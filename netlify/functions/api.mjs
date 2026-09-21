/**
 * =====================================================================
 *  API du Patro Notre-Dame d'Ittre — v3.0 (SQL / Netlify DB)
 * =====================================================================
 *  MIGRATION D'ARCHITECTURE :
 *  - Toutes les données métier (comptes, enfants, présences, paiements,
 *    notifications, questions, tâches, contenu, documents, historique,
 *    sessions) sont désormais stockées dans Netlify DB (Postgres/Neon),
 *    via des tables relationnelles avec clés étrangères explicites.
 *  - Netlify Blobs n'est plus utilisé pour l'état applicatif. Il reste
 *    disponible uniquement pour d'éventuels fichiers bruts (PDF/photos),
 *    via la table `files` (colonne blob_key) — non utilisé pour le
 *    moment car aucune fonctionnalité d'upload n'est encore active.
 *  - La connexion `neon()` (voir lib/db.mjs) est fournie sans argument :
 *    Netlify injecte automatiquement l'URL de connexion appropriée
 *    (production, deploy preview ou branche) — le "database branching"
 *    natif de Netlify DB est donc utilisé nativement, sans code
 *    supplémentaire ici.
 * =====================================================================
 */
import { randomBytes } from 'node:crypto';
import { sql, ensureSchema } from './lib/db.mjs';
import {
  uid, norm, hashPwd, today, TYPES_EVENEMENT, LABEL_TYPE,
  mapSection, mapUserPublic, mapChild, mapEvent, mapPresence, mapPayment,
  mapNotification, mapDocTemplate, mapHistory,
  getSections, getUserById, getUserByToken, notify, labelForUser,
  childrenVisibleTo, canSeeChild, notifyParentsBySections, notifyAnimateursBySections,
} from './lib/helpers.mjs';

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

/** Construit les objets "enfant" enrichis (paiements + documents) au format
 * consommé par le front, en regroupant plusieurs requêtes SQL. */
async function buildChildFull(row) {
  const child = mapChild(row);
  const payments = await sql`SELECT * FROM payments WHERE child_id = ${child.id} ORDER BY created_at`;
  child.paiements = payments.map(mapPayment);

  const [fs] = await sql`SELECT * FROM health_forms WHERE child_id = ${child.id}`;
  const [ap] = await sql`SELECT * FROM parental_authorizations WHERE child_id = ${child.id}`;
  const [insc] = await sql`SELECT * FROM registration_documents WHERE child_id = ${child.id}`;
  const autres = await sql`SELECT * FROM child_custom_documents WHERE child_id = ${child.id}`;

  child.documents = {
    ficheSante: fs ? {
      nomPrenom: fs.nom_prenom, naissance: fs.naissance ? String(fs.naissance).slice(0, 10) : '',
      adresse: fs.adresse, telephoneParent: fs.telephone_parent,
      urgence1Nom: fs.urgence1_nom, urgence1Lien: fs.urgence1_lien, urgence1Tel: fs.urgence1_tel,
      urgence2Nom: fs.urgence2_nom, urgence2Lien: fs.urgence2_lien, urgence2Tel: fs.urgence2_tel,
      problemeSante: fs.probleme_sante, problemeSanteDetail: fs.probleme_sante_detail,
      allergiesSante: fs.allergies_sante, allergiesDetail: fs.allergies_detail,
      regime: fs.regime, regimeDetail: fs.regime_detail,
      medicaments: fs.medicaments, medicamentNom: fs.medicament_nom, medicamentDose: fs.medicament_dose, medicamentMoment: fs.medicament_moment,
      autre: fs.autre, autreDetail: fs.autre_detail,
      medecinNom: fs.medecin_nom, medecinTel: fs.medecin_tel,
      updatedAt: fs.updated_at,
    } : null,
    autorisation: ap ? {
      photo: ap.photo, secours: ap.secours, mesuresUrgence: ap.mesures_urgence,
      infosExactes: ap.infos_exactes, voiture: ap.voiture, updatedAt: ap.updated_at,
    } : null,
    inscription: { recu: insc ? insc.recu : false, updatedAt: insc ? insc.updated_at : null },
    autres: autres.map((a) => ({ id: a.id, docTemplateId: a.doc_template_id, statut: a.statut, updatedAt: a.updated_at })),
  };
  return child;
}

function statutDocumentFor(child, tpl) {
  const docs = child.documents || {};
  if (tpl.cle === 'ficheSante') return docs.ficheSante && docs.ficheSante.updatedAt ? 'fourni' : 'manquant';
  if (tpl.cle === 'autorisation') return docs.autorisation && docs.autorisation.updatedAt ? 'fourni' : 'manquant';
  if (tpl.cle === 'inscription') return docs.inscription && docs.inscription.recu ? 'fourni' : 'manquant';
  const entree = (docs.autres || []).find((a) => a.docTemplateId === tpl.id);
  return entree ? entree.statut || 'manquant' : 'manquant';
}

async function enrichDocumentsForChild(child) {
  const templates = await sql`SELECT * FROM document_templates ORDER BY created_at`;
  return templates.map(mapDocTemplate).map((tpl) => ({
    templateId: tpl.id, cle: tpl.cle, nom: tpl.nom, instructions: tpl.instructions, obligatoire: tpl.obligatoire,
    statut: statutDocumentFor(child, tpl),
  }));
}

function paiementDefaultRows(childId) {
  return [
    { id: uid('pay'), type: 'cotisation', label: "Cotisation annuelle (goûters inclus)", montant: 50 },
    { id: uid('pay'), type: 'camp', label: "Camp d'été", montant: 150 },
  ].map((p) => ({ ...p, childId }));
}

export default async (request, context) => {
  if (request.method === 'OPTIONS') return json({ ok: true });
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\//, '').replace(/\/$/, '');
  let body = {};
  if (request.method === 'POST') { try { body = await request.json(); } catch { body = {}; } }

  try {
    await ensureSchema();

    const token = request.headers.get('x-auth-token');
    const compteRow = await getUserByToken(token);
    const compte = compteRow || null; // ligne SQL brute (snake_case) tant que non "public-ifiée"
    const need = (...roles) => compte && roles.includes(compte.role);

    // -------------------------------------------------------------------
    // Routes publiques
    // -------------------------------------------------------------------
    if (route === 'system/status' && request.method === 'GET') {
      const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM users`;
      return json({ nbComptes: count, initialise: count > 0 });
    }

    if (route === 'sections' && request.method === 'GET') return json({ sections: await getSections() });

    if (route === 'contenu' && request.method === 'GET') {
      const rows = await sql`SELECT * FROM site_content`;
      const contenu = {};
      rows.forEach((r) => { contenu[r.key] = r.value; });
      const hist = await sql`SELECT * FROM history_events ORDER BY date`;
      contenu.histoire = hist.map(mapHistory);
      return json({ contenu });
    }

    if (route === 'animateurs-public' && request.method === 'GET') {
      const rows = await sql`SELECT id, prenom, nom, totem, bio, section_id FROM users WHERE role = 'animateur' AND statut = 'valide'`;
      const animateurs = rows.map((r) => ({ id: r.id, prenom: r.prenom, nom: r.nom, totem: r.totem, bio: r.bio, sectionId: r.section_id }));
      return json({ animateurs, sections: await getSections() });
    }

    if (route === 'auth/inscription' && request.method === 'POST') {
      const { prenom, nom, email, password, tel, adresse, codePostal, localite, contactUrgence, role, enfants: enfantsForm } = body;
      const roleFinal = role === 'animateur' ? 'animateur' : 'parent';
      if (!prenom || !nom || !email || !password) return err('Prénom, nom, e-mail et mot de passe sont obligatoires.');
      const existing = await sql`SELECT 1 FROM users WHERE email = ${norm(email)}`;
      if (existing.length) return err('Un compte existe déjà avec cet e-mail.');

      if (roleFinal === 'parent' && (!Array.isArray(enfantsForm) || !enfantsForm.length)) {
        return err("Ajoutez au moins un enfant à la demande d'inscription.");
      }

      const salt = randomBytes(8).toString('hex');
      const passwordHash = hashPwd(password, salt);
      const userId = uid('cpt');
      await sql`INSERT INTO users (id, email, salt, password_hash, prenom, nom, role, statut, tel, adresse, code_postal, localite, contact_urgence)
                VALUES (${userId}, ${norm(email)}, ${salt}, ${passwordHash}, ${prenom}, ${nom}, ${roleFinal}, 'attente',
                        ${tel || ''}, ${adresse || ''}, ${codePostal || '1460'}, ${localite || 'Ittre'}, ${contactUrgence || ''})`;

      if (roleFinal === 'parent') {
        for (const ef of enfantsForm) {
          const childId = uid('enf');
          await sql`INSERT INTO children (id, parent_id, prenom, nom, naissance, section_id, allergies, remarques_medicales, photo_autorisee)
                    VALUES (${childId}, NULL, ${ef.prenom}, ${ef.nom || nom}, ${ef.naissance || null}, ${ef.sectionId || null},
                            ${ef.allergies || ''}, ${ef.remarquesMedicales || ''}, ${!!ef.photoAutorisee})`;
          // Lien parent<->enfant créé APRES validation admin (voir admin/inscriptions/valider) ;
          // on stocke temporairement le futur parent via une table de correspondance légère :
          await sql`INSERT INTO parent_child_links (id, parent_id, child_id, lien)
                    VALUES (${uid('pcl')}, ${userId}, ${childId}, ${ef.lien || 'Responsable'})`;
          await paiementSeed(childId);
        }
      }

      const admins = await sql`SELECT id FROM users WHERE role = 'admin'`;
      for (const a of admins) {
        await notify(a.id, "Nouvelle demande d'inscription",
          `${prenom} ${nom} a demandé la création d'un compte ${roleFinal === 'animateur' ? 'animateur' : 'parent'}.`,
          'admin.html#inscriptions', 'systeme');
      }
      return json({ ok: true, message: "Votre demande a été envoyée. Vous recevrez un accès dès validation par l'administrateur." });
    }

    if (route === 'auth/login' && request.method === 'POST') {
      const { email, password } = body;
      const rows = await sql`SELECT * FROM users WHERE email = ${norm(email)}`;
      const c = rows[0];
      if (!c || c.password_hash !== hashPwd(password, c.salt)) return err('E-mail ou mot de passe incorrect.', 401);
      if (c.statut === 'attente') return err("Votre inscription est en attente de validation par l'administrateur.", 403);
      if (c.statut === 'refuse') return err("Votre demande d'inscription a été refusée. Contactez pndi@patro.be.", 403);
      const tok = randomBytes(24).toString('hex');
      await sql`INSERT INTO sessions (token, user_id) VALUES (${tok}, ${c.id})`;
      return json({ token: tok, compte: mapUserPublic(c), label: await labelForUser(c) });
    }
    if (route === 'auth/logout' && request.method === 'POST') {
      if (token) await sql`DELETE FROM sessions WHERE token = ${token}`;
      return json({ ok: true });
    }
    if (route === 'auth/me' && request.method === 'GET') {
      if (!compte) return err('Non authentifié.', 401);
      const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = ${compte.id} AND lue = false`;
      return json({ compte: mapUserPublic(compte), label: await labelForUser(compte), nbNotificationsNonLues: count });
    }

    /* -----------------------------------------------------------------
       Procédure de récupération d'accès administrateur ("break glass").
       Route PUBLIQUE (pas besoin d'être connecté) mais protégée par une
       clé secrète (ADMIN_RECOVERY_KEY, variable d'environnement Netlify ;
       valeur par défaut si non définie — à changer en production).
       Ne fonctionne que s'il n'existe plus aucun admin valide en base.
       ----------------------------------------------------------------- */
    if (route === 'auth/recuperer-admin' && request.method === 'POST') {
      const cleAttendue = (globalThis.process && globalThis.process.env && globalThis.process.env.ADMIN_RECOVERY_KEY) || 'PATRO-RECUP-2024';
      const { action, email, cleSecrete, prenom, nom, password } = body;
      if (cleSecrete !== cleAttendue) return err('Clé de récupération incorrecte.', 403);
      const [{ count: nbAdmins }] = await sql`SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND statut = 'valide'`;
      if (nbAdmins > 0) {
        return err("Un compte administrateur valide existe déjà : la procédure de récupération est désactivée par sécurité. Connectez-vous avec ce compte administrateur existant.", 403);
      }
      if (action === 'promouvoir') {
        if (!email) return err('E-mail requis.');
        const rows = await sql`SELECT * FROM users WHERE email = ${norm(email)}`;
        if (!rows.length) return err(`Aucun compte trouvé avec l'e-mail ${email}.`, 404);
        await sql`UPDATE users SET role = 'admin', statut = 'valide', updated_at = now() WHERE id = ${rows[0].id}`;
        return json({ ok: true, message: `Le compte ${rows[0].email} a bien été rétabli comme administrateur. Vous pouvez maintenant vous reconnecter.` });
      }
      if (action === 'creer') {
        if (!email || !password || !prenom || !nom) return err('Prénom, nom, e-mail et mot de passe sont obligatoires.');
        const existing = await sql`SELECT 1 FROM users WHERE email = ${norm(email)}`;
        if (existing.length) return err('Un compte existe déjà avec cet e-mail. Utilisez plutôt « Redonner les droits admin ».');
        const salt = randomBytes(8).toString('hex');
        const passwordHash = hashPwd(password, salt);
        await sql`INSERT INTO users (id, email, salt, password_hash, prenom, nom, role, statut)
                  VALUES (${uid('cpt')}, ${norm(email)}, ${salt}, ${passwordHash}, ${prenom}, ${nom}, 'admin', 'valide')`;
        return json({ ok: true, message: `Un nouveau compte administrateur (${norm(email)}) a été créé. Vous pouvez maintenant vous connecter.` });
      }
      return err("Action invalide : utilisez 'promouvoir' ou 'creer'.");
    }

    if (!compte) return err('Vous devez être connecté.', 401);

    if (route === 'compte/coordonnees' && request.method === 'POST') {
      const fields = { prenom: 'prenom', nom: 'nom', tel: 'tel', adresse: 'adresse', codePostal: 'code_postal', localite: 'localite', contactUrgence: 'contact_urgence', remarques: 'remarques' };
      const sets = [];
      const vals = {};
      for (const [jsKey, col] of Object.entries(fields)) {
        if (body[jsKey] !== undefined) { sets.push(col); vals[col] = body[jsKey]; }
      }
      if (sets.length) {
        await sql`UPDATE users SET
          prenom = COALESCE(${vals.prenom ?? null}, prenom),
          nom = COALESCE(${vals.nom ?? null}, nom),
          tel = COALESCE(${vals.tel ?? null}, tel),
          adresse = COALESCE(${vals.adresse ?? null}, adresse),
          code_postal = COALESCE(${vals.code_postal ?? null}, code_postal),
          localite = COALESCE(${vals.localite ?? null}, localite),
          contact_urgence = COALESCE(${vals.contact_urgence ?? null}, contact_urgence),
          remarques = COALESCE(${vals.remarques ?? null}, remarques),
          updated_at = now()
          WHERE id = ${compte.id}`;
      }
      const [fresh] = await sql`SELECT * FROM users WHERE id = ${compte.id}`;
      return json({ compte: mapUserPublic(fresh), label: await labelForUser(fresh) });
    }

    if (route === 'documents/requis' && request.method === 'GET') {
      const rows = await sql`SELECT * FROM document_templates ORDER BY created_at`;
      return json({ documentsRequis: rows.map(mapDocTemplate) });
    }

    if (route === 'enfants/mes' && request.method === 'GET') {
      const enfants = await childrenVisibleTo(compte);
      const withPayments = [];
      for (const e of enfants) {
        const rows = await sql`SELECT * FROM payments WHERE child_id = ${e.id} ORDER BY created_at`;
        withPayments.push({ ...e, paiements: rows.map(mapPayment) });
      }
      return json({ enfants: withPayments, sections: await getSections() });
    }

    if (route === 'enfants/detail' && request.method === 'GET') {
      const id = url.searchParams.get('id');
      const [row] = await sql`SELECT * FROM children WHERE id = ${id}`;
      if (!row) return err('Enfant introuvable.', 404);
      if (!(await canSeeChild(compte, row))) return err("Accès refusé : cet enfant n'est pas associé à votre compte.", 403);
      const child = await buildChildFull(row);
      const [section] = row.section_id ? await sql`SELECT * FROM sections WHERE id = ${row.section_id}` : [null];
      const chefsRows = await sql`SELECT id, prenom, nom, tel, totem FROM users WHERE role = 'animateur' AND statut = 'valide' AND section_id = ${row.section_id}`;
      const presRows = await sql`SELECT * FROM presences WHERE child_id = ${id}`;
      return json({
        enfant: child, section: section ? mapSection(section) : null,
        chefs: chefsRows, presences: presRows.map(mapPresence),
        documents: await enrichDocumentsForChild(child),
      });
    }

    if (route === 'enfants' && request.method === 'POST' && compte.role === 'parent') {
      const ef = body.enfant || {};
      const childId = uid('enf');
      await sql`INSERT INTO children (id, parent_id, prenom, nom, naissance, section_id, allergies, remarques_medicales, photo_autorisee)
                VALUES (${childId}, ${compte.id}, ${ef.prenom}, ${ef.nom || compte.nom}, ${ef.naissance || null}, ${ef.sectionId || null},
                        ${ef.allergies || ''}, ${ef.remarquesMedicales || ''}, ${!!ef.photoAutorisee})`;
      await sql`INSERT INTO parent_child_links (id, parent_id, child_id, lien) VALUES (${uid('pcl')}, ${compte.id}, ${childId}, ${ef.lien || 'Responsable'})`;
      await paiementSeed(childId);
      const [row] = await sql`SELECT * FROM children WHERE id = ${childId}`;
      return json(mapChild(row));
    }

    if (route === 'enfants/document' && request.method === 'POST') {
      const { enfantId, type, champs } = body;
      const [child] = await sql`SELECT * FROM children WHERE id = ${enfantId}`;
      if (!child) return err('Enfant introuvable.', 404);
      if (!(compte.role === 'admin' || child.parent_id === compte.id)) return err('Accès refusé.', 403);

      if (type === 'ficheSante') {
        const c = champs;
        await sql`INSERT INTO health_forms (child_id, nom_prenom, naissance, adresse, telephone_parent,
                    urgence1_nom, urgence1_lien, urgence1_tel, urgence2_nom, urgence2_lien, urgence2_tel,
                    probleme_sante, probleme_sante_detail, allergies_sante, allergies_detail,
                    regime, regime_detail, medicaments, medicament_nom, medicament_dose, medicament_moment,
                    autre, autre_detail, medecin_nom, medecin_tel, updated_at)
                  VALUES (${enfantId}, ${c.nomPrenom||''}, ${c.naissance||null}, ${c.adresse||''}, ${c.telephoneParent||''},
                    ${c.urgence1Nom||''}, ${c.urgence1Lien||''}, ${c.urgence1Tel||''}, ${c.urgence2Nom||''}, ${c.urgence2Lien||''}, ${c.urgence2Tel||''},
                    ${c.problemeSante||'non'}, ${c.problemeSanteDetail||''}, ${c.allergiesSante||'non'}, ${c.allergiesDetail||''},
                    ${c.regime||'non'}, ${c.regimeDetail||''}, ${c.medicaments||'non'}, ${c.medicamentNom||''}, ${c.medicamentDose||''}, ${c.medicamentMoment||''},
                    ${c.autre||'non'}, ${c.autreDetail||''}, ${c.medecinNom||''}, ${c.medecinTel||''}, now())
                  ON CONFLICT (child_id) DO UPDATE SET
                    nom_prenom=EXCLUDED.nom_prenom, naissance=EXCLUDED.naissance, adresse=EXCLUDED.adresse, telephone_parent=EXCLUDED.telephone_parent,
                    urgence1_nom=EXCLUDED.urgence1_nom, urgence1_lien=EXCLUDED.urgence1_lien, urgence1_tel=EXCLUDED.urgence1_tel,
                    urgence2_nom=EXCLUDED.urgence2_nom, urgence2_lien=EXCLUDED.urgence2_lien, urgence2_tel=EXCLUDED.urgence2_tel,
                    probleme_sante=EXCLUDED.probleme_sante, probleme_sante_detail=EXCLUDED.probleme_sante_detail,
                    allergies_sante=EXCLUDED.allergies_sante, allergies_detail=EXCLUDED.allergies_detail,
                    regime=EXCLUDED.regime, regime_detail=EXCLUDED.regime_detail,
                    medicaments=EXCLUDED.medicaments, medicament_nom=EXCLUDED.medicament_nom, medicament_dose=EXCLUDED.medicament_dose, medicament_moment=EXCLUDED.medicament_moment,
                    autre=EXCLUDED.autre, autre_detail=EXCLUDED.autre_detail, medecin_nom=EXCLUDED.medecin_nom, medecin_tel=EXCLUDED.medecin_tel, updated_at=now()`;
      } else if (type === 'autorisation') {
        const c = champs;
        await sql`INSERT INTO parental_authorizations (child_id, photo, secours, mesures_urgence, infos_exactes, voiture, updated_at)
                  VALUES (${enfantId}, ${!!c.photo}, ${!!c.secours}, ${!!c.mesuresUrgence}, ${!!c.infosExactes}, ${!!c.voiture}, now())
                  ON CONFLICT (child_id) DO UPDATE SET photo=EXCLUDED.photo, secours=EXCLUDED.secours,
                    mesures_urgence=EXCLUDED.mesures_urgence, infos_exactes=EXCLUDED.infos_exactes, voiture=EXCLUDED.voiture, updated_at=now()`;
      } else if (type === 'inscription') {
        await sql`INSERT INTO registration_documents (child_id, recu, updated_at) VALUES (${enfantId}, ${!!champs.recu}, now())
                  ON CONFLICT (child_id) DO UPDATE SET recu = EXCLUDED.recu, updated_at = now()`;
      } else if (type === 'autre') {
        let statutFinal = champs.statut || 'fourni';
        if (compte.role !== 'admin' && statutFinal === 'a_verifier') statutFinal = 'fourni';
        await sql`INSERT INTO child_custom_documents (id, child_id, doc_template_id, statut, updated_at)
                  VALUES (${uid('doc')}, ${enfantId}, ${champs.docTemplateId}, ${statutFinal}, now())
                  ON CONFLICT (child_id, doc_template_id) DO UPDATE SET statut = EXCLUDED.statut, updated_at = now()`;
      }
      const [row] = await sql`SELECT * FROM children WHERE id = ${enfantId}`;
      const full = await buildChildFull(row);
      return json(full.documents);
    }

    if (route === 'reunions' && request.method === 'GET') {
      const sid = url.searchParams.get('sectionId');
      let rows;
      if (sid) {
        rows = await sql`
          SELECT e.*, COALESCE(array_agg(es.section_id) FILTER (WHERE es.section_id IS NOT NULL), '{}') AS sections
          FROM events e
          LEFT JOIN event_sections es ON es.event_id = e.id
          WHERE e.id IN (
            SELECT event_id FROM event_sections WHERE section_id = ${sid}
            UNION
            SELECT id FROM events WHERE id NOT IN (SELECT event_id FROM event_sections)
          )
          GROUP BY e.id ORDER BY e.date`;
      } else {
        rows = await sql`
          SELECT e.*, COALESCE(array_agg(es.section_id) FILTER (WHERE es.section_id IS NOT NULL), '{}') AS sections
          FROM events e LEFT JOIN event_sections es ON es.event_id = e.id
          GROUP BY e.id ORDER BY e.date`;
      }
      return json({ reunions: rows.map(mapEvent) });
    }

    if (route === 'reunions' && request.method === 'POST') {
      if (!need('admin', 'animateur')) return err('Accès refusé.', 403);
      const r = body.reunion || {};
      const sections = compte.role === 'animateur' ? [compte.section_id] : (r.sections || []);
      const type = TYPES_EVENEMENT.includes(r.type) ? r.type : 'reunion';
      const isEdit = !!r.id;
      const eventId = r.id || uid('reu');

      await sql`INSERT INTO events (id, titre, type, date, date_fin, heure_debut, heure_fin, lieu, description, created_by)
                VALUES (${eventId}, ${r.titre}, ${type}, ${r.date}, ${r.dateFin || null}, ${r.heureDebut || ''}, ${r.heureFin || ''}, ${r.lieu || ''}, ${r.description || ''}, ${compte.id})
                ON CONFLICT (id) DO UPDATE SET titre=EXCLUDED.titre, type=EXCLUDED.type, date=EXCLUDED.date,
                  date_fin=EXCLUDED.date_fin, heure_debut=EXCLUDED.heure_debut, heure_fin=EXCLUDED.heure_fin,
                  lieu=EXCLUDED.lieu, description=EXCLUDED.description`;
      await sql`DELETE FROM event_sections WHERE event_id = ${eventId}`;
      for (const s of sections) { await sql`INSERT INTO event_sections (event_id, section_id) VALUES (${eventId}, ${s})`; }

      const sectionsCibles = sections.length ? sections : (await getSections()).map((s) => s.id);
      await notifyParentsBySections(sectionsCibles,
        isEdit ? 'Événement modifié' : 'Nouvelle date au calendrier',
        (row) => `« ${r.titre} » ${isEdit ? 'a été modifié' : 'a été ajouté(e)'} le ${r.date}.`, eventId, 'animateur');

      const [row] = await sql`SELECT e.*, ${sections} AS sections FROM events e WHERE e.id = ${eventId}`;
      return json(mapEvent(row));
    }

    if (route === 'reunions/delete' && request.method === 'POST') {
      if (!need('admin', 'animateur')) return err('Accès refusé.', 403);
      if (compte.role === 'animateur') {
        const secRows = await sql`SELECT section_id FROM event_sections WHERE event_id = ${body.id}`;
        if (secRows.length && !secRows.some((s) => s.section_id === compte.section_id)) return err('Accès refusé.', 403);
      }
      await sql`DELETE FROM events WHERE id = ${body.id}`;
      return json({ ok: true });
    }

    if (route === 'presences' && request.method === 'GET') {
      const { enfantId, reunionId, sectionId } = Object.fromEntries(url.searchParams);
      let rows;
      if (enfantId) rows = await sql`SELECT * FROM presences WHERE child_id = ${enfantId}`;
      else if (reunionId && sectionId) {
        rows = await sql`SELECT p.* FROM presences p JOIN children c ON c.id = p.child_id WHERE p.event_id = ${reunionId} AND c.section_id = ${sectionId}`;
      } else if (reunionId) rows = await sql`SELECT * FROM presences WHERE event_id = ${reunionId}`;
      else if (sectionId) rows = await sql`SELECT p.* FROM presences p JOIN children c ON c.id = p.child_id WHERE c.section_id = ${sectionId}`;
      else rows = await sql`SELECT * FROM presences`;
      return json({ presences: rows.map(mapPresence) });
    }

    if (route === 'presences' && request.method === 'POST') {
      const { enfantId, reunionId, statut = 'present', motifRetard = '', heureArrivee = '' } = body;
      const [child] = await sql`SELECT * FROM children WHERE id = ${enfantId}`;
      if (!child) return err('Enfant introuvable.', 404);
      if (!(compte.role === 'admin' || child.parent_id === compte.id)) return err("Accès refusé : cet enfant n'est pas associé à votre compte.", 403);
      const [ev] = await sql`SELECT * FROM events WHERE id = ${reunionId}`;
      if (ev && String(ev.date).slice(0, 10) < today() && compte.role !== 'admin') {
        return err("Impossible de modifier la présence d'une réunion passée.", 403);
      }
      await sql`INSERT INTO presences (id, child_id, event_id, statut, motif_retard, heure_arrivee, updated_at)
                VALUES (${uid('pres')}, ${enfantId}, ${reunionId}, ${statut}, ${motifRetard}, ${heureArrivee}, now())
                ON CONFLICT (child_id, event_id) DO UPDATE SET statut=EXCLUDED.statut, motif_retard=EXCLUDED.motif_retard,
                  heure_arrivee=EXCLUDED.heure_arrivee, updated_at=now()`;
      const [row] = await sql`SELECT * FROM presences WHERE child_id = ${enfantId} AND event_id = ${reunionId}`;
      return json(mapPresence(row));
    }

    if (route === 'presences/agregat' && request.method === 'GET') {
      if (!need('admin', 'animateur')) return err('Accès refusé.', 403);
      const sectionId = url.searchParams.get('sectionId') || compte.section_id;
      const [{ count: totalEnfants }] = await sql`SELECT COUNT(*)::int AS count FROM children WHERE section_id = ${sectionId}`;
      const events = await sql`
        SELECT e.* FROM events e
        WHERE e.id IN (
          SELECT event_id FROM event_sections WHERE section_id = ${sectionId}
          UNION SELECT id FROM events WHERE id NOT IN (SELECT event_id FROM event_sections)
        ) ORDER BY e.date`;
      const agregat = [];
      for (const ev of events) {
        const pres = await sql`SELECT p.statut FROM presences p JOIN children c ON c.id = p.child_id WHERE p.event_id = ${ev.id} AND c.section_id = ${sectionId}`;
        const present = pres.filter((p) => p.statut === 'present').length;
        const absent = pres.filter((p) => p.statut === 'absent').length;
        const retard = pres.filter((p) => p.statut === 'retard').length;
        agregat.push({ reunion: mapEvent(ev), present, absent, retard, sansReponse: totalEnfants - pres.length, totalEnfants });
      }
      return json({ agregat });
    }

    if (route === 'presences/manquants' && request.method === 'GET') {
      if (!need('admin')) return err('Accès refusé.', 403);
      const reunionId = url.searchParams.get('reunionId');
      const [ev] = await sql`SELECT * FROM events WHERE id = ${reunionId}`;
      if (!ev) return err('Réunion introuvable.', 404);
      const secRows = await sql`SELECT section_id FROM event_sections WHERE event_id = ${reunionId}`;
      const sections = secRows.map((s) => s.section_id);
      const enfants = sections.length
        ? await sql`SELECT * FROM children WHERE section_id = ANY(${sections})`
        : await sql`SELECT * FROM children`;
      const presRows = await sql`SELECT child_id FROM presences WHERE event_id = ${reunionId}`;
      const presentIds = new Set(presRows.map((p) => p.child_id));
      const manquants = [];
      for (const e of enfants) {
        if (presentIds.has(e.id)) continue;
        const parentRow = e.parent_id ? await getUserById(e.parent_id) : null;
        manquants.push({ enfant: mapChild(e), parent: parentRow ? mapUserPublic(parentRow) : null });
      }
      return json({ manquants, reunion: mapEvent(ev) });
    }

    if (route === 'questions' && request.method === 'POST') {
      if (compte.role !== 'parent') return err('Seuls les parents peuvent poser une question.', 403);
      const { enfantId, categorie, texte } = body;
      if (!texte || !categorie) return err('Catégorie et texte requis.');
      let sectionId = null;
      if (categorie === 'section') {
        if (!enfantId) return err('Merci de sélectionner un enfant pour une question de section.');
        const [child] = await sql`SELECT * FROM children WHERE id = ${enfantId}`;
        if (!child || !(await canSeeChild(compte, child))) return err('Enfant introuvable ou non associé à votre compte.', 403);
        sectionId = child.section_id;
        if (!sectionId) return err("La section de cet enfant n'est pas encore définie. Contactez l'administrateur.");
      }
      const qId = uid('q');
      await sql`INSERT INTO questions (id, user_id, child_id, categorie, section_id, texte, statut)
                VALUES (${qId}, ${compte.id}, ${enfantId || null}, ${categorie}, ${sectionId}, ${texte}, 'ouverte')`;
      if (categorie === 'section') {
        const dest = await sql`SELECT id FROM users WHERE role = 'animateur' AND statut = 'valide' AND section_id = ${sectionId}`;
        if (dest.length) {
          for (const d of dest) await notify(d.id, 'Nouvelle question', `${compte.prenom} ${compte.nom} a posé une question concernant sa section.`, 'animateur.html#notifications', 'parent');
        } else {
          const admins = await sql`SELECT id FROM users WHERE role = 'admin'`;
          for (const a of admins) await notify(a.id, 'Nouvelle question (section sans animateur)', `${compte.prenom} ${compte.nom} a posé une question de section, mais aucun animateur n'y est encore assigné.`, 'admin.html#animateurs', 'parent');
        }
      } else {
        const admins = await sql`SELECT id FROM users WHERE role = 'admin'`;
        for (const a of admins) await notify(a.id, 'Nouvelle question', `${compte.prenom} ${compte.nom} a posé une question générale.`, 'admin.html#questions', 'parent');
      }
      const [row] = await sql`SELECT * FROM questions WHERE id = ${qId}`;
      return json({ id: row.id, compteId: row.user_id, enfantId: row.child_id, categorie: row.categorie, sectionId: row.section_id, texte: row.texte, date: row.date, statut: row.statut, reponses: [] });
    }

    async function enrichQuestions(rows) {
      const out = [];
      for (const q of rows) {
        const auteur = await getUserById(q.user_id);
        const enfantRow = q.child_id ? (await sql`SELECT prenom, nom FROM children WHERE id = ${q.child_id}`)[0] : null;
        const reponses = await sql`SELECT * FROM question_responses WHERE question_id = ${q.id} ORDER BY date`;
        out.push({
          id: q.id, compteId: q.user_id, enfantId: q.child_id, categorie: q.categorie, sectionId: q.section_id,
          texte: q.texte, date: q.date, statut: q.statut,
          auteurNom: auteur ? `${auteur.prenom} ${auteur.nom}` : '—',
          enfantNom: enfantRow ? `${enfantRow.prenom} ${enfantRow.nom}` : null,
          reponses: reponses.map((r) => ({ compteId: r.user_id, role: r.role, texte: r.texte, date: r.date })),
        });
      }
      return out;
    }

    if (route === 'questions/mes' && request.method === 'GET') {
      if (compte.role !== 'parent') return err('Accès refusé.', 403);
      const rows = await sql`SELECT * FROM questions WHERE user_id = ${compte.id} ORDER BY date DESC`;
      return json({ questions: await enrichQuestions(rows) });
    }
    if (route === 'questions/section' && request.method === 'GET') {
      if (!need('admin', 'animateur')) return err('Accès refusé.', 403);
      const sid = compte.role === 'animateur' ? compte.section_id : url.searchParams.get('sectionId');
      const rows = await sql`SELECT * FROM questions WHERE categorie = 'section' AND section_id = ${sid} ORDER BY date DESC`;
      return json({ questions: await enrichQuestions(rows) });
    }
    if (route === 'questions/patro' && request.method === 'GET') {
      if (!need('admin')) return err('Accès refusé.', 403);
      const rows = await sql`SELECT * FROM questions WHERE categorie = 'patro' ORDER BY date DESC`;
      return json({ questions: await enrichQuestions(rows) });
    }
    if (route === 'questions/repondre' && request.method === 'POST') {
      if (!need('admin', 'animateur')) return err('Accès refusé.', 403);
      const [q] = await sql`SELECT * FROM questions WHERE id = ${body.questionId}`;
      if (!q) return err('Question introuvable.', 404);
      if (compte.role === 'animateur' && q.section_id !== compte.section_id) return err('Accès refusé.', 403);
      await sql`INSERT INTO question_responses (id, question_id, user_id, role, texte) VALUES (${uid('resp')}, ${q.id}, ${compte.id}, ${compte.role}, ${body.texte})`;
      await sql`UPDATE questions SET statut = 'repondue' WHERE id = ${q.id}`;
      const lienReponse = q.child_id ? `enfant.html?id=${q.child_id}#questions` : 'mes-enfants.html';
      await notify(q.user_id, 'Réponse à votre question', body.texte.slice(0, 140), lienReponse, compte.role);
      const [rows] = await enrichQuestions([{ ...q, statut: 'repondue' }]);
      return json(rows);
    }

    if (route === 'notifications/mes' && request.method === 'GET') {
      const rows = await sql`SELECT * FROM notifications WHERE user_id = ${compte.id} ORDER BY date DESC`;
      return json({ notifications: rows.map(mapNotification), nonLues: rows.filter((n) => !n.lue).length });
    }
    if (route === 'notifications/lire' && request.method === 'POST') {
      if (body.all) await sql`UPDATE notifications SET lue = true WHERE user_id = ${compte.id}`;
      else await sql`UPDATE notifications SET lue = true WHERE id = ${body.id} AND user_id = ${compte.id}`;
      return json({ ok: true });
    }

    if (route.startsWith('admin/') && !need('admin')) return err("Accès réservé à l'administrateur.", 403);

    if (route === 'admin/comptes/creer' && request.method === 'POST') {
      const { role, prenom, nom, email, password, tel, sectionId, totem, bio, tache,
              adresse, codePostal, localite, contactUrgence, enfants: enfantsForm } = body;
      if (!prenom || !nom || !email || !password) return err('Prénom, nom, e-mail et mot de passe sont obligatoires.');
      if (!['parent', 'animateur', 'admin'].includes(role)) return err('Rôle invalide.');
      const existing = await sql`SELECT 1 FROM users WHERE email = ${norm(email)}`;
      if (existing.length) return err('Un compte existe déjà avec cet e-mail.');
      const salt = randomBytes(8).toString('hex');
      const passwordHash = hashPwd(password, salt);
      const userId = uid('cpt');
      await sql`INSERT INTO users (id, email, salt, password_hash, prenom, nom, role, statut, tel, adresse, code_postal, localite, contact_urgence, section_id, totem, bio, tache)
                VALUES (${userId}, ${norm(email)}, ${salt}, ${passwordHash}, ${prenom}, ${nom}, ${role}, 'valide',
                        ${tel || ''}, ${adresse || ''}, ${codePostal || '1460'}, ${localite || 'Ittre'}, ${contactUrgence || ''},
                        ${role === 'animateur' ? (sectionId || null) : null}, ${totem || ''}, ${bio || ''}, ${tache || ''})`;
      if (role === 'parent' && Array.isArray(enfantsForm)) {
        for (const ef of enfantsForm.filter((e) => e && e.prenom)) {
          const childId = uid('enf');
          await sql`INSERT INTO children (id, parent_id, prenom, nom, naissance, section_id, allergies, remarques_medicales, photo_autorisee)
                    VALUES (${childId}, ${userId}, ${ef.prenom}, ${ef.nom || nom}, ${ef.naissance || null}, ${ef.sectionId || null}, ${ef.allergies || ''}, ${ef.remarquesMedicales || ''}, ${!!ef.photoAutorisee})`;
          await sql`INSERT INTO parent_child_links (id, parent_id, child_id, lien) VALUES (${uid('pcl')}, ${userId}, ${childId}, ${ef.lien || 'Responsable'})`;
          await paiementSeed(childId);
        }
      }
      const [row] = await sql`SELECT * FROM users WHERE id = ${userId}`;
      return json(mapUserPublic(row));
    }

    if (route === 'admin/inscriptions' && request.method === 'GET') {
      const rows = await sql`SELECT * FROM users WHERE statut = 'attente'`;
      const out = [];
      for (const c of rows) {
        const pub = mapUserPublic(c);
        if (c.role === 'parent') {
          const kids = await sql`
            SELECT ch.* FROM children ch JOIN parent_child_links pcl ON pcl.child_id = ch.id
            WHERE pcl.parent_id = ${c.id}`;
          pub.enfantsEnAttente = kids.map(mapChild);
        }
        out.push(pub);
      }
      return json({ inscriptions: out });
    }
    if (route === 'admin/inscriptions/valider' && request.method === 'POST') {
      const [c] = await sql`SELECT * FROM users WHERE id = ${body.compteId}`;
      if (!c) return err('Compte introuvable.', 404);
      await sql`UPDATE users SET statut = 'valide' WHERE id = ${c.id}`;
      await notify(c.id, 'Compte validé', 'Votre inscription a été validée. Vous pouvez maintenant vous connecter.', 'connexion.html', 'admin');
      const [fresh] = await sql`SELECT * FROM users WHERE id = ${c.id}`;
      return json(mapUserPublic(fresh));
    }
    if (route === 'admin/inscriptions/refuser' && request.method === 'POST') {
      const [c] = await sql`SELECT * FROM users WHERE id = ${body.compteId}`;
      if (!c) return err('Compte introuvable.', 404);
      await sql`UPDATE users SET statut = 'refuse' WHERE id = ${c.id}`;
      const [fresh] = await sql`SELECT * FROM users WHERE id = ${c.id}`;
      return json(mapUserPublic(fresh));
    }
    if (route === 'admin/comptes' && request.method === 'GET') {
      const rows = await sql`SELECT * FROM users ORDER BY created_at`;
      return json({ comptes: rows.map(mapUserPublic) });
    }
    if (route === 'admin/comptes/role' && request.method === 'POST') {
      const [c] = await sql`SELECT * FROM users WHERE id = ${body.compteId}`;
      if (!c) return err('Compte introuvable.', 404);
      if (c.role === 'admin' && body.role && body.role !== 'admin') {
        const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND statut = 'valide'`;
        if (count <= 1) return err("Impossible de retirer le rôle administrateur : c'est le dernier compte administrateur actif. Créez d'abord un autre compte administrateur avant de modifier celui-ci.", 400);
      }
      await sql`UPDATE users SET
        role = COALESCE(${body.role ?? null}, role),
        section_id = ${body.sectionId !== undefined ? body.sectionId : c.section_id},
        totem = COALESCE(${body.totem ?? null}, totem),
        bio = COALESCE(${body.bio ?? null}, bio),
        tache = COALESCE(${body.tache ?? null}, tache),
        tel = COALESCE(${body.tel ?? null}, tel),
        updated_at = now()
        WHERE id = ${c.id}`;
      const [fresh] = await sql`SELECT * FROM users WHERE id = ${c.id}`;
      return json(mapUserPublic(fresh));
    }
    if (route === 'admin/comptes/statut' && request.method === 'POST') {
      const [c] = await sql`SELECT * FROM users WHERE id = ${body.compteId}`;
      if (!c) return err('Compte introuvable.', 404);
      if (c.role === 'admin' && body.statut !== 'valide') {
        const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND statut = 'valide'`;
        if (count <= 1) return err('Impossible de désactiver le dernier compte administrateur actif.', 400);
      }
      await sql`UPDATE users SET statut = ${body.statut} WHERE id = ${c.id}`;
      const [fresh] = await sql`SELECT * FROM users WHERE id = ${c.id}`;
      return json(mapUserPublic(fresh));
    }
    /* Suppression d'un compte (retire notamment l'accès d'un animateur).
       ON DELETE CASCADE/SET NULL sur les FK garantit qu'aucune donnee
       historique (reunions.created_by -> SET NULL, notifications ->
       CASCADE sur ce compte uniquement, presences/questions des ENFANTS
       -> inchangees) n'est perdue de facon incoherente : seul l'acces
       du compte lui-meme est retire. */
    if (route === 'admin/comptes/supprimer' && request.method === 'POST') {
      const [c] = await sql`SELECT * FROM users WHERE id = ${body.compteId}`;
      if (!c) return err('Compte introuvable.', 404);
      if (c.role === 'admin') {
        const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'`;
        if (count <= 1) return err('Impossible de supprimer le dernier compte administrateur.', 400);
      }
      await sql`DELETE FROM users WHERE id = ${body.compteId}`;
      return json({ ok: true });
    }
    if (route === 'admin/enfants/ajouter' && request.method === 'POST') {
      const { compteId, enfant } = body;
      const [c] = await sql`SELECT * FROM users WHERE id = ${compteId} AND role = 'parent'`;
      if (!c) return err('Compte parent introuvable.', 404);
      const childId = uid('enf');
      await sql`INSERT INTO children (id, parent_id, prenom, nom, naissance, section_id, allergies, remarques_medicales, photo_autorisee)
                VALUES (${childId}, ${c.id}, ${enfant.prenom}, ${enfant.nom || c.nom}, ${enfant.naissance || null}, ${enfant.sectionId || null}, ${enfant.allergies || ''}, ${enfant.remarquesMedicales || ''}, ${!!enfant.photoAutorisee})`;
      await sql`INSERT INTO parent_child_links (id, parent_id, child_id, lien) VALUES (${uid('pcl')}, ${c.id}, ${childId}, ${enfant.lien || 'Responsable'})`;
      await paiementSeed(childId);
      const [row] = await sql`SELECT * FROM children WHERE id = ${childId}`;
      return json(mapChild(row));
    }

    if (route === 'admin/enfants' && request.method === 'GET') {
      const rows = await sql`SELECT * FROM children ORDER BY prenom`;
      const out = [];
      for (const r of rows) {
        const payments = await sql`SELECT * FROM payments WHERE child_id = ${r.id}`;
        out.push({ ...mapChild(r), paiements: payments.map(mapPayment) });
      }
      return json({ enfants: out, sections: await getSections() });
    }

    /* Suppression DEFINITIVE d'un enfant (pas un masquage). Grace aux FK
       ON DELETE CASCADE definies dans lib/db.mjs sur presences.child_id,
       payments.child_id, questions.child_id (SET NULL), parent_child_links,
       health_forms, parental_authorizations, registration_documents et
       child_custom_documents, un simple DELETE FROM children suffit a
       nettoyer TOUTES les donnees liees sans requete manuelle repetee et
       sans laisser de donnee orpheline. */
    if (route === 'admin/enfants/supprimer' && request.method === 'POST') {
      const { enfantId } = body;
      const [child] = await sql`SELECT * FROM children WHERE id = ${enfantId}`;
      if (!child) return err('Enfant introuvable.', 404);
      await sql`DELETE FROM children WHERE id = ${enfantId}`;
      return json({ ok: true });
    }

    if (route === 'admin/enfants/section' && request.method === 'POST') {
      const { enfantId, sectionId } = body;
      const [child] = await sql`SELECT * FROM children WHERE id = ${enfantId}`;
      if (!child) return err('Enfant introuvable.', 404);
      if (sectionId) {
        const [sec] = await sql`SELECT 1 FROM sections WHERE id = ${sectionId}`;
        if (!sec) return err('Section invalide.', 400);
      }
      const [ancienneSection] = child.section_id ? await sql`SELECT nom FROM sections WHERE id = ${child.section_id}` : [null];
      const [nouvelleSection] = sectionId ? await sql`SELECT nom FROM sections WHERE id = ${sectionId}` : [null];
      await sql`UPDATE children SET section_id = ${sectionId || null} WHERE id = ${enfantId}`;
      if (child.parent_id) {
        await notify(child.parent_id, 'Changement de section',
          `${child.prenom} a été déplacé(e) ${ancienneSection ? 'de ' + ancienneSection.nom + ' ' : ''}vers la section ${nouvelleSection ? nouvelleSection.nom : '—'}.`,
          `enfant.html?id=${enfantId}`, 'admin');
      }
      const [fresh] = await sql`SELECT * FROM children WHERE id = ${enfantId}`;
      return json(mapChild(fresh));
    }

    if (route === 'admin/paiements/marquer' && request.method === 'POST') {
      const [p] = await sql`SELECT * FROM payments WHERE id = ${body.paiementId} AND child_id = ${body.enfantId}`;
      if (!p) return err('Paiement introuvable.', 404);
      const paye = !!body.paye;
      await sql`UPDATE payments SET paye = ${paye}, date_paiement = ${paye ? today() : null} WHERE id = ${p.id}`;
      const [child] = await sql`SELECT * FROM children WHERE id = ${body.enfantId}`;
      if (child.parent_id) {
        await notify(child.parent_id, 'Paiement mis à jour', `Le paiement « ${p.label} » de ${child.prenom} a été marqué comme ${paye ? 'payé' : 'non payé'}.`, `profil.html?enfant=${child.id}#paiements`, 'admin');
      }
      const payments = await sql`SELECT * FROM payments WHERE child_id = ${child.id}`;
      return json({ ...mapChild(child), paiements: payments.map(mapPayment) });
    }
    if (route === 'admin/paiements' && request.method === 'GET') {
      const rows = await sql`
        SELECT p.*, c.prenom AS c_prenom, c.nom AS c_nom, c.section_id AS c_section, u.id AS u_id, u.prenom AS u_prenom, u.nom AS u_nom, u.email AS u_email
        FROM payments p JOIN children c ON c.id = p.child_id LEFT JOIN users u ON u.id = c.parent_id
        ORDER BY p.created_at`;
      const paiements = rows.map((r) => ({
        paiementId: r.id, enfantId: r.child_id, enfantNom: `${r.c_prenom} ${r.c_nom}`, sectionId: r.c_section,
        parentId: r.u_id, parentNom: r.u_id ? `${r.u_prenom} ${r.u_nom}` : '—', parentEmail: r.u_email || '—',
        label: r.label, type: r.type, montant: Number(r.montant), paye: r.paye,
        datePaiement: r.date_paiement ? String(r.date_paiement).slice(0, 10) : null,
        description: r.description || '', dateLimite: r.date_limite ? String(r.date_limite).slice(0, 10) : null,
      }));
      return json({ paiements, sections: await getSections() });
    }
    if (route === 'admin/paiements/creer' && request.method === 'POST') {
      const { titre, montant, description, dateLimite, cible, enfantId, sectionId } = body;
      if (!titre || montant === undefined || montant === null || montant === '') return err('Titre et montant sont obligatoires.');
      const m = Number(montant);
      if (Number.isNaN(m) || m < 0) return err('Montant invalide.');
      let cibles;
      if (cible === 'enfant') {
        cibles = await sql`SELECT * FROM children WHERE id = ${enfantId}`;
        if (!cibles.length) return err('Enfant introuvable.', 404);
      } else if (cible === 'section') {
        cibles = await sql`SELECT * FROM children WHERE section_id = ${sectionId}`;
        if (!cibles.length) return err('Aucun enfant dans cette section.');
      } else {
        cibles = await sql`SELECT * FROM children`;
      }
      let nbCrees = 0;
      for (const e of cibles) {
        const payId = uid('pay');
        await sql`INSERT INTO payments (id, child_id, type, label, montant, paye, description, date_limite)
                  VALUES (${payId}, ${e.id}, 'custom', ${titre}, ${m}, false, ${description || ''}, ${dateLimite || null})`;
        nbCrees++;
        if (e.parent_id) {
          await notify(e.parent_id, 'Nouveau paiement à effectuer', `« ${titre} » — ${m} € pour ${e.prenom}${dateLimite ? ` (à régler avant le ${dateLimite})` : ''}.`, `profil.html?enfant=${e.id}#paiements`, 'admin');
        }
      }
      return json({ ok: true, nbCrees });
    }
    if (route === 'admin/notifications/envoyer' && request.method === 'POST') {
      const { enfantId, titre, texte } = body;
      const [e] = await sql`SELECT * FROM children WHERE id = ${enfantId}`;
      if (!e || !e.parent_id) return err('Enfant introuvable ou sans compte parent.', 404);
      await notify(e.parent_id, titre || "Message du Patro Notre-Dame d'Ittre", texte, `enfant.html?id=${e.id}`, 'admin');
      return json({ ok: true });
    }
    if (route === 'admin/rappels/presence' && request.method === 'POST') {
      const { reunionId } = body;
      const [ev] = await sql`SELECT * FROM events WHERE id = ${reunionId}`;
      if (!ev) return err('Réunion introuvable.', 404);
      const secRows = await sql`SELECT section_id FROM event_sections WHERE event_id = ${reunionId}`;
      const sections = secRows.map((s) => s.section_id);
      const enfants = sections.length ? await sql`SELECT * FROM children WHERE section_id = ANY(${sections})` : await sql`SELECT * FROM children`;
      const presRows = await sql`SELECT child_id FROM presences WHERE event_id = ${reunionId}`;
      const presentIds = new Set(presRows.map((p) => p.child_id));
      let n = 0;
      for (const e of enfants) {
        if (presentIds.has(e.id)) continue;
        if (e.parent_id) { await notify(e.parent_id, 'Rappel — présence à confirmer', `Merci d'indiquer si ${e.prenom} sera présent(e) à « ${ev.titre} » le ${String(ev.date).slice(0,10)}.`, `enfant.html?id=${e.id}&event=${ev.id}#calendrier`, 'admin'); n++; }
      }
      return json({ ok: true, nbRappels: n });
    }
    if (route === 'admin/taches' && request.method === 'GET') {
      const taches = await sql`SELECT * FROM tasks`;
      const comptes = await sql`SELECT * FROM users WHERE role != 'parent'`;
      return json({
        taches: taches.map((t) => ({ id: t.id, nom: t.nom, referentCompteId: t.referent_user_id, referentNomLibre: t.referent_nom_libre })),
        comptes: comptes.map(mapUserPublic),
      });
    }
    if (route === 'admin/taches' && request.method === 'POST') {
      const t = body.tache || {};
      const id = t.id || uid('tache');
      await sql`INSERT INTO tasks (id, nom, referent_user_id, referent_nom_libre)
                VALUES (${id}, ${t.nom}, ${t.referentCompteId || null}, ${t.referentNomLibre || ''})
                ON CONFLICT (id) DO UPDATE SET nom=EXCLUDED.nom, referent_user_id=EXCLUDED.referent_user_id, referent_nom_libre=EXCLUDED.referent_nom_libre`;
      return json({ id, nom: t.nom, referentCompteId: t.referentCompteId || null, referentNomLibre: t.referentNomLibre || '' });
    }
    if (route === 'admin/taches/delete' && request.method === 'POST') {
      await sql`DELETE FROM tasks WHERE id = ${body.id}`;
      return json({ ok: true });
    }
    if (route === 'admin/contenu' && request.method === 'POST') {
      const map = { patroTexte: 'patroTexte', infosImportantes: 'infosImportantes', compteBancaire: 'compteBancaire', texteDifficulteFinanciere: 'texteDifficulteFinanciere' };
      for (const [jsKey, key] of Object.entries(map)) {
        if (body[jsKey] !== undefined) {
          await sql`INSERT INTO site_content (key, value) VALUES (${key}, ${body[jsKey]}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
        }
      }
      const rows = await sql`SELECT * FROM site_content`;
      const contenu = {};
      rows.forEach((r) => { contenu[r.key] = r.value; });
      return json(contenu);
    }
    if (route === 'admin/histoire' && request.method === 'POST') {
      const h = body.evenement || {};
      const id = h.id || uid('hist');
      await sql`INSERT INTO history_events (id, date, titre, texte_court, texte_long)
                VALUES (${id}, ${h.date}, ${h.titre}, ${h.texteCourt || ''}, ${h.texteLong || ''})
                ON CONFLICT (id) DO UPDATE SET date=EXCLUDED.date, titre=EXCLUDED.titre, texte_court=EXCLUDED.texte_court, texte_long=EXCLUDED.texte_long`;
      return json({ id, date: h.date, titre: h.titre, texteCourt: h.texteCourt || '', texteLong: h.texteLong || '' });
    }
    if (route === 'admin/histoire/delete' && request.method === 'POST') {
      await sql`DELETE FROM history_events WHERE id = ${body.id}`;
      return json({ ok: true });
    }

    if (route === 'admin/documents' && request.method === 'GET') {
      const rows = await sql`SELECT * FROM document_templates ORDER BY created_at`;
      return json({ documentsRequis: rows.map(mapDocTemplate) });
    }
    if (route === 'admin/documents' && request.method === 'POST') {
      const d = body.document || {};
      const estNouveau = !d.id;
      if (!d.nom) return err('Le nom du document est obligatoire.');
      const id = d.id || uid('doctpl');
      let cle = 'custom';
      let protege = false;
      if (!estNouveau) {
        const [existant] = await sql`SELECT * FROM document_templates WHERE id = ${d.id}`;
        if (existant) { cle = existant.cle; protege = existant.protege; }
      }
      await sql`INSERT INTO document_templates (id, cle, nom, instructions, obligatoire, protege, updated_at)
                VALUES (${id}, ${cle}, ${d.nom}, ${d.instructions || ''}, ${!!d.obligatoire}, ${protege}, now())
                ON CONFLICT (id) DO UPDATE SET nom=EXCLUDED.nom, instructions=EXCLUDED.instructions, obligatoire=EXCLUDED.obligatoire, updated_at=now()`;
      const [saved] = await sql`SELECT * FROM document_templates WHERE id = ${id}`;
      // Notifie tous les parents ayant un enfant (un document requis concerne potentiellement chaque enfant).
      const kids = await sql`SELECT id, prenom, parent_id FROM children WHERE parent_id IS NOT NULL`;
      for (const k of kids) {
        await notify(k.parent_id,
          estNouveau ? 'Nouveau document demandé' : 'Document mis à jour',
          `Un document (« ${saved.nom} ») a été ${estNouveau ? 'ajouté' : 'modifié'} concernant ${k.prenom}. Veuillez consulter et mettre à jour le document demandé.`,
          `enfant.html?id=${k.id}#documents`, 'admin');
      }
      return json(mapDocTemplate(saved));
    }
    if (route === 'admin/documents/delete' && request.method === 'POST') {
      const [tpl] = await sql`SELECT * FROM document_templates WHERE id = ${body.id}`;
      if (!tpl) return err('Document introuvable.', 404);
      if (tpl.protege) return err("Ce document est structurel au site et ne peut pas être supprimé (vous pouvez toujours modifier son nom et ses instructions).", 400);
      await sql`DELETE FROM document_templates WHERE id = ${body.id}`;
      return json({ ok: true });
    }

    if (route === 'admin/evenement' && request.method === 'POST') {
      const r = body.reunion || {};
      const type = TYPES_EVENEMENT.includes(r.type) ? r.type : 'reunion';
      const allSections = (await getSections()).map((s) => s.id);
      const sections = (r.sections && r.sections.length) ? r.sections : allSections;
      const isEdit = !!r.id;
      const eventId = r.id || uid('reu');

      await sql`INSERT INTO events (id, titre, type, date, date_fin, heure_debut, heure_fin, lieu, description, created_by)
                VALUES (${eventId}, ${r.titre}, ${type}, ${r.date}, ${r.dateFin || null}, ${r.heureDebut || ''}, ${r.heureFin || ''}, ${r.lieu || ''}, ${r.description || ''}, ${compte.id})
                ON CONFLICT (id) DO UPDATE SET titre=EXCLUDED.titre, type=EXCLUDED.type, date=EXCLUDED.date,
                  date_fin=EXCLUDED.date_fin, heure_debut=EXCLUDED.heure_debut, heure_fin=EXCLUDED.heure_fin,
                  lieu=EXCLUDED.lieu, description=EXCLUDED.description`;
      await sql`DELETE FROM event_sections WHERE event_id = ${eventId}`;
      for (const s of sections) { await sql`INSERT INTO event_sections (event_id, section_id) VALUES (${eventId}, ${s})`; }

      if (!isEdit) {
        await notifyParentsBySections(sections, 'Nouvel événement',
          () => `« ${r.titre} » (${LABEL_TYPE[type]}) a été ajouté le ${r.date}.`, eventId, 'admin');
      } else if (body.notifierModif) {
        await notifyParentsBySections(sections, 'Événement modifié',
          () => `« ${r.titre} » a été modifié (date : ${r.date}, ${r.heureDebut||''}-${r.heureFin||''}).`, eventId, 'admin');
        await notifyAnimateursBySections(sections, 'Événement modifié', `« ${r.titre} » a été modifié (date : ${r.date}).`, eventId, 'admin');
      }
      const [row] = await sql`SELECT e.*, ${sections} AS sections FROM events e WHERE e.id = ${eventId}`;
      return json(mapEvent(row));
    }

    if (route === 'admin/stats' && request.method === 'GET') {
      const annee = url.searchParams.get('annee') || String(new Date().getFullYear());
      const events = await sql`SELECT * FROM events WHERE date::text LIKE ${annee + '%'}`;
      const sections = await getSections();

      async function tauxPourEvenement(ev) {
        const secRows = await sql`SELECT section_id FROM event_sections WHERE event_id = ${ev.id}`;
        const secs = secRows.map((s) => s.section_id);
        const enfants = secs.length ? await sql`SELECT id FROM children WHERE section_id = ANY(${secs})` : await sql`SELECT id FROM children`;
        if (!enfants.length) return null;
        const ids = enfants.map((e) => e.id);
        const pres = await sql`SELECT COUNT(*)::int AS c FROM presences WHERE event_id = ${ev.id} AND child_id = ANY(${ids}) AND statut IN ('present','retard')`;
        return Math.round((pres[0].c / enfants.length) * 100);
      }

      const parType = {};
      for (const t of TYPES_EVENEMENT) {
        const evts = events.filter((e) => e.type === t);
        const taux = [];
        for (const e of evts) { const v = await tauxPourEvenement(e); if (v !== null) taux.push(v); }
        parType[t] = taux.length ? Math.round(taux.reduce((a, b) => a + b, 0) / taux.length) : null;
      }

      const parSection = {};
      for (const s of sections) {
        parSection[s.id] = {};
        const enf = await sql`SELECT id FROM children WHERE section_id = ${s.id}`;
        const ids = enf.map((e) => e.id);
        for (const t of TYPES_EVENEMENT) {
          const evtsSec = [];
          for (const ev of events.filter((e) => e.type === t)) {
            const secRows = await sql`SELECT section_id FROM event_sections WHERE event_id = ${ev.id}`;
            const secs = secRows.map((r) => r.section_id);
            if (!secs.length || secs.includes(s.id)) evtsSec.push(ev);
          }
          const taux = [];
          for (const ev of evtsSec) {
            if (!ids.length) continue;
            const pres = await sql`SELECT COUNT(*)::int AS c FROM presences WHERE event_id = ${ev.id} AND child_id = ANY(${ids}) AND statut IN ('present','retard')`;
            taux.push(Math.round((pres[0].c / ids.length) * 100));
          }
          parSection[s.id][t] = taux.length ? Math.round(taux.reduce((a, b) => a + b, 0) / taux.length) : null;
        }
      }

      const parEvenement = [];
      for (const ev of events.sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
        parEvenement.push({ id: ev.id, titre: ev.titre, type: ev.type, date: String(ev.date).slice(0, 10), taux: await tauxPourEvenement(ev) });
      }

      const anneesRows = await sql`SELECT DISTINCT LEFT(date::text, 4) AS annee FROM events ORDER BY annee`;
      const annees = anneesRows.map((r) => r.annee).filter(Boolean);

      return json({ annee, annees, global: parType, parSection, parEvenement, sections, labelsType: LABEL_TYPE });
    }

    return err(`Route inconnue : ${route}`, 404);
  } catch (e) {
    return err(e.message + ' | ' + (e.stack || '').slice(0, 300), 500);
  }
};

async function paiementSeed(childId) {
  const labelCotisation = "Cotisation annuelle (goûters inclus)";
  const labelCamp = "Camp d'été";
  await sql`INSERT INTO payments (id, child_id, type, label, montant) VALUES (${uid('pay')}, ${childId}, 'cotisation', ${labelCotisation}, 50)`;
  await sql`INSERT INTO payments (id, child_id, type, label, montant) VALUES (${uid('pay')}, ${childId}, 'camp', ${labelCamp}, 150)`;
}

export const config = { path: '/api/*' };
