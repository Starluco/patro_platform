/* =====================================================================
   Utilitaires communs — Patro Notre-Dame d'Ittre
   ===================================================================== */
const API = '/api';

async function api(route, { method = 'GET', body = null, admin = false } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (admin) headers['x-admin-password'] = sessionStorage.getItem('patro_admin_pwd') || '';
  const res = await fetch(`${API}/${route}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });
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

const NAV = [
  { href: 'index.html',      label: '🏠 Accueil' },
  { href: 'parents.html',    label: '👨‍👩‍👧 Espace parents' },
  { href: 'presences.html',  label: '✅ Présences' },
  { href: 'gestion.html',    label: '⚙️ Gestion' },
  { href: 'communication.html', label: '✉️ Communication' },
];

function renderNav(current) {
  const links = NAV.map(
    (n) => `<a href="${n.href}" class="${n.href === current ? 'active' : ''}">${n.label}</a>`
  ).join('');
  document.body.insertAdjacentHTML('afterbegin', `
  <nav class="navbar"><div class="navbar-inner">
    <a class="brand" href="index.html">
      <span class="logo">P</span>
      <span>Patro Notre-Dame d'Ittre<small>Mouvement de jeunesse</small></span>
    </a>
    <div class="nav-links">${links}</div>
  </div></nav>`);
}

function renderFooter() {
  document.body.insertAdjacentHTML('beforeend', `
  <footer class="footer">
    <p><strong>Patro Notre-Dame d'Ittre</strong> — Réunions tous les samedis de 14h00 à 17h00<br>
    Parking en face du « Deli-traiteur », 1460 Ittre</p>
    <p>📧 <a href="mailto:pndi@patro.be">pndi@patro.be</a> &nbsp;•&nbsp; Camp : du 1<sup>er</sup> au 10 août</p>
    <p style="opacity:.6;font-size:.8rem">© ${new Date().getFullYear()} Patro Notre-Dame d'Ittre — Le Staff</p>
  </footer>`);
}

const SECTION_COULEURS = {
  bengalis: '#7BC043', benjas: '#4CAF50', 'chev-etc': '#F9C80E',
  'conq-alps': '#F4A100', aventuriers: '#2E7D32', grands: '#C9A227',
};

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

const parentSession = {
  get: () => { try { return JSON.parse(localStorage.getItem('patro_parent') || 'null'); } catch { return null; } },
  set: (p) => localStorage.setItem('patro_parent', JSON.stringify(p)),
  clear: () => localStorage.removeItem('patro_parent'),
};
