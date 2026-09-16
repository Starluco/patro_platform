# 🌳 Patro Notre-Dame d'Ittre — v2.3.0

## Nouveautés / corrections de cette version

### 1. Modification des événements (admin)
Onglet **📅 Créer un événement** permet aussi de modifier : chaque événement listé
propose un bouton « ✏️ Modifier » qui pré-remplit le formulaire (titre, date, heure,
sections, description, type). L'enregistrement réutilise la même route API
(`admin/evenement`) avec l'`id` de l'événement existant. Une case à cocher
« Notifier les parents et animateurs concernés » apparaît uniquement en mode
modification. Les changements sont immédiatement visibles dans tous les calendriers
concernés (mêmes données lues par `enfant.html` et `animateur.html`).

### 2. Notifications cliquables
Chaque notification stockée porte un champ `lien` **précis** :
- Événement → `enfant.html?id=...&event=...#calendrier` (parent) ou `animateur.html?event=...#calendrier`
- Paiement → `profil.html?enfant=...#paiements`
- Question / réponse → `enfant.html?id=...#questions`
- Modification d'un enfant → `enfant.html?id=...`

Sur `profil.html`, chaque notification est un lien cliquable : le clic marque la
notification comme lue (`notifications/lire`) puis redirige immédiatement vers la
page concernée, qui met en évidence l'élément visé (surlignage + scroll automatique).

### 3 & 4. Choix du type de compte (connexion + inscription)
`connexion.html` et `inscription.html` démarrent par un choix explicite
**👨‍👩‍👧 Parent** / **🧑‍🏫 Animateur** avant d'afficher le formulaire. Un compte
animateur ne demande jamais d'informations sur des enfants (le bloc est masqué).
À la connexion, si le type de compte choisi ne correspond pas au rôle réel du compte,
un message clair l'indique (l'administrateur peut se connecter depuis les deux écrans).

### 5. Suppression d'un animateur
Dans **Animateurs → Équipe par section**, chaque animateur dispose d'un bouton
« 🗑️ Supprimer » avec une confirmation explicite reprenant son nom. La suppression
retire uniquement le compte et ses sessions actives (`admin/comptes/supprimer`) :
les réunions, présences et questions déjà enregistrées restent intactes, conformément
à la demande de ne jamais perdre l'historique.

## 🔑 Connexion administrateur
| Rôle | E-mail | Mot de passe |
|---|---|---|
| Administrateur | `admin@patro.be` | `Ster2014` |

## 🚀 Déploiement
```bash
git add .
git commit -m "v2.3.0 : modification événements, notifications cliquables, choix parent/animateur, suppression animateur"
git push
```
