/**
 * Elga Energy — Cloudflare Worker v2
 * Structure tarifaire réelle issue des bilans comparatifs 2026
 *
 * Endpoints:
 *   POST /api/scan           → analyse une facture avec Claude AI
 *   GET  /api/prices         → retourne la grille de prix courante
 *   POST /api/prices         → met à jour la grille (admin token requis)
 *   POST /api/extract-prices → extrait les prix d'un bilan comparatif (admin)
 *
 * Secrets Cloudflare (wrangler secret put) :
 *   ANTHROPIC_API_KEY  → clé API Anthropic
 *   ADMIN_TOKEN        → mot de passe admin
 *   ELGA_KV            → binding KV namespace
 */

const CLAUDE_MODEL   = 'claude-haiku-4-5-20251001';
const ANTHROPIC_API  = 'https://api.anthropic.com/v1/messages';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// ─── Prompt extraction de facture client ─────────────────────────────────────

const EXTRACTION_PROMPT = `Tu es un expert en factures d'énergie professionnelle française (électricité et gaz).
Tu sais lire les factures de tous les fournisseurs : EDF, Engie, TotalEnergies, Vattenfall, Endesa, GEG, Elmy, ilek, Primeo, SEFE, etc.

Analyse cette facture et extrais les informations ci-dessous en JSON valide. Si une valeur est introuvable, utilise null.

Réponds UNIQUEMENT avec le JSON, sans texte avant ou après :

{
  "supplier": "nom du fournisseur",
  "energy_type": "electricity" ou "gas" ou "both",
  "contract_type": "ex: MU4, CU4, C4-LU, T2, T3, Tarif Bleu, HC/HP, Base, etc.",
  "segment": "c5_mu4" ou "c5_cu4" ou "c4_lu" ou "c5_hta" ou "t2_p12" ou "t3" ou null,
  "power_kva": null,
  "annual_consumption_mwh": null,
  "price_hph_mwh": null,
  "price_hch_mwh": null,
  "price_hpb_mwh": null,
  "price_hcb_mwh": null,
  "price_pte_mwh": null,
  "price_base_mwh": null,
  "capa_mwh": null,
  "cee_mwh": null,
  "subscription_monthly_ht": null,
  "acheminement_annual_ht": null,
  "taxes_annual_ht": null,
  "total_ht_annual": null,
  "total_ttc_annual": null,
  "confidence": "high" ou "medium" ou "low"
}

Notes importantes :
- Les prix énergie sont en €/MWh (HT). Sur les factures EDF, ils peuvent être affichés en centimes/kWh — convertis en divisant par 10.
- segment : c5_mu4 = ≤36 kVA usage moyen (restaurant, hôtel), c5_cu4 = ≤36 kVA usage court (pompage, saisonnier),
  c4_lu = 36-250 kVA longue utilisation (industriel, gros agricole), c5_hta = >36 kVA haute tension.
  Pour le gaz : t2_p12 = ≤200 MWh/an, t3 = 200-600 MWh/an.
- annual_consumption_mwh : si la facture ne couvre pas 12 mois, extrapoler.
- total_ht_annual et total_ttc_annual : montant ANNUEL estimé.
- confidence = high si prix + conso trouvés, medium si partiel, low si peu de données.`;

// ─── Prompt extraction depuis bilan comparatif ───────────────────────────────

const BILAN_EXTRACTION_PROMPT = `Tu es un expert en courtage d'énergie B2B en France.
On te fournit un bilan comparatif de fourniture d'énergie édité par un courtier (document avec tableaux de comparaison fournisseurs, prix par plage tarifaire, acheminement, taxes).

Extrais les meilleurs prix Elga / courtier (les prix les plus compétitifs proposés) pour constituer une grille tarifaire de référence.

Structure des prix électricité (en €/MWh HT) :
- C4-LU (Longue Utilisation, 36-250 kVA) : 5 plages Pte / HPH / HCH / HPB / HCB + mécanisme de capacité (capa) + CEE
- C5-MU4 (Moyenne Utilisation, ≤36 kVA) : 4 plages HPH / HCH / HPB / HCB + capa + CEE
- C5-CU4 (Courte Utilisation, ≤36 kVA) : 4 plages HPH / HCH / HPB / HCB + capa + CEE
- C5-HTA (>36 kVA haute tension) : 4 plages HPH / HCH / HPB / HCB + capa + CEE

Structure des prix gaz (en €/MWh HT) :
- T2 (≤200 MWh/an) : molécule + CEE + CPB + acheminement réseau
- T3 (200-600 MWh/an) : idem

Réponds UNIQUEMENT avec ce JSON valide (null si non trouvé) :

{
  "electricity": {
    "c4_lu": {
      "pte": null, "hph": null, "hch": null, "hpb": null, "hcb": null,
      "cee": null, "capa": null,
      "acheminement_annual": null, "abo_monthly": null
    },
    "c5_mu4": {
      "hph": null, "hch": null, "hpb": null, "hcb": null,
      "cee": null, "capa": null,
      "acheminement_annual": null, "abo_monthly": null
    },
    "c5_cu4": {
      "hph": null, "hch": null, "hpb": null, "hcb": null,
      "cee": null, "capa": null,
      "acheminement_annual": null, "abo_monthly": null
    },
    "c5_hta": {
      "hph": null, "hch": null, "hpb": null, "hcb": null,
      "cee": null, "capa": null,
      "acheminement_annual": null, "abo_monthly": null
    },
    "taxes": { "accise_mwh": null, "cta_annual": null, "tva_pct": null }
  },
  "gas": {
    "t2_p12": {
      "molecule_mwh": null, "cee_mwh": null, "cpb_mwh": null, "acheminement_mwh": null,
      "abo_monthly": null, "cta_annual": null, "accise_mwh": null, "tva_pct": null
    },
    "t3": {
      "molecule_mwh": null, "cee_mwh": null, "cpb_mwh": null, "acheminement_mwh": null,
      "abo_monthly": null, "cta_annual": null, "accise_mwh": null, "tva_pct": null
    }
  },
  "meta": {
    "average_savings_pct": null,
    "notes": "brève explication des données trouvées"
  },
  "confidence": "high" ou "medium" ou "low"
}

Notes :
- Prends les MEILLEURS prix (les plus bas proposés dans le document).
- Les prix dans les bilans sont déjà en €/MWh HT. Ne pas diviser par 1000.
- Si le bilan montre uniquement C5-MU4, laisse les autres segments à null.
- average_savings_pct = % d'économie moyen constaté si visible dans le bilan.`;

// ─── Grille de prix par défaut (valeurs 2026 issues des bilans réels) ─────────

function getDefaultPrices() {
  return {
    electricity: {
      c4_lu: {
        pte: 121.00, hph: 121.00, hch: 86.00, hpb: 57.00, hcb: 45.00,
        cee: 11.00, capa: 0.66,
        acheminement_annual: 4610, abo_monthly: 0
      },
      c5_mu4: {
        hph: 87.00, hch: 74.00, hpb: 87.00, hcb: 74.00,
        cee: 11.15, capa: 0.66,
        acheminement_annual: 1320, abo_monthly: 10.00
      },
      c5_cu4: {
        hph: 84.00, hch: 84.00, hpb: 84.00, hcb: 84.00,
        cee: 11.00, capa: 0.66,
        acheminement_annual: 1707, abo_monthly: 0
      },
      c5_hta: {
        hph: 82.27, hch: 69.38, hpb: 82.27, hcb: 69.38,
        cee: 11.22, capa: 0.66,
        acheminement_annual: 1530, abo_monthly: 12.60
      },
      taxes: {
        accise_mwh: 20.50,
        cta_annual: 50,
        tva_pct: 20
      }
    },
    gas: {
      t2_p12: {
        molecule_mwh: 54.00, cee_mwh: 12.43, cpb_mwh: 0.41, acheminement_mwh: 12.08,
        abo_monthly: 22.06, cta_annual: 46, accise_mwh: 16.39, tva_pct: 20
      },
      t3: {
        molecule_mwh: 52.00, cee_mwh: 12.00, cpb_mwh: 0.41, acheminement_mwh: 9.00,
        abo_monthly: 200.00, cta_annual: 200, accise_mwh: 16.39, tva_pct: 20
      }
    },
    meta: {
      updated_at: null,
      average_savings_pct: 15,
      notes: ''
    }
  };
}

// ─── Calcul des économies ─────────────────────────────────────────────────────

function calculateSavings(bill, grid) {
  if (!grid) return null;

  const isGas = bill.energy_type === 'gas';
  const isElec = bill.energy_type === 'electricity' || !isGas;

  const consumptionMwh = bill.annual_consumption_mwh;
  const avgPct = grid.meta?.average_savings_pct || 15;

  // ─ Cas gaz ─
  if (isGas && grid.gas) {
    const segment = bill.segment === 't3' ? 't3' : 't2_p12';
    const ref = grid.gas[segment];
    if (!ref || !consumptionMwh) return fallbackSavings(bill.total_ttc_annual, avgPct, segment);

    const totalPrixMwh = (ref.molecule_mwh || 0) + (ref.cee_mwh || 0) + (ref.cpb_mwh || 0) + (ref.acheminement_mwh || 0);
    const elgaEnergyHT = consumptionMwh * totalPrixMwh;
    const elgaAboHT    = (ref.abo_monthly || 0) * 12;
    const elgaCTA      = ref.cta_annual || 0;
    const elgaAccise   = consumptionMwh * (ref.accise_mwh || 16.39);
    const tva          = 1 + (ref.tva_pct || 20) / 100;
    const elgaTTC      = (elgaEnergyHT + elgaAboHT + elgaCTA + elgaAccise) * tva;

    const clientTTC = bill.total_ttc_annual;
    if (!clientTTC) return fallbackSavings(null, avgPct, segment);

    return buildResult(clientTTC, elgaTTC, avgPct, segment);
  }

  // ─ Cas électricité ─
  if (!grid.electricity) return null;

  // Détermination du segment
  const kva = bill.power_kva;
  let seg = bill.segment;
  if (!seg) {
    if (kva) {
      if (kva > 250)  seg = 'c4_lu';
      else if (kva > 36) seg = 'c5_hta';
      else seg = 'c5_mu4';
    } else if (consumptionMwh) {
      if (consumptionMwh > 300) seg = 'c4_lu';
      else if (consumptionMwh > 50) seg = 'c5_hta';
      else seg = 'c5_mu4';
    } else {
      seg = 'c5_mu4';
    }
  }

  const ref  = grid.electricity[seg];
  const taxes = grid.electricity.taxes || {};

  if (!ref || !consumptionMwh) return fallbackSavings(bill.total_ttc_annual, avgPct, seg);

  // Prix moyen pondéré selon les plages disponibles
  // Distribution typique : HPH 30% / HCH 20% / HPB 30% / HCB 20%
  // Pour C4 avec Pte : Pte 5% / HPH 25% / HCH 15% / HPB 30% / HCB 25%
  let avgPriceMwh;
  if (seg === 'c4_lu' && ref.pte) {
    avgPriceMwh = ref.pte * 0.05 + ref.hph * 0.25 + ref.hch * 0.15 + ref.hpb * 0.30 + ref.hcb * 0.25;
  } else {
    avgPriceMwh = (ref.hph || ref.hpb || 0) * 0.60 + (ref.hch || ref.hcb || 0) * 0.40;
  }

  const cee  = ref.cee  || 0;
  const capa = ref.capa || 0;
  const ach  = ref.acheminement_annual || 0;
  const abo  = (ref.abo_monthly || 0) * 12;
  const accise = consumptionMwh * (taxes.accise_mwh || 20.50);
  const cta    = taxes.cta_annual || 50;
  const tva    = 1 + (taxes.tva_pct || 20) / 100;

  const elgaEnergyHT = consumptionMwh * (avgPriceMwh + cee + capa);
  const elgaTTC = (elgaEnergyHT + ach + abo + accise + cta) * tva;

  const clientTTC = bill.total_ttc_annual;
  if (!clientTTC) return fallbackSavings(null, avgPct, seg);

  return buildResult(clientTTC, elgaTTC, avgPct, seg);
}

function fallbackSavings(clientTTC, avgPct, segment) {
  if (!clientTTC) return null;
  const savings = Math.round(clientTTC * avgPct / 100);
  return {
    client_total_annual: Math.round(clientTTC),
    elga_total_annual:   Math.round(clientTTC - savings),
    savings_annual:      savings,
    savings_pct:         avgPct,
    segment,
    is_estimate:         true
  };
}

function buildResult(clientTTC, elgaTTC, avgPct, segment) {
  const rawSavings = clientTTC - elgaTTC;
  const rawPct     = (rawSavings / clientTTC) * 100;
  // Si Elga est moins cher : utilise le calcul. Sinon, applique le % moyen (cas edge).
  const savings = rawPct > 2 ? rawSavings : clientTTC * avgPct / 100;
  const pct     = rawPct > 2 ? rawPct     : avgPct;
  return {
    client_total_annual: Math.round(clientTTC),
    elga_total_annual:   Math.round(clientTTC - savings),
    savings_annual:      Math.round(savings),
    savings_pct:         Math.round(pct),
    segment,
    is_estimate:         rawPct <= 2
  };
}

// ─── Handler : scan de facture ────────────────────────────────────────────────

async function handleScan(request, env) {
  let body;
  try { body = await request.json(); } catch {
    return jsonResponse({ error: 'Corps de requête invalide' }, 400);
  }

  const { file_data, file_name } = body;
  // Normalise le type : certains navigateurs envoient un type vide pour les PDF
  let file_type = body.file_type || '';
  if (!file_type && file_name && file_name.toLowerCase().endsWith('.pdf')) file_type = 'application/pdf';
  if (!file_type && file_name && /\.(jpg|jpeg)$/i.test(file_name)) file_type = 'image/jpeg';
  if (!file_type && file_name && /\.png$/i.test(file_name)) file_type = 'image/png';
  if (!file_type && file_name && /\.webp$/i.test(file_name)) file_type = 'image/webp';

  if (!file_data) {
    return jsonResponse({ error: 'file_data est requis' }, 400);
  }
  if (!file_type) {
    return jsonResponse({ error: 'Format non reconnu. Utilisez un PDF, JPG ou PNG.' }, 400);
  }

  let priceGrid = getDefaultPrices();
  try {
    const raw = await env.ELGA_KV.get('price_grid');
    if (raw) priceGrid = JSON.parse(raw);
  } catch {}

  const isImage = file_type.startsWith('image/');
  const isPdf   = file_type === 'application/pdf' || file_type === 'application/octet-stream';
  if (!isImage && !isPdf) {
    return jsonResponse({ error: 'Format non supporté. Utilisez PDF, JPG, PNG ou WEBP.' }, 400);
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
      messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: EXTRACTION_PROMPT }] }],
    }),
  });

  if (!claudeRes.ok) {
    const errText = await claudeRes.text();
    return jsonResponse({ error: 'Erreur IA', detail: errText }, 502);
  }

  const claudeData = await claudeRes.json();
  let extracted;
  try {
    const text  = claudeData.content[0].text.trim();
    const match = text.match(/\{[\s\S]*\}/);
    extracted   = JSON.parse(match ? match[0] : text);
  } catch {
    return jsonResponse({ error: 'Impossible de lire la réponse IA', raw: claudeData }, 502);
  }

  const savings = calculateSavings(extracted, priceGrid);
  return jsonResponse({ extracted, savings, price_grid_updated_at: priceGrid.meta?.updated_at });
}

// ─── Handler : lecture de la grille de prix ───────────────────────────────────

async function handleGetPrices(request, env) {
  // Auth optionnelle : si token admin fourni, on retourne la grille complète,
  // sinon on retourne aussi (la grille est publique en lecture)
  try {
    const raw = await env.ELGA_KV.get('price_grid');
    if (raw) return jsonResponse(JSON.parse(raw));
  } catch {}
  return jsonResponse(getDefaultPrices());
}

// ─── Handler : mise à jour de la grille de prix ───────────────────────────────

async function handleSetPrices(request, env) {
  const auth  = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token || token !== env.ADMIN_TOKEN) {
    return jsonResponse({ error: 'Non autorisé' }, 401);
  }

  let body;
  try { body = await request.json(); } catch {
    return jsonResponse({ error: 'JSON invalide' }, 400);
  }

  if (!body.meta) body.meta = {};
  body.meta.updated_at = new Date().toISOString().split('T')[0];
  await env.ELGA_KV.put('price_grid', JSON.stringify(body));
  return jsonResponse({ ok: true, updated_at: body.meta.updated_at });
}

// ─── Handler : extraction prix depuis un bilan comparatif ─────────────────────

async function handleExtractPrices(request, env) {
  const auth  = request.headers.get('Authorization') || '';
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
  const isPdf   = file_type === 'application/pdf';
  if (!isImage && !isPdf) {
    return jsonResponse({ error: 'Format non supporté' }, 400);
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
      max_tokens: 2048,
      messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: BILAN_EXTRACTION_PROMPT }] }],
    }),
  });

  if (!claudeRes.ok) {
    const errText = await claudeRes.text();
    return jsonResponse({ error: 'Erreur IA', detail: errText }, 502);
  }

  const claudeData = await claudeRes.json();
  let extracted;
  try {
    const text  = claudeData.content[0].text.trim();
    const match = text.match(/\{[\s\S]*\}/);
    extracted   = JSON.parse(match ? match[0] : text);
  } catch {
    return jsonResponse({ error: 'Impossible de parser la réponse IA', raw: claudeData }, 502);
  }

  return jsonResponse({ extracted });
}

// ─── Router principal ─────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (pathname === '/api/scan' && method === 'POST') {
      return handleScan(request, env);
    }

    if (pathname === '/api/prices' && method === 'GET') {
      return handleGetPrices(request, env);
    }

    if (pathname === '/api/prices' && method === 'POST') {
      return handleSetPrices(request, env);
    }

    if (pathname === '/api/extract-prices' && method === 'POST') {
      return handleExtractPrices(request, env);
    }

    return jsonResponse({ error: 'Route non trouvée', version: '2.0' }, 404);
  },
};
