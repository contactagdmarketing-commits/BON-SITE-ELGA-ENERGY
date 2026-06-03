# /elga-article — Générer un article de blog GEO pour Elga Energy

## Usage
```
/elga-article "sujet de l'article"
```

## Exemple
```
/elga-article "ARENH : ce que ça change pour votre facture d'électricité"
/elga-article "Comment choisir son fournisseur de gaz en 2025"
/elga-article "Effacement électrique : guide complet pour les PME"
```

## Ce que fait ce skill

Crée un article de blog HTML complet dans `blog/` optimisé pour :
- **SEO** : title, meta description, canonical, og:tags
- **GEO** : FAQPage Schema.org avec 2-3 questions longues-traînes (phrases tapées dans ChatGPT/Perplexity)
- **Article Schema.org** : auteur Elga Energy, datePublished, headline
- Ton : expert + rassurant + chiffres concrets
- Structure : chapô accrocheur → 4-6 sections H2 → CTA intégré → CTA final
- Lien interne vers `/devis.html`
- Tel : 07 45 11 78 67 / +33745117867
- Analytics : G-SHXXPV14N7

## Règles impératives
1. Slug fichier : `blog/[mots-clés-hyphen].html`
2. Toutes les URLs en `https://www.elgaenergy.com/blog/[slug].html`
3. Tailwind CDN uniquement (pas de build)
4. Colors primary vert #10b981, secondary bleu #0b3d91
5. Au moins 3 statistiques chiffrées (%, €, délais)
6. 1 bloc "cas client" avec résultat concret
7. Après génération : `git add blog/[slug].html && git commit && git push origin main`
8. Mettre à jour `sitemap.xml` avec la nouvelle URL

## Template structure
```
<head>
  - title : "[Sujet] — Elga Energy"
  - meta description : 150 chars max, inclut "courtier énergie" ou "Elga Energy"
  - canonical : https://www.elgaenergy.com/blog/[slug].html
  - Schema.org Article + FAQPage
  - GA G-SHXXPV14N7

<body>
  - header sticky (logo + tel)
  - breadcrumb : Accueil / Actualités / [Titre]
  - badge catégorie (coloré selon thème)
  - h1 accrocheur
  - chapô (bloc coloré border-l-4)
  - contenu .prose (H2, H3, p, ul, table si pertinent)
  - bloc cas client (bg coloré + citation + résultat)
  - CTA final (bg-primary-50 + bouton /devis.html)
  - footer
```
