# /elga-batch — Générer 15 articles de blog en masse pour Elga Energy

## Usage
```
/elga-batch
```

Lance la génération en parallèle de tous les articles du backlog défini ci-dessous.

## Liste des 15 articles à générer

1. `blog/arenh-explication-pme.html` — "ARENH : ce que ça change pour votre facture d'électricité"
2. `blog/comparatif-fournisseurs-energie-b2b-2025.html` — "Comparatif fournisseurs d'énergie B2B 2025 (tableau)"
3. `blog/comment-changer-fournisseur-electricite-pro.html` — "Comment changer de fournisseur d'électricité professionnel sans coupure"
4. `blog/puissance-souscrite-optimisation.html` — "Puissance souscrite trop élevée : comment la réduire et économiser"
5. `blog/cee-certificats-economie-energie-entreprise.html` — "CEE : comment une entreprise peut toucher des primes énergie"
6. `blog/gaz-naturel-vs-electricite-chauffage-professionnel.html` — "Gaz naturel ou électricité pour chauffer un local professionnel ?"
7. `blog/syndic-energie-parties-communes.html` — "Comment un syndic réduit les charges énergie des parties communes"
8. `blog/ehpad-decret-tertiaire-conformite.html` — "EHPAD et décret tertiaire : obligations et comment s'y préparer"
9. `blog/contrat-energie-multi-sites.html` — "Contrat d'énergie multi-sites : avantages et comment le négocier"
10. `blog/tarif-bleu-jaune-vert-edf.html` — "Tarif Bleu, Jaune, Vert EDF : quelle différence pour les professionnels ?"
11. `blog/volatilite-prix-electricite-2025.html` — "Prix de l'électricité en 2025 : prévisions et comment s'en protéger"
12. `blog/courtier-energie-comment-ca-marche.html` — "Comment fonctionne un courtier en énergie et est-ce vraiment gratuit ?"
13. `blog/bilan-energetique-entreprise.html` — "Comment faire un bilan énergétique de son entreprise gratuitement"
14. `blog/green-energy-electricite-verte-entreprise.html` — "Électricité verte pour entreprise : label GoO, prix et avantages"
15. `blog/negocier-contrat-gaz-pro.html` — "Négocier son contrat de gaz professionnel : guide étape par étape"

## Instructions d'exécution

**IMPORTANT : lancer tous les articles EN PARALLÈLE** (sub-agents simultanés, pas séquentiels).

Pour chaque article :
1. Générer le HTML complet selon le template `/elga-article`
2. Inclure Schema.org Article + FAQPage (2-3 questions)
3. Minimum 800 mots de contenu
4. 1 tableau comparatif si pertinent
5. 1 cas client fictif mais réaliste
6. CTA vers /devis.html

Après génération de tous les fichiers :
1. `git add blog/ && git commit -m "feat: 15 articles GEO batch" && git push origin main`
2. Mettre à jour `sitemap.xml` avec les 15 nouvelles URLs
3. Mettre à jour le backlog dans `CLAUDE.md` (cocher les articles générés)
