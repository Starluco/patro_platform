# 🌳 Patro Notre-Dame d'Ittre — Application de gestion

Application web (statique + Netlify Functions + **Netlify Blobs** comme base de données JSON)
pour gérer les inscriptions, sections, chefs, cotisations, présences et communications.

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

Tout passe par une seule function : `netlify/functions/api.mjs` exposée sur `/api/*`.
Au premier appel, la base est automatiquement initialisée avec des **données fictives**
(6 sections, 8 chefs, 2 familles, 3 enfants, tous les samedis + le camp).

### Routes principales
```
GET  /api/db                     GET  /api/sections            POST /api/sections
POST /api/reset                  GET  /api/chefs               POST /api/chefs
POST /api/admin/login            POST /api/chefs/delete
POST /api/parents/login          POST /api/parents
POST /api/enfants                POST /api/enfants/delete      POST /api/enfants/cotisation
GET  /api/reunions               POST /api/reunions            POST /api/reunions/delete
GET  /api/presences              POST /api/presences
GET  /api/infos                  POST /api/infos               POST /api/infos/delete
GET  /api/messages               POST /api/messages/send
```

## 🚀 Déploiement sur Netlify

### 1. En local
```bash
npm install
npx netlify dev        # http://localhost:8888  (Blobs fonctionne en local)
```

### 2. Sur Netlify
```bash
npm install -g netlify-cli
netlify login
netlify init           # ou : glisser le dossier sur app.netlify.com/drop
netlify deploy --prod
```

Ou via Git : pousser le dépôt, puis dans Netlify → *Add new site* → *Import from Git*.
Les réglages sont déjà dans `netlify.toml` :
- **Publish directory** : `public`
- **Functions directory** : `netlify/functions`
- **Build command** : aucune (site statique)

### 3. Variables d'environnement (Site configuration → Environment variables)

| Variable | Rôle | Exemple |
|---|---|---|
| `ADMIN_PASSWORD` | mot de passe des modules Gestion & Communication | `MonMotDePasse2025` |
| `RESEND_API_KEY` | *(optionnel)* envoi de vrais e-mails via Resend | `re_xxx` |
| `MAIL_FROM` | expéditeur des e-mails | `Patro Ittre <pndi@patro.be>` |

> Sans `RESEND_API_KEY`, le module de communication fonctionne en **mode simulation** :
> le message et la liste des destinataires sont enregistrés (utile pour tester),
> et le bouton « Copier les adresses » permet de coller les adresses dans votre client mail.

## 🔑 Accès de démonstration

- **Parents** : `marie.durand@example.com` ou `olivier.peeters@example.com`
- **Admin** : mot de passe `patro2025` (à changer via `ADMIN_PASSWORD`)

## 🎨 Charte graphique
Vert (`#1B5E20`, `#2E7D32`, `#7BC043`) et jaune (`#F9C80E`) — variables CSS dans `public/assets/style.css`.

## 📌 Améliorations possibles
- Vrai système de comptes (Netlify Identity) au lieu de l'e-mail seul
- Paiement en ligne des cotisations
- Export PDF des listes de présence par section
- Envoi automatique des rappels (Netlify Scheduled Functions)
