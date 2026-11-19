// DeskSync popup UI.
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const state = { notes: [], later: [], clips: [], vault: [], trash: [], vaultKey: null, editing: null, editingVault: null, tabOrigin: null };

// ---------- Utils ----------
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 1800);
}
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k);
  return e;
}
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'i');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}
function ago(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago';
}
async function copy(text, label = 'Copied') {
  await navigator.clipboard.writeText(text); toast(label);
}
function safe(fn) {
  return async (...a) => { try { await fn(...a); } catch (e) { console.error(e); toast(e.message || 'Something went wrong'); } };
}
// Allow only basic formatting tags in note HTML; strip all attributes except highlight colour.
const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'UL', 'OL', 'LI', 'BR', 'DIV', 'P', 'SPAN']);
function sanitize(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const walk = (node) => {
    for (const child of [...node.children]) {
      if (/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|TEMPLATE|SVG|MATH)$/i.test(child.tagName)) { child.remove(); continue; }
      walk(child);   // clean descendants first, so unwrapped children are already safe
      if (!ALLOWED.has(child.tagName)) { child.replaceWith(...child.childNodes); continue; }
      const bg = child.style?.backgroundColor;
      for (const a of [...child.attributes]) child.removeAttribute(a.name);
      if (bg && /^(rgb|#)[\d\s,a-f#()]+$/i.test(bg)) child.style.backgroundColor = bg;
    }
  };
  const root = doc.body.firstChild; walk(root);
  return root.innerHTML;
}
const textOf = (html) => new DOMParser().parseFromString(html, 'text/html').body.textContent || '';
const empty = (msg) => el('li', { class: 'empty' }, msg);
function dayLabel(iso) {
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((day(new Date()) - day(new Date(iso))) / 864e5);
  return diff <= 0 ? 'Today' : diff === 1 ? 'Yesterday' : 'Earlier';
}
// Renders rows under section headings. With `featured`, the first row is the pink card and has no heading.
function fillList(list, items, featured, sectionOf, row) {
  let last = null;
  items.forEach((item, i) => {
    const isFeature = featured && i === 0;
    if (!isFeature && sectionOf(item) !== last) {
      last = sectionOf(item);
      list.append(el('li', { class: 'section' }, last));
    }
    list.append(row(item, isFeature));
  });
}
// A header button that stays on or off, then re-renders.
function toggleButton(sel, render) {
  $(sel).addEventListener('click', () => {
    const on = $(sel).classList.toggle('on');
    $(sel).setAttribute('aria-pressed', on);
    render();
  });
}
const isOn = (sel) => $(sel).classList.contains('on');

// ---------- Auth ----------
// The source folder ships with placeholders; `make ext` fills them in for dist/extension.
const isConfigured = !DESKSYNC_CONFIG.SUPABASE_URL.includes('YOUR-PROJECT');

async function boot() {
  const user = await currentUser();
  $('#auth').classList.toggle('hidden', !!user);
  $('#app').classList.toggle('hidden', !user);
  if (!isConfigured) $('#auth-msg').textContent = 'Not configured: run make ext, then load dist/extension.';
  if (!user) return;
  $('#me').textContent = user.email;
  // Drops a previous account's cached rows and queued writes before showing anything.
  await cache.claim(user.id);
  const { lastTab } = await chrome.storage.local.get('lastTab');
  showTab(lastTab || 'notes');
  loadNotes(); loadLater(); loadClips(); loadSettings();
  subscribeRealtime(user.id);
  updateOfflineBar();
  syncNow();
}

// ---------- Offline ----------
// The strip under the header is the only place offline state is announced; writes
// themselves don't fail, they queue (see lib/client.js).
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function updateOfflineBar() {
  const pending = await outbox.count();
  const bar = $('#offline-bar');
  bar.classList.toggle('hidden', navigator.onLine && !pending);
  bar.textContent = !navigator.onLine
    ? (pending ? `Offline — ${plural(pending, 'change')} saved here, will sync later` : 'Offline — showing saved data')
    : `Syncing ${plural(pending, 'change')}…`;
}

const syncNow = safe(async () => {
  const { synced } = await outbox.flush();
  await updateOfflineBar();
  if (!synced) return;
  loadNotes(); loadLater(); loadClips();
  if (state.vaultKey) loadVault();
});

window.addEventListener('online', () => { updateOfflineBar(); syncNow(); });
window.addEventListener('offline', updateOfflineBar);
// Writes from the service worker (saved tabs, captured clips) queue too, so watch the outbox itself.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[OUTBOX_KEY]) updateOfflineBar();
});

$('#auth-form').addEventListener('submit', safe(async (e) => {
  e.preventDefault();
  if (!isConfigured) return;
  const mode = e.submitter?.dataset.mode;
  const email = $('#auth-email').value.trim(), password = $('#auth-pass').value;
  $('#auth-msg').textContent = '';
  const { data, error } = mode === 'signup'
    ? await sb.auth.signUp({ email, password })
    : await sb.auth.signInWithPassword({ email, password });
  if (error) { $('#auth-msg').textContent = error.message; return; }
  if (mode === 'signup' && !data.session) { $('#auth-msg').textContent = 'Check your email to confirm, then sign in.'; return; }
  boot();
}));

// Signing out clears the local cache and the outbox, so unsynced changes are lost.
// When there are any, the button says so and asks a second time.
$('#signout').addEventListener('click', safe(async () => {
  const b = $('#signout');
  const pending = await outbox.count();
  if (pending && !b.dataset.armed) {
    b.dataset.armed = '1';
    b.replaceChildren(icon('exit'), `${plural(pending, 'change')} not synced — sign out anyway?`);
    clearTimeout(b._t);
    b._t = setTimeout(() => { b.dataset.armed = ''; b.replaceChildren(icon('exit'), 'Sign out'); }, 5000);
    return;
  }
  await vaultCrypto.lock();
  await cache.clear();
  await sb.auth.signOut();
  location.reload();
}));

// ---------- Tabs ----------
const TAB_TITLES = { notes: 'Notes', later: 'Read later', clips: 'Clipboard', vault: 'Vault', settings: 'Settings' };

function showTab(name) {
  if (state.tab && state.tab !== 'settings') state.prevTab = state.tab;
  state.tab = name;
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.sheet > .tab').forEach((t) => t.classList.toggle('hidden', t.id !== 'tab-' + name));
  $$('[data-for]').forEach((e) => e.classList.toggle('hidden', e.dataset.for !== name));
  $('#tab-title').textContent = TAB_TITLES[name];
  // On Settings, the gear becomes the way back.
  const onSettings = name === 'settings';
  const nav = $('#nav-settings');
  nav.querySelector('use').setAttribute('href', onSettings ? '#i-back' : '#i-gear');
  nav.title = onSettings ? 'Back' : 'Settings';
  nav.setAttribute('aria-label', nav.title);
  chrome.storage.local.set({ lastTab: name });
  if (name === 'vault') openVault();
}
$$('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
$('#nav-settings').addEventListener('click', () => showTab(state.tab === 'settings' ? state.prevTab || 'notes' : 'settings'));

// ---------- Realtime: refresh when another profile / the phone changes data ----------
function subscribeRealtime(uid) {
  const reload = { notes: loadNotes, read_later: loadLater, clips: loadClips, vault_items: () => state.vaultKey && loadVault() };
  const ch = sb.channel('desksync');
  for (const table of Object.keys(reload)) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `user_id=eq.${uid}` }, () => reload[table]());
  }
  ch.subscribe();
}

// ---------- Notes ----------
const loadNotes = safe(async () => { state.notes = await db.list('notes'); renderNotes(); });

function renderNotes() {
  const q = $('#notes-search').value.trim().toLowerCase();
  const pinnedOnly = isOn('#notes-pinned');
  const items = state.notes
    .filter((n) => !pinnedOnly || n.pinned)
    .filter((n) => !q || (q.startsWith('#') ? n.tags.some((t) => t.toLowerCase() === q.slice(1))
      : (n.title + ' ' + textOf(n.body) + ' ' + n.tags.join(' ')).toLowerCase().includes(q)))
    .sort((a, b) => (b.pinned - a.pinned) || (new Date(b.updated_at) - new Date(a.updated_at)));
  renderTagBar(q);
  const list = $('#notes-list'); list.replaceChildren();
  if (!items.length) return list.append(empty(q ? 'No matching notes' : pinnedOnly ? 'No pinned notes' : 'No notes yet — click New note'));
  fillList(list, items, !q && !pinnedOnly, (n) => (n.pinned ? 'Pinned' : dayLabel(n.updated_at)), noteRow);
}
function noteRow(n, isFeature) {
  const text = textOf(n.body).slice(0, 200);
  const when = ago(n.updated_at);
  return el('li', { class: isFeature ? 'feature' : '', onclick: () => editNote(n) },
    el('div', { class: 'tile c-' + n.color }, icon('note')),
    el('div', { class: 'main' },
      el('div', { class: 't' }, n.title || 'Untitled'),
      isFeature ? [el('div', { class: 's' }, text), el('div', { class: 'meta' }, `${n.pinned ? 'Pinned' : 'Latest'} · ${when}`)]
        : el('div', { class: 's' }, text ? `${when} · ${text}` : when)),
    n.tags.length ? el('span', { class: 'chip', title: n.tags.map((t) => '#' + t).join(' ') },
      '#' + n.tags[0] + (n.tags.length > 1 ? ` +${n.tags.length - 1}` : '')) : null,
    el('div', { class: 'acts' },
      el('button', { class: n.pinned ? 'on' : '', title: n.pinned ? 'Unpin' : 'Pin', 'aria-label': n.pinned ? 'Unpin' : 'Pin', onclick: safe(async (e) => { e.stopPropagation();
        await db.update('notes', n.id, { pinned: !n.pinned }); loadNotes(); }) }, icon('pin'))));
}
function renderTagBar(q) {
  const tags = [...new Set(state.notes.flatMap((n) => n.tags))].sort((a, b) => a.localeCompare(b));
  $('#notes-tagbar').replaceChildren(...(tags.length ? tags.map((t) => {
    const active = q === '#' + t.toLowerCase();
    return el('button', { class: 'chip' + (active ? ' on' : ''), onclick: () => {
      $('#notes-search').value = active ? '' : '#' + t; renderNotes();
    } }, '#' + t);
  }) : [el('span', { class: 'muted small' }, 'No tags yet')]));
}
$('#notes-search').addEventListener('input', renderNotes);
toggleButton('#notes-pinned', renderNotes);
$('#notes-filter').addEventListener('click', () => {
  const open = $('#notes-tagbar').classList.toggle('hidden') === false;
  $('#notes-filter').setAttribute('aria-expanded', open);
});

function editNote(n) {
  state.editing = n || null;
  $('#note-heading').textContent = n ? 'Edit note' : 'New note';
  $('#note-title').value = n?.title || '';
  $('#note-body').innerHTML = sanitize(n?.body || '');
  $('#note-color').value = n?.color || 'yellow';
  $('#note-tags').value = (n?.tags || []).join(', ');
  $('#note-delete').classList.toggle('hidden', !n);
  $('#note-editor').classList.remove('hidden');
  $('#note-body').focus();
}
$('#note-new').addEventListener('click', () => editNote(null));
$('#note-cancel').addEventListener('click', () => $('#note-editor').classList.add('hidden'));
$$('.fmt button').forEach((b) => b.addEventListener('mousedown', (e) => {
  e.preventDefault(); document.execCommand(b.dataset.cmd, false, b.dataset.val || null);
}));

$('#note-save').addEventListener('click', safe(async () => {
  const row = {
    title: $('#note-title').value.trim(),
    body: sanitize($('#note-body').innerHTML),
    color: $('#note-color').value,
    tags: $('#note-tags').value.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean)
  };
  if (state.editing) await db.update('notes', state.editing.id, row); else await db.insert('notes', row);
  $('#note-editor').classList.add('hidden'); toast('Saved'); loadNotes();
}));
$('#note-delete').addEventListener('click', safe(async () => {
  if (!state.editing) return;
  await db.remove('notes', state.editing.id); $('#note-editor').classList.add('hidden'); toast('Deleted'); loadNotes();
}));

// ---------- Read later ----------
const loadLater = safe(async () => { state.later = await db.list('read_later', { order: 'created_at' }); renderLater(); });

function renderLater() {
  const showRead = isOn('#later-show-read');
  const items = state.later.filter((r) => showRead || !r.is_read);
  const list = $('#later-list'); list.replaceChildren();
  if (!items.length) return list.append(empty('Nothing saved — press Alt+Shift+S on any page'));
  fillList(list, items, !items[0].is_read, (r) => dayLabel(r.created_at), laterRow);
}
function laterRow(r, isFeature) {
  let host = ''; try { host = new URL(r.url).hostname; } catch {}
  const when = ago(r.created_at);
  return el('li', { class: [r.is_read ? 'read' : '', isFeature ? 'feature' : ''].join(' ').trim(), onclick: safe(async () => {
      if (!/^https?:/i.test(r.url)) return toast('Blocked unsafe link');
      // Opening a tab closes the popup, so mark it read first. A failed update shouldn't block reading.
      if (!r.is_read) await db.update('read_later', r.id, { is_read: true }).catch(console.error);
      chrome.tabs.create({ url: r.url });
    }) },
    el('div', { class: 'tile plain', title: r.source === 'android' ? 'Saved from your phone' : 'Saved from a browser' },
      r.favicon && /^https:/.test(r.favicon) ? el('img', { src: r.favicon, alt: '' }) : icon(r.source === 'android' ? 'phone' : 'globe')),
    el('div', { class: 'main' }, el('div', { class: 't' }, r.title || r.url),
      isFeature ? [el('div', { class: 's' }, host), el('div', { class: 'meta' }, `Up next · ${when}`)]
        : el('div', { class: 's' }, `${host} · ${when}`)),
    el('div', { class: 'acts' },
      el('button', { title: r.is_read ? 'Mark unread' : 'Mark read', 'aria-label': r.is_read ? 'Mark unread' : 'Mark read', onclick: safe(async (e) => { e.stopPropagation();
        await db.update('read_later', r.id, { is_read: !r.is_read }); loadLater(); }) }, icon(r.is_read ? 'undo' : 'check')),
      el('button', { class: 'del', title: 'Delete', 'aria-label': 'Delete', onclick: safe(async (e) => { e.stopPropagation();
        await db.remove('read_later', r.id); loadLater(); }) }, icon('trash'))));
}
toggleButton('#later-show-read', renderLater);

$('#later-save').addEventListener('click', safe(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!/^https?:/.test(tab?.url || '')) return toast("Can't save this page");
  await db.insert('read_later', { url: tab.url, title: tab.title, favicon: tab.favIconUrl || null });
  toast('Saved to Read later'); loadLater();
}));
$('#later-save-all').addEventListener('click', safe(async () => {
  const tabs = (await chrome.tabs.query({ currentWindow: true })).filter((t) => /^https?:/.test(t.url || ''));
  if (!tabs.length) return toast('No tabs to save');
  const { error } = await sb.from('read_later').insert(tabs.map((t) => ({ url: t.url, title: t.title, favicon: t.favIconUrl || null })));
  if (error) throw error;
  toast(`Saved ${tabs.length} tabs`); loadLater();
}));

// ---------- Clipboard ----------
const loadClips = safe(async () => {
  state.clips = await db.list('clips', { order: 'created_at', limit: DESKSYNC_CONFIG.CLIP_HISTORY_LIMIT });
  renderClips();
});

function renderClips() {
  const q = $('#clips-search').value.trim().toLowerCase();
  const pinnedOnly = isOn('#clips-pinned');
  const items = state.clips.filter((c) => !pinnedOnly || c.pinned).filter((c) => !q || c.content.toLowerCase().includes(q))
    .sort((a, b) => (b.pinned - a.pinned) || (new Date(b.created_at) - new Date(a.created_at)));
  const list = $('#clips-list'); list.replaceChildren();
  if (!items.length) return list.append(empty(q ? 'No matches' : pinnedOnly ? 'No pinned clips' : 'Empty — save from your clipboard below, or approve sites for capture in Settings'));
  fillList(list, items, !q && !pinnedOnly, (c) => (c.pinned ? 'Pinned' : dayLabel(c.created_at)), clipRow);
}
function clipRow(c, isFeature) {
  const where = `${c.source_url ? c.source_url + ' · ' : ''}${ago(c.created_at)}`;
  return el('li', { class: isFeature ? 'feature' : '', title: 'Click to copy', onclick: safe(() => copy(c.content)) },
    el('div', { class: 'tile plain' }, icon('copy')),
    el('div', { class: 'main' }, el('div', { class: 't' }, c.content),
      isFeature ? el('div', { class: 'meta' }, `${c.pinned ? 'Pinned' : 'Latest copy'} · ${where}`) : el('div', { class: 's' }, where)),
    el('div', { class: 'acts' },
      el('button', { class: c.pinned ? 'on' : '', title: c.pinned ? 'Unpin' : 'Pin', 'aria-label': c.pinned ? 'Unpin' : 'Pin', onclick: safe(async (e) => { e.stopPropagation();
        await db.update('clips', c.id, { pinned: !c.pinned }); loadClips(); }) }, icon('pin')),
      el('button', { title: 'Save as note', 'aria-label': 'Save as note', onclick: safe(async (e) => { e.stopPropagation();
        await db.insert('notes', { title: c.content.slice(0, 40), body: el('div', {}, c.content).innerHTML });
        toast('Saved as note'); loadNotes(); }) }, icon('edit')),
      el('button', { class: 'del', title: 'Delete', 'aria-label': 'Delete', onclick: safe(async (e) => { e.stopPropagation();
        await db.remove('clips', c.id, { content: '', source_url: null }); loadClips(); }) }, icon('trash'))));
}
$('#clips-search').addEventListener('input', renderClips);
toggleButton('#clips-pinned', renderClips);
$('#clips-paste').addEventListener('click', safe(async () => {
  const text = (await navigator.clipboard.readText()).trim().slice(0, DESKSYNC_CONFIG.CLIP_MAX_LENGTH);
  if (!text) return toast('Clipboard is empty');
  await db.insert('clips', { content: text }); toast('Saved'); loadClips();
}));

// ---------- Vault ----------
function vaultView(v) {
  ['setup', 'locked', 'open'].forEach((n) => $('#vault-' + n).classList.toggle('hidden', n !== v));
  $('#app').dataset.vault = v;
}

const openVault = safe(async () => {
  state.vaultKey = await vaultCrypto.loadSessionKey();
  if (state.vaultKey) { vaultView('open'); return loadVault(); }
  const { data, error } = await sb.from('vault_meta').select('user_id').maybeSingle();
  if (error) throw error;
  vaultView(data ? 'locked' : 'setup');
  (data ? $('#vault-pass') : $('#vault-new1')).focus();
});

$('#vault-create').addEventListener('click', safe(async () => {
  const p1 = $('#vault-new1').value, p2 = $('#vault-new2').value, msg = $('#vault-setup-msg');
  if (p1.length < 10) return (msg.textContent = 'Use at least 10 characters.');
  if (p1 !== p2) return (msg.textContent = "Passwords don't match.");
  msg.textContent = 'Creating…';
  const salt = b64.from(vaultCrypto.randomBytes(16));
  const key = await vaultCrypto.deriveKey(p1, salt);
  const v = await vaultCrypto.encrypt(key, VAULT_VERIFIER);
  const { error } = await sb.from('vault_meta').insert({ salt, iterations: 600000, verifier_iv: v.iv, verifier_ct: v.ciphertext });
  if (error) throw error;
  await vaultCrypto.storeSessionKey(key);
  $('#vault-new1').value = $('#vault-new2').value = ''; msg.textContent = '';
  openVault();
}));

async function unlock() {
  const msg = $('#vault-msg'); msg.textContent = 'Unlocking…';
  const { data: meta, error } = await sb.from('vault_meta').select('*').single();
  if (error) throw error;
  const key = await vaultCrypto.deriveKey($('#vault-pass').value, meta.salt, meta.iterations);
  try {
    if ((await vaultCrypto.decrypt(key, meta.verifier_iv, meta.verifier_ct)) !== VAULT_VERIFIER) throw 0;
  } catch { msg.textContent = 'Wrong master password.'; return; }
  await vaultCrypto.storeSessionKey(key);
  $('#vault-pass').value = ''; msg.textContent = '';
  openVault();
}
$('#vault-unlock').addEventListener('click', safe(unlock));
$('#vault-pass').addEventListener('keydown', (e) => e.key === 'Enter' && safe(unlock)());
$('#vault-lock').addEventListener('click', safe(async () => { await vaultCrypto.lock(); state.vaultKey = null; state.vault = []; closeVaultEditor(); openVault(); }));

const loadVault = safe(async () => {
  const rows = await db.list('vault_items');
  state.vault = [];
  for (const r of rows) {
    try { state.vault.push({ ...JSON.parse(await vaultCrypto.decrypt(state.vaultKey, r.iv, r.ciphertext)), id: r.id }); }
    catch { console.warn('Could not decrypt vault item', r.id); }
  }
  state.vault.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  renderVault();
});

// Does a saved item belong to the site in the front tab?
function hostMatches(itemUrl, tabHost) {
  if (!tabHost || !itemUrl) return false;
  let host;
  try { host = new URL(/^https?:\/\//i.test(itemUrl) ? itemUrl : 'https://' + itemUrl).hostname.replace(/^www\./, ''); }
  catch { return false; }
  return host === tabHost || tabHost.endsWith('.' + host) || host.endsWith('.' + tabHost);
}

function renderVault() {
  const q = $('#vault-search').value.trim().toLowerCase();
  const items = state.vault.filter((v) => !q || [v.title, v.url, v.username].join(' ').toLowerCase().includes(q));
  const list = $('#vault-list'); list.replaceChildren();
  if (!items.length) return list.append(empty(q ? 'No matches' : 'Vault is empty — click New item'));
  // Items for the site you're looking at come first, and only those can be filled.
  const here = items.filter((v) => hostMatches(v.url, state.tabHost));
  const rest = items.filter((v) => !here.includes(v));
  if (here.length) list.append(el('li', { class: 'section' }, state.tabHost));
  here.forEach((v) => list.append(vaultRow(v, true)));
  if (here.length && rest.length) list.append(el('li', { class: 'section' }, 'All items'));
  rest.forEach((v) => list.append(vaultRow(v, false)));
}

function vaultRow(v, canFill) {
  return el('li', { onclick: () => editVault(v) },
    el('div', { class: 'tile' }, icon('key')),
    el('div', { class: 'main' }, el('div', { class: 't' }, v.title || v.url || 'Untitled'),
      el('div', { class: 's' }, v.username || '')),
    el('div', { class: 'acts' },
      canFill ? el('button', { class: 'on', title: 'Fill this login on the page', 'aria-label': 'Fill this login on the page',
        onclick: (e) => { e.stopPropagation(); fillItem(v); } }, icon('fill')) : null,
      el('button', { title: 'Copy username', 'aria-label': 'Copy username', onclick: safe((e) => { e.stopPropagation(); return copy(v.username || '', 'Username copied'); }) }, icon('user')),
      el('button', { title: 'Copy password', 'aria-label': 'Copy password', onclick: safe((e) => { e.stopPropagation(); return copy(v.password || '', 'Password copied'); }) }, icon('key'))));
}

// ---------- Autofill ----------
// Runs in the page, in the extension's isolated world: it can reach the DOM but
// shares nothing else with the page. Only ever injected by the click handler
// below, into the tab in front, for an item saved for that site.
function fillForm(username, password) {
  const shown = (el) => el.getClientRects().length > 0 && !el.disabled && !el.readOnly;
  // Frameworks track their own value, so go through the native setter and then
  // announce the change the way a real keystroke would.
  const setValue = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const inputs = [...document.querySelectorAll('input')].filter(shown);
  const pw = inputs.find((i) => i.type === 'password');
  // No usable password field means this isn't a login form, so fill nothing at all:
  // typing a username into a newsletter box would be worse than doing nothing.
  if (!pw) return { filled: 0, foundPassword: false };
  // The username is looked for above the password only, nearest first, so a mailing-list
  // field higher up the page doesn't win over the real one.
  const before = inputs.slice(0, inputs.indexOf(pw)).filter((i) => /^(text|email|tel)$/.test(i.type));
  const named = before.filter((i) =>
    /user|email|login|account/i.test(`${i.name} ${i.id} ${i.autocomplete} ${i.getAttribute('aria-label') || ''}`));
  const user = named[named.length - 1] || before[before.length - 1];
  let filled = 0;
  if (user && username) { setValue(user, username); filled++; }
  if (password) { setValue(pw, password); filled++; pw.focus(); }
  return { filled, foundPassword: true };
}

function fillItem(v) {
  const { tabId, tabOrigin } = state;
  if (!tabId || !tabOrigin) return toast('No page to fill');
  // permissions.request only works inside the click's user gesture, so nothing is
  // awaited before it. Filling a site is also what grants access to that site.
  chrome.permissions.request({ origins: [tabOrigin] }).then(async (granted) => {
    if (!granted) return toast('DeskSync needs access to this site to fill it');
    const [res] = await chrome.scripting.executeScript({
      target: { tabId }, func: fillForm, args: [v.username || '', v.password || '']
    });
    const r = res?.result;
    if (!r?.foundPassword) return toast('No login form found on this page');
    toast(r.filled > 1 ? 'Filled username and password' : 'Filled password');
    setTimeout(() => window.close(), 700);
  }).catch((e) => { console.error(e); toast(e.message || "Couldn't fill this page"); });
}
$('#vault-search').addEventListener('input', renderVault);

// Pre-fill the site name/URL from the current tab when creating an item.
async function editVault(v) {
  state.editingVault = v || null;
  $('#vi-heading').textContent = v ? 'Edit item' : 'New item';
  let tabUrl = '', tabTitle = '';
  if (!v) { const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (/^https?:/.test(t?.url || '')) { tabUrl = new URL(t.url).origin; tabTitle = new URL(t.url).hostname.replace(/^www\./, ''); } }
  $('#vi-title').value = v?.title ?? tabTitle;
  $('#vi-url').value = v?.url ?? tabUrl;
  $('#vi-user').value = v?.username || '';
  $('#vi-pass').value = v?.password || '';
  $('#vi-pass').type = 'password';
  $('#vi-notes').value = v?.notes || '';
  $('#vi-delete').classList.toggle('hidden', !v);
  $('#vault-editor').classList.remove('hidden');
}
// Clears the fields too, so decrypted values don't stay in the DOM.
function closeVaultEditor() {
  state.editingVault = null;
  for (const id of ['vi-title', 'vi-url', 'vi-user', 'vi-pass', 'vi-notes']) $('#' + id).value = '';
  $('#vault-editor').classList.add('hidden');
}
$('#vault-new').addEventListener('click', () => editVault(null));
$('#vi-cancel').addEventListener('click', closeVaultEditor);
$('#vi-show').addEventListener('click', () => { const p = $('#vi-pass'); p.type = p.type === 'password' ? 'text' : 'password'; });
$('#vi-gen').addEventListener('click', () => { $('#vi-pass').value = vaultCrypto.generatePassword(); $('#vi-pass').type = 'text'; });

$('#vi-save').addEventListener('click', safe(async () => {
  if (!state.vaultKey) return openVault();
  const item = { title: $('#vi-title').value.trim(), url: $('#vi-url').value.trim(),
    username: $('#vi-user').value, password: $('#vi-pass').value, notes: $('#vi-notes').value };
  const { iv, ciphertext } = await vaultCrypto.encrypt(state.vaultKey, JSON.stringify(item));
  if (state.editingVault) await db.update('vault_items', state.editingVault.id, { iv, ciphertext });
  else await db.insert('vault_items', { iv, ciphertext });
  closeVaultEditor(); toast('Saved (encrypted)'); loadVault();
}));
$('#vi-delete').addEventListener('click', safe(async () => {
  if (!state.editingVault) return;
  await db.remove('vault_items', state.editingVault.id); closeVaultEditor(); toast('Deleted'); loadVault();
}));

// ---------- Trash ----------
// Clips are left out on purpose: `remove` blanks their text, so there is nothing to restore.
const TRASH = {
  notes: { icon: 'note', label: 'Note', reload: () => loadNotes() },
  read_later: { icon: 'bookmark', label: 'Link', reload: () => loadLater() },
  vault_items: { icon: 'key', label: 'Vault item', reload: () => state.vaultKey && loadVault() }
};

async function trashTitle(r) {
  if (r._table === 'notes') return r.title || textOf(r.body).slice(0, 80) || 'Untitled';
  if (r._table === 'read_later') return r.title || r.url;
  // A deleted vault item only has a title while the vault is unlocked.
  if (!state.vaultKey) return 'Vault item';
  try { return JSON.parse(await vaultCrypto.decrypt(state.vaultKey, r.iv, r.ciphertext)).title || 'Vault item'; }
  catch { return 'Vault item'; }
}

const loadTrash = safe(async () => {
  const tables = Object.keys(TRASH);
  const groups = await Promise.all(tables.map((t) => db.listDeleted(t)));
  const rows = groups.flatMap((g, i) => g.map((r) => ({ ...r, _table: tables[i] })))
    .sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at));
  state.trash = await Promise.all(rows.map(async (r) => ({ ...r, _title: await trashTitle(r) })));
  renderTrash();
});

function renderTrash() {
  const list = $('#trash-list'); list.replaceChildren();
  $('#trash-empty').disabled = !state.trash.length;
  if (!state.trash.length) return list.append(empty('Trash is empty'));
  for (const r of state.trash) {
    const kind = TRASH[r._table];
    list.append(el('li', { class: 'static' },
      el('div', { class: 'tile' }, icon(kind.icon)),
      el('div', { class: 'main' },
        el('div', { class: 't' }, r._title),
        el('div', { class: 's' }, `${kind.label} · deleted ${ago(r.deleted_at)}`)),
      el('div', { class: 'acts' },
        el('button', { title: 'Restore', 'aria-label': 'Restore', onclick: safe(async () => {
          await db.restore(r._table, r.id); toast('Restored'); kind.reload(); loadTrash(); }) }, icon('undo')),
        el('button', { class: 'del', title: 'Delete forever', 'aria-label': 'Delete forever', onclick: safe(async () => {
          await db.purge(r._table, r.id); toast('Deleted forever'); loadTrash(); }) }, icon('trash')))));
  }
}

function openTrash() { $('#trash').classList.remove('hidden'); resetEmptyTrash(); loadTrash(); }
$('#set-trash').addEventListener('click', openTrash);
$('#trash-back').addEventListener('click', () => $('#trash').classList.add('hidden'));

// Emptying the trash can't be undone, so the button asks a second time instead of
// opening a dialog (a modal dialog would freeze the popup).
function resetEmptyTrash() {
  const b = $('#trash-empty');
  b.dataset.armed = '';
  b.replaceChildren(icon('trash'), 'Empty trash');
}
$('#trash-empty').addEventListener('click', safe(async () => {
  const b = $('#trash-empty');
  if (!b.dataset.armed) {
    b.dataset.armed = '1';
    b.replaceChildren(icon('trash'), 'Delete everything in the trash?');
    clearTimeout(b._t); b._t = setTimeout(resetEmptyTrash, 5000);
    return;
  }
  clearTimeout(b._t); resetEmptyTrash();
  await Promise.all(Object.keys(TRASH).map((t) => db.purgeAll(t)));
  toast('Trash emptied'); loadTrash();
}));

// ---------- Settings ----------
// Approved sites are the extension's granted host permissions, e.g. *://*.github.com/*
function originFor(hostname) {
  const host = hostname.replace(/^www\./, '');
  const single = !host.includes('.') || /^[\d.]+$/.test(host) || host.startsWith('[');
  return single ? `*://${host}/*` : `*://*.${host}/*`;
}
const hostOfOrigin = (origin) => origin.replace(/^\*:\/\/(\*\.)?/, '').replace(/\/\*$/, '');

async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  $('#set-clip').checked = settings?.clipCapture ?? false;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onPage = /^https?:/.test(tab?.url || '');
  state.tabId = onPage ? tab.id : null;
  state.tabHost = onPage ? new URL(tab.url).hostname.replace(/^www\./, '') : null;
  state.tabOrigin = onPage ? originFor(new URL(tab.url).hostname) : null;
  await renderSites();
  renderVault();   // the Fill action depends on which tab is in front
}

// Sites approved for clipboard capture. Kept apart from the extension's granted
// origins because autofill asks for host access too, and being allowed to fill a
// password on a site must not also start recording what you copy there.
async function captureOrigins() {
  const { captureOrigins } = await chrome.storage.local.get('captureOrigins');
  if (captureOrigins) return captureOrigins;
  const { origins = [] } = await chrome.permissions.getAll();   // upgrade from the old behaviour
  await chrome.storage.local.set({ captureOrigins: origins });
  return origins;
}

async function renderSites() {
  const origins = await captureOrigins();
  const list = $('#set-sites'); list.replaceChildren();
  if (!origins.length) list.append(empty('No approved sites yet'));
  for (const origin of origins) {
    list.append(el('li', {},
      el('div', { class: 'tile' }, icon('globe')),
      el('div', { class: 'main' }, el('div', { class: 't' }, hostOfOrigin(origin))),
      el('div', { class: 'acts' },
        el('button', { class: 'del', title: 'Stop capturing on this site', 'aria-label': 'Stop capturing on this site', onclick: safe(async () => {
          const left = (await captureOrigins()).filter((o) => o !== origin);
          await chrome.storage.local.set({ captureOrigins: left });
          await chrome.permissions.remove({ origins: [origin] });
          renderSites();
        }) }, icon('trash')))));
  }
  const btn = $('#set-allow');
  btn.disabled = !state.tabOrigin || origins.includes(state.tabOrigin);
  state.captureOrigins = origins;
  btn.textContent = state.tabOrigin ? `Allow ${hostOfOrigin(state.tabOrigin)}` : 'Allow this site';
}

$('#set-clip').addEventListener('change', safe(async (e) => {
  await chrome.storage.local.set({ settings: { clipCapture: e.target.checked } });
  toast(e.target.checked ? 'Capture on' : 'Capture off');
}));
// permissions.request needs the click's user gesture, so nothing may be awaited before it.
$('#set-allow').addEventListener('click', safe(async () => {
  if (!(await chrome.permissions.request({ origins: [state.tabOrigin] }))) return;
  const origins = [...new Set([...(state.captureOrigins || []), state.tabOrigin])];
  await chrome.storage.local.set({ captureOrigins: origins });
  toast('Site approved'); renderSites();
}));

boot();
