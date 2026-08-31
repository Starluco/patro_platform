/**
 * =====================================================================
 *  API unique du Patro Notre-Dame d'Ittre
 *  Base de donnees : Netlify Blobs (store "patro-db", un seul blob JSON)
 *  Doc : https://docs.netlify.com/build/data-and-storage/netlify-blobs/
 * =====================================================================
 *  Cette fonction declare elle-meme sa route via `config.path = "/api/*"`.
 *  Elle est donc UNIQUEMENT accessible sur /api/... (pas sur
 *  /.netlify/functions/api/...). Ne pas ajouter de [[redirects]] vers
 *  cette derniere adresse dans netlify.toml : cela provoque des 404.
 *
 *   GET  /api/db                      -> toute la base (debug / admin)
 *   POST /api/reset                   -> reinitialise avec les donnees demo
 *
 *   GET  /api/sections                -> sections + chefs
 *   POST /api/sections                -> upsert section        (admin)
 *   POST /api/chefs                   -> upsert chef           (admin)
 *   POST /api/chefs/delete            -> supprime un chef      (admin)
 *
 *   POST /api/parents/login           -> { email }  -> parent + enfants
 *   POST /api/parents                 -> upsert parent (inscription/maj coord.)
 *   POST /api/enfants                 -> upsert enfant
 *   POST /api/enfants/delete          -> supprime un enfant
 *   POST /api/enfants/cotisation      -> maj paiement          (admin)
 *
 *   GET  /api/reunions                -> liste des reunions (calendrier)
 *   POST /api/reunions                -> upsert reunion        (admin)
 *   POST /api/reunions/delete         -> supprime une reunion  (admin)
 *
 *   GET  /api/presences               -> toutes les presences
 *   POST /api/presences               -> pointe une presence
 *
 *   GET  /api/infos                   -> annonces / actualites
 *   POST /api/infos                   -> upsert annonce        (admin)
 *   POST /api/infos/delete            -> supprime annonce      (admin)
 *
 *   POST /api/messages/send           -> envoi d'un e-mail groupe (admin)
 *   GET  /api/messages                -> historique des envois
 *
 *   POST /api/admin/login             -> verifie le mot de passe president
 * =====================================================================
 */

import { getStore } from '@netlify/blobs';

const STORE = 'patro-db';
const KEY = 'database';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, x-admin-password',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    },
  });

const uid = (p = 'id') =>
  `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/* ------------------------------------------------------------------ */
/*  Donnees de demonstration (fictives)                                */
/* ------------------------------------------------------------------ */
function seed() {
  const sections = [
    { id: 'bengalis',  nom: 'Bengalis',    tranche: '4-6 ans',   ageMin: 4,  ageMax: 6,  couleur: '#7BC043', emoji: '🐯',
      description: "Les tout-petits du Patro : jeux, bricolages et premieres grandes aventures." },
    { id: 'benjas',    nom: 'Benjas',      tranche: '6-9 ans',   ageMin: 6,  ageMax: 9,  couleur: '#4CAF50', emoji: '🦊',
      description: "On decouvre la vie en groupe, les grands jeux et les chants du Patro." },
    { id: 'chev-etc',  nom: 'Chev-Etc',    tranche: '9-12 ans',  ageMin: 9,  ageMax: 12, couleur: '#F9C80E', emoji: '🐺',
      description: "Jeux de piste, defis d'equipe et premiers hikes." },
    { id: 'conq-alps', nom: 'Conq-Alps',   tranche: '12+ ans',   ageMin: 12, ageMax: 15, couleur: '#F4A100', emoji: '⛰️',
      description: "Grands jeux, projets et responsabilites croissantes." },
    { id: 'aventuriers', nom: 'Aventuriers', tranche: '15-17 ans', ageMin: 15, ageMax: 17, couleur: '#2E7D32', emoji: '🎒',
      description: "Les aventuriers construisent leurs propres projets et services." },
    { id: 'grands',    nom: 'Grands',      tranche: '17+ ans',   ageMin: 17, ageMax: 99, couleur: '#C9A227', emoji: '🔥',
      description: "Les plus grands : service, animation et esprit Patro." },
  ];

  const chefs = [
    { id: 'chef_1', prenom: 'Camille', nom: 'Dubois',   role: 'Cheffe de section', sectionId: 'bengalis',  email: 'camille.dubois@patro-ittre.be', tel: '0470 11 22 33', totem: 'Loutre' },
    { id: 'chef_2', prenom: 'Thomas',  nom: 'Lemaire',  role: 'Animateur',         sectionId: 'bengalis',  email: 'thomas.lemaire@patro-ittre.be',  tel: '0471 22 33 44', totem: 'Ecureuil' },
    { id: 'chef_3', prenom: 'Sarah',   nom: 'Vermeulen',role: 'Cheffe de section', sectionId: 'benjas',    email: 'sarah.vermeulen@patro-ittre.be', tel: '0472 33 44 55', totem: 'Mesange' },
    { id: 'chef_4', prenom: 'Antoine', nom: 'Hublet',   role: 'Animateur',         sectionId: 'benjas',    email: 'antoine.hublet@patro-ittre.be',  tel: '0473 44 55 66', totem: 'Blaireau' },
    { id: 'chef_5', prenom: 'Julie',   nom: 'Marchal',  role: 'Cheffe de section', sectionId: 'chev-etc',  email: 'julie.marchal@patro-ittre.be',   tel: '0474 55 66 77', totem: 'Hirondelle' },
    { id: 'chef_6', prenom: 'Maxime',  nom: 'Delvaux',  role: 'Chef de section',   sectionId: 'conq-alps', email: 'maxime.delvaux@patro-ittre.be',  tel: '0475 66 77 88', totem: 'Bouquetin' },
    { id: 'chef_7', prenom: 'Lucie',   nom: 'Renard',   role: 'Animatrice',        sectionId: 'aventuriers', email: 'lucie.renard@patro-ittre.be',  tel: '0476 77 88 99', totem: 'Chouette' },
    { id: 'chef_8', prenom: 'Nicolas', nom: 'Bastin',   role: 'President',         sectionId: 'grands',    email: 'pndi@patro.be',                  tel: '0477 88 99 00', totem: 'Bison' },
  ];

  const parents = [
    { id: 'par_1', prenom: 'Marie',   nom: 'Durand', email: 'marie.durand@example.com', tel: '0478 12 34 56',
      adresse: 'Rue de la Montagne 12', codePostal: '1460', localite: 'Ittre',
      contactUrgence: 'Paul Durand — 0479 65 43 21', remarques: '' },
    { id: 'par_2', prenom: 'Olivier', nom: 'Peeters', email: 'olivier.peeters@example.com', tel: '0479 98 76 54',
      adresse: 'Chaussee de Nivelles 45', codePostal: '1460', localite: 'Virginal',
      contactUrgence: 'Sophie Peeters — 0470 55 44 33', remarques: '' },
  ];

  const enfants = [
    { id: 'enf_1', parentId: 'par_1', prenom: 'Lea',   nom: 'Durand',  naissance: '2018-04-12', sectionId: 'bengalis',
      cotisationPayee: true,  montantCotisation: 45, dateNaissanceOk: true,
      allergies: 'Arachides', remarquesMedicales: '', photoAutorisee: true },
    { id: 'enf_2', parentId: 'par_1', prenom: 'Hugo',  nom: 'Durand',  naissance: '2015-09-03', sectionId: 'benjas',
      cotisationPayee: false, montantCotisation: 45, dateNaissanceOk: true,
      allergies: '', remarquesMedicales: 'Asthme leger (ventoline dans le sac)', photoAutorisee: true },
    { id: 'enf_3', parentId: 'par_2', prenom: 'Nina',  nom: 'Peeters', naissance: '2013-01-22', sectionId: 'chev-etc',
      cotisationPayee: true,  montantCotisation: 45, dateNaissanceOk: true,
      allergies: '', remarquesMedicales: '', photoAutorisee: false },
  ];

  const reunions = [];
  const samedis = [
    '2025-09-06','2025-09-13','2025-09-20','2025-09-27',
    '2025-10-04','2025-10-11','2025-10-18','2025-10-25',
    '2025-11-08','2025-11-15','2025-11-22','2025-11-29',
    '2025-12-06','2025-12-13','2025-12-20',
  ];
  samedis.forEach((d, i) => {
    reunions.push({
      id: `reu_${d}`,
      date: d,
      heureDebut: '14:00',
      heureFin: '17:00',
      titre: i === 0 ? 'Reunion de rentree' : 'Reunion hebdomadaire',
      lieu: 'Parking en face du Deli-traiteur, Ittre',
      sections: ['bengalis','benjas','chev-etc','conq-alps','aventuriers','grands'],
      type: 'reunion',
      remarques: i === 0 ? 'Apportez la fiche d inscription completee !' : '',
    });
  });
  reunions.push({
    id: 'reu_camp_2026', date: '2026-08-01', dateFin: '2026-08-10',
    heureDebut: '10:00', heureFin: '16:00',
    titre: 'CAMP D ETE — du 1er au 10 aout',
    lieu: 'Lieu de camp (communique en juin)',
    sections: ['bengalis','benjas','chev-etc','conq-alps','aventuriers','grands'],
    type: 'camp', remarques: 'Le camp se deroule chaque annee du 1er au 10 aout.',
  });

  const infos = [
    { id: 'info_1', date: '2025-08-20', titre: 'Reprise des reunions le 6 septembre !',
      texte: "Rendez-vous samedi 6 septembre a 14h00 sur le parking en face du Deli-traiteur. Les nouveaux sont les bienvenus pour essayer une reunion.",
      important: true, sections: [] },
    { id: 'info_2', date: '2025-08-25', titre: 'Cotisation annuelle',
      texte: "La cotisation est de 45 EUR par enfant (35 EUR a partir du 3e enfant). A verser sur le compte BE00 0000 0000 0000 avec en communication le nom de l enfant + sa section.",
      important: false, sections: [] },
  ];

  return {
    meta: { version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    sections, chefs, parents, enfants, reunions, presences: [], infos, messages: [],
  };
}

/* ------------------------------------------------------------------ */
/*  Acces base                                                         */
/* ------------------------------------------------------------------ */
async function readDB() {
  const store = getStore(STORE);
  let db = await store.get(KEY, { type: 'json' });
  if (!db) {
    db = seed();
    await store.setJSON(KEY, db);
  }
  for (const k of ['sections','chefs','parents','enfants','reunions','presences','infos','messages']) {
    if (!Array.isArray(db[k])) db[k] = [];
  }
  return db;
}

async function writeDB(db) {
  db.meta = { ...(db.meta || {}), updatedAt: new Date().toISOString() };
  await getStore(STORE).setJSON(KEY, db);
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

const norm = (s) => String(s || '').trim().toLowerCase();

/* ------------------------------------------------------------------ */
/*  Handler                                                            */
/* ------------------------------------------------------------------ */
export default async (request, context) => {
  if (request.method === 'OPTIONS') return json({ ok: true });

  const url = new URL(request.url);
  // Cette fonction est routee via config.path = "/api/*" -> pathname = /api/xxx
  const route = url.pathname
    .replace(/^\/api\//, '')
    .replace(/^\/\.netlify\/functions\/api\/?/, '')
    .replace(/\/$/, '');

  let body = {};
  if (request.method === 'POST') {
    try { body = await request.json(); } catch { body = {}; }
  }

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'patro2025';
  const isAdmin = () =>
    (request.headers.get('x-admin-password') || body.adminPassword) === ADMIN_PASSWORD;
  const needAdmin = () => json({ error: 'Mot de passe administrateur invalide.' }, 401);

  try {
    if (route === 'db' && request.method === 'GET') return json(await readDB());

    if (route === 'reset' && request.method === 'POST') {
      if (!isAdmin()) return needAdmin();
      return json(await writeDB(seed()));
    }

    if (route === 'admin/login' && request.method === 'POST') {
      return isAdmin() ? json({ ok: true }) : needAdmin();
    }

    const db = await readDB();

    /* ---------------- sections & chefs ---------------- */
    if (route === 'sections' && request.method === 'GET') {
      return json({
        sections: db.sections.map((s) => ({
          ...s,
          chefs: db.chefs.filter((c) => c.sectionId === s.id),
          nbEnfants: db.enfants.filter((e) => e.sectionId === s.id).length,
        })),
      });
    }
    if (route === 'sections' && request.method === 'POST') {
      if (!isAdmin()) return needAdmin();
      const s = upsert(db.sections, body.section || {}, 'sec');
      await writeDB(db); return json(s);
    }
    if (route === 'chefs' && request.method === 'GET') return json({ chefs: db.chefs });
    if (route === 'chefs' && request.method === 'POST') {
      if (!isAdmin()) return needAdmin();
      const c = upsert(db.chefs, body.chef || {}, 'chef');
      await writeDB(db); return json(c);
    }
    if (route === 'chefs/delete' && request.method === 'POST') {
      if (!isAdmin()) return needAdmin();
      db.chefs = db.chefs.filter((c) => c.id !== body.id);
      await writeDB(db); return json({ ok: true });
    }

    /* ---------------- parents & enfants ---------------- */
    if (route === 'parents/login' && request.method === 'POST') {
      const email = norm(body.email);
      const parent = db.parents.find((p) => norm(p.email) === email);
      if (!parent) return json({ error: 'Aucun parent trouve avec cet e-mail. Inscrivez-vous d abord.' }, 404);
      const enfants = db.enfants.filter((e) => e.parentId === parent.id);
      return json({ parent, enfants, sections: db.sections, chefs: db.chefs });
    }
    if (route === 'parents' && request.method === 'GET') return json({ parents: db.parents });
    if (route === 'parents' && request.method === 'POST') {
      const p = body.parent || {};
      if (!p.id) {
        const exist = db.parents.find((x) => norm(x.email) === norm(p.email));
        if (exist) p.id = exist.id;
      }
      const saved = upsert(db.parents, p, 'par');
      await writeDB(db); return json(saved);
    }
    if (route === 'enfants' && request.method === 'GET') return json({ enfants: db.enfants });
    if (route === 'enfants' && request.method === 'POST') {
      const saved = upsert(db.enfants, body.enfant || {}, 'enf');
      await writeDB(db); return json(saved);
    }
    if (route === 'enfants/delete' && request.method === 'POST') {
      db.enfants = db.enfants.filter((e) => e.id !== body.id);
      db.presences = db.presences.filter((p) => p.enfantId !== body.id);
      await writeDB(db); return json({ ok: true });
    }
    if (route === 'enfants/cotisation' && request.method === 'POST') {
      if (!isAdmin()) return needAdmin();
      const e = db.enfants.find((x) => x.id === body.id);
      if (!e) return json({ error: 'Enfant introuvable' }, 404);
      e.cotisationPayee = !!body.cotisationPayee;
      if (body.montantCotisation != null) e.montantCotisation = Number(body.montantCotisation);
      e.datePaiement = e.cotisationPayee ? (body.datePaiement || new Date().toISOString().slice(0, 10)) : null;
      await writeDB(db); return json(e);
    }

    /* ---------------- reunions ---------------- */
    if (route === 'reunions' && request.method === 'GET') {
      const sid = url.searchParams.get('sectionId');
      let list = [...db.reunions].sort((a, b) => a.date.localeCompare(b.date));
      if (sid) list = list.filter((r) => !r.sections?.length || r.sections.includes(sid));
      return json({ reunions: list });
    }
    if (route === 'reunions' && request.method === 'POST') {
      if (!isAdmin()) return needAdmin();
      const r = upsert(db.reunions, body.reunion || {}, 'reu');
      await writeDB(db); return json(r);
    }
    if (route === 'reunions/delete' && request.method === 'POST') {
      if (!isAdmin()) return needAdmin();
      db.reunions = db.reunions.filter((r) => r.id !== body.id);
      await writeDB(db); return json({ ok: true });
    }

    /* ---------------- presences ---------------- */
    if (route === 'presences' && request.method === 'GET') {
      const { enfantId, reunionId, sectionId } = Object.fromEntries(url.searchParams);
      let list = db.presences;
      if (enfantId) list = list.filter((p) => p.enfantId === enfantId);
      if (reunionId) list = list.filter((p) => p.reunionId === reunionId);
      if (sectionId) {
        const ids = db.enfants.filter((e) => e.sectionId === sectionId).map((e) => e.id);
        list = list.filter((p) => ids.includes(p.enfantId));
      }
      return json({ presences: list });
    }
    if (route === 'presences' && request.method === 'POST') {
      const { enfantId, reunionId, statut = 'present', commentaire = '' } = body;
      if (!enfantId || !reunionId) return json({ error: 'enfantId et reunionId requis' }, 400);
      const i = db.presences.findIndex((p) => p.enfantId === enfantId && p.reunionId === reunionId);
      const rec = { id: uid('pres'), enfantId, reunionId, statut, commentaire, updatedAt: new Date().toISOString() };
      if (i >= 0) db.presences[i] = { ...db.presences[i], statut, commentaire, updatedAt: rec.updatedAt };
      else db.presences.push(rec);
      await writeDB(db);
      return json(i >= 0 ? db.presences[i] : rec);
    }

    /* ---------------- infos ---------------- */
    if (route === 'infos' && request.method === 'GET') {
      return json({ infos: [...db.infos].sort((a, b) => (b.date || '').localeCompare(a.date || '')) });
    }
    if (route === 'infos' && request.method === 'POST') {
      if (!isAdmin()) return needAdmin();
      const i = upsert(db.infos, body.info || {}, 'info');
      await writeDB(db); return json(i);
    }
    if (route === 'infos/delete' && request.method === 'POST') {
      if (!isAdmin()) return needAdmin();
      db.infos = db.infos.filter((x) => x.id !== body.id);
      await writeDB(db); return json({ ok: true });
    }

    /* ---------------- communication ---------------- */
    if (route === 'messages' && request.method === 'GET') {
      return json({ messages: [...db.messages].reverse() });
    }
    if (route === 'messages/send' && request.method === 'POST') {
      if (!isAdmin()) return needAdmin();
      const { sujet, texte, cible = 'tous', sectionId = null, destinatairesManuels = [] } = body;
      if (!sujet || !texte) return json({ error: 'Sujet et message requis.' }, 400);

      const parentsAvecEnfants = (filtre) => {
        const ids = new Set(db.enfants.filter(filtre).map((e) => e.parentId));
        return db.parents.filter((p) => ids.has(p.id));
      };
      let dest = [];
      switch (cible) {
        case 'tous':          dest = db.parents; break;
        case 'en-ordre':      dest = parentsAvecEnfants((e) => e.cotisationPayee); break;
        case 'pas-en-ordre':  dest = parentsAvecEnfants((e) => !e.cotisationPayee); break;
        case 'section':       dest = parentsAvecEnfants((e) => e.sectionId === sectionId); break;
        case 'chefs':         dest = db.chefs; break;
        case 'manuel':        dest = destinatairesManuels.map((email) => ({ email })); break;
        default:              dest = db.parents;
      }
      const emails = [...new Set(dest.map((d) => d.email).filter(Boolean))];

      let envoye = false, erreur = null;
      if (process.env.RESEND_API_KEY && emails.length) {
        try {
          const r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              authorization: `Bearer ${process.env.RESEND_API_KEY}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              from: process.env.MAIL_FROM || 'pndi@patro.be',
              to: process.env.MAIL_FROM || 'pndi@patro.be',
              bcc: emails,
              subject: sujet,
              html: `<div style="font-family:system-ui,sans-serif;line-height:1.6">
                       <div style="background:#2E7D32;color:#fff;padding:16px;border-radius:12px 12px 0 0">
                         <strong>Patro Notre-Dame d'Ittre</strong></div>
                     <div style="border:1px solid #eee;border-top:0;padding:20px;border-radius:0 0 12px 12px">
                       ${String(texte).replace(/\n/g, '<br>')}
                       <hr style="border:0;border-top:1px solid #eee;margin:20px 0">
                       <small style="color:#666">Le Staff du Patro Notre-Dame d'Ittre — pndi@patro.be</small>
                     </div></div>`,
            }),
          });
          envoye = r.ok;
          if (!r.ok) erreur = await r.text();
        } catch (e) { erreur = e.message; }
      }

      const msg = {
        id: uid('msg'), date: new Date().toISOString(), sujet, texte, cible, sectionId,
        nbDestinataires: emails.length, destinataires: emails,
        envoye, mode: process.env.RESEND_API_KEY ? 'reel' : 'simulation', erreur,
      };
      db.messages.push(msg);
      await writeDB(db);
      return json(msg);
    }

    return json({ error: `Route inconnue : ${route}` }, 404);
  } catch (err) {
    return json({ error: err.message, stack: err.stack }, 500);
  }
};

export const config = { path: '/api/*' };
