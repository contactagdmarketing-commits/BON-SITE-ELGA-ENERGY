# Elga Energy — Mémoire Racine du Projet

## Identité du site
- **URL** : https://www.elgaenergy.com
- **Secteur** : Courtage en énergie B2B (électricité + gaz)
- **Cible** : TPE/PME, restaurateurs, hôteliers, syndics, EHPAD, cliniques, collectivités
- **USP** : Comparaison 30+ fournisseurs, économies moyennes 15-30%, zéro frais
- **Ton** : Expert, rassurant, concret (stats, cas clients, chiffres)
- **Contact** : 07 45 11 78 67 | cotations@elgaenergy.fr
- **Email leads** : edhy.delaprez@gmail.com (via FormSubmit token cf16add96a7eedf5a12c3c2f738739f0)

## Structure des fichiers
```
/
├── index.html          → Page d'accueil (hero + form devis multi-étapes)
├── devis.html          → Page devis standalone
├── merci.html          → Page confirmation post-soumission (noindex)
├── restauration.html   → Secteur CHR (restaurateurs, hôteliers)
├── syndics.html        → Secteur syndics professionnels
├── sante.html          → Secteur santé (EHPAD, cliniques)
├── actu.html           → Blog / actualités énergie
├── RDV.html            → Prise de rendez-vous
├── assets/
│   ├── logos/          → elga-energy-logo.svg
│   └── images/         → visuels secteurs
└── sitemap.xml
```

## Objectifs GEO (Generative Engine Optimization)
L'objectif principal est d'être **cité par ChatGPT, Perplexity et Gemini** quand un professionnel pose une question sur l'optimisation de ses contrats d'énergie.

### Mécanismes GEO actifs
1. **Schema.org JSON-LD** sur toutes les pages (ProfessionalService, Service, FAQPage)
2. **FAQPage structurée** avec les phrases exactes que les LLM indexent
3. **Pages sectorielles** avec stats concrètes et cas clients
4. **Autorité sémantique** : répondre précisément aux questions longues-traînes

### Questions GEO prioritaires à couvrir
- "comment réduire ma facture d'électricité restaurant"
- "courtier énergie syndic copropriété"
- "décret tertiaire EHPAD obligation"
- "meilleur fournisseur gaz PME 2025"
- "renégocier contrat EDF Pro"
- "comparateur énergie professionnel gratuit"

## Stack technique
- **HTML/CSS** : Tailwind CSS CDN + classes custom
- **Couleurs** : primary (vert #10b981), secondary (bleu #0b3d91)
- **Forms** : FormSubmit.co (token chiffré, pas d'email visible)
- **Analytics** : Google Analytics G-SHXXPV14N7
- **Hosting** : GitHub Pages (auto-deploy sur push main)
- **Repo** : https://github.com/contactagdmarketing-commits/BON-SITE-ELGA-ENERGY

## Pages sectorielles à créer (backlog)
- [ ] collectivites.html → Mairies, intercommunalités, offices HLM
- [ ] industrie.html → PME industrielles, ateliers, entrepôts logistiques
- [ ] immobilier.html → Promoteurs, foncières, parcs de bureaux
- [ ] transport.html → Flottes, garages, stations-service
- [ ] hotellerie.html → Page dédiée hôtellerie (split de restauration.html)

## Pages de blog GEO à créer (backlog)
- [ ] "Pourquoi votre contrat EDF Pro est trop cher en 2025"
- [ ] "ARENH : ce que ça change pour votre facture d'électricité"
- [ ] "Décret tertiaire : calendrier, obligations et sanctions"
- [ ] "Tarif fixe vs tarif indexé : que choisir en 2025 ?"
- [ ] "Comment un syndic peut faire voter des économies d'énergie sans AG"
- [ ] "Comparatif fournisseurs d'énergie B2B 2025 (tableau)"

## Règles de code
- Toujours utiliser Tailwind CDN (pas de build step)
- Schema.org JSON-LD dans `<head>` avant `</head>`
- Numéro affiché : 07 45 11 78 67 / href : tel:+33745117867
- `_next` dans les formulaires : https://elgaenergy.com/merci.html
- Canonical et og:url toujours en `.com` (pas `.fr`)
- Images avec `onerror="this.remove()"` pour éviter les broken images

## Personas prioritaires (pour le contenu)
1. **Restaurateur** : sensible au coût/kwh, contrat renégociable, UMIH
2. **Hôtelier** : multi-compteurs, puissance souscrite élevée, saisonnalité
3. **Syndic** : prescripteur (40-120 contrats), pas besoin de vote AG
4. **Directeur EHPAD** : décret tertiaire, continuité 24h/24, reporting
5. **Gérant PME** : budget énergie 20-40% des charges, veut simplicité
6. **DAF groupe** : multi-sites, reporting consolidé, appels d'offres

## Voix de marque
- **Jamais** de jargon technique sans explication
- **Toujours** des chiffres concrets (%, €, délais)
- **Structure** : problème → solution → preuve → CTA
- **CTA** : "Obtenir mon comparatif gratuit" ou "Être rappelé sous 24h"
