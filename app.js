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
  products: []
};

let editingProductId = null;
let realtimeChannel = null;

const TAG_COLORS = ['#2980b9', '#e67e22', '#27ae60', '#8e44ad', '#c0392b', '#16a085', '#d35400', '#7f8c8d'];

/* ---------- Filtres courants ---------- */
let filterBrand = 'all';
let filterEtat = 'all';

/* ---------- Utilitaires ---------- */
const $ = (sel) => document.querySelector(sel);

function brandById(product) {
  return state.brands.find(b => b.id === product.brand_id) ||
         { id: '', name: 'Marque supprimée', emoji: '\uD83C\uDF7E' };
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
      showToast('Notifications activées \u2705');
      return;
    }
    Notification.requestPermission().then(refresh);
  });
}

function notifyLowStock(product) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const brand = brandById(product);
  try {
    new Notification('\u26A0 Stock faible — ' + product.name, {
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
function dbProducts() { return ensureClient().from('products'); }

async function loadData() {
  const sb = ensureClient();
  if (!sb) return;
  try {
    const [br, et, pr] = await Promise.all([
      dbBrands().select('*').order('name'),
      dbEtats().select('*').order('created_at'),
      dbProducts().select('*').order('created_at')
    ]);
    if (br.error) throw br.error;
    if (et.error) throw et.error;
    if (pr.error) throw pr.error;
    state.brands = br.data;
    state.etats = et.data;
    state.products = pr.data;
    renderAll();
    showLastUpdate();
  } catch (e) {
    if (e && (e.status === 401 || e.status === 403)) return;
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
    ['brands', 'etats', 'products'].forEach(table => {
      realtimeChannel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        scheduleReload();
      });
    });
    realtimeChannel.subscribe();
  } catch (e) { /* temps réel indisponible : la reprise se fait à chaque action */ }
}

async function dbInsert(table, row) {
  const { error } = await ensureClient().from(table).insert(row);
  if (error) { showToast('Erreur : ' + error.message, true); return false; }
  await loadData();
  return true;
}

async function dbUpdate(table, id, patch) {
  const { error } = await ensureClient().from(table).update(patch).eq('id', id);
  if (error) { showToast('Erreur : ' + error.message, true); return false; }
  await loadData();
  return true;
}

async function dbDelete(table, id) {
  const { error } = await ensureClient().from(table).delete().eq('id', id);
  if (error) { showToast('Erreur : ' + error.message, true); return false; }
  await loadData();
  return true;
}

/* =====================================================
   SESSION (le formulaire Connexion/Inscription est géré
   par le module inline dans index.html, qui appelle
   window.AppShowSession à chaque changement de session)
   ===================================================== */

function setAuthUi(session) {
  const logged = !!session;
  console.log('[ui] setAuthUi session:', logged);
  $('#authScreen').classList.toggle('hidden', logged);
  $('#appHeader').classList.toggle('hidden', !logged);
  document.querySelectorAll('nav.tab-bar, main').forEach(el => el.classList.toggle('hidden', !logged));
  console.log('[ui] écran connexion masqué :', document.getElementById('authScreen').classList.contains('hidden'));
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
    const name = (user.user_metadata && user.user_metadata.full_name) || user.email;
    $('#userEmail').textContent = name;
    $('#headerUser').classList.remove('hidden');
    loadData();
    setupRealtime();
    initNotifications();
  } else {
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

function renderBrandTabs() {
  const bar = $('#brandTabs');
  let html = '<button class="brand-tab' + (filterBrand === 'all' ? ' active' : '') + '" data-brand="all">Toutes</button>';
  html += state.brands.map(b => {
    const count = state.products.filter(p => p.brand_id === b.id).length;
    return '<button class="brand-tab' + (filterBrand === b.id ? ' active' : '') + '" data-brand="' + b.id + '">' +
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
    '<button class="chip' + (filterEtat === e.id ? ' active' : '') + '" data-etat="' + e.id + '" style="--chip-color:' + e.color + '">' +
    '<span class="chip-dot" style="background:' + e.color + '"></span>' + escapeHtml(e.name) + '</button>'
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
  if (filterBrand !== 'all') items = items.filter(p => p.brand_id === filterBrand);
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
    empty.innerHTML = (query || filterBrand !== 'all' || filterEtat !== 'all')
      ? '<div class="empty-icon">&#128269;</div><p>Aucun produit ne correspond à cette recherche.</p>'
      : '<div class="empty-icon">&#127864;</div><p>Aucun produit pour le moment.<br>Cliquez sur « Ajouter un produit » pour commencer.</p>';
    return;
  }

  empty.classList.add('hidden');
  list.innerHTML = items.map(productCardHtml).join('');
}

function productCardHtml(p) {
  const brand = brandById(p);
  const low = isLowStock(p);
  const currentEtat = etatById(p.etat_id);
  const etatOptions = ['<option value="">Sans état</option>'].concat(
    state.etats.map(e => '<option value="' + e.id + '"' + (p.etat_id === e.id ? ' selected' : '') + '>' + escapeHtml(e.name) + '</option>')
  );
  return `
  <div class="product-card${low ? ' low' : ''}" data-id="${p.id}">
    <div class="card-head">
      <div>
        <div class="product-name">${brand.emoji} ${escapeHtml(p.name || '')}</div>
        <div class="product-brand">Marque : ${escapeHtml(brand.name)}</div>
      </div>
      <div class="ref-actions">
        <button class="icon-btn" data-action="edit" title="Modifier">&#9998;</button>
        <button class="icon-btn" data-action="delete" title="Supprimer">&#128465;</button>
      </div>
    </div>
    <div class="ref-row">
      <span class="ref-code">${escapeHtml(p.ref || '')}</span>
      <button class="icon-btn" data-action="copy" title="Copier la référence">&#128203;</button>
      <button class="icon-btn" data-action="qr" title="Afficher le code QR">&#128310;</button>
    </div>
    <div class="etat-row">
      <select class="etat-select" data-action="change-etat" style="--etat-color:${currentEtat ? currentEtat.color : '#9b9380'}">
        ${etatOptions.join('')}
      </select>
    </div>
    <div class="qty-row">
      <div class="qty-controls">
        <button class="qty-btn qty-add" data-action="add" title="Rajouter 1 bouteille">+</button>
        <span class="qty-val ${low ? 'low' : ''}">${p.qty}</span>
        <button class="qty-btn qty-sub" data-action="sub" title="Retirer 1 bouteille">&#8722;</button>
      </div>
      <span class="qty-units">bouteille${plural(p.qty)}<br><small>seuil : ${p.threshold}</small></span>
    </div>
    ${low ? '<div class="low-badge">&#9888; Stock faible — seuil : ' + p.threshold + '</div>' : ''}
  </div>`;
}

function renderBrands() {
  const list = $('#brandList');
  $('#marqueCount').textContent = state.brands.length;
  list.innerHTML = state.brands.map(b => {
    const count = state.products.filter(p => p.brand_id === b.id).length;
    return `
    <div class="brand-item" data-id="${b.id}">
      <div class="brand-info">
        <span class="brand-emoji">${b.emoji}</span>
        <div>
          <div class="brand-name">${escapeHtml(b.name)}</div>
          <div class="brand-count">${count} produit${plural(count)}</div>
        </div>
      </div>
      <div class="ref-actions">
        <button class="icon-btn" data-action="edit-brand" title="Changer l'emoji">&#127912;</button>
        <button class="icon-btn" data-action="delete-brand" title="Supprimer la marque">&#128465;</button>
      </div>
    </div>`;
  }).join('');

  if (state.brands.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">&#127868;</div><p>Aucune marque.</p></div>';
  }
}

function renderEtats() {
  const list = $('#etatList');
  $('#etatCount').textContent = state.etats.length;
  list.innerHTML = state.etats.map(e => {
    const count = state.products.filter(p => p.etat_id === e.id).length;
    return `
    <div class="brand-item" data-id="${e.id}">
      <div class="brand-info">
        <span class="etat-swatch" style="background:${e.color}"></span>
        <div>
          <div class="brand-name">${escapeHtml(e.name)}</div>
          <div class="brand-count">${count} produit${plural(count)} lié${plural(count)}</div>
        </div>
      </div>
      <div class="ref-actions">
        <button class="icon-btn" data-action="edit-etat" title="Changer la couleur">&#127912;</button>
        <button class="icon-btn" data-action="delete-etat" title="Supprimer l'état">&#128465;</button>
      </div>
    </div>`;
  }).join('');

  if (state.etats.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">&#127991;</div><p>Aucun état créé.</p></div>';
  }
}

function renderAlerts() {
  const list = $('#alertList');
  const low = state.products.filter(isLowStock).sort((a, b) => a.qty - b.qty);
  const count = low.length;
  $('#alertCount').textContent = count || '';

  if (count === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">&#9989;</div><p>Aucun stock faible à signaler.</p></div>';
    return;
  }
  list.innerHTML = low.map(p => {
    const brand = brandById(p);
    const etat = etatById(p.etat_id);
    const etatHtml = etat ? '<span class="etat-badge" style="background:' + etat.color + '">' + escapeHtml(etat.name) + '</span> ' : '';
    return `
    <div class="product-card low" data-id="${p.id}">
      <div class="card-head">
        <div>
          <div class="product-name">${brand.emoji} ${escapeHtml(p.name || '')}</div>
          <div class="product-brand">Marque : ${escapeHtml(brand.name)} — réf. ${escapeHtml(p.ref || '')}</div>
        </div>
        <div class="ref-actions">
          <button class="icon-btn" data-action="qr" title="Code QR">&#128310;</button>
        </div>
      </div>
      <div class="etat-row">${etatHtml}</div>
      <div class="qty-row">
        <div class="qty-controls">
          <button class="qty-btn qty-add" data-action="add">+</button>
          <span class="qty-val low">${p.qty}</span>
          <button class="qty-btn qty-sub" data-action="sub">&#8722;</button>
        </div>
        <span class="qty-units">bouteille${plural(p.qty)} <small>(seuil : ${p.threshold})</small></span>
      </div>
      <div class="low-badge">&#9888; Manque ${Math.max(0, p.threshold + 1 - p.qty)} bouteille${plural(Math.max(1, p.threshold + 1 - p.qty))} pour être au-dessus du seuil</div>
    </div>`;
  }).join('');
}

function renderAll() {
  renderBrandTabs();
  renderStateChips();
  renderProducts();
  renderBrands();
  renderEtats();
  renderAlerts();
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
    if (delta <= 0) showToast('\u26A0 Stock faible : ' + p.name + ' (' + newQty + ' bouteille' + plural(newQty) + ')', true);
  }

  await dbUpdate('products', productId, { qty: newQty, updated_at: new Date().toISOString() });
}

function openProductModal(product) {
  editingProductId = product ? product.id : null;
  $('#modalProductTitle').textContent = product ? 'Modifier le produit' : 'Ajouter un produit';

  $('#pName').value = product ? product.name : '';
  $('#pQty').value = product ? product.qty : 0;
  $('#pThreshold').value = product ? product.threshold : 10;
  $('#pRef').value = product ? product.ref : generateRef();
  $('#pRefRow').classList.remove('hidden');

  const bSel = $('#pBrand');
  bSel.innerHTML = state.brands.map(b =>
    '<option value="' + b.id + '">' + escapeHtml(b.name) + '</option>'
  ).join('');
  bSel.value = (product ? product.brand_id : '') || (state.brands.length ? state.brands[0].id : '');

  const eSel = $('#pEtat');
  eSel.innerHTML = '<option value="">Sans état</option>' + state.etats.map(e =>
    '<option value="' + e.id + '">' + escapeHtml(e.name) + '</option>'
  ).join('');
  eSel.value = product ? (product.etat_id || '') : '';

  $('#modalProduct').classList.remove('hidden');
}

function closeProductModal() {
  $('#modalProduct').classList.add('hidden');
  editingProductId = null;
}

async function saveProduct() {
  const name = $('#pName').value.trim();
  const brandId = $('#pBrand').value;
  const etatId = $('#pEtat').value || null;
  const qty = Math.max(0, parseInt($('#pQty').value, 10) || 0);
  const threshold = Math.max(0, parseInt($('#pThreshold').value, 10) || 0);
  const ref = $('#pRef').value.trim().toUpperCase();

  if (!name) { showToast('Veuillez saisir un nom de produit', true); return; }
  if (!brandId) {
    showToast('Aucune marque disponible — ajoutez-en une dans l\'onglet Marques', true);
    return;
  }
  if (!ref) { showToast('Veuillez saisir une référence', true); return; }
  const refTaken = state.products.some(p => p.ref.toUpperCase() === ref && p.id !== editingProductId);
  if (refTaken) { showToast('Cette référence existe déjà', true); return; }

  let ok = false;
  if (editingProductId) {
    ok = await dbUpdate('products', editingProductId, {
      name, brand_id: brandId, etat_id: etatId, qty, threshold, ref,
      updated_at: new Date().toISOString()
    });
    if (ok) showToast('Produit modifié \u2705');
  } else {
    ok = await dbInsert('products', {
      id: generateId(), name, brand_id: brandId, etat_id: etatId, qty, threshold, ref,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    });
    if (ok) showToast('Produit ajouté \u2705 (réf. ' + ref + ')');
  }

  if (ok) { closeProductModal(); renderAll(); }
}

async function deleteProduct(id) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  if (!confirm('Supprimer le produit « ' + p.name + ' » (réf. ' + p.ref + ') ?')) return;
  await dbDelete('products', id);
  showToast('Produit supprimé');
}

async function changeProductEtat(id, newEtatId) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  p.etat_id = newEtatId || null;
  renderAll();
  const e = etatById(p.etat_id);
  showToast(p.name + ' → ' + (e ? e.name : 'sans état') + ' \u2705');
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
  const ok = await dbInsert('brands', { id: generateId(), name, emoji: '\uD83C\uDF87', created_at: new Date().toISOString() });
  if (ok) showToast('Marque « ' + name + ' » ajoutée \u2705');
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

async function changeBrandEmoji(id) {
  const b = state.brands.find(x => x.id === id);
  if (!b) return;
  const emojis = ['\uD83C\uDF87', '\uD83E\uDDEC', '\uD83C\uDF7B', '\uD83E\uDD43', '\uD83C\uDF77', '\uD83C\uDF78', '\uD83E\uDDEE', '\uD83C\uDF79', '\uD83C\uDF45'];
  const current = emojis.indexOf(b.emoji);
  b.emoji = emojis[(current + 1) % emojis.length];
  renderAll();
  await dbUpdate('brands', id, { emoji: b.emoji });
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
  if (ok) showToast('État « ' + name + ' » ajouté \u2705');
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
  $('#qrProductText').textContent = brand.emoji + ' ' + product.name +
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
    navigator.clipboard.writeText('CHAMPAGNE:' + text).then(() => showToast('Référence copiée \u2705'));
  }
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

  // Ajout produit
  $('#btnAddProduct').addEventListener('click', () => openProductModal(null));

  // Modal produit
  $('#btnCancelProduct').addEventListener('click', closeProductModal);
  $('#btnSaveProduct').addEventListener('click', saveProduct);
  $('#modalProduct').addEventListener('click', e => { if (e.target === e.currentTarget) closeProductModal(); });

  // Modal QR
  $('#btnCloseQr').addEventListener('click', closeQr);
  $('#btnShareQr').addEventListener('click', shareQr);
  $('#modalQr').addEventListener('click', e => { if (e.target === e.currentTarget) closeQr(); });

  // Marques
  $('#btnAddBrand').addEventListener('click', addBrand);
  $('#newBrandInput').addEventListener('keydown', e => { if (e.key === 'Enter') addBrand(); });

  // États
  $('#btnAddEtat').addEventListener('click', addEtat);
  $('#newEtatInput').addEventListener('keydown', e => { if (e.key === 'Enter') addEtat(); });

  // Délégation : listes produits / alertes
  ['#productList', '#alertList'].forEach(sel => {
    document.querySelector(sel).addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const card = e.target.closest('.product-card');
      const id = card ? card.dataset.id : null;
      const p = id ? state.products.find(x => x.id === id) : null;
      if (!p) return;
      switch (btn.dataset.action) {
        case 'add': changeQty(id, +1); break;
        case 'sub': changeQty(id, -1); break;
        case 'edit': openProductModal(p); break;
        case 'delete': deleteProduct(id); break;
        case 'copy': copyRef(p); break;
        case 'qr': openQr(p); break;
      }
    });

    // Changement rapide d'état via le sélecteur de la carte
    document.querySelector(sel).addEventListener('change', e => {
      const selEl = e.target.closest('[data-action="change-etat"]');
      if (!selEl) return;
      const card = e.target.closest('.product-card');
      const id = card ? card.dataset.id : null;
      if (!id) return;
      changeProductEtat(id, selEl.value || null);
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
    if (btn.dataset.action === 'edit-brand') changeBrandEmoji(id);
  });

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
    navigator.clipboard.writeText(p.ref).then(() => showToast('Référence ' + p.ref + ' copiée \u2703'));
  } else {
    showToast(p.ref);
  }
}

/* =====================================================
   INITIALISATION
   ===================================================== */

function init() {
  setupEvents();
  // Session éventuelle récupérée par le module inline avant notre chargement
  if (window.__pendingSession) {
    const s = window.__pendingSession;
    window.__pendingSession = null;
    setAuthUi(s);
  }
}

document.addEventListener('DOMContentLoaded', init);