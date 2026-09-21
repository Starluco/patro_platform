# 🌳 Patro Notre-Dame d'Ittre — v3.0.1

## 🩹 Correctif de déploiement (v3.0.1)

Le déploiement Netlify de la v3.0.0 a échoué avec l'erreur suivante :

```
npm error code ETARGET
npm error notarget No matching version found for @netlify/neon@^1.0.0.
```

**Cause** : `@netlify/neon` n'a que la version **`0.1.2`** publiée sur npm à ce jour.
La contrainte `^1.0.0` indiquée dans `package.json` n'existe pas, donc `npm install`
échoue immédiatement pendant la phase "Installing dependencies" du build Netlify.

**Correctif appliqué** : `package.json` utilise désormais `"@netlify/neon": "0.1.2"`
(version exacte). L'API utilise `neon()` sans argument, ce qui est bien supporté
par cette version 0.1.2 et lit automatiquement `NETLIFY_DATABASE_URL` injectée par
Netlify (y compris avec la bonne branche selon l'environnement de déploiement).

Aucun autre changement de logique n'était nécessaire : le code de `lib/db.mjs`,
`lib/helpers.mjs` et `api.mjs` était déjà compatible avec cette version.

## 🔄 Rappel : migration vers Netlify DB (Postgres) — v3.0.0

Toute la donnée applicative (comptes, enfants, présences, paiements, notifications,
questions, tâches, documents demandés, contenu du site, historique, sessions) est
stockée dans **Netlify DB** (Postgres serverless — Neon), et non plus dans Netlify
Blobs.

### Nouveaux fichiers
- **`netlify/functions/lib/db.mjs`** : connexion Neon + schéma complet (19 tables) + seed idempotent
- **`netlify/functions/lib/helpers.mjs`** : hashing, mappers SQL→JS, requêtes métier partagées

### Garanties d'intégrité
Grâce aux `ON DELETE CASCADE`/`SET NULL`, la suppression d'un enfant est un simple
`DELETE FROM children WHERE id = ...` — la base nettoie automatiquement présences,
paiements, questions, documents liés.

### Branching des environnements (Deploy Previews)
`neon()` est appelé **sans argument**. Netlify détecte automatiquement le contexte
de build (production / deploy preview / branch deploy) et injecte l'URL de
connexion pointant vers la branche Neon isolée correspondante.

### Exception Blobs (fichiers bruts)
La table `files` (colonne `blob_key`) est prête à recevoir des références vers des
fichiers stockés dans un store Netlify Blobs séparé (PDF, photos), conformément à
l'exception autorisée. Non utilisée pour l'instant (aucune fonctionnalité d'upload).

## 🔑 Connexion administrateur
| Rôle | E-mail | Mot de passe |
|---|---|---|
| Administrateur | `admin@patro.be` | `Ster2014` |

## 🆘 Récupération d'accès admin
Si le dernier compte administrateur perd accidentellement son rôle, la page
`recuperation-admin.html` (route API `auth/recuperer-admin`) permet de le rétablir
ou d'en créer un nouveau, protégée par la clé `ADMIN_RECOVERY_KEY` (variable
d'environnement Netlify) — désactivée automatiquement dès qu'un admin valide
existe à nouveau.

## 🚀 Déploiement

1. Sur le dashboard Netlify de ce site : **Site settings → Database → Enable
   Netlify DB**. Netlify provisionne une base Postgres (Neon) et injecte
   automatiquement `NETLIFY_DATABASE_URL`.
2. (Optionnel) Définissez `ADMIN_RECOVERY_KEY` dans **Site settings →
   Environment variables** pour remplacer la valeur par défaut.
3. Poussez le code :
   ```bash
   git add .
   git commit -m "v3.0.1 : fix package.json (@netlify/neon 0.1.2, version inexistante ^1.0.0 corrigee)"
   git push
   ```
4. Au premier appel de l'API (ex: première visite du site), les tables sont créées
   automatiquement et les données de référence insérées.

## Structure du projet
```
netlify.toml
package.json
netlify/functions/
  api.mjs                <- API unique (routage /api/*), toute la logique métier
  lib/db.mjs             <- connexion Neon + schéma SQL + seed
  lib/helpers.mjs        <- utilitaires partagés (hash, mappers, requêtes communes)
public/
  index.html, patro.html, animateurs.html, histoire.html, histoire-detail.html,
  infos.html, connexion.html, inscription.html, recuperation-admin.html
  mes-enfants.html, enfant.html, profil.html          (parent)
  animateur.html                                       (animateur)
  admin.html, admin-enfant.html                         (administrateur)
  assets/style.css, assets/app.js
```
