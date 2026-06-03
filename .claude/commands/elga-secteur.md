# /elga-secteur — Générer une page sectorielle GEO pour Elga Energy

## Usage
```
/elga-secteur "nom du secteur"
```

## Exemple
```
/elga-secteur "boulangerie"
/elga-secteur "grande distribution"
/elga-secteur "data center"
/elga-secteur "agriculture"
```

## Ce que fait ce skill

Crée une page sectorielle HTML complète à la racine du projet, optimisée pour :
- **SEO** : title "Énergie pour [Secteur] — Elga Energy", meta description, canonical
- **GEO** : Service Schema.org + FAQPage avec 3-4 questions spécifiques au secteur
- Ton : expert, rassurant, chiffres sectoriels concrets
- Structure : Hero coloré adapté au secteur → Stats → Spécificités → FAQ → CTA

## Règles impératives
1. Nom de fichier : `[secteur-hyphen].html` (ex: `boulangerie.html`)
2. URL canonical : `https://www.elgaenergy.com/[secteur].html`
3. Tailwind CDN, couleurs primary vert + secondary bleu
4. Tel : 07 45 11 78 67 / href tel:+33745117867
5. FAQPage : minimum 3 questions longues-traînes (phrases ChatGPT réelles)
6. Stats : 4 chiffres clés (économies %, volume, fournisseurs, coût)
7. Cas client ou témoignage avec résultat chiffré
8. Après génération :
   - `git add [secteur].html && git commit && git push origin main`
   - Ajouter la page au `sitemap.xml`
   - Ajouter une carte dans la section `#secteurs` de `index.html`
   - Mettre à jour le backlog dans `CLAUDE.md`

## Template couleurs hero par secteur
- Restauration/Food : amber/orange
- Santé/médical : blue/cyan  
- Industrie/technique : slate/zinc
- Nature/agriculture : green
- Luxe/hôtellerie : amber foncé
- Collectivités/public : secondary blue
- Défaut : gradient slate-700 → slate-900

## Questions FAQPage à générer
Les questions doivent être :
- Exactement comme on les taperait dans ChatGPT
- Longues-traînes (6-12 mots)
- Avec "comment", "combien", "est-ce que", "quelle différence"
- Réponses factuelles avec chiffres (%, €, durées)
