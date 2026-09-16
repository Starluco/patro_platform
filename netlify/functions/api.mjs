/**
 * =====================================================================
 *  API du Patro Notre-Dame d'Ittre — v2.3
 *  Base de donnees : Netlify Blobs (store "patro-db", cle "database")
 *  Routage : /api/*  (config.path). Coherence forte (strong) partout.
 * =====================================================================
 *  NOUVEAUTES v2.3 :
 *  - admin/evenement accepte desormais un id pour MODIFIER un evenement
 *    existant (pas seulement en creer un). Notification optionnelle des
 *    parents/animateurs concernes lors d'une modification.
 *  - Toutes les notifications portent desormais un "lien" precis
 *    (page + parametres + ancre) permettant au front de rediriger
 *    directement l'utilisateur vers l'element concerne au clic.
 *  - Inscription publique accepte un role ('parent' ou 'animateur').
 *    Un compte animateur en attente n'a jamais d'enfants associes.
 *  - admin/comptes/supprimer (deja existant) : conserve explicitement
 *    en commentaire la garantie que les donnees historiques (reunions,
 *    presences, questions) ne sont jamais supprimees, seul le compte
 *    et ses sessions actives le sont.
 * =====================================================================
 */
import { getStore } from '@netlify/blobs';
import { createHash, randomBytes } from 'node:crypto';

const STORE = 'patro-db';
const KEY = 'database';

function store() {
  return getStore({ name: STORE, consistency: 'strong' });
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, x-auth-token',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    },
  });
const err = (msg, status = 400) => json({ error: msg }, status);
const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const norm = (s) => String(s || '').trim().toLowerCase();
const hash = (pwd, salt) => createHash('sha256').update(String(salt) + String(pwd)).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);

const SECTIONS_DEFAUT = [
  { id: 'bengalis',             nom: 'Bengalis',              tranche: '4-6 ans',   ageMin: 4,  ageMax: 6,  couleur: '#7BC043', emoji: '🐯' },
  { id: 'benjas',               nom: 'Benjas',                tranche: '6-9 ans',   ageMin: 6,  ageMax: 9,  couleur: '#4CAF50', emoji: '🦊' },
  { id: 'chevaliers-etincelles',nom: 'Chevaliers-Étincelles', tranche: '9-12 ans',  ageMin: 9,  ageMax: 12, couleur: '#F9C80E', emoji: '🐺' },
  { id: 'conquerants-alpines',  nom: 'Conquérants-Alpines',   tranche: '12-14 ans', ageMin: 12, ageMax: 14, couleur: '#F4A100', emoji: '⛰️' },
  { id: 'aventuriers',          nom: 'Aventuriers',           tranche: '14-15 ans', ageMin: 14, ageMax: 15, couleur: '#2E7D32', emoji: '🎒' },
  { id: 'grands',               nom: 'Grands',                tranche: '15-17 ans', ageMin: 15, ageMax: 17, couleur: '#C9A227', emoji: '🔥' },
];
const TYPES_EVENEMENT = ['reunion', 'souper', 'journee', 'camp'];
const LABEL_TYPE = { reunion: 'Réunion', souper: 'Souper', journee: 'Journée spéciale', camp: 'Camp' };

function seed() {
  const salt = randomBytes(8).toString('hex');
  const admin = {
    id: 'cpt_admin', email: 'admin@patro.be', salt, passwordHash: hash('Ster2014', salt),
    prenom: 'Administrateur', nom: 'Patro', role: 'admin', statut: 'valide',
    tel: '', adresse: '', codePostal: '1460', localite: 'Ittre', contactUrgence: '', remarques: '',
    sectionId: null, totem: '', bio: '', tache: '', liens: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const contenu = {
    patroTexte: "Le Patro est un mouvement de jeunesse belge qui accueille les enfants et les jeunes de 4 à 17 ans, chaque samedi après-midi.\n\n(Ce texte est provisoire : l'administrateur pourra le remplacer depuis l'onglet « Contenu » de l'espace administrateur.)",
    infosImportantes: "Les réunions se déroulent tous les samedis de 14h00 à 17h00.\nUn goûter est prévu lors de chaque réunion.\nLe rendez-vous se fait sur le parking en face du « Deli-traiteur », endroit où se trouvent nos locaux.\nLes enfants peuvent venir essayer une réunion pour voir comment cela se déroule.\nLe camp se déroule chaque année aux mêmes dates, du 1er au 10 août.",
    histoire: [
      { id: 'hist_1', date: '1958', titre: "Fondation du Patro Notre-Dame d'Ittre", texteCourt: "Création du groupe par la paroisse d'Ittre.", texteLong: "Texte détaillé à compléter par l'administrateur depuis l'onglet Contenu." },
    ],
  };
  return {
    meta: { version: 3, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    sections: SECTIONS_DEFAUT, comptes: [admin], enfants: [], reunions: [], presences: [],
    notifications: [], questions: [], taches: [], contenu, sessions: [],
  };
}

async function readDB() {
  const s = store();
  let db = await s.get(KEY, { type: 'json', consistency: 'strong' });
  if (!db) { db = seed(); await s.setJSON(KEY, db); }
  for (const k of ['sections','comptes','enfants','reunions','presences','notifications','questions','taches','sessions']) {
    if (!Array.isArray(db[k])) db[k] = [];
  }
  if (!db.contenu) db.contenu = seed().contenu;
  if (!db.sections.length) db.sections = SECTIONS_DEFAUT;
  db.sections = db.sections.map((s) => {
    const ref = SECTIONS_DEFAUT.find((d) => d.id === s.id);
    if (ref && (s.ageMin !== ref.ageMin || s.ageMax !== ref.ageMax || s.tranche !== ref.tranche)) {
      return { ...s, ageMin: ref.ageMin, ageMax: ref.ageMax, tranche: ref.tranche };
    }
    return s;
  });
  if (!db.comptes.some((c) => c.role === 'admin')) {
    const s2 = seed();
    db.comptes.push(s2.comptes[0]);
  }
  return db;
}
async function writeDB(db) {
  db.meta = { ...(db.meta || {}), updatedAt: new Date().toISOString() };
  await store().setJSON(KEY, db);
  return db;
}
function upsert(list, item, prefix) {
  if (item.id) {
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) { list[i] = { ...list[i], ...item }; return list[i]; }
  }
  const created = { ...item, id: item.id || uid(prefix), createdAt: new Date().toISOString() };
  list.push(created);
  return created;
}

function sectionNom(db, id) { const s = db.sections.find((x) => x.id === id); return s ? s.nom : id; }
function publicCompte(c) { if (!c) return null; const { passwordHash, salt, ...rest } = c; return rest; }
function labelCompte(db, compte) {
  if (!compte) return '';
  if (compte.role === 'admin') return `${compte.prenom} ${compte.nom} — Administrateur`;
  if (compte.role === 'animateur') return `${compte.prenom} ${compte.nom} — Animateur ${sectionNom(db, compte.sectionId)}`;
  const liens = compte.liens || [];
  if (!liens.length) return `${compte.prenom} ${compte.nom} — Parent`;
  const noms = liens.map((l) => { const e = db.enfants.find((x) => x.id === l.enfantId); return e ? e.prenom : null; }).filter(Boolean);
  const lienPrincipal = liens[0].lien || 'Responsable';
  return noms.length ? `${compte.prenom} ${compte.nom} — ${lienPrincipal} de ${noms.join(', ')}` : `${compte.prenom} ${compte.nom} — Parent`;
}
function mesEnfants(db, compte) {
  if (compte.role === 'admin') return db.enfants;
  if (compte.role === 'animateur') return db.enfants.filter((e) => e.sectionId === compte.sectionId);
  const ids = new Set((compte.liens || []).map((l) => l.enfantId));
  return db.enfants.filter((e) => ids.has(e.id));
}
function peutVoirEnfant(db, compte, enfant) {
  if (!enfant) return false;
  if (compte.role === 'admin') return true;
  if (compte.role === 'animateur') return enfant.sectionId === compte.sectionId;
  return enfant.compteId === compte.id;
}
function notifier(db, compteId, titre, texte, lien = '', origine = 'systeme') {
  db.notifications.push({ id: uid('notif'), compteId, titre, texte, lien, lue: false, date: new Date().toISOString(), origine });
}
function auth(db, request) {
  const token = request.headers.get('x-auth-token');
  if (!token) return null;
  const session = db.sessions.find((s) => s.token === token);
  if (!session) return null;
  const compte = db.comptes.find((c) => c.id === session.compteId);
  if (!compte || compte.statut !== 'valide') return null;
  return compte;
}
function enrichirQuestions(db, list) {
  return list.map((q) => {
    const auteur = db.comptes.find((c) => c.id === q.compteId);
    const enfant = q.enfantId ? db.enfants.find((e) => e.id === q.enfantId) : null;
    return { ...q, auteurNom: auteur ? `${auteur.prenom} ${auteur.nom}` : '—', enfantNom: enfant ? `${enfant.prenom} ${enfant.nom}` : null };
  });
}
function paiementParDefaut() {
  return [
    { id: uid('pay'), type: 'cotisation', label: "Cotisation annuelle (goûters inclus)", montant: 50, paye: false, datePaiement: null, description: '', dateLimite: null },
    { id: uid('pay'), type: 'camp', label: "Camp d'été", montant: 150, paye: false, datePaiement: null, description: '', dateLimite: null },
  ];
}
function docsParDefaut() {
  return { ficheSante: null, autorisation: null, autres: [] };
}
function notifierParentsParEnfant(db, sections, titre, texteFn, eventId, origine) {
  db.enfants
    .filter((e) => e.compteId && sections.includes(e.sectionId))
    .forEach((e) => {
      notifier(db, e.compteId, titre, texteFn(e), `enfant.html?id=${e.id}&event=${eventId}#calendrier`, origine);
    });
}
function notifierAnimateursSections(db, sections, titre, texte, eventId, origine) {
  db.comptes
    .filter((c) => c.role === 'animateur' && c.statut === 'valide' && sections.includes(c.sectionId))
    .forEach((c) => notifier(db, c.id, titre, texte, `animateur.html?event=${eventId}#calendrier`, origine));
}

export default async (request, context) => {
  if (request.method === 'OPTIONS') return json({ ok: true });
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\//, '').replace(/\/$/, '');
  let body = {};
  if (request.method === 'POST') { try { body = await request.json(); } catch { body = {}; } }

  try {
    const db = await readDB();
    const compte = auth(db, request);
    const need = (...roles) => compte && roles.includes(compte.role);

    if (route === 'system/status' && request.method === 'GET') {
      return json({ nbComptes: db.comptes.length, initialise: db.comptes.length > 0 });
    }

    if (route === 'sections' && request.method === 'GET') return json({ sections: db.sections });
    if (route === 'contenu' && request.method === 'GET') return json({ contenu: db.contenu });
    if (route === 'animateurs-public' && request.method === 'GET') {
      const list = db.comptes.filter((c) => c.role === 'animateur' && c.statut === 'valide')
        .map((c) => ({ id: c.id, prenom: c.prenom, nom: c.nom, totem: c.totem, bio: c.bio, sectionId: c.sectionId }));
      return json({ animateurs: list, sections: db.sections });
    }

    if (route === 'auth/inscription' && request.method === 'POST') {
      const { prenom, nom, email, password, tel, adresse, codePostal, localite, contactUrgence, role, enfants: enfantsForm } = body;
      const roleFinal = role === 'animateur' ? 'animateur' : 'parent';
      if (!prenom || !nom || !email || !password) return err('Prénom, nom, e-mail et mot de passe sont obligatoires.');
      if (db.comptes.some((c) => norm(c.email) === norm(email))) return err('Un compte existe déjà avec cet e-mail.');
      let nouveauxEnfants = [];
      if (roleFinal === 'parent') {
        if (!Array.isArray(enfantsForm) || !enfantsForm.length) return err("Ajoutez au moins un enfant à la demande d'inscription.");
        nouveauxEnfants = enfantsForm.map((ef) => ({
          id: uid('enf'), compteId: null, prenom: ef.prenom, nom: ef.nom || nom, naissance: ef.naissance,
          sectionId: ef.sectionId || '', allergies: ef.allergies || '', remarquesMedicales: ef.remarquesMedicales || '',
          photoAutorisee: !!ef.photoAutorisee, documents: docsParDefaut(),
          paiements: paiementParDefaut(), createdAt: new Date().toISOString(),
        }));
      }
      const salt = randomBytes(8).toString('hex');
      const compteCree = {
        id: uid('cpt'), email: norm(email), salt, passwordHash: hash(password, salt),
        prenom, nom, role: roleFinal, statut: 'attente', tel: tel || '', adresse: adresse || '',
        codePostal: codePostal || '1460', localite: localite || 'Ittre', contactUrgence: contactUrgence || '', remarques: '',
        sectionId: null, totem: '', bio: '', tache: '',
        liens: nouveauxEnfants.map((e) => ({ enfantId: e.id, lien: e.lien || 'Responsable' })),
        enfantsEnAttente: nouveauxEnfants,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      db.comptes.push(compteCree);
      db.comptes.filter((c) => c.role === 'admin').forEach((a) =>
        notifier(db, a.id, "Nouvelle demande d'inscription", `${prenom} ${nom} a demandé la création d'un compte ${roleFinal === 'animateur' ? 'animateur' : 'parent'}.`, 'admin.html#inscriptions', 'systeme'));
      await writeDB(db);
      return json({ ok: true, message: "Votre demande a été envoyée. Vous recevrez un accès dès validation par l'administrateur." });
    }

    if (route === 'auth/login' && request.method === 'POST') {
      const { email, password } = body;
      const c = db.comptes.find((x) => norm(x.email) === norm(email));
      if (!c || c.passwordHash !== hash(password, c.salt)) return err('E-mail ou mot de passe incorrect.', 401);
      if (c.statut === 'attente') return err("Votre inscription est en attente de validation par l'administrateur.", 403);
      if (c.statut === 'refuse') return err("Votre demande d'inscription a été refusée. Contactez pndi@patro.be.", 403);
      const token = randomBytes(24).toString('hex');
      db.sessions.push({ token, compteId: c.id, createdAt: new Date().toISOString() });
      await writeDB(db);
      return json({ token, compte: publicCompte(c), label: labelCompte(db, c) });
    }
    if (route === 'auth/logout' && request.method === 'POST') {
      const token = request.headers.get('x-auth-token');
      db.sessions = db.sessions.filter((s) => s.token !== token);
      await writeDB(db);
      return json({ ok: true });
    }
    if (route === 'auth/me' && request.method === 'GET') {
      if (!compte) return err('Non authentifié.', 401);
      const nbNonLues = db.notifications.filter((n) => n.compteId === compte.id && !n.lue).length;
      return json({ compte: publicCompte(compte), label: labelCompte(db, compte), nbNotificationsNonLues: nbNonLues });
    }

    if (!compte) return err('Vous devez être connecté.', 401);

    if (route === 'compte/coordonnees' && request.method === 'POST') {
      const champs = ['prenom','nom','tel','adresse','codePostal','localite','contactUrgence','remarques'];
      champs.forEach((k) => { if (body[k] !== undefined) compte[k] = body[k]; });
      compte.updatedAt = new Date().toISOString();
      await writeDB(db);
      return json({ compte: publicCompte(compte), label: labelCompte(db, compte) });
    }

    if (route === 'enfants/mes' && request.method === 'GET') return json({ enfants: mesEnfants(db, compte), sections: db.sections });
    if (route === 'enfants/detail' && request.method === 'GET') {
      const e = db.enfants.find((x) => x.id === url.searchParams.get('id'));
      if (!e) return err('Enfant introuvable.', 404);
      if (!peutVoirEnfant(db, compte, e)) return err("Accès refusé : cet enfant n'est pas associé à votre compte.", 403);
      const chefs = db.comptes.filter((c) => c.role === 'animateur' && c.sectionId === e.sectionId && c.statut === 'valide')
        .map((c) => ({ id: c.id, prenom: c.prenom, nom: c.nom, tel: c.tel, totem: c.totem }));
      const presencesEnfant = db.presences.filter((p) => p.enfantId === e.id);
      return json({ enfant: e, section: db.sections.find((s) => s.id === e.sectionId) || null, chefs, presences: presencesEnfant });
    }
    if (route === 'enfants' && request.method === 'POST' && compte.role === 'parent') {
      const ef = body.enfant || {};
      const e = { id: uid('enf'), compteId: compte.id, prenom: ef.prenom, nom: ef.nom || compte.nom,
        naissance: ef.naissance, sectionId: ef.sectionId || '', allergies: ef.allergies || '', remarquesMedicales: ef.remarquesMedicales || '',
        photoAutorisee: !!ef.photoAutorisee, documents: docsParDefaut(),
        paiements: paiementParDefaut(), createdAt: new Date().toISOString() };
      db.enfants.push(e);
      compte.liens = [...(compte.liens || []), { enfantId: e.id, lien: ef.lien || 'Responsable' }];
      await writeDB(db);
      return json(e);
    }
    if (route === 'enfants/document' && request.method === 'POST') {
      const { enfantId, type, champs } = body;
      const e = db.enfants.find((x) => x.id === enfantId);
      if (!e) return err('Enfant introuvable.', 404);
      if (!(compte.role === 'admin' || e.compteId === compte.id)) return err('Accès refusé.', 403);
      if (!e.documents) e.documents = docsParDefaut();
      if (type === 'autre') {
        e.documents.autres = e.documents.autres || [];
        upsert(e.documents.autres, { ...champs, id: champs.id, updatedAt: new Date().toISOString() }, 'doc');
      } else {
        e.documents[type] = { ...champs, updatedAt: new Date().toISOString() };
      }
      await writeDB(db);
      return json(e.documents);
    }

    if (route === 'reunions' && request.method === 'GET') {
      const sid = url.searchParams.get('sectionId');
      let list = [...db.reunions].sort((a, b) => a.date.localeCompare(b.date));
      if (sid) list = list.filter((r) => !r.sections?.length || r.sections.includes(sid));
      return json({ reunions: list });
    }
    if (route === 'reunions' && request.method === 'POST') {
      if (!need('admin', 'animateur')) return err('Accès refusé.', 403);
      const r = body.reunion || {};
      if (compte.role === 'animateur') r.sections = [compte.sectionId];
      if (!TYPES_EVENEMENT.includes(r.type)) r.type = 'reunion';
      const isEdit = !!r.id;
      const saved = upsert(db.reunions, { ...r, createdBy: compte.id }, 'reu');
      const sectionsCibles = (!saved.sections || !saved.sections.length) ? db.sections.map((s) => s.id) : saved.sections;
      notifierParentsParEnfant(db, sectionsCibles,
        isEdit ? 'Événement modifié' : 'Nouvelle date au calendrier',
        (e) => `« ${saved.titre} » ${isEdit ? 'a été modifié' : 'a été ajouté(e)'} le ${saved.date}.`,
        saved.id, 'animateur');
      await writeDB(db);
      return json(saved);
    }
    if (route === 'reunions/delete' && request.method === 'POST') {
      if (!need('admin', 'animateur')) return err('Accès refusé.', 403);
      const r = db.reunions.find((x) => x.id === body.id);
      if (compte.role === 'animateur' && r && !(r.sections||[]).includes(compte.sectionId)) return err('Accès refusé.', 403);
      db.reunions = db.reunions.filter((x) => x.id !== body.id);
      await writeDB(db); return json({ ok: true });
    }

    if (route === 'presences' && request.method === 'GET') {
      const { enfantId, reunionId, sectionId } = Object.fromEntries(url.searchParams);
      let list = db.presences;
      if (enfantId) list = list.filter((p) => p.enfantId === enfantId);
      if (reunionId) list = list.filter((p) => p.reunionId === reunionId);
      if (sectionId) { const ids = db.enfants.filter((e) => e.sectionId === sectionId).map((e) => e.id); list = list.filter((p) => ids.includes(p.enfantId)); }
      return json({ presences: list });
    }
    if (route === 'presences' && request.method === 'POST') {
      const { enfantId, reunionId, statut = 'present', motifRetard = '', heureArrivee = '' } = body;
      const e = db.enfants.find((x) => x.id === enfantId);
      if (!e) return err('Enfant introuvable.', 404);
      if (!(compte.role === 'admin' || e.compteId === compte.id)) return err("Accès refusé : cet enfant n'est pas associé à votre compte.", 403);
      const r = db.reunions.find((x) => x.id === reunionId);
      if (r && r.date < today() && compte.role !== 'admin') return err("Impossible de modifier la présence d'une réunion passée.", 403);
      const i = db.presences.findIndex((p) => p.enfantId === enfantId && p.reunionId === reunionId);
      const rec = { id: uid('pres'), enfantId, reunionId, statut, motifRetard, heureArrivee, updatedAt: new Date().toISOString() };
      if (i >= 0) db.presences[i] = { ...db.presences[i], statut, motifRetard, heureArrivee, updatedAt: rec.updatedAt };
      else db.presences.push(rec);
      await writeDB(db);
      return json(i >= 0 ? db.presences[i] : rec);
    }
    if (route === 'presences/agregat' && request.method === 'GET') {
      if (!need('admin', 'animateur')) return err('Accès refusé.', 403);
      const sectionId = url.searchParams.get('sectionId') || compte.sectionId;
      const enfantsSection = db.enfants.filter((e) => e.sectionId === sectionId);
      const reunionsSection = db.reunions.filter((r) => !r.sections?.length || r.sections.includes(sectionId));
      const result = reunionsSection.map((r) => {
        const pres = db.presences.filter((p) => p.reunionId === r.id && enfantsSection.some((e) => e.id === p.enfantId));
        return { reunion: r, present: pres.filter((p) => p.statut === 'present').length,
          absent: pres.filter((p) => p.statut === 'absent').length, retard: pres.filter((p) => p.statut === 'retard').length,
          sansReponse: enfantsSection.length - pres.length, totalEnfants: enfantsSection.length };
      });
      return json({ agregat: result.sort((a,b)=>a.reunion.date.localeCompare(b.reunion.date)) });
    }
    if (route === 'presences/manquants' && request.method === 'GET') {
      if (!need('admin')) return err('Accès refusé.', 403);
      const reunionId = url.searchParams.get('reunionId');
      const r = db.reunions.find((x) => x.id === reunionId);
      if (!r) return err('Réunion introuvable.', 404);
      const enfantsConcernes = db.enfants.filter((e) => !r.sections?.length || r.sections.includes(e.sectionId));
      const manquants = enfantsConcernes.filter((e) => !db.presences.some((p) => p.enfantId === e.id && p.reunionId === reunionId));
      const detail = manquants.map((e) => { const parent = db.comptes.find((c) => c.id === e.compteId); return { enfant: e, parent: parent ? publicCompte(parent) : null }; });
      return json({ manquants: detail, reunion: r });
    }

    if (route === 'questions' && request.method === 'POST') {
      if (compte.role !== 'parent') return err('Seuls les parents peuvent poser une question.', 403);
      const { enfantId, categorie, texte } = body;
      if (!texte || !categorie) return err('Catégorie et texte requis.');
      let sectionId = null;
      if (categorie === 'section') {
        if (!enfantId) return err('Merci de sélectionner un enfant pour une question de section.');
        const e = db.enfants.find((x) => x.id === enfantId);
        if (!e || !peutVoirEnfant(db, compte, e)) return err('Enfant introuvable ou non associé à votre compte.', 403);
        sectionId = e.sectionId || null;
        if (!sectionId) return err("La section de cet enfant n'est pas encore définie. Contactez l'administrateur.");
      }
      const q = { id: uid('q'), compteId: compte.id, enfantId: enfantId || null, categorie, sectionId,
        texte, date: new Date().toISOString(), statut: 'ouverte', reponses: [] };
      db.questions.push(q);
      if (categorie === 'section') {
        const dest = db.comptes.filter((c) => c.role === 'animateur' && c.statut === 'valide' && c.sectionId === sectionId);
        if (dest.length) {
          dest.forEach((c) => notifier(db, c.id, 'Nouvelle question', `${compte.prenom} ${compte.nom} a posé une question concernant sa section.`, 'animateur.html#notifications', 'parent'));
        } else {
          db.comptes.filter((c) => c.role === 'admin')
            .forEach((c) => notifier(db, c.id, 'Nouvelle question (section sans animateur)', `${compte.prenom} ${compte.nom} a posé une question de section, mais aucun animateur n'y est encore assigné.`, 'admin.html#animateurs', 'parent'));
        }
      } else {
        db.comptes.filter((c) => c.role === 'admin')
          .forEach((c) => notifier(db, c.id, 'Nouvelle question', `${compte.prenom} ${compte.nom} a posé une question générale.`, 'admin.html#questions', 'parent'));
      }
      await writeDB(db);
      return json(q);
    }
    if (route === 'questions/mes' && request.method === 'GET') {
      if (compte.role !== 'parent') return err('Accès refusé.', 403);
      return json({ questions: db.questions.filter((q) => q.compteId === compte.id).sort((a,b)=>b.date.localeCompare(a.date)) });
    }
    if (route === 'questions/section' && request.method === 'GET') {
      if (!need('admin', 'animateur')) return err('Accès refusé.', 403);
      const sid = compte.role === 'animateur' ? compte.sectionId : url.searchParams.get('sectionId');
      const list = db.questions.filter((q) => q.categorie === 'section' && q.sectionId === sid).sort((a,b)=>b.date.localeCompare(a.date));
      return json({ questions: enrichirQuestions(db, list) });
    }
    if (route === 'questions/patro' && request.method === 'GET') {
      if (!need('admin')) return err('Accès refusé.', 403);
      const list = db.questions.filter((q) => q.categorie === 'patro').sort((a,b)=>b.date.localeCompare(a.date));
      return json({ questions: enrichirQuestions(db, list) });
    }
    if (route === 'questions/repondre' && request.method === 'POST') {
      if (!need('admin', 'animateur')) return err('Accès refusé.', 403);
      const q = db.questions.find((x) => x.id === body.questionId);
      if (!q) return err('Question introuvable.', 404);
      if (compte.role === 'animateur' && q.sectionId !== compte.sectionId) return err('Accès refusé.', 403);
      q.reponses.push({ compteId: compte.id, role: compte.role, texte: body.texte, date: new Date().toISOString() });
      q.statut = 'repondue';
      const lienReponse = q.enfantId ? `enfant.html?id=${q.enfantId}#questions` : 'mes-enfants.html';
      notifier(db, q.compteId, 'Réponse à votre question', body.texte.slice(0, 140), lienReponse, compte.role);
      await writeDB(db);
      return json(q);
    }

    if (route === 'notifications/mes' && request.method === 'GET') {
      const list = db.notifications.filter((n) => n.compteId === compte.id).sort((a,b)=>b.date.localeCompare(a.date));
      return json({ notifications: list, nonLues: list.filter((n) => !n.lue).length });
    }
    if (route === 'notifications/lire' && request.method === 'POST') {
      if (body.all) db.notifications.forEach((n) => { if (n.compteId === compte.id) n.lue = true; });
      else { const n = db.notifications.find((x) => x.id === body.id && x.compteId === compte.id); if (n) n.lue = true; }
      await writeDB(db);
      return json({ ok: true });
    }

    if (route.startsWith('admin/') && !need('admin')) return err("Accès réservé à l'administrateur.", 403);

    if (route === 'admin/comptes/creer' && request.method === 'POST') {
      const { role, prenom, nom, email, password, tel, sectionId, totem, bio, tache,
              adresse, codePostal, localite, contactUrgence, enfants: enfantsForm } = body;
      if (!prenom || !nom || !email || !password) return err('Prénom, nom, e-mail et mot de passe sont obligatoires.');
      if (!['parent','animateur','admin'].includes(role)) return err('Rôle invalide.');
      if (db.comptes.some((c) => norm(c.email) === norm(email))) return err('Un compte existe déjà avec cet e-mail.');
      const salt = randomBytes(8).toString('hex');
      let nouveauxEnfants = [];
      if (role === 'parent' && Array.isArray(enfantsForm)) {
        nouveauxEnfants = enfantsForm.filter((ef) => ef && ef.prenom).map((ef) => ({
          id: uid('enf'), compteId: null, prenom: ef.prenom, nom: ef.nom || nom, naissance: ef.naissance || '',
          sectionId: ef.sectionId || '', allergies: ef.allergies || '', remarquesMedicales: ef.remarquesMedicales || '',
          photoAutorisee: !!ef.photoAutorisee, documents: docsParDefaut(),
          paiements: paiementParDefaut(), createdAt: new Date().toISOString(),
        }));
      }
      const nouveauCompte = {
        id: uid('cpt'), email: norm(email), salt, passwordHash: hash(password, salt),
        prenom, nom, role, statut: 'valide', tel: tel || '', adresse: adresse || '',
        codePostal: codePostal || '1460', localite: localite || 'Ittre', contactUrgence: contactUrgence || '', remarques: '',
        sectionId: role === 'animateur' ? (sectionId || null) : null,
        totem: totem || '', bio: bio || '', tache: tache || '',
        liens: nouveauxEnfants.map((e) => ({ enfantId: e.id, lien: e.lien || 'Responsable' })),
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      db.comptes.push(nouveauCompte);
      nouveauxEnfants.forEach((e) => { e.compteId = nouveauCompte.id; db.enfants.push(e); });
      await writeDB(db);
      return json(publicCompte(nouveauCompte));
    }

    if (route === 'admin/inscriptions' && request.method === 'GET') return json({ inscriptions: db.comptes.filter((c) => c.statut === 'attente').map(publicCompte) });
    if (route === 'admin/inscriptions/valider' && request.method === 'POST') {
      const c = db.comptes.find((x) => x.id === body.compteId);
      if (!c) return err('Compte introuvable.', 404);
      c.statut = 'valide';
      (c.enfantsEnAttente || []).forEach((e) => { e.compteId = c.id; db.enfants.push(e); });
      delete c.enfantsEnAttente;
      notifier(db, c.id, 'Compte validé', 'Votre inscription a été validée. Vous pouvez maintenant vous connecter.', 'connexion.html', 'admin');
      await writeDB(db);
      return json(publicCompte(c));
    }
    if (route === 'admin/inscriptions/refuser' && request.method === 'POST') {
      const c = db.comptes.find((x) => x.id === body.compteId);
      if (!c) return err('Compte introuvable.', 404);
      c.statut = 'refuse'; delete c.enfantsEnAttente;
      await writeDB(db);
      return json(publicCompte(c));
    }
    if (route === 'admin/comptes' && request.method === 'GET') return json({ comptes: db.comptes.map(publicCompte) });
    if (route === 'admin/comptes/role' && request.method === 'POST') {
      const c = db.comptes.find((x) => x.id === body.compteId);
      if (!c) return err('Compte introuvable.', 404);
      if (body.role) c.role = body.role;
      if (body.sectionId !== undefined) c.sectionId = body.sectionId;
      if (body.totem !== undefined) c.totem = body.totem;
      if (body.bio !== undefined) c.bio = body.bio;
      if (body.tache !== undefined) c.tache = body.tache;
      if (body.tel !== undefined) c.tel = body.tel;
      c.updatedAt = new Date().toISOString();
      await writeDB(db);
      return json(publicCompte(c));
    }
    if (route === 'admin/comptes/statut' && request.method === 'POST') {
      const c = db.comptes.find((x) => x.id === body.compteId);
      if (!c) return err('Compte introuvable.', 404);
      c.statut = body.statut;
      await writeDB(db);
      return json(publicCompte(c));
    }
    /* Suppression d'un compte (utilisee notamment pour retirer un animateur).
       IMPORTANT : seuls db.comptes et db.sessions sont modifies ici. Les
       reunions, presences et questions liees a ce compte (createdBy,
       compteId dans les reponses, etc.) restent intactes dans la base :
       aucune donnee historique n'est supprimee, seul l'ACCES est retire. */
    if (route === 'admin/comptes/supprimer' && request.method === 'POST') {
      const c = db.comptes.find((x) => x.id === body.compteId);
      if (!c) return err('Compte introuvable.', 404);
      if (c.role === 'admin' && db.comptes.filter((x) => x.role === 'admin').length <= 1) {
        return err('Impossible de supprimer le dernier compte administrateur.', 400);
      }
      db.comptes = db.comptes.filter((x) => x.id !== body.compteId);
      db.sessions = db.sessions.filter((s) => s.compteId !== body.compteId);
      await writeDB(db);
      return json({ ok: true });
    }
    if (route === 'admin/enfants/ajouter' && request.method === 'POST') {
      const { compteId, enfant } = body;
      const c = db.comptes.find((x) => x.id === compteId);
      if (!c || c.role !== 'parent') return err('Compte parent introuvable.', 404);
      const e = { id: uid('enf'), compteId: c.id, prenom: enfant.prenom, nom: enfant.nom || c.nom,
        naissance: enfant.naissance || '', sectionId: enfant.sectionId || '', allergies: enfant.allergies || '',
        remarquesMedicales: enfant.remarquesMedicales || '', photoAutorisee: !!enfant.photoAutorisee,
        documents: docsParDefaut(), paiements: paiementParDefaut(), createdAt: new Date().toISOString() };
      db.enfants.push(e);
      c.liens = [...(c.liens || []), { enfantId: e.id, lien: enfant.lien || 'Responsable' }];
      await writeDB(db);
      return json(e);
    }

    if (route === 'admin/enfants' && request.method === 'GET') return json({ enfants: db.enfants, sections: db.sections });
    if (route === 'admin/paiements/marquer' && request.method === 'POST') {
      const e = db.enfants.find((x) => x.id === body.enfantId);
      if (!e) return err('Enfant introuvable.', 404);
      const p = e.paiements.find((x) => x.id === body.paiementId);
      if (!p) return err('Paiement introuvable.', 404);
      p.paye = !!body.paye; p.datePaiement = p.paye ? today() : null;
      if (e.compteId) notifier(db, e.compteId, 'Paiement mis à jour', `Le paiement « ${p.label} » de ${e.prenom} a été marqué comme ${p.paye ? 'payé' : 'non payé'}.`, `profil.html?enfant=${e.id}#paiements`, 'admin');
      await writeDB(db);
      return json(e);
    }
    if (route === 'admin/paiements' && request.method === 'GET') {
      const lignes = [];
      db.enfants.forEach((e) => {
        const parent = db.comptes.find((c) => c.id === e.compteId);
        (e.paiements || []).forEach((p) => {
          lignes.push({
            paiementId: p.id, enfantId: e.id, enfantNom: `${e.prenom} ${e.nom}`,
            sectionId: e.sectionId, parentId: parent ? parent.id : null,
            parentNom: parent ? `${parent.prenom} ${parent.nom}` : '—',
            parentEmail: parent ? parent.email : '—',
            label: p.label, type: p.type, montant: p.montant, paye: p.paye,
            datePaiement: p.datePaiement, description: p.description || '', dateLimite: p.dateLimite || null,
          });
        });
      });
      return json({ paiements: lignes, sections: db.sections });
    }
    if (route === 'admin/paiements/creer' && request.method === 'POST') {
      const { titre, montant, description, dateLimite, cible, enfantId, sectionId } = body;
      if (!titre || montant === undefined || montant === null || montant === '') return err('Titre et montant sont obligatoires.');
      const m = Number(montant);
      if (Number.isNaN(m) || m < 0) return err('Montant invalide.');
      let cibles = [];
      if (cible === 'enfant') {
        const e = db.enfants.find((x) => x.id === enfantId);
        if (!e) return err('Enfant introuvable.', 404);
        cibles = [e];
      } else if (cible === 'section') {
        cibles = db.enfants.filter((e) => e.sectionId === sectionId);
        if (!cibles.length) return err('Aucun enfant dans cette section.');
      } else {
        cibles = db.enfants;
      }
      const paiementsCrees = [];
      cibles.forEach((e) => {
        const p = { id: uid('pay'), type: 'custom', label: titre, montant: m, paye: false, datePaiement: null,
          description: description || '', dateLimite: dateLimite || null };
        e.paiements = [...(e.paiements || []), p];
        paiementsCrees.push({ enfantId: e.id, paiementId: p.id });
        if (e.compteId) notifier(db, e.compteId, 'Nouveau paiement à effectuer', `« ${titre} » — ${m} € pour ${e.prenom}${dateLimite ? ` (à régler avant le ${dateLimite})` : ''}.`, `profil.html?enfant=${e.id}#paiements`, 'admin');
      });
      await writeDB(db);
      return json({ ok: true, nbCrees: paiementsCrees.length });
    }
    if (route === 'admin/notifications/envoyer' && request.method === 'POST') {
      const { enfantId, titre, texte } = body;
      const e = db.enfants.find((x) => x.id === enfantId);
      if (!e || !e.compteId) return err('Enfant introuvable ou sans compte parent.', 404);
      notifier(db, e.compteId, titre || "Message du Patro Notre-Dame d'Ittre", texte, `enfant.html?id=${e.id}`, 'admin');
      await writeDB(db);
      return json({ ok: true });
    }
    if (route === 'admin/rappels/presence' && request.method === 'POST') {
      const { reunionId } = body;
      const r = db.reunions.find((x) => x.id === reunionId);
      if (!r) return err('Réunion introuvable.', 404);
      const enfantsConcernes = db.enfants.filter((e) => !r.sections?.length || r.sections.includes(e.sectionId));
      const manquants = enfantsConcernes.filter((e) => !db.presences.some((p) => p.enfantId === e.id && p.reunionId === reunionId));
      let n = 0;
      manquants.forEach((e) => { if (e.compteId) { notifier(db, e.compteId, 'Rappel — présence à confirmer', `Merci d'indiquer si ${e.prenom} sera présent(e) à « ${r.titre} » le ${r.date}.`, `enfant.html?id=${e.id}&event=${r.id}#calendrier`, 'admin'); n++; } });
      await writeDB(db);
      return json({ ok: true, nbRappels: n });
    }
    if (route === 'admin/taches' && request.method === 'GET') return json({ taches: db.taches, comptes: db.comptes.filter(c=>c.role!=='parent').map(publicCompte) });
    if (route === 'admin/taches' && request.method === 'POST') { const t = upsert(db.taches, body.tache || {}, 'tache'); await writeDB(db); return json(t); }
    if (route === 'admin/taches/delete' && request.method === 'POST') { db.taches = db.taches.filter((x) => x.id !== body.id); await writeDB(db); return json({ ok: true }); }
    if (route === 'admin/sections' && request.method === 'POST') { const s = upsert(db.sections, body.section || {}, 'sec'); await writeDB(db); return json(s); }
    if (route === 'admin/contenu' && request.method === 'POST') {
      if (body.patroTexte !== undefined) db.contenu.patroTexte = body.patroTexte;
      if (body.infosImportantes !== undefined) db.contenu.infosImportantes = body.infosImportantes;
      await writeDB(db); return json(db.contenu);
    }
    if (route === 'admin/histoire' && request.method === 'POST') { const h = upsert(db.contenu.histoire, body.evenement || {}, 'hist'); await writeDB(db); return json(h); }
    if (route === 'admin/histoire/delete' && request.method === 'POST') { db.contenu.histoire = db.contenu.histoire.filter((x) => x.id !== body.id); await writeDB(db); return json({ ok: true }); }

    if (route === 'admin/evenement' && request.method === 'POST') {
      const r = body.reunion || {};
      if (!TYPES_EVENEMENT.includes(r.type)) r.type = 'reunion';
      if (!r.sections || !r.sections.length) r.sections = db.sections.map((s) => s.id);
      const isEdit = !!r.id;
      const saved = upsert(db.reunions, { ...r, createdBy: compte.id }, 'reu');
      if (!isEdit) {
        notifierParentsParEnfant(db, saved.sections, 'Nouvel événement',
          (e) => `« ${saved.titre} » (${LABEL_TYPE[saved.type]}) a été ajouté le ${saved.date}.`, saved.id, 'admin');
      } else if (body.notifierModif) {
        notifierParentsParEnfant(db, saved.sections, 'Événement modifié',
          (e) => `« ${saved.titre} » a été modifié (date : ${saved.date}, ${saved.heureDebut||''}-${saved.heureFin||''}).`, saved.id, 'admin');
        notifierAnimateursSections(db, saved.sections, 'Événement modifié',
          `« ${saved.titre} » a été modifié (date : ${saved.date}).`, saved.id, 'admin');
      }
      await writeDB(db);
      return json(saved);
    }

    if (route === 'admin/stats' && request.method === 'GET') {
      const annee = url.searchParams.get('annee') || String(new Date().getFullYear());
      const reunionsAnnee = db.reunions.filter((r) => (r.date || '').startsWith(annee));
      const tauxEvenement = (r) => {
        const enfantsConcernes = db.enfants.filter((e) => !r.sections?.length || r.sections.includes(e.sectionId));
        if (!enfantsConcernes.length) return null;
        const pres = db.presences.filter((p) => p.reunionId === r.id && enfantsConcernes.some((e) => e.id === p.enfantId) && (p.statut === 'present' || p.statut === 'retard'));
        return Math.round((pres.length / enfantsConcernes.length) * 100);
      };
      const parType = {};
      TYPES_EVENEMENT.forEach((t) => {
        const evts = reunionsAnnee.filter((r) => r.type === t);
        const taux = evts.map(tauxEvenement).filter((x) => x !== null);
        parType[t] = taux.length ? Math.round(taux.reduce((a,b)=>a+b,0)/taux.length) : null;
      });
      const parSection = {};
      db.sections.forEach((s) => {
        parSection[s.id] = {};
        TYPES_EVENEMENT.forEach((t) => {
          const evts = reunionsAnnee.filter((r) => r.type === t && (!r.sections?.length || r.sections.includes(s.id)));
          const enf = db.enfants.filter((e) => e.sectionId === s.id);
          const taux = evts.map((r) => {
            if (!enf.length) return null;
            const pres = db.presences.filter((p) => p.reunionId === r.id && enf.some((e) => e.id === p.enfantId) && (p.statut === 'present' || p.statut === 'retard'));
            return Math.round((pres.length / enf.length) * 100);
          }).filter((x) => x !== null);
          parSection[s.id][t] = taux.length ? Math.round(taux.reduce((a,b)=>a+b,0)/taux.length) : null;
        });
      });
      const parEvenement = reunionsAnnee.map((r) => ({ id: r.id, titre: r.titre, type: r.type, date: r.date, taux: tauxEvenement(r) })).sort((a,b)=>a.date.localeCompare(b.date));
      const annees = [...new Set(db.reunions.map((r) => (r.date||'').slice(0,4)))].filter(Boolean).sort();
      return json({ annee, annees, global: parType, parSection, parEvenement, sections: db.sections, labelsType: LABEL_TYPE });
    }

    return err(`Route inconnue : ${route}`, 404);
  } catch (e) {
    return err(e.message + ' | ' + (e.stack||'').slice(0,300), 500);
  }
};

export const config = { path: '/api/*' };
