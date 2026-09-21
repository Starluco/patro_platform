/**
 * =====================================================================
 *  Couche base de données — Patro Notre-Dame d'Ittre (v3.0)
 *  Store : Netlify DB (Neon Serverless Postgres) via @netlify/neon
 * =====================================================================
 *  ARCHITECTURE (mise à jour) :
 *  - Netlify Blobs N'EST PLUS utilisé pour l'état applicatif (comptes,
 *    enfants, présences, paiements...). Toutes ces données vivent dans
 *    des tables relationnelles avec clés étrangères explicites.
 *  - `neon()` sans argument lit automatiquement la variable
 *    d'environnement injectée par Netlify (NETLIFY_DATABASE_URL). En
 *    local (`netlify dev`) comme en Preview Deploy, Netlify route
 *    automatiquement vers la branche de base de données correspondante
 *    (branching natif Neon) — AUCUNE logique de branche à écrire ici :
 *    c'est Netlify qui sélectionne la bonne URL de connexion selon le
 *    contexte de déploiement (production vs deploy preview vs branche).
 *  - Exception Blobs autorisée (cahier des charges) : uniquement pour
 *    des fichiers bruts (PDF de fiche santé scannée, photo de profil...).
 *    Dans ce cas, le fichier est stocké dans un store Blobs dédié
 *    ("patro-files") et seule sa clé/URL est enregistrée dans la colonne
 *    `blob_key` de la table `files` ci-dessous. Aucune donnée métier
 *    n'est stockée dans Blobs.
 * =====================================================================
 */
import { neon } from '@netlify/neon';

// Connexion — Netlify injecte automatiquement l'URL (et sa branche Neon
// correcte selon l'environnement : production / deploy preview / branch).
export const sql = neon();

let schemaReady = false;

/**
 * Crée les tables si elles n'existent pas encore (idempotent, donc
 * sans danger même appelé à chaque cold start) et insère les données
 * de référence (sections, admin initial, gabarits de documents,
 * contenu par défaut) UNIQUEMENT si elles sont absentes.
 */
export async function ensureSchema() {
  if (schemaReady) return;

  // --- Tables de référence -------------------------------------------------
  await sql`CREATE TABLE IF NOT EXISTS sections (
    id       TEXT PRIMARY KEY,
    nom      TEXT NOT NULL,
    tranche  TEXT NOT NULL,
    age_min  INT  NOT NULL,
    age_max  INT  NOT NULL,
    couleur  TEXT NOT NULL,
    emoji    TEXT NOT NULL
  )`;

  // --- Comptes (parents / animateurs / admin) -------------------------------
  await sql`CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    salt            TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    prenom          TEXT NOT NULL,
    nom             TEXT NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('parent','animateur','admin')),
    statut          TEXT NOT NULL CHECK (statut IN ('attente','valide','refuse')) DEFAULT 'attente',
    tel             TEXT DEFAULT '',
    adresse         TEXT DEFAULT '',
    code_postal     TEXT DEFAULT '1460',
    localite        TEXT DEFAULT 'Ittre',
    contact_urgence TEXT DEFAULT '',
    remarques       TEXT DEFAULT '',
    section_id      TEXT REFERENCES sections(id) ON DELETE SET NULL,
    totem           TEXT DEFAULT '',
    bio             TEXT DEFAULT '',
    tache           TEXT DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_users_section ON users(section_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_users_statut ON users(statut)`;

  // --- Enfants ---------------------------------------------------------------
  await sql`CREATE TABLE IF NOT EXISTS children (
    id                   TEXT PRIMARY KEY,
    parent_id            TEXT REFERENCES users(id) ON DELETE SET NULL,
    prenom               TEXT NOT NULL,
    nom                  TEXT NOT NULL,
    naissance            DATE,
    section_id           TEXT REFERENCES sections(id) ON DELETE SET NULL,
    allergies            TEXT DEFAULT '',
    remarques_medicales  TEXT DEFAULT '',
    photo_autorisee      BOOLEAN NOT NULL DEFAULT false,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_children_parent ON children(parent_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_children_section ON children(section_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_children_nom ON children(nom, prenom)`;

  // --- Liens parent(s) <-> enfant (plusieurs responsables possibles) --------
  await sql`CREATE TABLE IF NOT EXISTS parent_child_links (
    id         TEXT PRIMARY KEY,
    parent_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    child_id   TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    lien       TEXT DEFAULT 'Responsable',
    UNIQUE(parent_id, child_id)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_pcl_parent ON parent_child_links(parent_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_pcl_child ON parent_child_links(child_id)`;

  // --- Événements (réunions / soupers / journées / camps) --------------------
  await sql`CREATE TABLE IF NOT EXISTS events (
    id           TEXT PRIMARY KEY,
    titre        TEXT NOT NULL,
    type         TEXT NOT NULL CHECK (type IN ('reunion','souper','journee','camp')) DEFAULT 'reunion',
    date         DATE NOT NULL,
    date_fin     DATE,
    heure_debut  TEXT DEFAULT '',
    heure_fin    TEXT DEFAULT '',
    lieu         TEXT DEFAULT '',
    description  TEXT DEFAULT '',
    created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_events_date ON events(date)`;

  await sql`CREATE TABLE IF NOT EXISTS event_sections (
    event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    section_id  TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, section_id)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_es_section ON event_sections(section_id)`;

  // --- Présences (une ligne par enfant + par événement) -----------------------
  await sql`CREATE TABLE IF NOT EXISTS presences (
    id             TEXT PRIMARY KEY,
    child_id       TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    event_id       TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    statut         TEXT NOT NULL CHECK (statut IN ('present','absent','retard')) DEFAULT 'present',
    motif_retard   TEXT DEFAULT '',
    heure_arrivee  TEXT DEFAULT '',
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(child_id, event_id)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_presences_event ON presences(event_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_presences_child ON presences(child_id)`;

  // --- Paiements ---------------------------------------------------------------
  await sql`CREATE TABLE IF NOT EXISTS payments (
    id             TEXT PRIMARY KEY,
    child_id       TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    type           TEXT NOT NULL DEFAULT 'custom',
    label          TEXT NOT NULL,
    montant        NUMERIC(8,2) NOT NULL DEFAULT 0,
    paye           BOOLEAN NOT NULL DEFAULT false,
    date_paiement  DATE,
    description    TEXT DEFAULT '',
    date_limite    DATE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_payments_child ON payments(child_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_payments_paye ON payments(paye)`;

  // --- Notifications -------------------------------------------------------------
  await sql`CREATE TABLE IF NOT EXISTS notifications (
    id       TEXT PRIMARY KEY,
    user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    titre    TEXT NOT NULL,
    texte    TEXT NOT NULL,
    lien     TEXT DEFAULT '',
    lue      BOOLEAN NOT NULL DEFAULT false,
    date     TIMESTAMPTZ NOT NULL DEFAULT now(),
    origine  TEXT DEFAULT 'systeme'
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, lue)`;

  // --- Questions & réponses -------------------------------------------------------
  await sql`CREATE TABLE IF NOT EXISTS questions (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    child_id    TEXT REFERENCES children(id) ON DELETE SET NULL,
    categorie   TEXT NOT NULL CHECK (categorie IN ('section','patro')),
    section_id  TEXT REFERENCES sections(id) ON DELETE SET NULL,
    texte       TEXT NOT NULL,
    date        TIMESTAMPTZ NOT NULL DEFAULT now(),
    statut      TEXT NOT NULL DEFAULT 'ouverte'
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_questions_section ON questions(section_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_questions_user ON questions(user_id)`;

  await sql`CREATE TABLE IF NOT EXISTS question_responses (
    id           TEXT PRIMARY KEY,
    question_id  TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
    role         TEXT,
    texte        TEXT NOT NULL,
    date         TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_qr_question ON question_responses(question_id)`;

  // --- Tâches / référents ----------------------------------------------------------
  await sql`CREATE TABLE IF NOT EXISTS tasks (
    id                  TEXT PRIMARY KEY,
    nom                 TEXT NOT NULL,
    referent_user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
    referent_nom_libre  TEXT DEFAULT ''
  )`;

  // --- Sessions (jetons d'authentification) -----------------------------------------
  await sql`CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`;

  // --- Contenu du site (clé/valeur simple) -------------------------------------------
  await sql`CREATE TABLE IF NOT EXISTS site_content (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL DEFAULT ''
  )`;

  // --- Ligne du temps (histoire) -----------------------------------------------------
  await sql`CREATE TABLE IF NOT EXISTS history_events (
    id           TEXT PRIMARY KEY,
    date         TEXT NOT NULL,
    titre        TEXT NOT NULL,
    texte_court  TEXT DEFAULT '',
    texte_long   TEXT DEFAULT ''
  )`;

  // --- Gabarits de documents demandés -------------------------------------------------
  await sql`CREATE TABLE IF NOT EXISTS document_templates (
    id            TEXT PRIMARY KEY,
    cle           TEXT NOT NULL,
    nom           TEXT NOT NULL,
    instructions  TEXT DEFAULT '',
    obligatoire   BOOLEAN NOT NULL DEFAULT true,
    protege       BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

  // --- Fiche santé (1 ligne par enfant) ------------------------------------------------
  await sql`CREATE TABLE IF NOT EXISTS health_forms (
    child_id              TEXT PRIMARY KEY REFERENCES children(id) ON DELETE CASCADE,
    nom_prenom            TEXT DEFAULT '',
    naissance             DATE,
    adresse               TEXT DEFAULT '',
    telephone_parent      TEXT DEFAULT '',
    urgence1_nom          TEXT DEFAULT '', urgence1_lien TEXT DEFAULT '', urgence1_tel TEXT DEFAULT '',
    urgence2_nom          TEXT DEFAULT '', urgence2_lien TEXT DEFAULT '', urgence2_tel TEXT DEFAULT '',
    probleme_sante        TEXT DEFAULT 'non', probleme_sante_detail TEXT DEFAULT '',
    allergies_sante       TEXT DEFAULT 'non', allergies_detail TEXT DEFAULT '',
    regime                TEXT DEFAULT 'non', regime_detail TEXT DEFAULT '',
    medicaments           TEXT DEFAULT 'non', medicament_nom TEXT DEFAULT '', medicament_dose TEXT DEFAULT '', medicament_moment TEXT DEFAULT '',
    autre                 TEXT DEFAULT 'non', autre_detail TEXT DEFAULT '',
    medecin_nom           TEXT DEFAULT '', medecin_tel TEXT DEFAULT '',
    updated_at            TIMESTAMPTZ
  )`;

  // --- Autorisation parentale (1 ligne par enfant) -------------------------------------
  await sql`CREATE TABLE IF NOT EXISTS parental_authorizations (
    child_id         TEXT PRIMARY KEY REFERENCES children(id) ON DELETE CASCADE,
    photo            BOOLEAN DEFAULT false,
    secours          BOOLEAN DEFAULT false,
    mesures_urgence  BOOLEAN DEFAULT false,
    infos_exactes    BOOLEAN DEFAULT false,
    voiture          BOOLEAN DEFAULT false,
    updated_at       TIMESTAMPTZ
  )`;

  // --- Document d'inscription papier (1 ligne par enfant) --------------------------------
  await sql`CREATE TABLE IF NOT EXISTS registration_documents (
    child_id    TEXT PRIMARY KEY REFERENCES children(id) ON DELETE CASCADE,
    recu        BOOLEAN DEFAULT false,
    updated_at  TIMESTAMPTZ
  )`;

  // --- Documents personnalisés (gabarits "custom") par enfant ------------------------------
  await sql`CREATE TABLE IF NOT EXISTS child_custom_documents (
    id               TEXT PRIMARY KEY,
    child_id         TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    doc_template_id  TEXT NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
    statut           TEXT NOT NULL DEFAULT 'manquant',
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(child_id, doc_template_id)
  )`;

  // --- Exception Blobs autorisée : fichiers bruts (PDF/photos). Seule la
  //     clé Blobs est stockée ici, jamais le contenu binaire en base. ------------------------
  await sql`CREATE TABLE IF NOT EXISTS files (
    id             TEXT PRIMARY KEY,
    blob_key       TEXT NOT NULL,
    original_name  TEXT,
    mime_type      TEXT,
    child_id       TEXT REFERENCES children(id) ON DELETE CASCADE,
    uploaded_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_files_child ON files(child_id)`;

  await seedReferenceData();
  schemaReady = true;
}

async function seedReferenceData() {
  const sections = [
    ['bengalis', 'Bengalis', '4-6 ans', 4, 6, '#7BC043', '🐯'],
    ['benjas', 'Benjas', '6-9 ans', 6, 9, '#4CAF50', '🦊'],
    ['chevaliers-etincelles', 'Chevaliers-Étincelles', '9-12 ans', 9, 12, '#F9C80E', '🐺'],
    ['conquerants-alpines', 'Conquérants-Alpines', '12-14 ans', 12, 14, '#F4A100', '⛰️'],
    ['aventuriers', 'Aventuriers', '14-15 ans', 14, 15, '#2E7D32', '🎒'],
    ['grands', 'Grands', '15-17 ans', 15, 17, '#C9A227', '🔥'],
  ];
  for (const [id, nom, tranche, ageMin, ageMax, couleur, emoji] of sections) {
    await sql`INSERT INTO sections (id, nom, tranche, age_min, age_max, couleur, emoji)
              VALUES (${id}, ${nom}, ${tranche}, ${ageMin}, ${ageMax}, ${couleur}, ${emoji})
              ON CONFLICT (id) DO UPDATE SET nom = EXCLUDED.nom, tranche = EXCLUDED.tranche,
                age_min = EXCLUDED.age_min, age_max = EXCLUDED.age_max`;
  }

  const { createHash, randomBytes } = await import('node:crypto');
  const salt = randomBytes(8).toString('hex');
  const passwordHash = createHash('sha256').update(salt + 'Ster2014').digest('hex');
  await sql`INSERT INTO users (id, email, salt, password_hash, prenom, nom, role, statut)
            VALUES ('cpt_admin', 'admin@patro.be', ${salt}, ${passwordHash}, 'Administrateur', 'Patro', 'admin', 'valide')
            ON CONFLICT (email) DO NOTHING`;

  const contenuDefaut = [
    ['patroTexte', "Le Patro est un mouvement de jeunesse belge qui accueille les enfants et les jeunes de 4 à 17 ans, chaque samedi après-midi.\n\n(Ce texte est provisoire : l'administrateur pourra le remplacer depuis l'onglet « Contenu » de l'espace administrateur.)"],
    ['infosImportantes', "Les réunions se déroulent tous les samedis de 14h00 à 17h00.\nUn goûter est prévu lors de chaque réunion.\nLe rendez-vous se fait sur le parking en face du « Deli-traiteur », endroit où se trouvent nos locaux.\nLes enfants peuvent venir essayer une réunion pour voir comment cela se déroule.\nLe camp se déroule chaque année aux mêmes dates, du 1er au 10 août."],
    ['compteBancaire', 'BE49 0012 6285 0171'],
    ['texteDifficulteFinanciere', "Le Patro a pour mission d'accueillir tous les enfants, sans discrimination quelle qu'elle soit. Aussi, le coût d'une année ne peut en aucun cas constituer un obstacle à la participation de votre enfant aux activités.\n\nPour tout problème à ce sujet, veuillez prendre contact avec un responsable de votre choix, qui trouvera, avec vous, une solution en toute discrétion."],
  ];
  for (const [key, value] of contenuDefaut) {
    await sql`INSERT INTO site_content (key, value) VALUES (${key}, ${value}) ON CONFLICT (key) DO NOTHING`;
  }

  await sql`INSERT INTO history_events (id, date, titre, texte_court, texte_long)
            VALUES ('hist_1', '1958', ${"Fondation du Patro Notre-Dame d'Ittre"}, ${"Création du groupe par la paroisse d'Ittre."}, ${"Texte détaillé à compléter par l'administrateur depuis l'onglet Contenu."})
            ON CONFLICT (id) DO NOTHING`;

  const docs = [
    ['doc_ficheSante', 'ficheSante', 'Fiche santé', "Merci de compléter la fiche santé de votre enfant (allergies, médicaments, contacts d'urgence...).", true, true],
    ['doc_autorisation', 'autorisation', 'Autorisation parentale', "Merci de compléter et signer (électroniquement) l'autorisation parentale.", true, true],
    ['doc_inscription', 'inscription', "Document d'inscription", "Le document d'inscription papier doit être remis à un animateur ou à l'administrateur.", true, true],
  ];
  for (const [id, cle, nom, instructions, obligatoire, protege] of docs) {
    await sql`INSERT INTO document_templates (id, cle, nom, instructions, obligatoire, protege)
              VALUES (${id}, ${cle}, ${nom}, ${instructions}, ${obligatoire}, ${protege})
              ON CONFLICT (id) DO NOTHING`;
  }
}
