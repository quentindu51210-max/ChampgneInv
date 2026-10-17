'use strict';

/* =====================================================
   Maison de Champagne — Gestion de stock
   Multi-utilisateurs : Supabase (authentification + base partagée)
   L'authentification (connexion/inscription/captcha) est gérée
   par le module inline dans index.html ; app.js gère les données.
   ===================================================== */

/* Le client supabase est créé par le module inline (index.html),
   possiblement après le chargement d'app.js : on le récupère à
   la demande (ensureClient) car l'init est asynchrone. */
let sbClientInstance = window.__supabase || null;

function ensureClient() {
  if (!sbClientInstance) sbClientInstance = window.__supabase || null;
  return sbClientInstance;
}

/* ---------- État ---------- */
let state = {
  brands: [],
  etats: [],
  types: [],
  products: []
};

let editingProductId = null;
let viewingProductId = null;
let realtimeChannel = null;

const TAG_COLORS = ['#4e745a', '#c1924c', '#a34a3e', '#3f6e8c', '#8a6d3b', '#6f7a70', '#b07a4a', '#2f5d50'];

/* ---------- Filtres courants ---------- */
let filterType = 'all';
let filterBrand = 'all';
let filterEtat = 'all';

/* ---------- Types de boisson ---------- */
const FALLBACK_TYPES = [
  { id: 'champagne', name: 'Champagne' },
  { id: 'coteaux', name: 'Coteaux Champenois' },
  { id: 'spiritueux', name: 'Spiritueux' }
];

function productType(p) {
  const id = p.type || 'champagne';
  return state.types.find(t => t.id === id) ||
         FALLBACK_TYPES.find(t => t.id === id) ||
         { id, name: id };
}

/* ---------- Utilitaires ---------- */
const $ = (sel) => document.querySelector(sel);

function brandById(product) {
  if (!product.brand_id) return { id: '', name: 'Sans marque' };
  return state.brands.find(b => b.id === product.brand_id) ||
         { id: '', name: 'Marque supprimée' };
}

function brandInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(w => /[A-Za-zÀ-ÿ0-9]/.test(w));
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const ICONS = {
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="1"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3z"/><path d="M20 14v3"/><path d="M14 20h3"/><path d="M20 20h1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  bottle: '<path d="M10 2h4v4l2 3v11a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V9l2-3V2Z"/><path d="M8 13h8"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v5"/><path d="M12 17h.01"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>'
};

function icon(name) {
  return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
}

function formatPrice(price) {
  if (price == null || price === '') return '—';
  return Number(price).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 });
}

function etatById(etatId) {
  return state.etats.find(e => e.id === etatId) || null;
}

function isLowStock(p) {
  return p.qty <= p.threshold;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function plural(n) {
  return n > 1 ? 's' : '';
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------- Référence aléatoire unique ---------- */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRef() {
  const existing = new Set(state.products.map(p => p.ref));
  let ref;
  do {
    const digits = String(Math.floor(Math.random() * 9000) + 1000);
    let letters = '';
    for (let i = 0; i < 4; i++) letters += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    ref = 'CH-' + digits + '-' + letters;
  } while (existing.has(ref));
  return ref;
}

/* ---------- Toast ---------- */
let toastTimer = null;
function showToast(msg, warn = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (warn ? ' warn' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
}

/* ---------- Notifications navigateur ---------- */
function initNotifications() {
  const btn = $('#btnNotify');
  if (!('Notification' in window)) {
    btn.style.display = 'none';
    return;
  }
  const refresh = () => btn.classList.toggle('active', Notification.permission === 'granted');
  refresh();
  btn.addEventListener('click', () => {
    if (Notification.permission === 'granted') {
      showToast('Notifications activées');
      return;
    }
    Notification.requestPermission().then(refresh);
  });
}

function notifyLowStock(product) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const brand = brandById(product);
  try {
    new Notification('Stock faible — ' + product.name, {
      body: 'Il ne reste que ' + product.qty + ' bouteille' + plural(product.qty) + ' (' + brand.name + ') — réf. ' + product.ref,
      icon: 'icon.svg'
    });
  } catch (e) { /* certains navigateurs mobiles bloquent */ }
}

/* =====================================================
   DONNÉES SUPABASE
   ===================================================== */

function dbBrands() { return ensureClient().from('brands'); }
function dbEtats()  { return ensureClient().from('etats'); }
function dbTypes()  { return ensureClient().from('types'); }
function dbProducts() { return ensureClient().from('products'); }

let typesMigrationWarned = false;

async function loadData() {
  const sb = ensureClient();
  if (!sb) return;
  if (flushing) return;
  if (!navigator.onLine) {
    if (restoreSnapshot()) {
      if (!offlineWarned) {
        offlineWarned = true;
        showToast('Hors ligne : données locales affichées, vos modifications seront synchronisées');
      }
    }
    updateSyncUi();
    return;
  }
  if (!flushing && readQueue().length) await flushQueue(false);
  try {
    const [br, et, pr, ty] = await Promise.all([
      dbBrands().select('*').order('name'),
      dbEtats().select('*').order('created_at'),
      dbProducts().select('*').order('created_at'),
      dbTypes().select('*').order('name')
    ]);
    if (br.error) throw br.error;
    if (et.error) throw et.error;
    if (pr.error) throw pr.error;
    state.brands = br.data;
    state.etats = et.data;
    state.products = pr.data;
    if (ty.error) {
      if (!state.types.length) state.types = FALLBACK_TYPES.slice();
      const msg = ty.error.message || '';
      const missing = ty.error.code === '42P01' || ty.error.code === 'PGRST205' ||
        /does not exist|not find the table/i.test(msg);
      if (!typesMigrationWarned && !sessionStorage.getItem('typesMigrationWarned')) {
        typesMigrationWarned = true;
        sessionStorage.setItem('typesMigrationWarned', '1');
        showToast(missing
          ? 'Table « types » absente : exécutez la migration SQL'
          : 'Types non chargés : ' + (msg || 'erreur ' + ty.error.code), true);
      }
    } else {
      state.types = ty.data;
      typesMigrationWarned = false;
      sessionStorage.removeItem('typesMigrationWarned');
    }
    saveSnapshot();
    offlineWarned = false;
    renderAll();
    showLastUpdate();
    updateSyncUi();
  } catch (e) {
    if (e && (e.status === 401 || e.status === 403)) {
      showToast('Accès refusé : votre compte n\'est pas autorisé. Contactez le propriétaire.', true);
      return;
    }
    if (isNetworkError(e) && restoreSnapshot()) {
      updateSyncUi();
      showToast('Connexion instable : données locales affichées', true);
      return;
    }
    showToast('Erreur de chargement des données', true);
  }
}

function showLastUpdate() {
  const el = $('#lastUpdate');
  if (!el) return;
  const d = new Date();
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const date = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  const text = 'Dernière mise à jour : ' + date + ' ' + time;
  try { localStorage.setItem('champagneLastUpdate', text); } catch (e) {}
  el.textContent = text;
  el.classList.remove('hidden');
}

function showLastUpdateOnAuth() {
  const el = $('#lastUpdate');
  if (!el) return;
  let stored = null;
  try { stored = localStorage.getItem('champagneLastUpdate'); } catch (e) {}
  el.textContent = stored || 'Aucune mise à jour synchronisée sur cet appareil';
  el.classList.remove('hidden');
}

let reloadTimer = null;
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(loadData, 400);
}

function setupRealtime() {
  const sb = ensureClient();
  if (!sb || realtimeChannel) return;
  try {
    realtimeChannel = sb.channel('stock-changes');
    ['brands', 'etats', 'types', 'products'].forEach(table => {
      realtimeChannel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        scheduleReload();
      });
    });
    realtimeChannel.subscribe();
  } catch (e) { /* temps réel indisponible : la reprise se fait à chaque action */ }
}

/* ---------- File d'attente hors ligne ---------- */
let storageUser = 'anon';
let flushing = false;
let offlineWarned = false;

function queueKey() { return 'champagne.queue.v1:' + storageUser; }
function snapshotKey() { return 'champagne.snapshot.v1:' + storageUser; }

function readQueue() {
  try { return JSON.parse(localStorage.getItem(queueKey()) || '[]'); } catch (e) { return []; }
}

function writeQueue(q) {
  try { localStorage.setItem(queueKey(), JSON.stringify(q)); } catch (e) {}
  updateSyncUi();
}

function queueOp(op) {
  const q = readQueue();
  q.push(Object.assign({ uid: Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }, op));
  writeQueue(q);
}

function removeQueued(uid) {
  writeQueue(readQueue().filter(op => op.uid !== uid));
}

function updateSyncUi(status) {
  const el = $('#syncStatus');
  if (!el) return;
  const n = readQueue().length;
  if (flushing) status = 'syncing';
  el.classList.remove('hidden', 'offline', 'syncing');
  if (status === 'syncing') {
    el.textContent = 'Synchronisation…';
    el.classList.add('syncing');
  } else if (!navigator.onLine) {
    el.textContent = n ? 'Hors ligne · ' + n : 'Hors ligne';
    el.classList.add('offline');
  } else if (n) {
    el.textContent = n + ' en attente';
    el.classList.add('offline');
  } else {
    el.textContent = '';
    el.classList.add('hidden');
  }
}

function isNetworkError(err) {
  if (!navigator.onLine) return true;
  const msg = (err && (err.message || err.error_description)) || '';
  return (err && err.status === 0) ||
    /failed to fetch|network ?error|network request failed|load failed|fetch failed/i.test(msg);
}

function saveSnapshot(at) {
  try {
    localStorage.setItem(snapshotKey(), JSON.stringify({
      brands: state.brands, etats: state.etats, types: state.types,
      products: state.products, at: at || Date.now()
    }));
  } catch (e) {}
}

let restoringSnapshot = false;

function restoreSnapshot() {
  try {
    const s = JSON.parse(localStorage.getItem(snapshotKey()) || 'null');
    if (!s) return false;
    state.brands = s.brands || [];
    state.etats = s.etats || [];
    state.types = s.types && s.types.length ? s.types : FALLBACK_TYPES.slice();
    state.products = s.products || [];
    restoringSnapshot = true;
    readQueue().forEach(applyOpLocal);
    restoringSnapshot = false;
    renderAll();
    saveSnapshot(s.at);
    const el = $('#lastUpdate');
    if (el) {
      const d = new Date(s.at);
      el.textContent = 'Données hors ligne · dernière synchro : ' +
        d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' +
        d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      el.classList.remove('hidden');
    }
    return true;
  } catch (e) { restoringSnapshot = false; return false; }
}

function applyLocal(table, fn) {
  const arr = state[table] || (state[table] = []);
  fn(arr);
  if (!restoringSnapshot) saveSnapshot();
  renderAll();
}

function applyOpLocal(op) {
  if (op.op === 'insert') {
    applyLocal(op.table, arr => { if (!arr.some(x => x.id === op.row.id)) arr.push(op.row); });
  } else if (op.op === 'update') {
    applyLocal(op.table, arr => {
      const r = arr.find(x => x.id === op.id);
      if (r) Object.assign(r, op.patch);
    });
  } else {
    applyLocal(op.table, arr => {
      const i = arr.findIndex(x => x.id === op.id);
      if (i >= 0) arr.splice(i, 1);
    });
  }
}

function queueLocally(op, apply) {
  queueOp(op);
  if (apply) apply();
  updateSyncUi();
  showToast('Hors ligne : enregistré, synchronisation à la reconnexion');
  return true;
}

async function runMutation(op) {
  const sb = ensureClient();
  if (op.op === 'insert') return sb.from(op.table).insert(op.row);
  if (op.op === 'update') return sb.from(op.table).update(op.patch).eq('id', op.id);
  return sb.from(op.table).delete().eq('id', op.id);
}

async function flushQueue(reload) {
  if (flushing || !navigator.onLine) return;
  const pending = readQueue();
  if (!pending.length) { updateSyncUi(); return; }
  flushing = true;
  updateSyncUi('syncing');
  let refused = 0;
  let authBlocked = false;
  for (const op of pending) {
    let error = null;
    try {
      const sb = ensureClient();
      let res;
      if (op.op === 'insert') res = await sb.from(op.table).upsert(op.row);
      else if (op.op === 'update') res = await sb.from(op.table).update(op.patch).eq('id', op.id);
      else res = await sb.from(op.table).delete().eq('id', op.id);
      error = res.error;
    } catch (e) { error = e; }
    if (!error) { removeQueued(op.uid); continue; }
    if (isNetworkError(error)) break;
    if (error.status === 401 || error.status === 403) { authBlocked = true; break; }
    refused++;
    removeQueued(op.uid);
  }
  flushing = false;
  updateSyncUi();
  if (refused) showToast(refused + ' modification(s) hors ligne refusée(s) par le serveur', true);
  if (authBlocked) showToast('Reconnectez-vous pour synchroniser les modifications en attente', true);
  if (reload !== false) await loadData();
}

async function dbWrite(op, apply) {
  if (!navigator.onLine) return queueLocally(op, apply);
  let error = null;
  try {
    const res = await runMutation(op);
    error = res.error;
  } catch (e) { error = e; }
  if (error) {
    if (isNetworkError(error)) return queueLocally(op, apply);
    showToast('Erreur : ' + (error.message || 'inconnue'), true);
    return false;
  }
  await loadData();
  return true;
}

async function dbInsert(table, row) {
  const op = { op: 'insert', table, row };
  return dbWrite(op, () => applyOpLocal(op));
}

async function dbUpdate(table, id, patch) {
  const op = { op: 'update', table, id, patch };
  return dbWrite(op, () => applyOpLocal(op));
}

async function dbDelete(table, id) {
  const op = { op: 'delete', table, id };
  return dbWrite(op, () => applyOpLocal(op));
}

/* =====================================================
   SESSION (le formulaire Connexion/Inscription est géré
   par le module inline dans index.html, qui appelle
   window.AppShowSession à chaque changement de session)
   ===================================================== */

function setAuthUi(session) {
  const logged = !!session;
  $('#authScreen').classList.toggle('hidden', logged);
  $('#appHeader').classList.toggle('hidden', !logged);
  document.querySelectorAll('nav.tab-bar, main').forEach(el => el.classList.toggle('hidden', !logged));
  const lu = $('#lastUpdate');
  if (logged) {
    lu.classList.add('hidden');
    lu.classList.remove('on-auth');
  } else {
    lu.classList.add('on-auth');
    showLastUpdateOnAuth();
  }

  if (logged) {
    const user = session.user;
    storageUser = (user && user.id) || 'anon';
    const name = (user.user_metadata && user.user_metadata.full_name) || user.email;
    $('#userEmail').textContent = name;
    $('#headerUser').classList.remove('hidden');
    updateSyncUi();
    loadData();
    setupRealtime();
    initNotifications();
  } else {
    storageUser = 'anon';
    updateSyncUi();
    $('#headerUser').classList.add('hidden');
  }
}

window.AppShowSession = setAuthUi;

function switchAuthTab(form) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.form === form));
  $('#loginForm').classList.toggle('hidden', form !== 'login');
  $('#signupForm').classList.toggle('hidden', form !== 'signup');
  $('#authError').textContent = '';
  $('#signupError').textContent = '';
  // Amener le formulaire visé à l'écran (mobile)
  const target = form === 'signup' ? $('#signupForm') : $('#loginForm');
  if (target) {
    const first = target.querySelector('input');
    if (first) first.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/* =====================================================
   RENDU
   ===================================================== */

function renderTypeTabs() {
  const bar = $('#typeTabs');
  if (!bar) return;
  if (filterType !== 'all' && !state.types.some(t => t.id === filterType)) filterType = 'all';
  let html = '<button class="brand-tab' + (filterType === 'all' ? ' active' : '') + '" data-type="all">Tous</button>';
  html += state.types.map(t => {
    const count = state.products.filter(p => (p.type || 'champagne') === t.id).length;
    return '<button class="brand-tab' + (filterType === t.id ? ' active' : '') + '" data-type="' + escapeHtml(t.id) + '">' +
           escapeHtml(t.name) + ' <span class="tab-count">' + count + '</span></button>';
  }).join('');
  bar.innerHTML = html;

  bar.querySelectorAll('.brand-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      filterType = btn.dataset.type;
      renderTypeTabs();
      renderProducts();
    });
  });
}

function renderBrandTabs() {
  const bar = $('#brandTabs');
  const unassigned = state.products.filter(p => !p.brand_id).length;
  if (filterBrand === 'none' && unassigned === 0) filterBrand = 'all';
  let html = '<button class="brand-tab' + (filterBrand === 'all' ? ' active' : '') + '" data-brand="all">Toutes</button>';
  if (unassigned > 0) {
    html += '<button class="brand-tab' + (filterBrand === 'none' ? ' active' : '') + '" data-brand="none">Sans marque <span class="tab-count">' + unassigned + '</span></button>';
  }
  html += state.brands.map(b => {
    const count = state.products.filter(p => p.brand_id === b.id).length;
    return '<button class="brand-tab' + (filterBrand === b.id ? ' active' : '') + '" data-brand="' + escapeHtml(b.id) + '">' +
           escapeHtml(b.name) + ' <span class="tab-count">' + count + '</span></button>';
  }).join('');
  bar.innerHTML = html;

  bar.querySelectorAll('.brand-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      filterBrand = btn.dataset.brand;
      renderBrandTabs();
      renderProducts();
    });
  });
}

function renderStateChips() {
  const row = $('#stateChips');
  let html = '<button class="chip' + (filterEtat === 'all' ? ' active' : '') + '" data-etat="all">Tous</button>';
  html += '<button class="chip' + (filterEtat === 'none' ? ' active' : '') + '" data-etat="none">Sans état</button>';
  html += state.etats.map(e =>
    '<button class="chip' + (filterEtat === e.id ? ' active' : '') + '" data-etat="' + escapeHtml(e.id) + '" style="--chip-color:' + escapeHtml(e.color) + '">' +
    '<span class="chip-dot" style="background:' + escapeHtml(e.color) + '"></span>' + escapeHtml(e.name) + '</button>'
  ).join('');
  row.innerHTML = html;

  row.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => {
      filterEtat = btn.dataset.etat;
      renderStateChips();
      renderProducts();
    });
  });
}

function renderProducts() {
  const list = $('#productList');
  const empty = $('#emptyState');
  const query = $('#searchInput').value.trim().toLowerCase();

  let items = state.products.slice();
  if (filterType !== 'all') items = items.filter(p => (p.type || 'champagne') === filterType);
  if (filterBrand === 'none') items = items.filter(p => !p.brand_id);
  else if (filterBrand !== 'all') items = items.filter(p => p.brand_id === filterBrand);
  if (filterEtat === 'none') items = items.filter(p => !p.etat_id);
  if (filterEtat !== 'all' && filterEtat !== 'none') items = items.filter(p => p.etat_id === filterEtat);
  if (query) {
    items = items.filter(p => {
      const b = brandById(p);
      return (p.name && p.name.toLowerCase().includes(query)) ||
             (p.ref && p.ref.toLowerCase().includes(query)) ||
             b.name.toLowerCase().includes(query);
    });
  }
  items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  empty.classList.remove('hidden');
  if (items.length === 0) {
    list.innerHTML = '';
    empty.innerHTML = (query || filterType !== 'all' || filterBrand !== 'all' || filterEtat !== 'all')
      ? '<div class="empty-icon">' + icon('search') + '</div><p>Aucun produit ne correspond à cette recherche.</p>'
      : '<div class="empty-icon">' + icon('bottle') + '</div><p>Aucun produit pour le moment.<br>Cliquez sur « Ajouter un produit » pour commencer.</p>';
    return;
  }

  empty.classList.add('hidden');
  list.innerHTML = items.map(p => productCardHtml(p)).join('');
}

function productCardHtml(p, alert) {
  const brand = brandById(p);
  const ptype = productType(p);
  const low = isLowStock(p);
  const etat = etatById(p.etat_id);
  const priceHtml = (p.price != null && p.price !== '')
    ? '<div class="card-price">' + formatPrice(p.price) + '</div>'
    : '';
  const badges = ['<span class="type-badge ' + ptype.id + '">' + escapeHtml(ptype.name) + '</span>'];
  if (etat) {
    badges.push('<span class="etat-badge" style="--etat-color:' + escapeHtml(etat.color) + '">' + escapeHtml(etat.name) + '</span>');
  }
  if (p.magnum) badges.push('<span class="magnum-badge">Magnum</span>');

  let lowText = 'Stock faible — seuil : ' + p.threshold;
  if (alert && low) {
    const missing = Math.max(0, p.threshold + 1 - p.qty);
    lowText = 'Manque ' + missing + ' bouteille' + plural(Math.max(1, missing)) + ' pour être au-dessus du seuil';
  }

  return `
  <div class="product-card${low ? ' low' : ''}" data-id="${escapeHtml(p.id)}" role="button" tabindex="0" aria-label="Ouvrir la fiche de ${escapeHtml(p.name || 'ce produit')}">
    <div class="card-head">
      <div class="card-head-main">
        <div class="product-brand">${escapeHtml(brand.name)}</div>
        <div class="product-name">${escapeHtml(p.name || '')}</div>
        <div class="card-badges">${badges.join('')}</div>
        ${priceHtml}
      </div>
      <span class="card-open" aria-hidden="true">${icon('chevron')}</span>
    </div>
    <div class="card-meta">
      <span class="ref-code">${escapeHtml(p.ref || '')}</span>
      <span class="card-stock${low ? ' low' : ''}">${p.qty} bouteille${plural(p.qty)}</span>
    </div>
    ${low ? '<div class="low-badge">' + lowText + '</div>' : ''}
  </div>`;
}

function renderBrands() {
  const list = $('#brandList');
  const unassigned = state.products.filter(p => !p.brand_id).length;
  $('#marqueCount').textContent = state.brands.length + 1;

  const sansMarque = `
    <div class="brand-item brand-item-sans">
      <div class="brand-info">
        <span class="brand-mark">SM</span>
        <div>
          <div class="brand-name">Sans marque</div>
          <div class="brand-count">${unassigned} produit${plural(unassigned)}</div>
        </div>
      </div>
    </div>`;

  list.innerHTML = sansMarque + state.brands.map(b => {
    const count = state.products.filter(p => p.brand_id === b.id).length;
    return `
    <div class="brand-item" data-id="${escapeHtml(b.id)}">
      <div class="brand-info">
        <span class="brand-mark">${escapeHtml(brandInitials(b.name))}</span>
        <div>
          <div class="brand-name">${escapeHtml(b.name)}</div>
          <div class="brand-count">${count} produit${plural(count)}</div>
        </div>
      </div>
      <div class="ref-actions">
        <button class="icon-btn" data-action="delete-brand" title="Supprimer la marque" aria-label="Supprimer la marque">${icon('trash')}</button>
      </div>
    </div>`;
  }).join('');
}

function renderEtats() {
  const list = $('#etatList');
  $('#etatCount').textContent = state.etats.length;
  list.innerHTML = state.etats.map(e => {
    const count = state.products.filter(p => p.etat_id === e.id).length;
    return `
    <div class="brand-item" data-id="${escapeHtml(e.id)}">
      <div class="brand-info">
        <span class="etat-swatch" style="background:${escapeHtml(e.color)}"></span>
        <div>
          <div class="brand-name">${escapeHtml(e.name)}</div>
          <div class="brand-count">${count} produit${plural(count)} lié${plural(count)}</div>
        </div>
      </div>
      <div class="ref-actions">
        <button class="icon-btn" data-action="edit-etat" title="Changer la couleur" aria-label="Changer la couleur">${icon('edit')}</button>
        <button class="icon-btn" data-action="delete-etat" title="Supprimer l'état" aria-label="Supprimer l'état">${icon('trash')}</button>
      </div>
    </div>`;
  }).join('');

  if (state.etats.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">' + icon('bottle') + '</div><p>Aucun état créé.</p></div>';
  }
}

function renderTypes() {
  const list = $('#typeList');
  if (!list) return;
  const countEl = $('#typeCount');
  if (countEl) countEl.textContent = state.types.length;
  list.innerHTML = state.types.map(t => {
    const count = state.products.filter(p => (p.type || 'champagne') === t.id).length;
    return `
    <div class="brand-item" data-id="${escapeHtml(t.id)}">
      <div class="brand-info">
        <span class="brand-mark">${escapeHtml(brandInitials(t.name))}</span>
        <div>
          <div class="brand-name">${escapeHtml(t.name)}</div>
          <div class="brand-count">${count} produit${plural(count)}</div>
        </div>
      </div>
      <div class="ref-actions">
        <button class="icon-btn" data-action="delete-type" title="Supprimer le type" aria-label="Supprimer le type">${icon('trash')}</button>
      </div>
    </div>`;
  }).join('');

  if (state.types.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">' + icon('bottle') + '</div><p>Aucun type créé.</p></div>';
  }
}

function renderAlerts() {
  const list = $('#alertList');
  const low = state.products.filter(isLowStock).sort((a, b) => a.qty - b.qty);
  const count = low.length;
  $('#alertCount').textContent = count || '';

  if (count === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">' + icon('check') + '</div><p>Aucun stock faible à signaler.</p></div>';
    return;
  }
  list.innerHTML = low.map(p => productCardHtml(p, true)).join('');
}

function renderAll() {
  renderTypeTabs();
  renderBrandTabs();
  renderStateChips();
  renderProducts();
  renderBrands();
  renderTypes();
  renderEtats();
  renderAlerts();
  if (viewingProductId && !editingProductId && !$('#modalProduct').classList.contains('hidden')) {
    const p = state.products.find(x => x.id === viewingProductId);
    if (p) renderFiche(p);
  }
}

/* =====================================================
   ACTIONS (quantités, produits, marques, états)
   ===================================================== */

async function changeQty(productId, delta) {
  const p = state.products.find(x => x.id === productId);
  if (!p) return;
  const wasLow = isLowStock(p);
  const newQty = Math.max(0, p.qty + delta);
  p.qty = newQty;
  renderAll();

  if (delta > 0) {
    showToast('+1 ' + p.name + ' => ' + newQty + ' bouteille' + plural(newQty));
  } else {
    showToast('-1 ' + p.name + ' => ' + newQty + ' bouteille' + plural(newQty));
  }

  if (newQty <= p.threshold && !wasLow) {
    notifyLowStock(p);
    if (delta <= 0) showToast('Stock faible : ' + p.name + ' (' + newQty + ' bouteille' + plural(newQty) + ')', true);
  }

  await dbUpdate('products', productId, { qty: newQty, updated_at: new Date().toISOString() });
}

function openProductModal(product) {
  if (!product || !$('#productView')) {
    openProductForm(product);
    return;
  }
  viewingProductId = product.id;
  editingProductId = null;
  renderFiche(product);
  $('#modalProductTitle').classList.add('hidden');
  $('#productView').classList.remove('hidden');
  $('#productForm').classList.add('hidden');

  const modal = $('#modalProduct').querySelector('.modal');
  const card = Array.prototype.find.call(
    document.querySelectorAll('.product-card'),
    el => el.dataset.id === product.id
  );
  if (modal) {
    if (card) {
      const r = card.getBoundingClientRect();
      modal.style.transformOrigin = (r.left + r.width / 2) + 'px ' + (r.top + r.height / 2) + 'px';
    } else {
      modal.style.transformOrigin = '';
    }
  }
  $('#modalProduct').classList.remove('hidden');
}

function renderFiche(product) {
  const brand = brandById(product);
  const ptype = productType(product);
  const etat = etatById(product.etat_id);
  const low = isLowStock(product);

  $('#ficheBrand').textContent = brand.name;
  $('#ficheName').textContent = product.name || '';

  const badges = ['<span class="type-badge ' + ptype.id + '">' + escapeHtml(ptype.name) + '</span>'];
  if (etat) {
    badges.push('<span class="etat-badge" style="--etat-color:' + escapeHtml(etat.color) + '">' + escapeHtml(etat.name) + '</span>');
  }
  if (product.magnum) badges.push('<span class="magnum-badge">Magnum</span>');
  $('#ficheBadges').innerHTML = badges.join('');

  $('#fichePrice').textContent = formatPrice(product.price);
  $('#ficheStock').textContent = product.qty + ' bouteille' + plural(product.qty);
  $('#ficheStock').classList.toggle('low', low);
  $('#ficheThreshold').textContent = product.threshold;
  $('#ficheRef').textContent = product.ref || '—';

  const lowEl = $('#ficheLow');
  lowEl.classList.toggle('hidden', !low);
  if (low) {
    lowEl.textContent = 'Stock faible : ' + product.qty + ' bouteille' + plural(product.qty) +
      ' — seuil ' + product.threshold;
  }

  const wrap = $('#ficheImageWrap');
  const img = $('#ficheImage');
  if (product.image_url) {
    if (img.getAttribute('src') !== product.image_url) img.src = product.image_url;
    img.alt = product.name || '';
    wrap.classList.remove('hidden');
  } else {
    wrap.classList.add('hidden');
    img.removeAttribute('src');
  }
}

function openProductForm(product) {
  editingProductId = product ? product.id : null;
  viewingProductId = product ? product.id : null;
  $('#modalProductTitle').classList.remove('hidden');
  $('#modalProductTitle').textContent = product ? 'Modifier le produit' : 'Ajouter un produit';

  $('#pName').value = product ? product.name : '';
  $('#pQty').value = product ? product.qty : 0;
  $('#pThreshold').value = product ? product.threshold : 10;
  $('#pRef').value = product ? product.ref : generateRef();
  $('#pPrice').value = product ? (product.price ?? 0) : 0;
  $('#pImageUrl').value = product ? (product.image_url || '') : '';
  const magnumEl = $('#pMagnum');
  if (magnumEl) magnumEl.checked = !!(product && product.magnum);
  $('#pRefRow').classList.remove('hidden');

  const tSel = $('#pType');
  tSel.innerHTML = state.types.length
    ? state.types.map(t => '<option value="' + escapeHtml(t.id) + '">' + escapeHtml(t.name) + '</option>').join('')
    : '<option value="">Aucun type — créez-en un</option>';
  const preferredType = product ? (product.type || 'champagne') : (state.types[0] ? state.types[0].id : '');
  tSel.value = state.types.some(t => t.id === preferredType) ? preferredType : (state.types[0] ? state.types[0].id : '');

  const bSel = $('#pBrand');
  bSel.innerHTML = '<option value="">Sans marque</option>' + state.brands.map(b =>
    '<option value="' + escapeHtml(b.id) + '">' + escapeHtml(b.name) + '</option>'
  ).join('');
  bSel.value = product ? (product.brand_id || '') : (state.brands.length ? state.brands[0].id : '');

  const eSel = $('#pEtat');
  eSel.innerHTML = '<option value="">Sans état</option>' + state.etats.map(e =>
    '<option value="' + escapeHtml(e.id) + '">' + escapeHtml(e.name) + '</option>'
  ).join('');
  eSel.value = product ? (product.etat_id || '') : '';

  const modal = $('#modalProduct').querySelector('.modal');
  if (modal) modal.style.transformOrigin = '';

  $('#productView').classList.add('hidden');
  $('#productForm').classList.remove('hidden');
  $('#modalProduct').classList.remove('hidden');
}

function cancelProductForm() {
  if (editingProductId) {
    const p = state.products.find(x => x.id === editingProductId);
    if (p) { openProductModal(p); return; }
  }
  closeProductModal();
}

function closeProductModal() {
  $('#modalProduct').classList.add('hidden');
  editingProductId = null;
  viewingProductId = null;
}

async function saveProduct() {
  const name = $('#pName').value.trim();
  const brandId = $('#pBrand').value;
  const etatId = $('#pEtat').value || null;
  const type = $('#pType').value;
  const qty = Math.max(0, parseInt($('#pQty').value, 10) || 0);
  const threshold = Math.max(0, parseInt($('#pThreshold').value, 10) || 0);
  const ref = $('#pRef').value.trim().toUpperCase();
  const price = parseFloat($('#pPrice').value) || 0;
  const imageUrl = $('#pImageUrl').value.trim();
  const magnum = $('#pMagnum') ? $('#pMagnum').checked : false;

  if (!name) { showToast('Veuillez saisir un nom de produit', true); return; }
  if (!ref) { showToast('Veuillez saisir une référence', true); return; }
  if (!type) { showToast('Créez d\'abord un type dans l\'onglet Types', true); return; }
  const refTaken = state.products.some(p => p.ref.toUpperCase() === ref && p.id !== editingProductId);
  if (refTaken) { showToast('Cette référence existe déjà', true); return; }

  const editedId = editingProductId;
  let ok = false;
  if (editedId) {
    ok = await dbUpdate('products', editedId, {
      name, type, brand_id: brandId || null, etat_id: etatId, qty, threshold, ref, price, image_url: imageUrl, magnum,
      updated_at: new Date().toISOString()
    });
    if (ok) showToast('Produit modifié');
  } else {
    ok = await dbInsert('products', {
      id: generateId(), name, type, brand_id: brandId || null, etat_id: etatId, qty, threshold, ref, price, image_url: imageUrl, magnum,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    });
    if (ok) showToast('Produit ajouté (réf. ' + ref + ')');
  }

  if (!ok) return;
  if (editedId) {
    const updated = state.products.find(x => x.id === editedId);
    if (updated) openProductModal(updated); else closeProductModal();
  } else {
    closeProductModal();
  }
}

async function deleteProduct(id) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  if (!confirm('Supprimer le produit « ' + p.name + ' » (réf. ' + p.ref + ') ?')) return;
  const ok = await dbDelete('products', id);
  if (ok) {
    closeProductModal();
    showToast('Produit supprimé');
  }
}

async function changeProductEtat(id, newEtatId) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  p.etat_id = newEtatId || null;
  renderAll();
  const e = etatById(p.etat_id);
  showToast(p.name + ' → ' + (e ? e.name : 'sans état'));
  await dbUpdate('products', id, { etat_id: p.etat_id, updated_at: new Date().toISOString() });
}

async function addBrand() {
  const input = $('#newBrandInput');
  const name = input.value.trim();
  if (!name) { showToast('Saisissez un nom de marque', true); return; }
  if (state.brands.some(b => b.name.toLowerCase() === name.toLowerCase())) {
    showToast('Cette marque existe déjà', true);
    return;
  }
  input.value = '';
  const ok = await dbInsert('brands', { id: generateId(), name, emoji: '', created_at: new Date().toISOString() });
  if (ok) showToast('Marque « ' + name + ' » ajoutée');
  renderAll();
}

async function deleteBrand(id) {
  const b = state.brands.find(x => x.id === id);
  if (!b) return;
  const linked = state.products.filter(p => p.brand_id === id).length;
  if (linked > 0) {
    showToast('Impossible : ' + linked + ' produit' + plural(linked) + ' est lié' + (linked > 1 ? 's' : '') + ' à cette marque', true);
    return;
  }
  if (!confirm('Supprimer la marque « ' + b.name + ' » ?')) return;
  await dbDelete('brands', id);
  showToast('Marque supprimée');
}

async function addType() {
  const input = $('#newTypeInput');
  const name = input.value.trim();
  if (!name) { showToast('Saisissez un nom de type', true); return; }
  if (state.types.some(t => t.name.toLowerCase() === name.toLowerCase())) {
    showToast('Ce type existe déjà', true);
    return;
  }
  input.value = '';
  const ok = await dbInsert('types', { id: generateId(), name, created_at: new Date().toISOString() });
  if (ok) showToast('Type « ' + name + ' » ajouté');
  renderAll();
}

async function deleteType(id) {
  const t = state.types.find(x => x.id === id);
  if (!t) return;
  const linked = state.products.filter(p => (p.type || 'champagne') === id).length;
  if (linked > 0) {
    showToast('Impossible : ' + linked + ' produit' + plural(linked) + ' utilise' + (linked > 1 ? 'nt' : '') + ' ce type', true);
    return;
  }
  if (state.types.length <= 1) {
    showToast('Conservez au moins un type', true);
    return;
  }
  if (!confirm('Supprimer le type « ' + t.name + ' » ?')) return;
  const ok = await dbDelete('types', id);
  if (ok) {
    if (filterType === id) filterType = 'all';
    showToast('Type supprimé');
  }
}

async function addEtat() {
  const input = $('#newEtatInput');
  const name = input.value.trim();
  if (!name) { showToast('Saisissez un nom d\'état', true); return; }
  if (state.etats.some(e => e.name.toLowerCase() === name.toLowerCase())) {
    showToast('Cet état existe déjà', true);
    return;
  }
  input.value = '';
  const color = TAG_COLORS[state.etats.length % TAG_COLORS.length];
  const ok = await dbInsert('etats', { id: generateId(), name, color });
  if (ok) showToast('État « ' + name + ' » ajouté');
  renderAll();
}

async function deleteEtat(id) {
  const e = state.etats.find(x => x.id === id);
  if (!e) return;
  const linked = state.products.filter(p => p.etat_id === id).length;
  const msg = linked > 0
    ? 'Supprimer l\'état « ' + e.name + ' » ?\n' + linked + ' produit' + plural(linked) + ' repassera' + (linked > 1 ? 'ont' : '') + ' en « sans état ».'
    : 'Supprimer l\'état « ' + e.name + ' » ?';
  if (!confirm(msg)) return;
  await dbDelete('etats', id);
  if (filterEtat === id) filterEtat = 'all';
  showToast('État supprimé');
}

async function changeEtatColor(id) {
  const e = state.etats.find(x => x.id === id);
  if (!e) return;
  const i = TAG_COLORS.indexOf(e.color);
  e.color = TAG_COLORS[(i + 1) % TAG_COLORS.length];
  renderAll();
  await dbUpdate('etats', id, { color: e.color });
}

/* =====================================================
   QR CODE
   ===================================================== */

let qrInstance = null;

function openQr(product) {
  const etat = etatById(product.etat_id);
  $('#qrTitle').textContent = 'Code QR — réf. ' + product.ref;
  $('#qrRefText').textContent = product.ref;
  const brand = brandById(product);
  $('#qrProductText').textContent = product.name +
    ' (' + brand.name + ')' + (etat ? ' — ' + etat.name : '');
  $('#modalQr').classList.remove('hidden');

  const box = $('#qrBox');
  box.innerHTML = '';
  qrInstance = new QRCode(box, {
    text: 'CHAMPAGNE:' + product.ref + '|' + product.name,
    width: 210,
    height: 210,
    correctLevel: QRCode.CorrectLevel.M
  });
}

function closeQr() {
  $('#modalQr').classList.add('hidden');
  if (qrInstance) { qrInstance.clear(); qrInstance = null; }
}

function shareQr() {
  const text = $('#qrRefText').textContent;
  const shareData = { title: 'Référence produit', text: 'CHAMPAGNE:' + text };
  if (navigator.share) {
    navigator.share(shareData).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText('CHAMPAGNE:' + text).then(() => showToast('Référence copiée'));
  }
}

/* =====================================================
   SCAN QR CODE (caméra)
   ===================================================== */

let scanStream = null;
let scanRaf = null;
let scanCanvas = null;
let scanLastTick = 0;
let scanHandled = false;
let jsqrPromise = null;

function loadJsQr() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (!jsqrPromise) {
    jsqrPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'jsqr.js';
      s.onload = () => window.jsQR ? resolve(window.jsQR) : reject(new Error('Décodeur QR indisponible'));
      s.onerror = () => reject(new Error('Chargement du décodeur QR impossible'));
      document.head.appendChild(s);
    }).catch(err => { jsqrPromise = null; throw err; });
  }
  return jsqrPromise;
}

function stopScan() {
  scanHandled = true;
  if (scanRaf) { cancelAnimationFrame(scanRaf); scanRaf = null; }
  if (scanStream) {
    scanStream.getTracks().forEach(t => t.stop());
    scanStream = null;
  }
  const video = $('#scanVideo');
  if (video) { video.pause(); video.srcObject = null; }
}

function closeScan() {
  stopScan();
  $('#modalScan').classList.add('hidden');
}

async function openScan() {
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('Le scan caméra nécessite HTTPS (ou localhost) et un navigateur récent', true);
    return;
  }
  scanHandled = false;
  scanLastTick = 0;
  $('#scanHint').textContent = 'Placez le code QR du produit dans le cadre.';
  $('#modalScan').classList.remove('hidden');

  try {
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    const video = $('#scanVideo');
    video.srcObject = scanStream;
    video.play().catch(() => {});
    const jsQR = await loadJsQr();

    scanCanvas = document.createElement('canvas');
    const ctx = scanCanvas.getContext('2d', { willReadFrequently: true });

    const tick = () => {
      if (scanHandled) return;
      const now = performance.now();
      if (now - scanLastTick >= 120) {
        scanLastTick = now;
        if (video.readyState >= video.HAVE_ENOUGH_DATA && video.videoWidth) {
          const scale = Math.min(1, 900 / Math.max(video.videoWidth, video.videoHeight));
          scanCanvas.width = Math.round(video.videoWidth * scale);
          scanCanvas.height = Math.round(video.videoHeight * scale);
          ctx.drawImage(video, 0, 0, scanCanvas.width, scanCanvas.height);
          const img = ctx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (code && code.data) {
            handleScanResult(code.data);
            return;
          }
        }
      }
      scanRaf = requestAnimationFrame(tick);
    };
    scanRaf = requestAnimationFrame(tick);
  } catch (err) {
    closeScan();
    let msg = 'Impossible d\'ouvrir la caméra.';
    if (err && err.name === 'NotAllowedError') {
      msg = 'Accès caméra refusé. Autorisez la caméra dans le navigateur.';
    } else if (err && err.name === 'NotFoundError') {
      msg = 'Aucune caméra détectée sur cet appareil.';
    } else if (err && err.message && /décodeur QR/i.test(err.message)) {
      msg = err.message;
    }
    showToast(msg, true);
  }
}

function productFromQr(text) {
  const m = /^CHAMPAGNE:([^|]+)(?:\|.*)?$/i.exec(String(text).trim());
  if (!m) return null;
  let ref = m[1];
  try { ref = decodeURIComponent(ref); } catch (e) { /* référence brute */ }
  ref = ref.trim().toUpperCase();
  return state.products.find(p => String(p.ref || '').trim().toUpperCase() === ref) || null;
}

function handleScanResult(text) {
  const payload = String(text).trim();
  const product = productFromQr(payload);
  closeScan();
  if (!product) {
    showToast(/^CHAMPAGNE:/i.test(payload)
      ? 'Code produit reconnu, mais référence introuvable'
      : 'Ce QR code n\'est pas un code produit de l\'application', true);
    return;
  }
  openProductModal(product);
  showToast('Produit trouvé : ' + product.name);
}

/* =====================================================
   ÉVÉNEMENTS
   ===================================================== */

function setupEvents() {
  // Onglets Connexion / Inscription : gérés par le module inline (index.html)

  // Onglets principaux
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      $('#tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  // Recherche
  $('#searchInput').addEventListener('input', renderProducts);

  // Scan QR
  if ($('#btnScanQr')) {
    $('#btnScanQr').addEventListener('click', openScan);
    $('#btnCancelScan').addEventListener('click', closeScan);
    $('#modalScan').addEventListener('click', e => { if (e.target === e.currentTarget) closeScan(); });
  }
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const scanModal = $('#modalScan');
    if (scanModal && !scanModal.classList.contains('hidden')) closeScan();
    else if (!$('#modalProduct').classList.contains('hidden')) closeProductModal();
  });

  // Ajout produit
  $('#btnAddProduct').addEventListener('click', () => openProductModal(null));

  // Fiche produit
  $('#btnCancelProduct').addEventListener('click', cancelProductForm);
  $('#btnSaveProduct').addEventListener('click', saveProduct);
  if ($('#productView')) {
    $('#btnEditProduct').addEventListener('click', () => {
      const p = state.products.find(x => x.id === viewingProductId);
      if (p) openProductForm(p);
    });
    $('#btnQrProduct').addEventListener('click', () => {
      const p = state.products.find(x => x.id === viewingProductId);
      if (p) openQr(p);
    });
    $('#btnCopyRef').addEventListener('click', () => {
      const p = state.products.find(x => x.id === viewingProductId);
      if (p) copyRef(p);
    });
    $('#btnDeleteProduct').addEventListener('click', () => {
      if (viewingProductId) deleteProduct(viewingProductId);
    });
    $('#btnCloseFiche').addEventListener('click', closeProductModal);
    $('#ficheImage').addEventListener('error', () => $('#ficheImageWrap').classList.add('hidden'));
  }
  $('#modalProduct').addEventListener('click', e => { if (e.target === e.currentTarget) closeProductModal(); });

  // Modal QR
  $('#btnCloseQr').addEventListener('click', closeQr);
  $('#btnShareQr').addEventListener('click', shareQr);
  $('#modalQr').addEventListener('click', e => { if (e.target === e.currentTarget) closeQr(); });

  // Marques
  $('#btnAddBrand').addEventListener('click', addBrand);
  $('#newBrandInput').addEventListener('keydown', e => { if (e.key === 'Enter') addBrand(); });

  // Types
  if ($('#btnAddType')) {
    $('#btnAddType').addEventListener('click', addType);
    $('#newTypeInput').addEventListener('keydown', e => { if (e.key === 'Enter') addType(); });
  }

  // États
  $('#btnAddEtat').addEventListener('click', addEtat);
  $('#newEtatInput').addEventListener('keydown', e => { if (e.key === 'Enter') addEtat(); });

  // Cartes produits / alertes : ouverture de la fiche
  ['#productList', '#alertList'].forEach(sel => {
    const openFromCard = target => {
      const card = target.closest('.product-card');
      if (!card || !card.dataset.id) return;
      const p = state.products.find(x => x.id === card.dataset.id);
      if (p) openProductModal(p);
    };

    document.querySelector(sel).addEventListener('click', e => openFromCard(e.target));
    document.querySelector(sel).addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      openFromCard(e.target);
    });
  });

  // Liste marques
  $('#brandList').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const item = e.target.closest('.brand-item');
    const id = item ? item.dataset.id : null;
    if (!id) return;
    if (btn.dataset.action === 'delete-brand') deleteBrand(id);
  });

  // Liste types
  if ($('#typeList')) {
    $('#typeList').addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const item = e.target.closest('.brand-item');
      const id = item ? item.dataset.id : null;
      if (!id) return;
      if (btn.dataset.action === 'delete-type') deleteType(id);
    });
  }

  // Liste états
  $('#etatList').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const item = e.target.closest('.brand-item');
    const id = item ? item.dataset.id : null;
    if (!id) return;
    if (btn.dataset.action === 'delete-etat') deleteEtat(id);
    if (btn.dataset.action === 'edit-etat') changeEtatColor(id);
  });
}

function copyRef(p) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(p.ref).then(() => showToast('Référence ' + p.ref + ' copiée'));
  } else {
    showToast(p.ref);
  }
}

/* =====================================================
   INITIALISATION
   ===================================================== */

function init() {
  setupEvents();

  window.addEventListener('online', () => { updateSyncUi(); flushQueue(); });
  window.addEventListener('offline', () => { updateSyncUi(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) flushQueue(); });
  window.addEventListener('focus', () => flushQueue());
  setInterval(() => { if (navigator.onLine) flushQueue(); }, 25000);
  updateSyncUi();

  // Session éventuelle récupérée par le module inline avant notre chargement
  if (window.__pendingSession) {
    const s = window.__pendingSession;
    window.__pendingSession = null;
    setAuthUi(s);
  }
}

document.addEventListener('DOMContentLoaded', init);