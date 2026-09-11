# 🌳 Patro Notre-Dame d'Ittre — v2.2.0

## 🐛 Correctifs de cette version (feedback utilisateur)

### 1. Tuiles "Connexion" et "Contact" illisibles (blanc sur blanc)
Le bouton `.btn-ghost` définit un fond blanc, or il était utilisé avec un texte blanc
en surcharge sur le bandeau vert -> texte invisible. Corrigé :
- Ajout de deux nouvelles bulles jaunes sur la page d'accueil : **🔑 Connexion** et **📧 Contact**
  (même style que « Inscrire mon enfant »).
- Les boutons du bandeau (hero) utilisent désormais soit `.btn-jaune` (jaune, lisible),
  soit une nouvelle classe `.btn-hero-outline` (transparent + bordure blanche, lisible sur fond vert).
- Le bouton « Mon profil » (utilisateur connecté) est également passé en jaune pour rester lisible.

### 2. Âges des sections corrigés
- Conquérants-Alpines : **12–14 ans**
- Aventuriers : **14–15 ans**
- Grands : **15–17 ans**

Ces tranches viennent d'une seule source (`sections` dans l'API) : elles sont donc
automatiquement cohérentes partout (page publique, animateurs, profils enfants, admin).
Une migration douce mnet à jour les tranches même sur une base déjà existante.

### 3. Calendrier parent — « Accès refusé » CORRIGÉ À LA SOURCE
**Cause réelle** : lorsqu'une inscription était validée par l'administrateur, les
enfants étaient ajoutés à la base mais leur champ `compteId` restait à `null` (jamais
rattaché au compte du parent). Toutes les vérifications de droits (calendrier, chefs
de section, documents) échouaient donc avec « Accès refusé », et le front plantait
ensuite avec `Cannot read properties of null (reading 'sectionId')` puisque l'enfant
n'était jamais chargé.

**Corrigé** : `admin/inscriptions/valider` assigne désormais `e.compteId = c.id`
à chaque enfant avant de l'ajouter à la base. Le calendrier fonctionne maintenant :
présent / absent / retard **+ heure d'arrivée prévue en cas de retard**, modifiable
tant que la réunion n'est pas passée. Les réponses sont visibles par les animateurs
de la section et les administrateurs (déjà exposé via `presences/agregat` et le détail
enfant côté admin).

### 4. Fiche santé complète (nouveau)
Nouveau formulaire complet dans **Documents** de la fiche enfant : informations de
l'enfant, 2 contacts d'urgence structurés, problème de santé / allergies / régime /
médicaments / autre info (chacun en Oui-Non + détail), médecin traitant. L'ancienne
autorisation parentale est conservée intégralement (photos, premiers secours) et
enrichie de 3 nouvelles cases : mesures d'urgence, exactitude des informations,
autorisation de transport en voiture par un animateur.

### 5 & 6. Questions — erreurs `sectionId` corrigées
Conséquence directe du correctif n°3 (l'enfant se charge maintenant correctement).
En plus :
- Catégorie « Patro / événement » : plus aucune section requise, la question part
  directement à l'administrateur (visible dans l'onglet **💬 Questions** de l'admin).
- Catégorie « Ma section » : la section est *toujours* dérivée automatiquement de
  l'enfant sélectionné, côté serveur — le parent n'a jamais à la choisir.
- Garde-fou ajouté : si l'enfant n'est pas encore chargé, un message clair s'affiche
  au lieu de planter.

### 7. « Les chefs de ma section » — corrigé (même cause que le n°3)

### 8. Espace administrateur
L'onglet « 🏠 Accueil » a été retiré de la navigation admin. Après connexion,
l'administrateur reste dans son espace (`admin.html` / `profil.html`).

### 9. Déconnexion renforcée
Bouton « 🚪 Se déconnecter » visible directement dans `profil.html`, `animateur.html`
et `admin.html`, ainsi que dans la barre de navigation de toutes les pages privées.
La déconnexion utilise `location.replace()` (pas de retour en arrière possible vers
la page privée) et un gestionnaire `pageshow` recharge automatiquement toute page
restaurée depuis le cache du navigateur (bfcache), ce qui déclenche une nouvelle
vérification d'authentification et coupe l'accès si la session n'est plus valide.

### 10. Vérification des relations Parent → Enfant → Section → Animateurs
Toute la chaîne de droits repose maintenant sur une seule source de vérité fiable :
`enfant.compteId` (toujours renseigné, quel que soit le mode de création — inscription
publique validée, ajout direct par le parent, ou création directe par l'admin).

## ✨ Nouvelle fonctionnalité : Paiements en attente (admin)

Nouvel onglet **💰 Paiements en attente** dans l'espace administrateur :
- Liste tous les paiements (avec filtre « en attente uniquement » / « tous »), avec
  parent, enfant, libellé, montant et statut 🟢/🔴.
- Formulaire de création d'un nouveau paiement : titre, montant, description, date
  limite (facultative), et ciblage (tous les enfants / une section / un enfant précis).
- Le paiement créé apparaît automatiquement dans le profil du ou des parents concernés,
  avec une notification.

## 🔑 Connexion administrateur

| Rôle | E-mail | Mot de passe |
|---|---|---|
| Administrateur | `admin@patro.be` | `Ster2014` |

## 🚀 Déploiement

```bash
git add .
git commit -m "v2.2.0 : corrections majeures (compteId, tuiles, questions, deconnexion) + paiements admin"
git push
```

Netlify redéploiera automatiquement.
