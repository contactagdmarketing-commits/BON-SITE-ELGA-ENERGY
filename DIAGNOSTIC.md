# Diagnostic du projet BON-SITE-ELGA-ENERGY

**Date :** 29 janvier 2026

---

## 🔴 Problème identifié : EMFILE (too many open files)

L’erreur `EMFILE: too many open files, open '.gitmodules'` indique que **le nombre maximal de fichiers ouverts** est atteint sur ton Mac. Le fichier `.gitmodules` est simplement le dernier fichier que Git/Cursor a tenté d’ouvrir avant de bloquer.

**Note :** Le projet **n’a pas** de fichier `.gitmodules` (pas de sous-modules). L’erreur ne signifie pas que ce fichier pose problème, mais que la limite système est dépassée.

---

## ✅ Ce qui est correct

| Élément | Statut |
|---------|--------|
| **.gitignore** | OK – `node_modules/` et `axiom-app/node_modules/` sont ignorés |
| **.env** | OK – Fichiers d’environnement exclus du Git |
| **Branche main** | Dernier commit : `f0dbe56` ("Recrutement: version finale, Reveliom, cartes 2 étapes") |
| **Remote origin** | `https://github.com/contactagdmarketing-commits/BON-SITE-ELGA-ENERGY.git` |

---

## 📁 Structure du projet

- **Site principal** : HTML statique (index, candidats, Recrutement, ptest, actu, devis…)
- **axiom-app** : Application Node/React avec `node_modules` (très nombreux fichiers)
- **assets** : Logos, images, vidéos

---

## ⚠️ Causes probables de l’EMFILE

1. **axiom-app/node_modules** : des milliers de fichiers que Cursor/Git peuvent parcourir
2. **Limite macOS** : souvent 256 ou 1024 fichiers ouverts par défaut
3. **Cursor** : ouvre beaucoup de fichiers pour l’indexation et les watchers

---

## 🔧 Solutions recommandées

### 1. Augmenter la limite (recommandé)

Dans le terminal :

```bash
ulimit -n 65536
```

Puis redémarrer Cursor.

### 2. Rendre le changement permanent

Ajouter dans `~/.zshrc` :

```bash
ulimit -n 65536
```

Puis :

```bash
source ~/.zshrc
```

### 3. Utiliser le terminal pour Git

Lancer Git en ligne de commande plutôt que via l’interface Cursor :

```bash
cd /Users/edhydelaprez/Desktop/BON-SITE-ELGA-ENERGY
git status
git add -A
git commit -m "Ton message"
git push origin main
```

### 4. Exclure axiom-app du watcher Cursor (si possible)

Dans les paramètres Cursor, ajouter `axiom-app/node_modules` aux exclus si le watcher de fichiers le permet.

### 5. Réduire la charge

- Fermer d’autres projets ou onglets dans Cursor
- Fermer des applications gourmandes
- Redémarrer le Mac si le problème persiste

---

## 📊 Vérification rapide

Pour vérifier la limite actuelle :

```bash
ulimit -n
```

Pour lister les modifications non commitées :

```bash
cd /Users/edhydelaprez/Desktop/BON-SITE-ELGA-ENERGY
git status
```

---

## Résumé

| Problème | EMFILE – trop de fichiers ouverts |
|----------|-----------------------------------|
| Impact | Git (et parfois Cursor) peut bloquer |
| Solution principale | `ulimit -n 65536` + redémarrage Cursor |
| Contournement | Utiliser le terminal pour `git add`, `commit`, `push` |
