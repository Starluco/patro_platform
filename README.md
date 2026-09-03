# 🌳 Patro Notre-Dame d'Ittre — v2.1.0

## 🐛 Correctifs de cette version

### 1. Bug de déconnexion automatique — CORRIGÉ
**Cause** : Netlify Blobs utilise par défaut une cohérence *éventuelle* (jusqu'à 60s de
délai de propagation entre une écriture et sa lecture). Lors de la connexion, la session
était écrite dans la base, mais la page suivante pouvait la relire *avant* que l'écriture
soit propagée → `auth/me` renvoyait 401 → déconnexion immédiate.

**Correctif appliqué (`netlify/functions/api.mjs`)** :
- Toutes les lectures/écritures du blob utilisent désormais `consistency: 'strong'`
  (cohérence forte, lecture-après-écriture garantie — recommandation officielle Netlify).
- Côté front (`app.js`), `requireAuth()` et `renderHeader()` ne déconnectent plus
  l'utilisateur sur une erreur réseau transitoire : seule une réponse **401 explicite**
  du serveur entraîne une déconnexion. Une erreur passagère déclenche une nouvelle tentative.

### 2. Comptes de démonstration supprimés
Seul un compte administrateur est désormais créé automatiquement :
- **E-mail :** `admin@patro.be`
- **Mot de passe :** `Ster2014`

Les comptes **parents** et **animateurs** ne sont plus créés par défaut : ils sont
créés exclusivement par l'administrateur depuis l'onglet **« ➕ Créer un compte »**
du portail admin (`admin.html`).

> Le formulaire public d'inscription (`inscription.html`) reste disponible pour les
> parents qui souhaitent faire une demande eux-mêmes (elle devra être validée par
> l'admin), mais l'admin peut désormais aussi créer un compte **directement, déjà validé**,
> sans passer par cette étape.

### 3. Correctif de layout sur la page d'accueil
Le bandeau vert (« hero ») avait un décor décoratif (vague blanche) en `position:absolute`
qui, sans z-index explicite, se plaçait **au-dessus** du contenu du hero (titre, texte,
boutons de connexion) et les recouvrait partiellement.

**Correctif (`style.css`)** : le décor est maintenant explicitement en arrière-plan
(`z-index:0`, `pointer-events:none`), et tout le contenu du hero passe au premier plan
(`z-index:1`). La section « Découvrir le Patro » a également été descendue (marge
supérieure augmentée) pour plus de clarté visuelle.

## 🔑 Connexion

| Rôle | E-mail | Mot de passe |
|---|---|---|
| Administrateur | `admin@patro.be` | `Ster2014` |

**Pensez à changer ce mot de passe** dès votre première connexion si possible
(via une future fonctionnalité, ou en le modifiant manuellement dans la base).

## 🚀 Déploiement

```bash
git add .
git commit -m "v2.1.0 : correctif connexion (Blobs strong consistency) + comptes admin uniquement + fix layout hero"
git push
```

Netlify redéploie automatiquement.

⚠️ **Important** : comme la structure de la base change (suppression des comptes démo),
si votre base Netlify Blobs existante contient encore l'ancienne structure, il est
recommandé de la réinitialiser proprement. Le code s'auto-répare partiellement (il
garantit toujours la présence d'un compte admin), mais pour un démarrage totalement
propre, vous pouvez supprimer le blob `patro-db` depuis le dashboard Netlify
(Site → Blobs) avant le premier déploiement de cette version.

## 🗄️ Base de données (Netlify Blobs)

Store `patro-db`, clé `database`, cohérence **forte** (`strong`). Collections :
`sections`, `comptes`, `enfants`, `reunions`, `presences`, `notifications`,
`questions`, `taches`, `sessions`, `contenu`.

Routage via `config.path = '/api/*'` dans `netlify/functions/api.mjs`
(ne jamais ajouter de `[[redirects]]` vers `/.netlify/functions/api`).

## 🧩 Pages

Publiques : `index.html`, `patro.html`, `animateurs.html`, `histoire.html`/`histoire-detail.html`,
`infos.html`, `connexion.html`, `inscription.html`.

Privées Parent : `mes-enfants.html`, `enfant.html?id=...`, `profil.html`.

Privées Animateur : `animateur.html`.

Privées Admin : `admin.html` (dont le nouvel onglet **Créer un compte**), `admin-enfant.html?id=...`.
