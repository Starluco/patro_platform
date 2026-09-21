/**
 * =====================================================================
 *  Fonctions utilitaires partagées — couche SQL (v3.0)
 * =====================================================================
 */
import { createHash, randomBytes } from 'node:crypto';
import { sql } from './db.mjs';

export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export const norm = (s) => String(s || '').trim().toLowerCase();
export const hashPwd = (pwd, salt) => createHash('sha256').update(String(salt) + String(pwd)).digest('hex');
export const today = () => new Date().toISOString().slice(0, 10);
export { randomBytes };

export const TYPES_EVENEMENT = ['reunion', 'souper', 'journee', 'camp'];
export const LABEL_TYPE = { reunion: 'Réunion', souper: 'Souper', journee: 'Journée spéciale', camp: 'Camp' };

// ---------------------------------------------------------------------------
// Mappers ligne SQL (snake_case) -> objet JS (camelCase), au plus proche du
// format déjà consommé par le front-end existant, pour limiter les
// changements côté HTML/JS public.
// ---------------------------------------------------------------------------
export function mapSection(r) {
  return { id: r.id, nom: r.nom, tranche: r.tranche, ageMin: r.age_min, ageMax: r.age_max, couleur: r.couleur, emoji: r.emoji };
}

export function mapUserPublic(r) {
  if (!r) return null;
  return {
    id: r.id, email: r.email, prenom: r.prenom, nom: r.nom, role: r.role, statut: r.statut,
    tel: r.tel, adresse: r.adresse, codePostal: r.code_postal, localite: r.localite,
    contactUrgence: r.contact_urgence, remarques: r.remarques, sectionId: r.section_id,
    totem: r.totem, bio: r.bio, tache: r.tache,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function mapChild(r) {
  return {
    id: r.id, compteId: r.parent_id, prenom: r.prenom, nom: r.nom,
    naissance: r.naissance ? String(r.naissance).slice(0, 10) : null,
    sectionId: r.section_id, allergies: r.allergies, remarquesMedicales: r.remarques_medicales,
    photoAutorisee: r.photo_autorisee, createdAt: r.created_at,
  };
}

export function mapEvent(r) {
  return {
    id: r.id, titre: r.titre, type: r.type,
    date: r.date ? String(r.date).slice(0, 10) : null,
    dateFin: r.date_fin ? String(r.date_fin).slice(0, 10) : null,
    heureDebut: r.heure_debut, heureFin: r.heure_fin, lieu: r.lieu, description: r.description,
    createdBy: r.created_by, sections: r.sections || [],
  };
}

export function mapPresence(r) {
  return {
    id: r.id, enfantId: r.child_id, reunionId: r.event_id, statut: r.statut,
    motifRetard: r.motif_retard, heureArrivee: r.heure_arrivee, updatedAt: r.updated_at,
  };
}

export function mapPayment(r) {
  return {
    id: r.id, enfantId: r.child_id, type: r.type, label: r.label,
    montant: Number(r.montant), paye: r.paye,
    datePaiement: r.date_paiement ? String(r.date_paiement).slice(0, 10) : null,
    description: r.description, dateLimite: r.date_limite ? String(r.date_limite).slice(0, 10) : null,
  };
}

export function mapNotification(r) {
  return { id: r.id, compteId: r.user_id, titre: r.titre, texte: r.texte, lien: r.lien, lue: r.lue, date: r.date, origine: r.origine };
}

export function mapDocTemplate(r) {
  return {
    id: r.id, cle: r.cle, nom: r.nom, instructions: r.instructions,
    obligatoire: r.obligatoire, protege: r.protege, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function mapHistory(r) {
  return { id: r.id, date: r.date, titre: r.titre, texteCourt: r.texte_court, texteLong: r.texte_long };
}

// ---------------------------------------------------------------------------
// Helpers "métier" partagés entre routes
// ---------------------------------------------------------------------------

export async function getSections() {
  const rows = await sql`SELECT * FROM sections ORDER BY age_min`;
  return rows.map(mapSection);
}

export async function getUserById(id) {
  const rows = await sql`SELECT * FROM users WHERE id = ${id}`;
  return rows[0] || null;
}

export async function getUserByToken(token) {
  if (!token) return null;
  const rows = await sql`
    SELECT u.* FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token} AND u.statut = 'valide'`;
  return rows[0] || null;
}

export async function notify(userId, titre, texte, lien = '', origine = 'systeme') {
  await sql`INSERT INTO notifications (id, user_id, titre, texte, lien, lue, origine)
            VALUES (${uid('notif')}, ${userId}, ${titre}, ${texte}, ${lien}, false, ${origine})`;
}

export async function labelForUser(u) {
  if (!u) return '';
  if (u.role === 'admin') return `${u.prenom} ${u.nom} — Administrateur`;
  if (u.role === 'animateur') {
    const secRows = await sql`SELECT nom FROM sections WHERE id = ${u.section_id}`;
    const secNom = secRows[0]?.nom || '';
    return `${u.prenom} ${u.nom} — Animateur ${secNom}`;
  }
  const liens = await sql`
    SELECT c.prenom, pcl.lien FROM parent_child_links pcl
    JOIN children c ON c.id = pcl.child_id
    WHERE pcl.parent_id = ${u.id}
    ORDER BY pcl.id LIMIT 1`;
  if (!liens.length) return `${u.prenom} ${u.nom} — Parent`;
  const noms = await sql`
    SELECT c.prenom FROM parent_child_links pcl
    JOIN children c ON c.id = pcl.child_id
    WHERE pcl.parent_id = ${u.id}`;
  const listeNoms = noms.map((n) => n.prenom).join(', ');
  return `${u.prenom} ${u.nom} — ${liens[0].lien || 'Responsable'} de ${listeNoms}`;
}

export async function childrenVisibleTo(u) {
  if (u.role === 'admin') {
    const rows = await sql`SELECT * FROM children ORDER BY prenom`;
    return rows.map(mapChild);
  }
  if (u.role === 'animateur') {
    const rows = await sql`SELECT * FROM children WHERE section_id = ${u.section_id} ORDER BY prenom`;
    return rows.map(mapChild);
  }
  const rows = await sql`
    SELECT c.* FROM children c
    JOIN parent_child_links pcl ON pcl.child_id = c.id
    WHERE pcl.parent_id = ${u.id}
    ORDER BY c.prenom`;
  return rows.map(mapChild);
}

export async function canSeeChild(u, child) {
  if (!child) return false;
  if (u.role === 'admin') return true;
  if (u.role === 'animateur') return child.section_id === u.section_id;
  const rows = await sql`SELECT 1 FROM parent_child_links WHERE parent_id = ${u.id} AND child_id = ${child.id}`;
  return rows.length > 0;
}

/** Notifie tous les parents ayant un enfant dans une des sections données. */
export async function notifyParentsBySections(sections, titre, texteFn, eventId, origine) {
  if (!sections || !sections.length) return;
  const rows = await sql`
    SELECT DISTINCT c.id, c.prenom, c.parent_id FROM children c
    WHERE c.parent_id IS NOT NULL AND c.section_id = ANY(${sections})`;
  for (const r of rows) {
    await notify(r.parent_id, titre, texteFn(r), `enfant.html?id=${r.id}&event=${eventId}#calendrier`, origine);
  }
}

export async function notifyAnimateursBySections(sections, titre, texte, eventId, origine) {
  if (!sections || !sections.length) return;
  const rows = await sql`SELECT id FROM users WHERE role = 'animateur' AND statut = 'valide' AND section_id = ANY(${sections})`;
  for (const r of rows) {
    await notify(r.id, titre, texte, `animateur.html?event=${eventId}#calendrier`, origine);
  }
}

export function docsDefault(childId) {
  return {
    ficheSante: { childId, updatedAt: null },
    autorisation: { childId, updatedAt: null },
    inscription: { childId, recu: false, updatedAt: null },
  };
}
