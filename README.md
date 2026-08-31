# 🌳 Patro Notre-Dame d'Ittre — Application de gestion

Application web (statique + Netlify Functions + **Netlify Blobs** comme base de données JSON)
pour gérer les inscriptions, sections, chefs, cotisations, présences et communications.

## ⚠️ Correctif important (v1.0.1)

La v1.0.0 contenait un `netlify.toml` avec une redirection `/api/* -> /.netlify/functions/api/:splat`.
Or la fonction déclare elle-même sa route via `export const config = { path: '/api/*' }`
(syntaxe "Netlify Functions v2"). **Quand une fonction définit un `path` personnalisé, elle n'est
plus disponible du tout à l'ancienne adresse `/.netlify/functions/...`.** La redirection pointait donc
vers une adresse qui n'existait plus → 404 systématique sur toutes les routes `/api/*`.

**Correctif appliqué :** suppression du bloc `[[redirects]]` dans `netlify.toml`. Le routage est
désormais géré uniquement par `config.path` dans `api.mjs`, comme recommandé par la documentation
Netlify pour les fonctions modernes.

## 🧩 Modules (1 fichier HTML par module)

| Fichier | Module | Contenu |
|---|---|---|
| `public/index.html` | **1. Accueil** | Présentation du mouvement, infos pratiques, sections, actualités, agenda |
| `public/parents.html` | **2. Espace parents** | Inscription, enfants, section, chefs + coordonnées, calendrier, modification des coordonnées, fiche d'inscription imprimable |
| `public/gestion.html` | **3. Gestion (président)** | Chefs, sections, cotisations, membres, réunions, informations, sauvegarde/export |
| `public/presences.html` | **4. Présences** | Les parents pointent présent / absent / retard pour chaque réunion |
| `public/communication.html` | **5. Communication** | E-mail groupé ciblé (tous, en ordre de cotisation, par section, chefs, manuel) + modèles + historique |

## 🗄️ Base de données

Netlify Blobs — store `patro-db`, clé `database`, un seul objet JSON contenant :
`sections`, `chefs`, `parents`, `enfants`, `reunions`, `presences`, `infos`, `messages`.

Tout passe par une seule function : `netlify/functions/api.mjs`, routée via `config.path = "/api/*"`.
Au premier appel, la base est automatiquement initialisée avec des **données fictives**.

## 🚀 Déploiement sur Netlify (via GitHub — recommandé)

1. Pousser ce dépôt sur GitHub
2. Netlify → **Add new site → Import an existing project → GitHub**
3. Sélectionner le dépôt. Vérifier les build settings (normalement auto-détectés via `netlify.toml`) :
   - **Publish directory** : `public`
   - **Functions directory** : `netlify/functions`
   - **Build command** : `echo 'Site statique + Netlify Functions — rien a builder'` (ou vide)
4. **Deploy site**

### Variables d'environnement (Site configuration → Environment variables)

| Variable | Rôle | Exemple |
|---|---|---|
| `ADMIN_PASSWORD` | mot de passe des modules Gestion & Communication | `MonMotDePasse2025` |
| `RESEND_API_KEY` | *(optionnel)* envoi de vrais e-mails via Resend | `re_xxx` |
| `MAIL_FROM` | expéditeur des e-mails | `Patro Ittre <pndi@patro.be>` |

Après avoir ajouté une variable, **redéployer** (Deploys → Trigger deploy).

### Vérifier que l'API fonctionne

```
https://ton-site.netlify.app/api/db
```
→ doit renvoyer du JSON (pas une 404). Sinon, vérifier dans l'onglet **Functions** du site que
la fonction `api` apparaît bien dans la liste des fonctions déployées.

## 🔑 Accès de démonstration

- **Parents** : `marie.durand@example.com` ou `olivier.peeters@example.com`
- **Admin** : mot de passe `patro2025` (à changer via `ADMIN_PASSWORD`)

## 🎨 Charte graphique
Vert (`#1B5E20`, `#2E7D32`, `#7BC043`) et jaune (`#F9C80E`) — variables CSS dans `public/assets/style.css`.
