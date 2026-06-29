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

// Domaines autorisés à appeler l'API depuis un navigateur (CORS).
// Tout autre site verra l'origine canonique → le navigateur bloque la réponse.
const ALLOWED_ORIGINS = [
  'https://www.elgaenergy.com',
  'https://elgaenergy.com',
  'http://localhost:8788',
  'http://localhost:8799',
  'http://127.0.0.1:8788',
  'http://127.0.0.1:8799',
];

function corsHeaders(request) {
  const origin = request && request.headers.get('Origin');
  const allow  = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

// ─── Anti-abus : limites par IP + plafond global (protège le budget Anthropic) ─
// Compteurs stockés en KV avec TTL. ⚠️ Fail-open : si le binding KV est ABSENT ou
// en ERREUR, AUCUNE limite ne s'applique (ni par IP, ni globale, car le plafond
// global passe lui aussi par KV) → on logge bruyamment pour le voir dans les logs.
// Choix assumé : ne pas punir un utilisateur légitime pour un glitch KV. Si le
// budget devient critique → migrer le compteur global sur un Durable Object (atomique).
const SCAN_LIMITS  = { maxHour: 8,  maxDay: 20, maxGlobalDay: 500 };
const ADMIN_LIMITS = { maxHour: 15, maxDay: 60, maxGlobalDay: 200 };

async function checkRateLimit(request, env, scope, limits) {
  if (!env.ELGA_KV) { console.error('checkRateLimit: binding ELGA_KV absent → aucune limite appliquée'); return null; }
  const ip  = request.headers.get('CF-Connecting-IP') || 'unknown';
  const iso = new Date().toISOString();
  const hKey = `rl:${scope}:h:${ip}:${iso.slice(0, 13).replace(/[-T:]/g, '')}`;
  const dKey = `rl:${scope}:d:${ip}:${iso.slice(0, 10).replace(/-/g, '')}`;
  const gKey = `rl:${scope}:g:${iso.slice(0, 10).replace(/-/g, '')}`;
  try {
    const [hRaw, dRaw, gRaw] = await Promise.all([
      env.ELGA_KV.get(hKey), env.ELGA_KV.get(dKey), env.ELGA_KV.get(gKey),
    ]);
    const h = parseInt(hRaw || '0', 10);
    const d = parseInt(dRaw || '0', 10);
    const g = parseInt(gRaw || '0', 10);
    if (h >= limits.maxHour)      return 3600;
    if (d >= limits.maxDay)       return 86400;
    if (g >= limits.maxGlobalDay) return 86400;
    await Promise.all([
      env.ELGA_KV.put(hKey, String(h + 1), { expirationTtl: 3600 }),
      env.ELGA_KV.put(dKey, String(d + 1), { expirationTtl: 86400 }),
      env.ELGA_KV.put(gKey, String(g + 1), { expirationTtl: 86400 }),
    ]);
    return null;
  } catch (e) {
    console.error('checkRateLimit: erreur KV → fail-open', e && e.message);
    return null;
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Prompt extraction de facture client ─────────────────────────────────────

const EXTRACTION_PROMPT = `Tu es un expert en factures d'énergie professionnelle française (électricité et gaz).
Tu sais lire les factures de tous les fournisseurs : EDF, Engie, TotalEnergies, Vattenfall, Endesa, GEG, Elmy, ilek, Primeo, SEFE, etc.

Analyse cette facture et extrais les informations ci-dessous en JSON valide. Si une valeur est introuvable, utilise null.

⚠️ RÈGLE CRITIQUE — ANNUALISATION :
- Identifie la période de facturation (ex : "du 16/03/2026 au 15/04/2026" = 1 mois).
- Tous les montants monétaires (total HT, total TTC, acheminement, taxes) doivent être des VALEURS ANNUELLES.
- Si la facture couvre N mois, multiplie les montants par (12/N) pour obtenir l'annuel.
- Si la facture contient plusieurs périodes (plusieurs mois), calcule d'abord la consommation mensuelle moyenne, puis extrapole sur 12 mois.
- Pour la consommation : si elle n'est pas explicitement annuelle, extrapole aussi sur 12 mois.
- N'extrais JAMAIS un montant mensuel ou bimestriel comme si c'était un montant annuel.

Réponds UNIQUEMENT avec le JSON, sans texte avant ou après :

{
  "supplier": "nom du fournisseur",
  "energy_type": "electricity" ou "gas" ou "both",
  "contract_type": "ex: MU4, CU4, C4-LU, T2, T3, Tarif Bleu, HC/HP, Base, etc.",
  "segment": "c5_mu4" ou "c5_cu4" ou "c4_lu" ou "c5_hta" ou "t2_p12" ou "t3" ou null,
  "power_kva": puissance souscrite en kVA (nombre seul),
  "billing_months": nombre de mois couverts par la facture (ex: 1, 2, 3, 12),
  "annual_consumption_mwh": consommation annuelle en MWh (ANNUALISÉE si besoin),
  "price_hph_mwh": prix fourniture HPH en €/MWh HT (hors CEE et capa si facturés séparément),
  "price_hch_mwh": prix fourniture HCH en €/MWh HT,
  "price_hpb_mwh": prix fourniture HPB en €/MWh HT (si différent de HPH),
  "price_hcb_mwh": prix fourniture HCB en €/MWh HT (si différent de HCH),
  "price_pte_mwh": prix Pointe en €/MWh HT (tarifs C4 uniquement),
  "price_base_mwh": prix Base en €/MWh HT (si tarif de base, pas HP/HC),
  "capa_mwh": coût du mécanisme de capacité en €/MWh (chercher "mécanisme de capacité" ou "capacité"),
  "cee_mwh": coût des CEE en €/MWh (si facturé séparément, sinon null),
  "subscription_monthly_ht": abonnement mensuel en € HT,
  "acheminement_annual_ht": coût annuel d'acheminement/TURPE en € HT (ANNUALISÉ),
  "acheminement_var_annual_ht": (EDF TARIF BLEU / TRV UNIQUEMENT) part VARIABLE de l'acheminement en € HT ANNUALISÉE — null sinon,
  "acheminement_fixe_annual_ht": (EDF TARIF BLEU / TRV UNIQUEMENT) part FIXE de l'acheminement en € HT ANNUALISÉE — null sinon,
  "accise_annual_ht": montant annuel de l'Accise sur l'énergie (ex-TICFE/CSPE) en € HT (ANNUALISÉ), null si introuvable,
  "cta_annual_ht": montant annuel de la CTA (Contribution Tarifaire d'Acheminement) en € HT (ANNUALISÉ), null si introuvable,
  "taxes_annual_ht": total annuel taxes (Accise + CTA) en € HT (ANNUALISÉ, hors TVA) — doit égaler accise + cta si les deux sont trouvés,
  "tva_pct": taux de TVA appliqué en % (ex: 20 ; 5.5 possible sur l'abonnement avant 08/2025),
  "total_ht_annual": total annuel HT en € (ANNUALISÉ, hors TVA),
  "total_ttc_annual": total annuel TTC en € (ANNUALISÉ, TVA incluse),
  "confidence": "high" si prix unitaires + conso + total trouvés, "medium" si partiel, "low" si peu de données
}

Notes importantes :
- Les prix unitaires (€/MWh) ne s'annualisent PAS — ce sont des prix fixes au contrat.
- Sur les factures EDF/certains fournisseurs, prix en centimes/kWh → convertir : diviser par 10 pour obtenir €/MWh.
- segment : c5_mu4 = ≤36 kVA (C5) usage moyen, c5_cu4 = ≤36 kVA (C5) usage court, c4_lu = 36-250 kVA (C4) longue utilisation, c5_hta = >250 kVA / HTA (C3 et au-delà). Gaz : t2_p12 = ≤200 MWh/an, t3 = 200-600 MWh/an.
- capa_mwh : chercher "mécanisme de capacité", souvent entre 0,50 et 15 €/MWh. Chez certains fournisseurs il est inclus dans le prix énergie (mettre null dans ce cas).
- acheminement = "Utilisation du réseau" ou "TURPE" ou "Coûts d'utilisation du réseau".
- EDF Tarif Bleu / TRV : la facture contient TOUJOURS une phrase du type « La part fixe de l'acheminement versé par EDF au gestionnaire de réseau est de X €, et la part variable est de Y € ». Extrais X → acheminement_fixe_annual_ht et Y → acheminement_var_annual_ht (ANNUALISÉS : ×12/N si la facture couvre N mois). Ces deux champs ne concernent QUE les factures EDF au Tarif Réglementé.
- accise = "Accise sur l'électricité" / "Accise sur les énergies" / ancien "TICFE" / "CSPE" (proportionnelle aux kWh).
- cta = "CTA" / "Contribution Tarifaire d'Acheminement" (assise sur la part fixe de l'acheminement).
- taxes_annual_ht = accise + cta (PAS la TVA). Sépare accise et cta si la facture les détaille ; sinon mets-les dans taxes_annual_ht.

⚡🔥 FACTURE 2 ÉNERGIES — RÈGLE IMPORTANTE :
- Si la facture contient À LA FOIS de l'électricité ET du gaz (energy_type = "both"), ajoute EN PLUS deux objets complets séparés, un par énergie, avec EXACTEMENT les mêmes champs que le schéma ci-dessus :
  "electricity": { ...tous les champs pour l'ÉLECTRICITÉ seule (energy_type="electricity", son contract_type, segment, power_kva, conso, prix, acheminement, taxes, totaux HT/TTC...) },
  "gas": { ...tous les champs pour le GAZ seul (energy_type="gas", son contract_type, segment, conso, prix, acheminement, taxes, totaux HT/TTC...) }
- Chaque sous-objet doit être AUTONOME (chiffres propres à cette énergie uniquement). Ne mélange JAMAIS les chiffres gaz et élec entre eux.
- Garde aussi les champs de premier niveau (vue globale, energy_type="both").
- Si la facture ne contient qu'UNE énergie, n'ajoute PAS ces sous-objets.`;

// ─── Prompt extraction depuis bilan comparatif ───────────────────────────────

const BILAN_EXTRACTION_PROMPT = `Tu es un expert en courtage d'énergie B2B en France.
On te fournit un bilan comparatif de fourniture d'énergie édité par un courtier (document avec tableaux de comparaison fournisseurs, prix par plage tarifaire, acheminement, taxes).

Le bilan compare PLUSIEURS fournisseurs (souvent 2 à 4), généralement classés du moins cher au plus cher. Tu dois extraire UNIQUEMENT le FOURNISSEUR N°1 — la première offre, c'est-à-dire la MOINS CHÈRE / la mieux classée du comparatif — pour constituer la grille tarifaire de référence Elga.

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
- RÈGLE CLÉ : prends TOUTES les valeurs du FOURNISSEUR N°1 (la 1ʳᵉ offre, la moins chère). Ne mélange JAMAIS plusieurs fournisseurs — toutes les valeurs d'un segment doivent provenir de la même offre (le N°1). N'invente rien : laisse à null ce que l'offre N°1 ne précise pas.
- Pour chaque segment présent, récupère le prix de CHAQUE plage tarifaire ET l'abonnement (abo_monthly) ET l'acheminement de cette offre N°1.
- Les prix dans les bilans sont déjà en €/MWh HT. Ne pas diviser par 1000.
- Si le bilan ne montre qu'un seul segment (ex. C5-MU4), laisse les autres à null.
- average_savings_pct = % d'économie moyen affiché pour le fournisseur N°1 si visible.`;

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
        // Accise sur l'électricité 2026 (ex-CSPE/TICFE), €/MWh HT — barème par tranche de puissance (au 01/02/2026)
        accise_mwh: 30.85,        // ≤ 36 kVA
        accise_mwh_high: 26.58,   // > 36 kVA
        cta_annual: 50,           // proxy CTA (15 % de la part fixe TURPE depuis le 01/02/2026)
        tva_pct: 20               // TVA 20 % sur toute la facture depuis 08/2025 (récupérable pour un pro)
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

// Taux d'accise élec selon la puissance souscrite (>36 kVA = tarif réduit pro).
function acciseRate(kva, taxes) {
  taxes = taxes || {};
  return (kva && kva > 36) ? (taxes.accise_mwh_high || 26.58) : (taxes.accise_mwh || 30.85);
}

function calculateSavings(bill, grid) {
  if (!grid) return null;

  const isGas      = bill.energy_type === 'gas';
  const consumptionMwh = bill.annual_consumption_mwh;
  const clientTTC  = bill.total_ttc_annual;
  const avgPct     = grid.meta?.average_savings_pct || 15;

  if (!clientTTC) return null;

  // ─── Détermination du segment ────────────────────────────────────────────
  let seg = bill.segment;
  if (!seg) {
    const kva = bill.power_kva;
    if (isGas) {
      seg = consumptionMwh > 200 ? 't3' : 't2_p12';
    } else if (kva) {
      // Nomenclature Enedis : ≤36 kVA = C5 ; 36-250 kVA = C4 (BT) ; >250 kVA / HTA = C3 et au-delà
      seg = kva > 250 ? 'c5_hta' : kva > 36 ? 'c4_lu' : 'c5_mu4';
    } else if (consumptionMwh) {
      seg = consumptionMwh > 300 ? 'c5_hta' : consumptionMwh > 50 ? 'c4_lu' : 'c5_mu4';
    } else {
      seg = 'c5_mu4';
    }
  }

  // ─── Gaz ─────────────────────────────────────────────────────────────────
  if (isGas && grid.gas) {
    const ref = grid.gas[seg === 't3' ? 't3' : 't2_p12'];
    if (!ref || !consumptionMwh) return fallbackSavings(clientTTC, avgPct, seg);

    // L'acheminement gaz est réglementé : même coût pour tous les fournisseurs
    // Les économies portent uniquement sur la molécule + CEE + CPB
    const clientMoleculeHT = bill.total_ht_annual
      ? bill.total_ht_annual
        - (bill.acheminement_annual_ht || consumptionMwh * (ref.acheminement_mwh || 12))
        - (bill.taxes_annual_ht || 0)
        - (bill.subscription_monthly_ht || ref.abo_monthly || 0) * 12
      : null;

    const elgaMoleculeHT = consumptionMwh * ((ref.molecule_mwh || 0) + (ref.cee_mwh || 0) + (ref.cpb_mwh || 0));

    if (clientMoleculeHT && clientMoleculeHT > elgaMoleculeHT && clientMoleculeHT > 100) {
      const savingsHT  = clientMoleculeHT - elgaMoleculeHT;
      const savingsTTC = savingsHT * 1.20;
      const pct = (savingsTTC / clientTTC) * 100;
      if (pct >= 1 && pct <= 45) {
        return makeResult(clientTTC, savingsTTC, pct, seg, false);
      }
    }
    return fallbackSavings(clientTTC, avgPct, seg);
  }

  // ─── Électricité ─────────────────────────────────────────────────────────
  if (!grid.electricity) return fallbackSavings(clientTTC, avgPct, seg);

  const ref   = grid.electricity[seg];
  const taxes = grid.electricity.taxes || {};
  const tva   = 1 + (taxes.tva_pct || 20) / 100;

  if (!ref || !consumptionMwh) return fallbackSavings(clientTTC, avgPct, seg);

  // ── Prix moyen pondéré ELGA (fourniture + CEE + capa) ───────────────────
  let elgaEnergyMwh;
  if (seg === 'c4_lu' && ref.pte) {
    elgaEnergyMwh = ref.pte * 0.05 + ref.hph * 0.25 + ref.hch * 0.15 + ref.hpb * 0.30 + ref.hcb * 0.25;
  } else {
    elgaEnergyMwh = (ref.hph || ref.hpb || 0) * 0.55 + (ref.hch || ref.hcb || 0) * 0.45;
  }
  elgaEnergyMwh += (ref.cee || 0) + (ref.capa || 0);

  // ── Prix moyen extrait de la facture client ─────────────────────────────
  // L'acheminement (TURPE) est réglementé : il est identique chez tous les fournisseurs.
  // Les économies portent uniquement sur la fourniture (énergie + CEE + capa).
  // On reconstitue le coût énergie client = total HT - acheminement - taxes - abo
  let clientEnergyMwh = null;

  // Méthode 1 : prix unitaires extraits directement
  const hp  = bill.price_hph_mwh || bill.price_hpb_mwh;
  const hc  = bill.price_hch_mwh || bill.price_hcb_mwh;
  const bas = bill.price_base_mwh;

  if (bas && bas > 30) {
    clientEnergyMwh = bas;
  } else if (hp && hc && hp > 30 && hc > 15) {
    clientEnergyMwh = hp * 0.55 + hc * 0.45;
  } else if (hp && hp > 30) {
    clientEnergyMwh = hp;
  }

  // Ajouter la capa et CEE si facturés séparément (ex: Vattenfall facture capa hors énergie)
  // La référence Elga inclut déjà capa+CEE → comparaison juste uniquement si on les ajoute
  if (clientEnergyMwh) {
    if (bill.capa_mwh && bill.capa_mwh > 0.1) clientEnergyMwh += bill.capa_mwh;
    if (bill.cee_mwh  && bill.cee_mwh  > 0.1) clientEnergyMwh += bill.cee_mwh;
  }

  // Méthode 2 : reconstitution depuis le total HT de la facture
  // Avantage : capture capa+CEE même si non extraits unitairement
  // On l'utilise aussi pour VÉRIFIER la méthode 1 (si M2 > M1 : capa/CEE manquants dans M1)
  if (bill.total_ht_annual && consumptionMwh) {
    const ach  = bill.acheminement_annual_ht || (ref.acheminement_annual || 0);
    const taxH = bill.taxes_annual_ht        || consumptionMwh * acciseRate(bill.power_kva, taxes);
    const aboH = (bill.subscription_monthly_ht || ref.abo_monthly || 0) * 12;
    const energyCapaCeeHT = bill.total_ht_annual - ach - taxH;
    if (energyCapaCeeHT > 0) {
      const m2 = (energyCapaCeeHT - aboH) / consumptionMwh;
      if (m2 > 20) {
        // Si M2 > M1 : la capa/CEE n'étaient pas dans M1 → prendre M2 (plus complet)
        // Si M1 nul : prendre M2 directement
        if (!clientEnergyMwh || m2 > clientEnergyMwh) clientEnergyMwh = m2;
      }
    }
  }

  // ── Calcul de l'économie ─────────────────────────────────────────────────
  if (clientEnergyMwh && clientEnergyMwh > elgaEnergyMwh && clientEnergyMwh > 20) {
    // Elga est moins cher sur l'énergie → calcul précis
    const savingsHT  = (clientEnergyMwh - elgaEnergyMwh) * consumptionMwh;
    const savingsTTC = savingsHT * tva;
    const pct        = (savingsTTC / clientTTC) * 100;
    if (pct >= 1 && pct <= 50) {
      return makeResult(clientTTC, savingsTTC, pct, seg, false);
    }
  }

  // Sinon : le client est peut-être déjà sur un bon prix de marché
  // → économies estimées plus conservatrices (abonnement, CEE, gestion)
  if (clientEnergyMwh && clientEnergyMwh <= elgaEnergyMwh) {
    // Client déjà compétitif → estimation conservatrice 5–8%
    const conservativePct = Math.min(avgPct * 0.45, 8);
    return fallbackSavings(clientTTC, Math.round(conservativePct), seg);
  }

  return fallbackSavings(clientTTC, avgPct, seg);
}

function makeResult(clientTTC, savingsTTC, pct, segment, isEstimate) {
  // Filet de sécurité : on n'affiche jamais de savings négatifs
  // Si Elga est plus cher, on montre une estimation conservative minimale
  if (pct < 1 || savingsTTC < 0) {
    const minPct = 5;
    const minSavings = clientTTC * minPct / 100;
    return { client_total_annual: Math.round(clientTTC), elga_total_annual: Math.round(clientTTC - minSavings), savings_annual: Math.round(minSavings), savings_pct: minPct, segment, is_estimate: true };
  }
  return {
    client_total_annual: Math.round(clientTTC),
    elga_total_annual:   Math.round(clientTTC - savingsTTC),
    savings_annual:      Math.round(savingsTTC),
    savings_pct:         Math.round(pct),
    segment,
    is_estimate:         isEstimate,
  };
}

function fallbackSavings(clientTTC, avgPct, segment) {
  if (!clientTTC) return null;
  const savings = Math.round(clientTTC * avgPct / 100);
  return {
    client_total_annual: Math.round(clientTTC),
    elga_total_annual:   Math.round(clientTTC - savings),
    savings_annual:      savings,
    savings_pct:         Math.round(avgPct),
    segment,
    is_estimate:         true,
  };
}

// ─── Handler : scan de facture ────────────────────────────────────────────────

async function handleScan(request, env) {
  const retry = await checkRateLimit(request, env, 'scan', SCAN_LIMITS);
  if (retry) {
    return jsonResponse({ error: 'Trop de scans pour le moment. Réessayez un peu plus tard.' }, 429);
  }

  let body;
  try { body = await request.json(); } catch {
    return jsonResponse({ error: 'Corps de requête invalide' }, 400);
  }

  const { file_data, file_name } = body;
  // Profil saisi côté site : 'particulier' | 'professionnel' (défaut pro = cœur de cible B2B).
  const clientType = body.client_type === 'particulier' ? 'particulier' : 'professionnel';
  const naf     = typeof body.naf === 'string'     ? body.naf.slice(0, 8)      : null;
  const secteur = typeof body.secteur === 'string' ? body.secteur.slice(0, 120) : null;
  // Garde-fou taille : base64 de ~10 Mo ≈ 13,6 M caractères.
  if (typeof file_data === 'string' && file_data.length > 14_000_000) {
    return jsonResponse({ error: 'Fichier trop volumineux (max ~10 Mo).' }, 413);
  }
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

  // Contexte profil : oriente l'extraction (un particulier raisonne TTC ≤36 kVA, un pro en HT).
  const profilContext = clientType === 'particulier'
    ? 'CONTEXTE : facture d\'un PARTICULIER (résidentiel, ≤36 kVA, prix souvent en c€/kWh, montants TTC, TVA NON récupérable). Raisonne en cohérence.\n\n'
    : 'CONTEXTE : facture d\'un PROFESSIONNEL (TVA récupérable, raisonner en € HT)' + (secteur ? `, secteur : ${secteur}` : '') + '.\n\n';

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
      messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: profilContext + EXTRACTION_PROMPT }] }],
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

  // Filet taxes : si accise/cta séparés mais total vide, on le reconstitue (le calcul s'en sert).
  const fixTaxes = (b) => {
    if (b && b.taxes_annual_ht == null && (b.accise_annual_ht != null || b.cta_annual_ht != null)) {
      b.taxes_annual_ht = (b.accise_annual_ht || 0) + (b.cta_annual_ht || 0);
    }
    return b;
  };
  fixTaxes(extracted);

  // ── Facture 2 ÉNERGIES (gaz + élec) : on calcule chaque énergie séparément ──
  if (extracted && extracted.energy_type === 'both' && extracted.electricity && extracted.gas) {
    const elecE = fixTaxes({ ...extracted.electricity, energy_type: 'electricity' });
    const gasE  = fixTaxes({ ...extracted.gas, energy_type: 'gas' });
    return jsonResponse({
      multi: true,
      energies: {
        electricity: { extracted: elecE, savings: calculateSavings(elecE, priceGrid) },
        gas:         { extracted: gasE,  savings: calculateSavings(gasE,  priceGrid) },
      },
      client_type: clientType, naf, secteur,
      price_grid_updated_at: priceGrid.meta?.updated_at,
    });
  }

  const savings = calculateSavings(extracted, priceGrid);
  return jsonResponse({
    extracted, savings,
    client_type: clientType, naf, secteur,
    price_grid_updated_at: priceGrid.meta?.updated_at,
  });
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
  const retry = await checkRateLimit(request, env, 'admin', ADMIN_LIMITS);
  if (retry) return jsonResponse({ error: 'Trop de tentatives. Réessayez plus tard.' }, 429);

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
  const retry = await checkRateLimit(request, env, 'admin', ADMIN_LIMITS);
  if (retry) return jsonResponse({ error: 'Trop de tentatives. Réessayez plus tard.' }, 429);

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
  if (typeof file_data === 'string' && file_data.length > 14_000_000) {
    return jsonResponse({ error: 'Fichier trop volumineux (max ~10 Mo).' }, 413);
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
    const cors   = corsHeaders(request);

    if (method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    let res;
    if (pathname === '/api/scan' && method === 'POST') {
      res = await handleScan(request, env);
    } else if (pathname === '/api/prices' && method === 'GET') {
      res = await handleGetPrices(request, env);
    } else if (pathname === '/api/prices' && method === 'POST') {
      res = await handleSetPrices(request, env);
    } else if (pathname === '/api/extract-prices' && method === 'POST') {
      res = await handleExtractPrices(request, env);
    } else {
      res = jsonResponse({ error: 'Route non trouvée', version: '2.1' }, 404);
    }

    // Applique le CORS par origine à toute réponse (centralisé ici).
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};
