# 🌳 Patro Notre-Dame d'Ittre — v2.4.0

## Nouveautés de cette version

### 1. Administrateur — supprimer un enfant
Dans la fiche détaillée de chaque enfant (`admin-enfant.html`), une zone de suppression
rouge propose un bouton **🗑️ Supprimer définitivement cet enfant**. Une confirmation
explicite est demandée : « Êtes-vous sûr de vouloir supprimer définitivement cet
enfant ? Cette action supprimera également ses données de la base de données. »

Côté API (`admin/enfants/supprimer`), la suppression est **définitive et en cascade** :
- l'enfant est retiré de `db.enfants` (pas de simple masquage) ;
- toutes ses présences (`db.presences`) sont supprimées ;
- toutes ses questions (`db.questions`) sont supprimées ;
- le lien enfant↔parent dans `compte.liens` est retiré.

L'enfant disparaît donc immédiatement de toutes les listes (admin, parent, animateur,
statistiques). Après suppression, l'administrateur est renvoyé vers la liste des
enfants, qui se recharge automatiquement.

### 2. Administrateur — gérer les documents demandés
Nouvel onglet **📁 Documents** dans l'espace administrateur, juste à côté de
« Contenu du site ». L'administrateur y gère une liste de documents requis
(`db.documentsRequis`) :
- 3 documents structurels toujours présents : *Fiche santé*, *Autorisation
  parentale*, *Document d'inscription* (leur nom/instructions restent modifiables,
  mais ils ne peuvent pas être supprimés puisqu'ils sont liés à des formulaires fixes
  du site) ;
- des documents personnalisés illimités (ajout, modification, suppression libres).

Chaque création/modification déclenche automatiquement une notification à tous les
parents concernés (« Un document a été ajouté/modifié... Veuillez consulter et
mettre à jour le document demandé »), avec un lien direct vers
`enfant.html?id=...#documents`. Ces documents et leurs instructions sont utilisés
en direct dans l'onglet Documents de la fiche enfant (parent) et dans la fiche
enfant (admin), avec un statut par document : 🟢 Fourni / 🔴 Manquant / 🟡 À vérifier.

### 3. Administrateur — changer la section d'un enfant
Dans `admin-enfant.html`, un nouveau bloc **🎯 Section de l'enfant** permet de choisir
une nouvelle section dans une liste déroulante et d'enregistrer. Le changement est
immédiat : `admin/enfants/section` met à jour `enfant.sectionId`, notifie le parent,
et l'enfant apparaît aussitôt dans les listes de la nouvelle section (y compris pour
les animateurs de cette section, qui le retrouvent dans leurs présences et
calendriers) et disparaît de l'ancienne.

### 4. Administrateur — documents d'inscription dans la fiche de l'enfant
La fiche enfant côté admin affiche désormais un tableau **📄 Documents de l'enfant**
listant chaque document requis avec son statut (Fourni / Manquant / À vérifier),
en plus du détail complet de la fiche santé et de l'autorisation parentale déjà
présents.

### 5. Rubrique Paiements — texte cotisation + compte bancaire
Dans `profil.html#paiements`, un nouveau bloc **💰 Comment payer ?** affiche le
numéro de compte du Patro de façon bien visible (encadré vert en pointillés) suivi
du texte demandé sur la cotisation qui inscrit définitivement l'enfant. Le montant
de la cotisation reste celui déjà configuré (paiement `type: cotisation`, 50 € par
défaut, modifiable comme avant). Le numéro de compte et ce texte sont éditables par
l'administrateur dans l'onglet Contenu → « Rubrique Paiements ».

### 6. Rubrique Paiements — difficultés financières
Un encadré discret (`alert-discret`) affiche, séparément du bloc paiement, le texte
sur l'accueil de tous les enfants sans discrimination financière et l'invitation à
contacter un responsable en toute discrétion. Ce texte est également éditable par
l'administrateur.

### 7. Connexion administrateur & protection réelle de la page Admin
- Le compte `admin@patro.be` / `Ster2014` est **stocké en base** avec `role: 'admin'`
  dès l'initialisation (`seed()`), jamais reconnu via une comparaison d'e-mail codée
  en dur.
- La tuile **⚙️ Administrateur** n'apparaît sur `index.html` que si
  `session.compte.role === 'admin'` (valeur elle-même toujours issue de
  `/api/auth/me`, donc de la base de données).
- `admin.html` (et `admin-enfant.html`) appellent `requireAuth(['admin'])`, qui
  interroge systématiquement `/api/auth/me` côté serveur : un parent ou animateur
  qui tape directement l'URL est immédiatement redirigé, la protection ne repose
  donc jamais uniquement sur un lien caché côté front.
- Toutes les routes `admin/*` côté API vérifient à nouveau `compte.role === 'admin'`
  avant toute opération (`need('admin')`), ce qui constitue la véritable barrière de
  sécurité, indépendante de l'interface.
- Le même système d'authentification par token (`db.sessions`) déjà en place pour
  les parents et animateurs est réutilisé pour l'administrateur — aucun système de
  connexion parallèle n'a été créé.

## 🔑 Connexion administrateur
| Rôle | E-mail | Mot de passe |
|---|---|---|
| Administrateur | `admin@patro.be` | `Ster2014` |

## 🚀 Déploiement
```bash
git add .
git commit -m "v2.4.0 : suppression/section enfant, gestion documents requis, textes paiements, tuile admin conditionnelle"
git push
```

## Structure du projet
```
netlify.toml
package.json
netlify/functions/api.mjs      <- API unique (routage /api/*)
public/
  index.html, patro.html, animateurs.html, histoire.html, histoire-detail.html,
  infos.html, connexion.html, inscription.html
  mes-enfants.html, enfant.html, profil.html          (parent)
  animateur.html                                       (animateur)
  admin.html, admin-enfant.html                         (administrateur)
  assets/style.css, assets/app.js
```
