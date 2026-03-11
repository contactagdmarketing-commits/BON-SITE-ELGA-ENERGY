# SPEC_RECRUTEMENT_SEO

## OBJECTIF

Ce projet sert à générer un grand nombre de pages d’offres d’emploi
pour SEO et Google Jobs.

Le système repose sur :

- pages statiques
- structure d’URL fixe
- template unique
- duplication contrôlée
- contenu annonce unique
- aucune modification automatique de structure

Cursor doit STRICTEMENT respecter ce fichier.

Toute modification non demandée est interdite.


--------------------------------------------------

## STRUCTURE OBLIGATOIRE

Toutes les pages doivent suivre exactement cette structure :

/recrutement/{region}/{departement}/{ville}/{metier}

Exemple :

/recrutement/occitanie/haute-garonne/toulouse/commercial
/recrutement/occitanie/haute-garonne/toulouse/courtier
/recrutement/occitanie/haute-garonne/toulouse/consultant

Cette structure ne doit jamais être modifiée.


--------------------------------------------------

## TEMPLATE UNIQUE

Toutes les pages doivent utiliser le même template.

Le template doit contenir :

- title SEO
- H1
- résumé court SEO
- contenu annonce
- formulaire
- variables region / departement / ville / metier

Le template ne doit jamais être dupliqué.
Le template ne doit jamais être refactorisé.
Le template ne doit jamais être remplacé.


--------------------------------------------------

## CONTENU ANNONCE OFFICIEL

Le texte de l’annonce est stocké dans :

/CONTENT_ANNONCE.md

Ce fichier est la source officielle.

Cursor doit toujours utiliser ce fichier.

Cursor ne doit jamais :

- modifier le texte
- résumer le texte
- réécrire le texte
- traduire le texte
- optimiser le texte
- générer un autre texte

Le contenu doit être injecté tel quel dans toutes les pages.


--------------------------------------------------

## VARIABLES AUTORISÉES

Seules ces variables peuvent changer :

region
departement
ville
metier

Tout le reste doit rester identique.


--------------------------------------------------

## SEO OBLIGATOIRE

Chaque page doit avoir :

Title unique
H1 unique
Meta description unique
URL unique

La ville doit apparaître dans le title.
Le département doit apparaître dans le texte.
La région doit apparaître dans le texte.


--------------------------------------------------

## FORMULAIRE

Toutes les pages utilisent le même formulaire.

Le formulaire ne doit jamais être modifié sans instruction.


--------------------------------------------------

## INTERDICTIONS

Cursor ne doit jamais :

- modifier la structure des URL
- créer un nouveau layout
- créer un nouveau template
- déplacer les fichiers
- renommer les dossiers
- créer un moteur dynamique
- ajouter une base de données
- changer le routing
- optimiser sans demande
- refactoriser sans demande
- générer des pages en masse sans validation


--------------------------------------------------

## REGLE DE GENERATION

Ordre obligatoire :

1 page modèle
1 duplication test
validation
puis génération massive

Cursor doit s’arrêter après chaque étape.


--------------------------------------------------

## REGLE ABSOLUE

Si une instruction contredit ce fichier,
ce fichier a priorité.