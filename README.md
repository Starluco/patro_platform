# 🌳 Patro Notre-Dame d'Ittre — v3.0.0

## 🔄 Changement d'architecture majeur : migration vers Netlify DB (Postgres)

À partir de la version 3.0.0, **toute la donnée applicative** (comptes, enfants,
présences, paiements, notifications, questions, tâches, documents demandés,
contenu du site, historique, sessions) est stockée dans **Netlify DB**
(Postgres serverless — Neon), et non plus dans Netlify Blobs.

### Pourquoi ce changement
L'application manipule des données fortement relationnelles (un parent a
plusieurs enfants, un enfant a plusieurs présences et paiements liés à des
événements et sections, etc.) et nécessite des garanties d'intégrité
transactionnelle (ex: ne jamais laisser une présence orpheline après
suppression d'un enfant). Un modèle relationnel strict avec clés étrangères
explicites est plus sûr et plus performant qu'un unique blob JSON pour ce
type de besoin.

### Ce qui a changé techniquement

| Aspect | Avant (v2.x) | Maintenant (v3.0) |
|---|---|---|
| Stockage | 1 blob JSON unique (`patro-db` / `database`) | Base Postgres relationnelle (Netlify DB / Neon) |
| Client | `@netlify/blobs` | `@netlify/neon` |
| Intégrité référentielle | Gérée à la main dans le code (boucles `filter`) | `FOREIGN KEY`, `ON DELETE CASCADE` / `SET NULL` au niveau SQL |
| Recherche/tri | `Array.filter/sort` en mémoire sur tout le JSON | Requêtes SQL indexées (`WHERE`, `JOIN`, index sur `date`, `email`, `nom/prenom`, `section_id`) |
| Environnements | Un seul store Blobs partagé | **Branching natif** Netlify DB : chaque Deploy Preview/branche a sa propre base isolée, automatiquement |
| Fichiers bruts (PDF/photos) | N/A | Autorisé via Netlify Blobs (table `files`, colonne `blob_key`) — exception explicitement prévue, non utilisée pour l'instant car aucune fonctionnalité d'upload n'existe encore |

### Nouveau fichier : `netlify/functions/lib/db.mjs`
- Exporte `sql` (client Neon, `neon()` sans argument — Netlify injecte
  automatiquement `NETLIFY_DATABASE_URL`, avec la bonne branche selon
  l'environnement de déploiement).
- Exporte `ensureSchema()` : crée toutes les tables si elles n'existent pas
  encore (idempotent — peut être appelé à chaque requête sans risque) et
  insère les données de référence (sections, admin par défaut, gabarits de
  documents, contenu par défaut) uniquement si absentes.

### Nouveau fichier : `netlify/functions/lib/helpers.mjs`
Fonctions utilitaires partagées : hashing de mot de passe, génération d'ID,
mappers ligne SQL (snake_case) → objet JS (camelCase) pour rester compatible
avec le front-end existant sans le modifier, et quelques requêtes "métier"
réutilisées par plusieurs routes (visibilité des enfants selon le rôle,
notifications groupées par section, etc.).

### Schéma relationnel (extrait)

```
sections (id PK)
users (id PK, email UNIQUE, role, statut, section_id FK -> sections)
children (id PK, parent_id FK -> users, section_id FK -> sections)
parent_child_links (parent_id FK, child_id FK, UNIQUE(parent_id, child_id))
events (id PK, type, date, created_by FK -> users)
event_sections (event_id FK, section_id FK)
presences (id PK, child_id FK -> children, event_id FK -> events, UNIQUE(child_id, event_id))
payments (id PK, child_id FK -> children)
notifications (id PK, user_id FK -> users)
questions (id PK, user_id FK -> users, child_id FK -> children, section_id FK -> sections)
question_responses (id PK, question_id FK -> questions, user_id FK -> users)
tasks (id PK, referent_user_id FK -> users)
sessions (token PK, user_id FK -> users)
site_content (key PK)
history_events (id PK)
document_templates (id PK)
health_forms (child_id PK/FK -> children)
parental_authorizations (child_id PK/FK -> children)
registration_documents (child_id PK/FK -> children)
child_custom_documents (id PK, child_id FK, doc_template_id FK, UNIQUE(child_id, doc_template_id))
files (id PK, child_id FK -> children, blob_key)   -- exception Blobs (fichiers bruts uniquement)
```

Toutes les FK vers `children`/`users`/`events`/`questions`/`document_templates`
utilisent `ON DELETE CASCADE` ou `ON DELETE SET NULL` selon le cas — ce qui
signifie par exemple que **supprimer un enfant** (`DELETE FROM children WHERE
id = ...`) nettoie automatiquement, au niveau base de données, toutes ses
présences, paiements, questions, documents liés — sans requêtes manuelles
répétées et sans risque de donnée orpheline.

### Branching des environnements (Deploy Previews)
`neon()` est appelé **sans argument** dans `lib/db.mjs`. Netlify détecte
automatiquement le contexte de build (production / deploy preview / branch
deploy) et injecte l'URL de connexion pointant vers la branche Neon isolée
correspondante. **Aucune logique conditionnelle n'a été écrite dans le code**
pour gérer cela : c'est une garantie native de l'intégration Netlify DB, à
condition que "Netlify DB" soit activé sur le site depuis le dashboard.

### Exception Blobs (fichiers bruts)
La table `files` (colonne `blob_key`) est prête à recevoir des références
vers des fichiers stockés dans un store Netlify Blobs séparé (ex: scans PDF
de fiche santé, photos de profil), conformément à l'exception autorisée.
**Aucune fonctionnalité d'upload n'est actuellement implémentée** — cette
table est un point d'extension prêt à l'emploi pour une future itération.

## 🔑 Connexion administrateur
| Rôle | E-mail | Mot de passe |
|---|---|---|
| Administrateur | `admin@patro.be` | `Ster2014` |

Le compte admin est créé automatiquement (`ensureSchema()` → `seedReferenceData()`)
au premier appel de l'API après activation de Netlify DB, avec `role = 'admin'`
stocké en base — jamais déduit de l'e-mail dans le code.

## 🆘 Récupération d'accès admin
Si le dernier compte administrateur perd accidentellement son rôle, la page
`recuperation-admin.html` (route API `auth/recuperer-admin`) permet de le
rétablir ou d'en créer un nouveau, protégée par la clé `ADMIN_RECOVERY_KEY`
(variable d'environnement Netlify) — désactivée automatiquement dès qu'un
admin valide existe à nouveau.

## 🚀 Déploiement

1. Sur le dashboard Netlify de ce site : **Site settings → Database → Enable
   Netlify DB**. Netlify provisionne une base Postgres (Neon) et injecte
   automatiquement `NETLIFY_DATABASE_URL`.
2. (Optionnel) Définissez `ADMIN_RECOVERY_KEY` dans **Site settings →
   Environment variables** pour remplacer la valeur par défaut.
3. Poussez le code :
   ```bash
   git add .
   git commit -m "v3.0.0 : migration vers Netlify DB (Postgres relationnel), fin de l'usage de Blobs pour l'état applicatif"
   git push
   ```
4. Au premier appel de l'API (ex: première visite du site), les tables sont
   créées automatiquement et les données de référence insérées.

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
