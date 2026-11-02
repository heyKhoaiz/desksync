// DeskSync popup UI.
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const state = { notes: [], later: [], clips: [], vault: [], vaultKey: null, editing: null, editingVault: null };

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

// ---------- Auth ----------
async function boot() {
  const user = await currentUser();
  $('#auth').classList.toggle('hidden', !!user);
  $('#app').classList.toggle('hidden', !user);
  if (!user) return;
  $('#me').textContent = user.email;
  const { lastTab } = await chrome.storage.local.get('lastTab');
  showTab(lastTab || 'notes');
  loadNotes(); loadLater(); loadClips(); loadSettings();
  subscribeRealtime(user.id);
}

$('#auth-form').addEventListener('submit', safe(async (e) => {
  e.preventDefault();
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

$('#signout').addEventListener('click', safe(async () => {
  await vaultCrypto.lock(); await sb.auth.signOut(); location.reload();
}));

// ---------- Tabs ----------
function showTab(name) {
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== 'tab-' + name));
  chrome.storage.local.set({ lastTab: name });
  if (name === 'vault') openVault();
}
$$('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

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
  const items = state.notes
    .filter((n) => !q || (q.startsWith('#') ? n.tags.some((t) => t.toLowerCase() === q.slice(1))
      : (n.title + ' ' + textOf(n.body) + ' ' + n.tags.join(' ')).toLowerCase().includes(q)))
    .sort((a, b) => (b.pinned - a.pinned) || (new Date(b.updated_at) - new Date(a.updated_at)));
  const list = $('#notes-list'); list.replaceChildren();
  if (!items.length) return list.append(empty(q ? 'No matching notes' : 'No notes yet — click + Note'));
  for (const n of items) {
    list.append(el('li', { class: 'c-' + n.color, onclick: () => editNote(n) },
      el('div', { class: 'main' },
        el('div', { class: 't' }, (n.pinned ? '📌 ' : '') + (n.title || 'Untitled')),
        el('div', { class: 's' }, textOf(n.body).slice(0, 200)),
        el('div', {}, n.tags.map((t) => el('span', { class: 'tag' }, '#' + t)), el('span', { class: 'small muted' }, ago(n.updated_at)))),
      el('div', { class: 'acts' },
        el('button', { title: 'Pin', onclick: safe(async (e) => { e.stopPropagation();
          await db.update('notes', n.id, { pinned: !n.pinned }); loadNotes(); }) }, n.pinned ? 'Unpin' : 'Pin'))));
  }
}
$('#notes-search').addEventListener('input', renderNotes);

function editNote(n) {
  state.editing = n || null;
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
  const showRead = $('#later-show-read').checked;
  const items = state.later.filter((r) => showRead || !r.is_read);
  const list = $('#later-list'); list.replaceChildren();
  if (!items.length) return list.append(empty('Nothing saved — press Alt+Shift+S on any page'));
  for (const r of items) {
    let host = ''; try { host = new URL(r.url).hostname; } catch {}
    list.append(el('li', { class: r.is_read ? 'read' : '', onclick: safe(async () => {
        if (!/^https?:/i.test(r.url)) return toast('Blocked unsafe link');
        chrome.tabs.create({ url: r.url });
        if (!r.is_read) await db.update('read_later', r.id, { is_read: true });
      }) },
      r.favicon && /^https:/.test(r.favicon) ? el('img', { src: r.favicon, alt: '' }) : null,
      el('div', { class: 'main' }, el('div', { class: 't' }, r.title || r.url),
        el('div', { class: 's' }, `${host} · ${ago(r.created_at)}${r.source === 'android' ? ' · 📱' : ''}`)),
      el('div', { class: 'acts' },
        el('button', { title: r.is_read ? 'Mark unread' : 'Mark read', onclick: safe(async (e) => { e.stopPropagation();
          await db.update('read_later', r.id, { is_read: !r.is_read }); loadLater(); }) }, r.is_read ? '↺' : '✓'),
        el('button', { title: 'Delete', onclick: safe(async (e) => { e.stopPropagation();
          await db.remove('read_later', r.id); loadLater(); }) }, '🗑'))));
  }
}
$('#later-show-read').addEventListener('change', renderLater);

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
  const items = state.clips.filter((c) => !q || c.content.toLowerCase().includes(q))
    .sort((a, b) => (b.pinned - a.pinned) || (new Date(b.created_at) - new Date(a.created_at)));
  const list = $('#clips-list'); list.replaceChildren();
  if (!items.length) return list.append(empty(q ? 'No matches' : 'Copy text on any web page and it shows up here'));
  for (const c of items) {
    let host = ''; try { host = c.source_url ? new URL(c.source_url).hostname : ''; } catch {}
    list.append(el('li', { title: 'Click to copy', onclick: safe(() => copy(c.content)) },
      el('div', { class: 'main' }, el('div', { class: 's' }, c.content),
        el('div', { class: 'small muted' }, `${c.pinned ? '📌 ' : ''}${host ? host + ' · ' : ''}${ago(c.created_at)}`)),
      el('div', { class: 'acts' },
        el('button', { title: 'Pin', onclick: safe(async (e) => { e.stopPropagation();
          await db.update('clips', c.id, { pinned: !c.pinned }); loadClips(); }) }, '📌'),
        el('button', { title: 'Save as note', onclick: safe(async (e) => { e.stopPropagation();
          await db.insert('notes', { title: c.content.slice(0, 40), body: el('div', {}, c.content).innerHTML });
          toast('Saved as note'); loadNotes(); }) }, '📝'),
        el('button', { title: 'Delete', onclick: safe(async (e) => { e.stopPropagation();
          await db.remove('clips', c.id); loadClips(); }) }, '🗑'))));
  }
}
$('#clips-search').addEventListener('input', renderClips);
$('#clips-paste').addEventListener('click', safe(async () => {
  const text = (await navigator.clipboard.readText()).trim().slice(0, DESKSYNC_CONFIG.CLIP_MAX_LENGTH);
  if (!text) return toast('Clipboard is empty');
  await db.insert('clips', { content: text }); toast('Saved'); loadClips();
}));

// ---------- Vault ----------
function vaultView(v) { ['setup', 'locked', 'open'].forEach((n) => $('#vault-' + n).classList.toggle('hidden', n !== v)); }

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
$('#vault-lock').addEventListener('click', safe(async () => { await vaultCrypto.lock(); state.vaultKey = null; state.vault = []; openVault(); }));

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

function renderVault() {
  const q = $('#vault-search').value.trim().toLowerCase();
  const items = state.vault.filter((v) => !q || [v.title, v.url, v.username].join(' ').toLowerCase().includes(q));
  const list = $('#vault-list'); list.replaceChildren();
  if (!items.length) return list.append(empty(q ? 'No matches' : 'Vault is empty — click + Item'));
  for (const v of items) {
    list.append(el('li', { onclick: () => editVault(v) },
      el('div', { class: 'main' }, el('div', { class: 't' }, v.title || v.url || 'Untitled'),
        el('div', { class: 's' }, v.username || '')),
      el('div', { class: 'acts' },
        el('button', { title: 'Copy username', onclick: safe((e) => { e.stopPropagation(); return copy(v.username || '', 'Username copied'); }) }, '👤'),
        el('button', { title: 'Copy password', onclick: safe((e) => { e.stopPropagation(); return copy(v.password || '', 'Password copied'); }) }, '🔑'))));
  }
}
$('#vault-search').addEventListener('input', renderVault);

// Pre-fill the site name/URL from the current tab when creating an item.
async function editVault(v) {
  state.editingVault = v || null;
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
$('#vault-new').addEventListener('click', () => editVault(null));
$('#vi-cancel').addEventListener('click', () => $('#vault-editor').classList.add('hidden'));
$('#vi-show').addEventListener('click', () => { const p = $('#vi-pass'); p.type = p.type === 'password' ? 'text' : 'password'; });
$('#vi-gen').addEventListener('click', () => { $('#vi-pass').value = vaultCrypto.generatePassword(); $('#vi-pass').type = 'text'; });

$('#vi-save').addEventListener('click', safe(async () => {
  if (!state.vaultKey) return openVault();
  const item = { title: $('#vi-title').value.trim(), url: $('#vi-url').value.trim(),
    username: $('#vi-user').value, password: $('#vi-pass').value, notes: $('#vi-notes').value };
  const { iv, ciphertext } = await vaultCrypto.encrypt(state.vaultKey, JSON.stringify(item));
  if (state.editingVault) await db.update('vault_items', state.editingVault.id, { iv, ciphertext });
  else await db.insert('vault_items', { iv, ciphertext });
  $('#vault-editor').classList.add('hidden'); toast('Saved (encrypted)'); loadVault();
}));
$('#vi-delete').addEventListener('click', safe(async () => {
  if (!state.editingVault) return;
  await db.remove('vault_items', state.editingVault.id); $('#vault-editor').classList.add('hidden'); toast('Deleted'); loadVault();
}));

// ---------- Settings ----------
async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = { clipCapture: true, clipIgnoreSites: [], ...(settings || {}) };
  $('#set-clip').checked = s.clipCapture;
  $('#set-ignore').value = s.clipIgnoreSites.join('\n');
}
$('#set-save').addEventListener('click', safe(async () => {
  const clipIgnoreSites = $('#set-ignore').value.split('\n').map((h) => h.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
  await chrome.storage.local.set({ settings: { clipCapture: $('#set-clip').checked, clipIgnoreSites } });
  toast('Settings saved');
}));

boot();
