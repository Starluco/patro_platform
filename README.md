# 🌳 Patro Notre-Dame d'Ittre — Application de gestion (v2.0.1)

Application multi-comptes (Parent / Animateur / Administrateur) avec base de données
**Netlify Blobs**, déployable directement sur Netlify (site statique + 1 fonction API).

## 🆘 Vous ne pouvez pas vous connecter avec les comptes de démo ?

C'est normal si votre base de données existait déjà avant cette mise à jour (v1 → v2) :
l'ancienne structure ne contenait pas de comptes avec mot de passe.

**Solution en 1 clic :** allez sur `connexion.html`. Un bandeau jaune apparaît automatiquement
si aucun compte n'existe encore, avec un bouton **« Initialiser les comptes de démonstration »**.
Cliquez dessus, puis connectez-vous normalement.

> 🔒 Cette route (`/api/system/init-demo`) est protégée : elle ne fonctionne QUE si la base est
> vide de tout compte. Dès qu'un compte existe (même un seul), elle est automatiquement désactivée.

## 🔑 Comptes de démonstration

| Rôle | E-mail | Mot de passe |
|---|---|---|
| Administrateur | `admin@patro.be` | `admin123` |
| Animateur (Bengalis) | `camille.dubois@patro-ittre.be` | `animateur123` |
| Parent | `marie.durand@example.com` | `parent123` |
| Parent | `olivier.peeters@example.com` | `parent123` |

## 🧩 Zones du site

### Publiques (sans connexion)
`index.html`, `patro.html`, `animateurs.html`, `histoire.html`/`histoire-detail.html`, `infos.html`, `connexion.html`, `inscription.html`.

### Privées — Parent
`mes-enfants.html`, `enfant.html?id=...`, `profil.html`.

### Privées — Animateur
`animateur.html`.

### Privées — Administrateur
`admin.html`, `admin-enfant.html?id=...`.

## 🗄️ Base de données (Netlify Blobs)

Store `patro-db`, clé `database`. Collections : `sections`, `comptes`, `enfants`,
`reunions`, `presences`, `notifications`, `questions`, `taches`, `sessions`, `contenu`.

Toute la logique est dans **une seule fonction** : `netlify/functions/api.mjs`,
routée via `config.path = "/api/*"` (⚠️ ne jamais ajouter de `[[redirects]]` vers
`/.netlify/functions/api` dans `netlify.toml`).

### Authentification
Token simple stocké dans `db.sessions`, envoyé dans l'en-tête `x-auth-token`.
Mots de passe hachés en `sha256(salt + password)`.

## 🚀 Déploiement

```bash
git add .
git commit -m "v2.0.1 : correctif connexion + comptes multi-roles"
git push
```

Netlify redéploie automatiquement. Après le déploiement, allez sur `/connexion.html`
et cliquez sur le bouton d'initialisation si le bandeau apparaît.

## ✅ Contenus à fournir par l'administrateur

Tout est éditable depuis `admin.html` → onglets **« Animateurs »** et **« Contenu du site »**.

## 🎨 Charte graphique
Vert (`#1B5E20`, `#2E7D32`, `#7BC043`) et jaune (`#F9C80E`).

## 🔧 Limitations connues
- Pas d'envoi de vrais e-mails (uniquement des notifications internes au site).
- Pas d'upload de fichiers binaires (fiche de santé/autorisation = formulaires texte).
