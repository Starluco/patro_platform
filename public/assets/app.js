/* =====================================================================
   Utilitaires communs — Patro Notre-Dame d'Ittre (v2.2)
   ===================================================================== */
const API = '/api';

const session = {
  get token(){ return localStorage.getItem('patro_token') || ''; },
  set token(t){ if(t) localStorage.setItem('patro_token', t); else localStorage.removeItem('patro_token'); },
  get compte(){ try{ return JSON.parse(localStorage.getItem('patro_compte')||'null'); }catch{ return null; } },
  set compte(c){ if(c) localStorage.setItem('patro_compte', JSON.stringify(c)); else localStorage.removeItem('patro_compte'); },
  get label(){ return localStorage.getItem('patro_label') || ''; },
  set label(l){ if(l) localStorage.setItem('patro_label', l); else localStorage.removeItem('patro_label'); },
  clear(){ this.token=''; this.compte=null; this.label=''; }
};

async function api(route, { method = 'GET', body = null } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (session.token) headers['x-auth-token'] = session.token;
  const res = await fetch(`${API}/${route}`, { method, headers, body: body ? JSON.stringify(body) : null });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

function toast(msg, isError = false) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = 'show' + (isError ? ' err' : '');
  clearTimeout(t._to);
  t._to = setTimeout(() => (t.className = ''), 3600);
}

/* -------- Deconnexion centralisee, utilisee partout -------- */
async function deconnecterEtRediriger(){
  try{ await api('auth/logout',{method:'POST'}); }catch(e){}
  session.clear();
  // location.replace() remplace l'entree d'historique courante : le bouton
  // "precedent" du navigateur ne pourra plus re-afficher la page privee.
  location.replace('index.html');
}

/* -------- Anti bouton "precedent" (bfcache) --------
   Quand une page est restauree depuis le cache du navigateur (bfcache),
   aucun script ne se re-execute normalement : on force un rechargement
   complet pour que requireAuth()/renderHeader() se relancent et
   redirigent immediatement si la session n'est plus valide. */
window.addEventListener('pageshow', function(e){
  if (e.persisted) location.reload();
});

const NAV_PUBLIC = [ { href: 'index.html', label: '🏠 Accueil' } ];
const NAV_PARENT = [
  { href: 'index.html', label: '🏠 Accueil' },
  { href: 'mes-enfants.html', label: '👧 Mes enfants' },
  { href: 'profil.html', label: '👤 Mon profil' },
];
const NAV_ANIMATEUR = [
  { href: 'index.html', label: '🏠 Accueil' },
  { href: 'animateur.html', label: '🧑‍🏫 Mon espace' },
  { href: 'profil.html', label: '👤 Mon profil' },
];
// Feedback : l'administrateur ne doit plus avoir de lien "Accueil" —
// apres connexion il reste dans son espace administratif.
const NAV_ADMIN = [
  { href: 'admin.html', label: '⚙️ Administration' },
  { href: 'profil.html', label: '👤 Mon profil' },
];

function initialesOf(){
  const c = session.compte;
  if(!c) return '?';
  return ((c.prenom||' ')[0]+(c.nom||' ')[0]).toUpperCase();
}

async function renderHeader(current) {
  const c = session.compte;
  let nbNotif = 0;
  let navItems = NAV_PUBLIC;
  if (c && session.token) {
    try {
      const me = await api('auth/me');
      session.compte = me.compte; session.label = me.label;
      nbNotif = me.nbNotificationsNonLues || 0;
      navItems = me.compte.role === 'admin' ? NAV_ADMIN : me.compte.role === 'animateur' ? NAV_ANIMATEUR : NAV_PARENT;
    } catch (e) {
      const msg = String(e && e.message || '');
      if (msg.includes('401') || msg.toLowerCase().includes('connecté') || msg.toLowerCase().includes('authentif')) {
        session.clear();
      }
      navItems = NAV_PUBLIC;
    }
  }
  const links = navItems.map((n) => `<a href="${n.href}" class="${n.href === current ? 'active' : ''}">${n.label}</a>`).join('');
  const droite = (session.token && session.compte)
    ? `<a href="profil.html" class="profil-chip">
         <span class="profil-avatar">${initialesOf()}</span>
         <span>${esc(session.label || '')}</span>
         ${nbNotif > 0 ? `<span class="profil-badge">${nbNotif > 9 ? '9+' : nbNotif}</span>` : ''}
       </a>
       <button class="btn-logout-top" onclick="deconnecterEtRediriger()">🚪 Se déconnecter</button>`
    : `<a href="connexion.html" class="btn-connexion">🔑 Connexion</a>`;

  document.body.insertAdjacentHTML('afterbegin', `
  <nav class="navbar"><div class="navbar-inner">
    <a class="brand" href="index.html">
      <span class="logo">P</span>
      <span>Patro Notre-Dame d'Ittre<small>Mouvement de jeunesse</small></span>
    </a>
    <div class="nav-links">${links}</div>
    <div class="nav-right">${droite}</div>
  </div></nav>`);
}

function renderFooter() {
  document.body.insertAdjacentHTML('beforeend', `
  <footer class="footer">
    <p><strong>Patro Notre-Dame d'Ittre</strong> — Réunions tous les samedis de 14h00 à 17h00<br>
    Parking en face du « Deli-traiteur », 1460 Ittre</p>
    <p>📧 <a href="mailto:pndi@patro.be">pndi@patro.be</a> &nbsp;•&nbsp; Camp : du 1<sup>er</sup> au 10 août
    &nbsp;•&nbsp; <a href="https://www.youtube.com/@patronotre-damedittrepndi1159" target="_blank" rel="noopener">Notre chaîne YouTube</a></p>
    <p style="opacity:.6;font-size:.8rem">© ${new Date().getFullYear()} Patro Notre-Dame d'Ittre — Le Staff</p>
  </footer>`);
}

async function requireAuth(roles = null) {
  if (!session.token) { location.href = 'connexion.html'; return null; }
  try {
    const me = await api('auth/me');
    session.compte = me.compte; session.label = me.label;
    if (roles && !roles.includes(me.compte.role)) {
      toast('Accès refusé pour ce rôle.', true);
      location.href = 'index.html';
      return null;
    }
    return me;
  } catch (e) {
    const msg = String(e && e.message || '');
    const estAuthInvalide = msg.includes('401') || msg.toLowerCase().includes('connecté') || msg.toLowerCase().includes('authentif');
    if (!estAuthInvalide) {
      await new Promise((r) => setTimeout(r, 600));
      try {
        const me2 = await api('auth/me');
        session.compte = me2.compte; session.label = me2.label;
        if (roles && !roles.includes(me2.compte.role)) {
          toast('Accès refusé pour ce rôle.', true);
          location.href = 'index.html';
          return null;
        }
        return me2;
      } catch (e2) {
        toast('Connexion au serveur instable, merci de réessayer.', true);
        return null;
      }
    }
    session.clear();
    location.href = 'connexion.html';
    return null;
  }
}

const SECTION_COULEURS = {
  bengalis: '#7BC043', benjas: '#4CAF50', 'chevaliers-etincelles': '#F9C80E',
  'conquerants-alpines': '#F4A100', aventuriers: '#2E7D32', grands: '#C9A227',
};
const AVATAR_COULEURS = ['#2E7D32','#F9C80E','#4CAF50','#F4A100','#7BC043','#C9A227','#1B5E20','#E0A800'];
function couleurAvatar(id){ let h=0; for(const c of String(id)) h=(h*31+c.charCodeAt(0))>>>0; return AVATAR_COULEURS[h%AVATAR_COULEURS.length]; }

function fmtDate(d) {
  if (!d) return '—';
  const date = new Date(d + (d.length === 10 ? 'T12:00:00' : ''));
  return date.toLocaleDateString('fr-BE', { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' });
}
function fmtDateCourt(d) {
  if (!d) return '—';
  return new Date(d + (d.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function age(naissance) {
  if (!naissance) return '—';
  const n = new Date(naissance), t = new Date();
  let a = t.getFullYear() - n.getFullYear();
  const m = t.getMonth() - n.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < n.getDate())) a--;
  return a;
}
function sectionSuggeree(naissance, sections) {
  const a = age(naissance);
  if (typeof a !== 'number') return '';
  const s = sections.find((x) => a >= x.ageMin && a <= x.ageMax);
  return s ? s.id : '';
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TYPE_LABEL = { reunion: '🎈 Réunion', souper: '🍽️ Souper', journee: '🌟 Journée spéciale', camp: '⛺ Camp' };
