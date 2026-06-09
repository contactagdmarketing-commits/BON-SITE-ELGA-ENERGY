/**
 * Elga Energy — Cloudflare Worker
 * Endpoints:
 *   POST /api/scan         → analyse une facture avec Claude AI
 *   GET  /api/prices       → retourne la grille de prix courante
 *   POST /api/prices       → met à jour la grille (admin token requis)
 *
 * Variables d'environnement (Cloudflare Dashboard > Settings > Variables) :
 *   ANTHROPIC_API_KEY  → votre clé API Anthropic
 *   ADMIN_TOKEN        → mot de passe admin (choisissez-le vous-même)
 *   ELGA_KV            → binding KV namespace "ELGA_KV"
 */

const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// ─── Prompt d'extraction ────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `Tu es un expert en factures d'énergie françaises (électricité et gaz).
Tu sais lire les factures de tous les fournisseurs : EDF, Engie, TotalEnergies, Vattenfall, Eni, Ohm Énergie, Ekwateur, Alpiq, Gaz de Bordeaux, etc.

Analyse cette facture et extrais les informations ci-dessous en JSON valide. Si une valeur est introuvable, utilise null.

Réponds UNIQUEMENT avec le JSON, sans texte avant ou après :

{
  "supplier": "nom du fournisseur",
  "energy_type": "electricity" ou "gas" ou "both",
  "contract_type": "ex: Tarif Bleu, Tempo, HC/HP, Base, Marché, etc.",
  "power_kva": null,
  "annual_consumption_kwh": null,
  "price_kwh_hp": null,
  "price_kwh_hc": null,
  "price_kwh_base": null,
  "subscription_annual_ht": null,
  "total_ht_period": null,
  "total_ttc_period": null,
  "period_months": null,
  "estimated_annual_total_ttc": null,
  "confidence": "high" ou "medium" ou "low"
}

Notes :
- price_kwh_hp et price_kwh_hc sont en €HT/kWh (heures pleines et heures creuses)
- price_kwh_base est en €HT/kWh si le contrat est Base (pas de HP/HC)
- estimated_annual_total_ttc = extrapolation sur 12 mois si la facture couvre moins
- confidence = high si tu as trouvé les prix et la conso, medium si partiel, low si peu de données`;

// ─── Calcul des économies ────────────────────────────────────────────────────

function calculateSavings(bill, grid) {
  if (!grid || !grid.electricity) return null;

  const consumption = bill.annual_consumption_kwh;

  // Coût actuel client (annuel TTC)
  let clientTotal = bill.estimated_annual_total_ttc;

  // Si pas de total, on reconstitue depuis les composants
  if (!clientTotal && consumption) {
    const priceHp = bill.price_kwh_hp || bill.price_kwh_base || 0;
    const priceHc = bill.price_kwh_hc || 0;
    const hasHc = priceHp > 0 && priceHc > 0;
    const energyCost = hasHc
      ? consumption * 0.6 * priceHp + consumption * 0.4 * priceHc
      : consumption * priceHp;
    const sub = bill.subscription_annual_ht || 0;
    // TURPE + taxes fixes ≈ 0.065 €/kWh (estimation France B2B 2026)
    const taxes = consumption * 0.065;
    clientTotal = (energyCost + sub + taxes) * 1.2;
  }

  if (!clientTotal || clientTotal < 100) return null;

  // Segment tarifaire selon puissance ou conso
  let segment = 'c2_small';
  const kva = bill.power_kva;
  const kwh = consumption || 0;
  if (kva) {
    if (kva > 250) segment = 'c4_large';
    else if (kva > 36) segment = 'c3_medium';
  } else if (kwh) {
    if (kwh > 500000) segment = 'c4_large';
    else if (kwh > 100000) segment = 'c3_medium';
  }

  const ref = grid.electricity[segment];
  if (!ref) return null;

  // Coût Elga estimé
  let elgaTotal = null;
  if (consumption) {
    const refHp = ref.kwh_hp || ref.kwh_base || 0;
    const refHc = ref.kwh_hc || 0;
    const hasHc = bill.price_kwh_hc && refHc > 0;
    const elgaEnergy = hasHc
      ? consumption * 0.6 * refHp + consumption * 0.4 * refHc
      : consumption * refHp;
    const elgaSub = (ref.subscription_monthly || 0) * 12;
    const taxes = consumption * 0.065;
    elgaTotal = (elgaEnergy + elgaSub + taxes) * 1.2;
  }

  // Si pas de conso pour calculer précisément, on applique le % moyen
  const avgPct = grid.average_savings_pct || 20;
  if (!elgaTotal) {
    const savings = Math.round(clientTotal * (avgPct / 100));
    return {
      client_total_annual: Math.round(clientTotal),
      elga_total_annual: Math.round(clientTotal - savings),
      savings_annual: savings,
      savings_pct: avgPct,
      segment,
      is_estimate: true,
    };
  }

  const savings = clientTotal - elgaTotal;
  const savingsPct = (savings / clientTotal) * 100;

  // Si le calcul donne < 5 %, on applique le plancher moyen (offre toujours meilleure)
  const effectiveSavings = savingsPct > 5 ? savings : clientTotal * (avgPct / 100);
  const effectivePct = savingsPct > 5 ? savingsPct : avgPct;

  return {
    client_total_annual: Math.round(clientTotal),
    elga_total_annual: Math.round(clientTotal - effectiveSavings),
    savings_annual: Math.round(effectiveSavings),
    savings_pct: Math.round(effectivePct),
    segment,
    is_estimate: savingsPct <= 5,
  };
}

// ─── Handler : scan de facture ───────────────────────────────────────────────

async function handleScan(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Corps de requête invalide' }, 400);
  }

  const { file_data, file_type } = body;
  if (!file_data || !file_type) {
    return jsonResponse({ error: 'file_data et file_type sont requis' }, 400);
  }

  // Récupère la grille de prix courante
  let priceGrid = getDefaultPrices();
  try {
    const raw = await env.ELGA_KV.get('price_grid');
    if (raw) priceGrid = JSON.parse(raw);
  } catch {}

  // Construction du bloc de contenu pour Claude
  const isImage = file_type.startsWith('image/');
  const isPdf = file_type === 'application/pdf';

  if (!isImage && !isPdf) {
    return jsonResponse({ error: 'Format non supporté. Utilisez PDF, JPG, PNG ou WEBP.' }, 400);
  }

  let contentBlock;
  if (isImage) {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const mediaType = allowedTypes.includes(file_type) ? file_type : 'image/jpeg';
    contentBlock = {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: file_data },
    };
  } else {
    contentBlock = {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: file_data },
    };
  }

  // Appel à l'API Claude
  const claudeRes = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'pdfs-2024-09-25',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            contentBlock,
            { type: 'text', text: EXTRACTION_PROMPT },
          ],
        },
      ],
    }),
  });

  if (!claudeRes.ok) {
    const errText = await claudeRes.text();
    console.error('Claude API error:', errText);
    return jsonResponse({ error: 'Erreur lors de l\'analyse IA', detail: errText }, 502);
  }

  const claudeData = await claudeRes.json();
  let extracted;
  try {
    const text = claudeData.content[0].text.trim();
    const match = text.match(/\{[\s\S]*\}/);
    extracted = JSON.parse(match ? match[0] : text);
  } catch (e) {
    return jsonResponse({ error: 'Impossible de lire la réponse IA', raw: claudeData }, 502);
  }

  const savings = calculateSavings(extracted, priceGrid);

  return jsonResponse({ extracted, savings, price_grid_updated_at: priceGrid.updated_at });
}

// ─── Handler : lecture de la grille de prix ──────────────────────────────────

async function handleGetPrices(env) {
  try {
    const raw = await env.ELGA_KV.get('price_grid');
    if (raw) return jsonResponse(JSON.parse(raw));
  } catch {}
  return jsonResponse(getDefaultPrices());
}

// ─── Handler : mise à jour de la grille de prix ──────────────────────────────

async function handleSetPrices(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token || token !== env.ADMIN_TOKEN) {
    return jsonResponse({ error: 'Non autorisé' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'JSON invalide' }, 400);
  }

  body.updated_at = new Date().toISOString().split('T')[0];
  await env.ELGA_KV.put('price_grid', JSON.stringify(body));
  return jsonResponse({ ok: true, updated_at: body.updated_at });
}

// ─── Grille de prix par défaut ───────────────────────────────────────────────

function getDefaultPrices() {
  return {
    updated_at: null,
    electricity: {
      c2_small: {
        label: 'Petit professionnel (≤ 36 kVA)',
        kwh_hp: 0.1450,
        kwh_hc: 0.0950,
        kwh_base: 0.1350,
        subscription_monthly: 35,
      },
      c3_medium: {
        label: 'Moyen professionnel (36 – 250 kVA)',
        kwh_hp: 0.1380,
        kwh_hc: 0.0890,
        kwh_base: 0.1280,
        subscription_monthly: 55,
      },
      c4_large: {
        label: 'Grand compte (> 250 kVA)',
        kwh_hp: 0.1320,
        kwh_hc: 0.0840,
        kwh_base: 0.1200,
        subscription_monthly: 90,
      },
      c5_industrial: {
        label: 'Industriel / Grand site (> 1 000 kVA)',
        kwh_hp: 0.1180,
        kwh_hc: 0.0750,
        kwh_base: 0.1100,
        subscription_monthly: 180,
      },
    },
    gas: {
      t2_small: {
        label: 'Petite conso gaz (< 300 MWh/an)',
        kwh: 0.0850,
        subscription_monthly: 45,
      },
      t3_medium: {
        label: 'Moyenne conso gaz (300 – 5 000 MWh/an)',
        kwh: 0.0780,
        subscription_monthly: 75,
      },
    },
    average_savings_pct: 22,
  };
}

// ─── Handler : extraction des prix depuis un bilan comparatif ────────────────

const BILAN_EXTRACTION_PROMPT = `Tu es un expert en courtage d'énergie B2B en France. On te fournit un bilan comparatif ou un tableau de comparaison fournisseurs édité par un courtier en énergie.

Extrais les meilleurs prix de référence (les prix les plus compétitifs proposés) pour constituer une grille de référence.

Réponds UNIQUEMENT avec ce JSON valide (null si non trouvé) :

{
  "electricity": {
    "c2_small": { "kwh_hp": null, "kwh_hc": null, "kwh_base": null, "subscription_monthly": null },
    "c3_medium": { "kwh_hp": null, "kwh_hc": null, "kwh_base": null, "subscription_monthly": null },
    "c4_large": { "kwh_hp": null, "kwh_hc": null, "kwh_base": null, "subscription_monthly": null },
    "c5_industrial": { "kwh_hp": null, "kwh_hc": null, "kwh_base": null, "subscription_monthly": null }
  },
  "gas": {
    "t2_small": { "kwh": null, "subscription_monthly": null },
    "t3_medium": { "kwh": null, "subscription_monthly": null }
  },
  "average_savings_pct": null,
  "confidence": "high" ou "medium" ou "low",
  "notes": "brève explication des données trouvées"
}

Notes importantes :
- Prends les prix HT en €/kWh
- Si tu vois plusieurs offres, prends la moins chère (meilleur prix négocié)
- C2 = petits pro ≤36 kVA, C3 = moyens 36-250 kVA, C4 = grands >250 kVA, C5 = industriels >1000 kVA
- average_savings_pct = % d'économie moyen constaté dans le bilan (si visible)`;

async function handleExtractPrices(request, env) {
  // Vérification admin token
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token || token !== env.ADMIN_TOKEN) {
    return jsonResponse({ error: 'Non autorisé' }, 401);
  }

  let body;
  try { body = await request.json(); } catch {
    return jsonResponse({ error: 'JSON invalide' }, 400);
  }

  const { file_data, file_type } = body;
  if (!file_data || !file_type) {
    return jsonResponse({ error: 'file_data et file_type requis' }, 400);
  }

  const isImage = file_type.startsWith('image/');
  const isPdf = file_type === 'application/pdf';
  if (!isImage && !isPdf) {
    return jsonResponse({ error: 'Format non supporté (PDF, JPG, PNG)' }, 400);
  }

  const contentBlock = isImage
    ? { type: 'image', source: { type: 'base64', media_type: file_type, data: file_data } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file_data } };

  const claudeRes = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'pdfs-2024-09-25',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: BILAN_EXTRACTION_PROMPT }] }],
    }),
  });

  if (!claudeRes.ok) {
    return jsonResponse({ error: 'Erreur IA', detail: await claudeRes.text() }, 502);
  }

  const claudeData = await claudeRes.json();
  let extracted;
  try {
    const text = claudeData.content[0].text.trim();
    const match = text.match(/\{[\s\S]*\}/);
    extracted = JSON.parse(match ? match[0] : text);
  } catch {
    return jsonResponse({ error: 'Impossible de parser la réponse IA' }, 502);
  }

  return jsonResponse({ extracted });
}

// ─── Point d'entrée ──────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === '/api/scan' && request.method === 'POST') {
      return handleScan(request, env);
    }
    if (url.pathname === '/api/prices' && request.method === 'GET') {
      return handleGetPrices(env);
    }
    if (url.pathname === '/api/prices' && request.method === 'POST') {
      return handleSetPrices(request, env);
    }
    if (url.pathname === '/api/extract-prices' && request.method === 'POST') {
      return handleExtractPrices(request, env);
    }

    return new Response('Not found', { status: 404 });
  },
};
