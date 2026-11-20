// DeskSync popup UI.
//
// The popup used to be four tabs, each with its own search box, so the thing you
// wanted was usually in a tab you were not in. It is now one search field over all
// four kinds of thing, with the types as filters on the rail and your own tags as
// chips under the search. Selecting a row opens it in the pane on the right instead
// of navigating away from the list — which is what the 780px width is for.

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// ---------- Where this page is running ----------
// The same page is the toolbar popup, the side panel (?view=panel) and a full
// tab (?view=tab, opened from the address bar or when a shortcut cannot open
// the popup). The popup is a fixed 780x560; the other two fill what they get.
// A popup closes the moment you click the page, which is fine for a lookup and
// hopeless for copying three things out of an article: that is what the panel
// is for.
const params = new URLSearchParams(location.search);
const VIEW = ['panel', 'tab'].includes(params.get('view')) ? params.get('view') : 'popup';
document.documentElement.classList.add('view-' + VIEW);

const state = {
  theme: 'light',
  notes: [], later: [], clips: [], vault: [], trash: [],
  vaultKey: null, vaultState: 'locked',     // 'setup' | 'locked' | 'open'
  items: [], rows: [], active: 0, vEditing: null, vDraft: null,
  filter: 'all', screen: null, editing: null,
  tagColors: {},
  tabId: null, tabHost: null, tabOrigin: null, windowId: null
};

// ---------- Utils ----------
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 1800);
}
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
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
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
// Puts text on the clipboard, with `html` alongside when given (Gmail, Docs
// and Notion paste that with its formatting).
//
// navigator.clipboard only exists on a secure page. The extension's own pages
// are, but a page opened over plain http is not, and every Copy button there
// failed with "Cannot read properties of undefined (reading 'writeText')".
// When the API is missing or refuses, the browser's older copy command is
// used instead: it works anywhere a click does.
async function writeClipboard(text, html = null) {
  try {
    if (html && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' })
      })]);
      return;
    }
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  } catch (e) {
    console.warn('[DeskSync] clipboard API refused, using the copy command', e);
  }
  // The copy command copies the page's selection, so the selection (a word
  // you had selected in a note, say) is kept and put back afterwards.
  const sel = getSelection();
  const kept = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  const focused = document.activeElement;
  const fill = (e) => {
    e.clipboardData.setData('text/plain', text);
    if (html) e.clipboardData.setData('text/html', html);
    e.preventDefault();
  };
  const holder = el('textarea', { 'aria-hidden': 'true', tabindex: '-1',
    style: 'position:fixed;top:-9999px;left:-9999px;opacity:0' });
  holder.value = text;
  document.body.append(holder);
  holder.select();
  document.addEventListener('copy', fill, true);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  document.removeEventListener('copy', fill, true);
  holder.remove();
  focused?.focus?.({ preventScroll: true });
  if (kept) { sel.removeAllRanges(); sel.addRange(kept); }
  if (!ok) throw new Error('Could not reach the clipboard. Select the text and press Ctrl+C instead.');
}

async function copy(text, label = 'Copied') { await writeClipboard(text); toast(label); }
function safe(fn) {
  return async (...a) => { try { await fn(...a); } catch (e) { console.error(e); toast(e.message || 'Something went wrong'); } };
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

// ---------- The four types ----------
// One colour each, used for the dot in a row and in the detail header. Nothing is
// ever distinguished by colour alone: the kind is always named in the detail pane.
const TYPES = {
  note:  { label: 'Notes',      one: 'Note',       icon: 'note',     color: 'var(--note)',  table: 'notes' },
  link:  { label: 'Read later', one: 'Read later', icon: 'bookmark', color: 'var(--link)',  table: 'read_later' },
  clip:  { label: 'Clipboard',  one: 'Clip',       icon: 'clip',     color: 'var(--clip)',  table: 'clips' },
  vault: { label: 'Vault',      one: 'Vault',      icon: 'shield',   color: 'var(--vault)', table: 'vault_items' }
};
const TYPE_KEYS = Object.keys(TYPES);

// Today is not a type: it is what you are likely to want right now. Pinned
// things, links you have not read yet, task lists not yet done, and notes and
// clips from the last day.
// The vault stays out of it; a login is not something you have "for today".
const DAY_MS = 86400000;
function isToday(i) {
  if (i.kind === 'vault') return false;
  if (i.pinned) return true;
  if (i.kind === 'link' && !i.read) return true;
  // A list with something left to do stays in Today until it is done.
  if (i.kind === 'note' && i.openTasks > 0) return true;
  return !!i.when && Date.now() - new Date(i.when) < DAY_MS;
}
function inFilter(i) {
  if (state.filter === 'all') return true;
  if (state.filter === 'today') return isToday(i);
  return i.kind === state.filter;
}
const filterLabel = (f) => TYPES[f]?.label || (f === 'today' ? 'Today' : null);

// ---------- A colour per note ----------
// `notes.color` has been in the schema since the first migration, defaulting to
// 'yellow', and nothing ever read it. This is what reads it. The tokens live in
// popup.css, once per theme, so a note stays legible in both.
//
// Keys are stored, not hexes: the phone, and any later theme, get to decide what
// 'mint' looks like.
const NOTE_COLOURS = [
  { k: 'yellow', label: 'Yellow' },
  { k: 'coral',  label: 'Coral' },
  { k: 'peach',  label: 'Peach' },
  { k: 'mint',   label: 'Mint' },
  { k: 'sky',    label: 'Sky' },
  { k: 'lilac',  label: 'Lilac' },
  { k: 'slate',  label: 'Slate' }
];
const noteColour = (row) => (NOTE_COLOURS.find((c) => c.k === row?.color) || NOTE_COLOURS[0]).k;
const colourVar = (row) => `var(--n-${noteColour(row)})`;
const colourFg = (row) => `var(--n-${noteColour(row)}-fg)`;

// ---------- Auth ----------
// The source folder ships with placeholders; `make ext` fills them in for dist/extension.
const isConfigured = !DESKSYNC_CONFIG.SUPABASE_URL.includes('YOUR-PROJECT');

// The app opens straight away, signed in or not: everything is on this device.
// An account only adds sync, and is set up from Settings.
async function boot() {
  $('#app').classList.remove('hidden');
  // Data left by the version where the server was the source of truth.
  await store.migrate();
  const user = isConfigured ? await currentUser() : null;
  state.email = user?.email || null;
  // A different account than this device last synced with takes the data here
  // along with it: see store.adopt.
  if (user) await store.adopt(user.id);
  sync.onWarn = toast;
  // Not awaited: it is usually a no-op, and the list should not wait on a write
  // for a note the last popup already showed.
  replayDraft();
  const { tagColors, theme } =
    await chrome.storage.local.get(['tagColors', 'theme']);
  state.tagColors = tagColors || {};
  applyTheme(theme || 'light');
  await loadSettings();
  // Awaited now that it is a local read: the welcome for an empty library must
  // not flash up on every open while the rows are still on their way.
  await Promise.all([loadNotes(), loadLater(), loadClips()]);
  state.loaded = true;
  checkVault();
  if (user) {
    subscribeRealtime(user.id);
    syncNow();
  }
  updateOfflineBar();
  if (state.startOnToday && !params.get('q') && !params.get('open')) state.filter = 'today';
  draw();
  $('#q').focus();
  await startAction();
}

// What this window was opened to do: a shortcut (Alt+Shift+K, Alt+Shift+V)
// leaves it in session storage, the address bar and the tab fallback put it in
// the URL.
async function startAction() {
  let action = params.get('do');
  try {
    const { pendingAction } = await chrome.storage.session.get('pendingAction');
    if (pendingAction) { action = pendingAction; await chrome.storage.session.remove('pendingAction'); }
  } catch { /* no session storage here: nothing was left for us */ }
  const query = params.get('q');
  if (query) { $('#q').value = query; state.active = 0; draw(); }
  const open = params.get('open');
  if (open) {
    const [kind, id] = open.split(':');
    const i = state.rows.findIndex((r) => r.kind === kind && r.id === id);
    if (i > -1) { state.picked = true; setActive(i, true); }
  }
  if (action === 'note') return startFromCompose();
  if (action === 'clip') return runAction('clip');
}

// Sign in or create an account, from Settings. Reloading runs boot() again,
// which adopts this device's data into the account and syncs.
async function signIn(mode, email, password) {
  if (!isConfigured) return 'Sync is not set up in this build: run make ext with a Supabase project.';
  const { data, error } = mode === 'signup'
    ? await sb.auth.signUp({ email, password })
    : await sb.auth.signInWithPassword({ email, password });
  if (error) return error.message;
  if (mode === 'signup' && !data.session) return 'Check your email to confirm, then sign in.';
  location.reload();
  return null;
}

// A draft the last popup could not finish writing. Opening the popup is the
// earliest moment anyone can notice, and it is cheap: there is usually nothing.
async function replayDraft() {
  try {
    const { saved } = await drafts.flush();
    if (saved) loadNotes();
  } catch (e) {
    console.warn('[DeskSync] could not replay a saved draft', e);
  }
}

// ---------- Offline ----------
async function updateOfflineBar() {
  const pending = state.email ? await sync.pending() : 0;
  const bar = $('#offline-bar');
  bar.classList.toggle('hidden', navigator.onLine && !pending);
  bar.textContent = !navigator.onLine
    ? (pending ? `Offline — ${plural(pending, 'change')} saved here, will sync later` : 'Offline — showing saved data')
    : `Syncing ${plural(pending, 'change')}…`;
}

// Push what changed here, pull what changed elsewhere, then redraw from the store.
const syncNow = safe(async () => {
  const { synced, pulled, vaultConflict } = await sync.run();
  state.vaultConflict = vaultConflict;
  await updateOfflineBar();
  if (!synced && !pulled) return;
  loadNotes(); loadLater(); loadClips();
  // A pull can bring the account's vault to a device that had none, so a
  // "Set up" vault is checked again rather than left inviting a second vault.
  if (state.vaultKey) loadVault(); else checkVault();
});

window.addEventListener('online', () => { updateOfflineBar(); syncNow(); });
window.addEventListener('offline', updateOfflineBar);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some((k) => k.startsWith(LOCAL_PREFIX))) updateOfflineBar();
});

function subscribeRealtime(uid) {
  // A change on the server is pulled into the store, then the lists redraw. Our
  // own pushes echo back here too, so a burst of events is one sync.
  const pull = () => { clearTimeout(pull._t); pull._t = setTimeout(syncNow, 500); };
  const ch = sb.channel('desksync');
  for (const table of SYNC_TABLES) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `user_id=eq.${uid}` }, pull);
  }
  ch.subscribe();
}

// ---------- Loading ----------
// Every row is mapped to one shape so a single list can hold all four kinds.
const loadNotes = safe(async () => { state.notes = await db.list('notes'); draw(); });
const loadLater = safe(async () => { state.later = await db.list('read_later', { order: 'created_at' }); draw(); });
const loadClips = safe(async () => {
  state.clips = await db.list('clips', { order: 'created_at', limit: DESKSYNC_CONFIG.CLIP_HISTORY_LIMIT });
  draw();
});

function buildItems() {
  const items = [];

  for (const n of state.notes) {
    // Without the ** and _ markers: the list shows words, and a search for
    // "big day" finds "**big** day".
    const text = fmt.strip(txt.toText(n));
    // A task list says how far along it is, before anything else about it.
    // Counted on the text with its lines, not the one-line version for the row.
    const p = tasks.progress(txt.toPlain(n));
    items.push({
      kind: 'note', id: n.id, row: n, when: n.updated_at, pinned: n.pinned,
      title: n.title || text.slice(0, 60) || 'Untitled',
      sub: (p.total ? `${p.done}/${p.total} done · ` : '') + text.slice(0, 90),
      text, openTasks: p.open, progress: p.total ? p : null, tags: n.tags || []
    });
  }
  for (const r of state.later) {
    items.push({
      kind: 'link', id: r.id, row: r, when: r.created_at, read: r.is_read,
      title: r.title || r.url, sub: hostOf(r.url), text: `${r.url} ${r.note || ''}`, tags: r.tags || []
    });
  }
  // A clip that looks like a key or token is listed masked and left out of
  // search, so it is not on screen whenever the popup opens next to someone.
  // Monospace is for code and commands only; an address or a sentence copied
  // from a page reads better in the normal face.
  for (const c of state.clips) {
    const secret = detect.isSecret(c.content);
    items.push({
      kind: 'clip', id: c.id, row: c, when: c.created_at, pinned: c.pinned,
      secret, mono: secret || detect.isCode(c.content),
      title: secret ? detect.mask(c.content) : c.content, text: secret ? '' : c.content,
      sub: c.source_url || '', tags: c.tags || []
    });
  }
  // Vault titles are inside the ciphertext, so a locked vault has nothing to list.
  for (const v of state.vault) {
    items.push({
      kind: 'vault', id: v.id, row: v, when: v.updated_at || null,
      title: v.title || v.url || 'Untitled', sub: v.username || hostOf(v.url), text: v.url || '', tags: v.tags || []
    });
  }

  items.sort((a, b) => (!!b.pinned - !!a.pinned) || (new Date(b.when || 0) - new Date(a.when || 0)));
  state.items = items;
}

// ---------- Tags ----------
// Tags are held in the search box as #tokens, so the chips and the typed text are
// the same state and cannot disagree.
// What a tag may be is decided in lib/tags.js, for every place that makes one.
// The search box used to see only English letters, so a Bangla #tag could be
// made but never searched for.
const parseQuery = (raw) => tagRules.fromQuery(raw);
const normalizeTag = (v) => tagRules.normalize(v);

function allTags() {
  const c = {};
  for (const i of state.items) for (const t of i.tags) c[t] = (c[t] || 0) + 1;
  return Object.keys(c).sort((a, b) => c[b] - c[a] || a.localeCompare(b));
}

// A #tag in the search box, swapped or taken out word by word. A regex with
// \b does not see a boundary after Bangla letters, so it could not remove
// a #কাজ once it was there.
function retagQuery(query, from, to = null) {
  return query.split(/\s+/)
    .map((w) => (w.startsWith('#') && normalizeTag(w) === from ? (to ? '#' + to : '') : w))
    .filter(Boolean).join(' ');
}

function toggleTag(t) {
  const q = $('#q');
  const { tags } = parseQuery(q.value);
  q.value = tags.includes(t) ? retagQuery(q.value, t) : (q.value.trim() + ' #' + t).trim();
  state.active = 0; draw(); q.focus();
}

// Writing a tag list back to whichever table the item came from. Vault tags go
// inside the encrypted payload, so they need a re-encrypt rather than a column write.
async function saveTags(item, tags) {
  // Whatever path a list came by, it leaves here following the rules.
  tags = tagRules.clean(tags);
  item.tags = tags;
  // The note open in the editor keeps its tags with its text, in the draft,
  // and they are saved together. Writing them to the row on their own left the
  // editor's copy behind: the new tag did not show, and the next autosave
  // wrote the old list back over it. A new note has no row yet at all, so
  // writing one made a second, empty note.
  const ed = state.editing;
  if (item.kind === 'note' && ed && state.draft && (item.id ?? null) === (ed.id ?? null)) {
    state.draft.tags = [...tags];
    ed.tags = [...tags];
    queueSave();
    return;
  }
  if (item.kind === 'vault') {
    if (!state.vaultKey) return toast('Unlock the vault first');
    const { iv, ciphertext } = await vaultCrypto.encrypt(state.vaultKey, JSON.stringify({ ...item.row, tags }));
    item.row.tags = tags;
    await db.update('vault_items', item.id, { iv, ciphertext });
  } else {
    item.row.tags = tags;
    await writeRow(TYPES[item.kind].table, item.id, { tags });
  }
}

// ---------- Search ----------
// Title prefix beats title substring beats a match in the second line, so typing
// "sup" puts "Supabase" above a note that merely mentions it.
function score(item, query) {
  const s = query.toLowerCase();
  const t = item.title.toLowerCase(), m = (item.sub || '').toLowerCase();
  if (t.startsWith(s)) return 100;
  if (t.includes(s)) return 50;
  if (m.includes(s)) return 20;
  // Anywhere in the body: a note is found by a word in its fifth paragraph, a
  // link by the comment you left on it.
  if ((item.text || '').toLowerCase().includes(s)) return 15;
  if (item.tags.some((x) => x.toLowerCase().includes(s))) return 10;
  return 0;
}

function matches(raw) {
  const { text, tags } = parseQuery(raw);
  const pool = state.items.filter((i) => inFilter(i) && tags.every((t) => i.tags.includes(t)));
  // Today mixes kinds, so it is grouped by kind like search results are. The
  // sort is stable: pinned first and newest first still hold inside each group.
  if (!text) return state.filter === 'today'
    ? pool.sort((a, b) => TYPE_KEYS.indexOf(a.kind) - TYPE_KEYS.indexOf(b.kind)) : pool;
  return pool
    .map((i) => [score(i, text), i])
    .filter(([n]) => n > 0)
    .sort((a, b) => (TYPE_KEYS.indexOf(a[1].kind) - TYPE_KEYS.indexOf(b[1].kind)) || (b[0] - a[0]))
    .map(([, i]) => i);
}

// ---------- Capture actions ----------
// The things you come here to add. A note is not one of them: "Take a note…"
// above the list starts one, empty or with the line typed, so a "New note" row
// beside it was the same button twice.
// The way to add a thing has to be reachable from wherever you are. Filtering to
// Notes used to hide every action, so an empty Notes list was a dead end with no
// way to create one. Each filter keeps the action that makes its own kind.
function actions() {
  const f = state.filter;
  const forAll = f === 'all' || f === 'today';
  const list = [];

  if (state.vaultState !== 'open' && (forAll || f === 'vault')) {
    list.push({ action: 'vault', icon: 'lock',
      title: state.vaultState === 'setup' ? 'Set up your vault' : 'Unlock the vault',
      sub: 'Saved logins are hidden until you do' });
  }
  if (forAll || f === 'link') {
    list.push({ action: 'tab', icon: 'bookmark', title: 'Save this tab',
      where: state.tabHost || 'no page', sub: state.tabHost || 'No page to save',
      kbd: 'Alt+Shift+S', disabled: !state.tabHost });
  }
  if (forAll || f === 'clip') {
    list.push({ action: 'clip', icon: 'clip', title: 'Save the clipboard',
      sub: 'Adds the clipboard as a clip' });
  }
  // Only under the Vault filter: adding a login by hand is rarer than the rest,
  // and Everything is already four rows deep.
  if (state.vaultState === 'open' && f === 'vault') {
    list.push({ action: 'login', icon: 'key', title: 'New login', sub: 'Save a username and password' });
  }
  return list.map((a) => ({ ...a, kind: 'action', tags: [] }));
}

// ---------- Draw ----------
function draw() {
  buildItems();
  const q = $('#q');
  const raw = q.value.trim();
  const { text, tags } = parseQuery(raw);

  drawHead(text, tags);
  drawTagbar(text, tags);
  drawCompose();

  const found = matches(raw);
  // Shown under a type filter too, so a filtered empty list still offers the
  // way to fill it. Hidden once you are searching: then you want results.
  const showActions = !raw;
  state.rows = showActions ? [...actions(), ...found] : found;

  const list = $('#list');
  list.replaceChildren();

  if (!state.rows.length) {
    list.append(emptyRow(text, tags));
    // An open note stays open even when nothing matches any more (you deleted
    // the word you searched for): closing it mid-word lost your place.
    if (!state.editing) showInPane(null);
    updateKeyHint(null);
    return;
  }

  let last = null;
  state.rows.forEach((item, idx) => {
    const group = item.kind === 'action' ? null
      : text ? TYPES[item.kind].label
      // Pinned things are kept at the top already; now the list says why.
      : state.filter === 'all' ? (item.pinned ? 'Pinned' : 'Recent')
      : TYPES[item.kind].label;
    if (group && group !== last) { list.append(el('li', { class: 'g-head' }, group)); last = group; }
    list.append(rowFor(item, idx, text));
  });
  // Only the actions are left: the filter has nothing of its own yet. Say what
  // goes here and how it gets here, under the action that adds it.
  if (!raw && !found.length && !libraryEmpty()) {
    list.append(el('li', { class: 'empty hint' }, EMPTY[state.filter] || EMPTY.all));
  }

  const acts = list.querySelectorAll('.row.act');
  if (acts.length) {
    acts[0].classList.add('act-first');
    acts[acts.length - 1].classList.add('act-last');
  }

  // Saving a note reorders the list by updated_at, and inserting one adds a row
  // above it. The selection is an index, so it would quietly come to rest on a
  // different note and close the editor out from under whoever was typing.
  // Follow the note being edited instead.
  const editingHere = state.editing?.id
    ? state.rows.findIndex((r) => r.kind === 'note' && r.id === state.editing.id) : -1;
  if (editingHere > -1) state.active = editingHere;
  // Otherwise the selection follows the thing that was selected, not its place
  // in the list: a clip captured in the background, or a sync, adds rows above
  // it, and an index left you looking at whatever had moved into that place.
  else if (!state.editing && state.activeKey) {
    const here = state.rows.findIndex((r) => rowKey(r) === state.activeKey);
    if (here > -1) state.active = here;
  }
  // A note being edited that has no row here leaves the pane alone: a new note
  // not written yet (a tag or a colour picked before the first word), or one
  // that no longer matches the search or tag it was opened from. Redrawing
  // used to select whatever row was in its place, which closed the note and
  // sent the next words typed into another one.
  if (state.editing && editingHere === -1) {
    $('#list').querySelectorAll('[role=option]').forEach((e) => e.setAttribute('aria-selected', 'false'));
    $('#q').removeAttribute('aria-activedescendant');
    return;
  }
  if (state.active >= state.rows.length) state.active = 0;
  // Until you pick something, the first thing shown is your own: the newest
  // note or link, not "Unlock the vault", whose lock screen used to be the
  // first thing anyone saw on opening.
  if (!state.picked && !raw && !state.editing && !state.vEditing && state.rows[state.active]?.kind === 'action') {
    const first = state.rows.findIndex((r) => r.kind !== 'action');
    if (first > -1) state.active = first;
  }
  // A fresh install has only action rows. Picking the first one for you would
  // fill the pane with, say, the vault's password form before you asked; the
  // welcome is the better first thing to see. Arrow keys or the mouse pick a
  // row as usual.
  if (libraryEmpty() && !raw && !state.editing && !state.vEditing && !state.picked) {
    setActive(-1, false);
    showInPane(null);
    return;
  }
  setActive(state.active, true);
}

function emptyRow(text, tags) {
  if (state.filter === 'vault' && state.vaultState !== 'open') {
    return el('li', { class: 'empty' }, 'The vault is locked, so its items are not listed. Unlock it on the right.');
  }
  const bits = [];
  if (text) bits.push(`matching “${text}”`);
  if (tags.length) bits.push(`tagged ${tags.map((t) => '#' + t).join(' and ')}`);
  return el('li', { class: 'empty' }, bits.length ? `Nothing ${bits.join(' ')}.` : (EMPTY[state.filter] || EMPTY.all));
}

// An empty list says what belongs in it and how to put something there, rather
// than "Nothing here yet", which is true and no help.
const EMPTY = {
  all: 'Nothing here yet.',
  today: 'Nothing for today. Pinned items, unread links, and notes and clips from the last day show up here.',
  note: 'No notes yet. Type in “Take a note…” above, or press Alt+Shift+K on any page.',
  link: 'Nothing to read later. Alt+Shift+S saves the tab you are on; right-click a link to save that instead.',
  clip: 'No clips yet. Alt+Shift+V saves what you copied. To keep everything you copy on a site, turn on capture in Settings.',
  vault: 'No logins saved yet.'
};

// ---------- The add-note section ----------
// A line typed here is the note. Adding one used to mean opening an empty editor
// first, which is a step and then a blank page; the common case is one sentence
// you want out of your head. Shown under Everything and Notes only: under Read
// later, Clipboard or Vault it would be offering to make the wrong kind of thing.
// The text is kept when it is hidden, so switching type and back loses nothing.
function drawCompose() {
  const makesNotes = state.filter === 'all' || state.filter === 'note' || state.filter === 'today';
  $('#compose').classList.toggle('hidden', !makesNotes);
}

function drawHead(text, tags) {
  const head = $('#listhead');
  const T = TYPES[state.filter];
  const parts = [filterLabel(state.filter), ...tags.map((t) => '#' + t)].filter(Boolean);
  const where = parts.length ? parts.join(' ') : (text ? 'Results' : 'Everything');
  const n = matches($('#q').value.trim()).length;
  // A narrowed list is often the thing you want to take somewhere else: the
  // links tagged #launch for a doc, the quotes in a swipe file.
  const narrowed = state.filter !== 'all' || text || tags.length;

  // replaceChildren does not skip nulls the way el() does, so filter first.
  head.replaceChildren(...[
    T ? el('span', { class: 'dot', style: `background:${T.color}` }) : null,
    el('span', { class: 'where' }, where),
    el('span', { class: 'n' }, text ? (n === 1 ? '1 match' : `${n} matches`) : plural(n, 'item')),
    narrowed && n && state.filter !== 'vault'
      // Labelled, like Clear beside it: a list icon alone did not say "copy".
      ? el('button', { class: 'copy-list', id: 'copy-list', title: 'Copy what is listed here, as text to paste anywhere',
          onclick: safe(copyList) }, icon('copy'), 'Copy')
      : null,
    narrowed
      ? el('button', { class: 'clear', id: 'clear-filter', title: 'Clear the search, tags and type: show everything',
          onclick: () => { $('#q').value = ''; setFilter('all'); } }, 'Clear')
      : null
  ].filter(Boolean));
}

function drawTagbar(text, tags) {
  const bar = $('#tagbar');
  // Each chip's count is what would be left if you also pressed it, so a chip can
  // never lead to an empty list without saying so first.
  const pool = state.items.filter((i) =>
    inFilter(i) &&
    tags.every((t) => i.tags.includes(t)) &&
    (!text || score(i, text) > 0));

  bar.replaceChildren(...allTags().map((t) => {
    const on = tags.includes(t);
    const n = on ? pool.length : pool.filter((i) => i.tags.includes(t)).length;
    const color = state.tagColors[t];
    return el('button', {
      'data-tag': t, 'aria-pressed': String(on), disabled: !on && !n,
      onclick: () => toggleTag(t)
    },
      color ? el('span', { class: 'tg-dot', style: `background:${color}` }) : el('span', { class: 'hash' }, '#'),
      t, el('span', { class: 'n' }, String(n)));
  }));

  // Only fade the edge when there is actually more to scroll to.
  const fade = () => bar.classList.toggle('more', bar.scrollWidth - bar.clientWidth - bar.scrollLeft > 4);
  bar.onscroll = fade; fade();

  $$('.rail [data-f]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.f === state.filter)));
}

// Highlights the matched run in a row's text without using innerHTML on user data.
function highlight(text, query) {
  if (!query) return [text];
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return [text];
  return [text.slice(0, i), el('mark', {}, text.slice(i, i + query.length)), text.slice(i + query.length)];
}

function rowFor(item, idx, query) {
  if (item.kind === 'action') {
    // One line each: the detail pane spells the action out when it is selected,
    // so repeating it here cost four rows of a list that only shows about ten.
    return el('li', {
      class: 'row act', id: 'r' + idx, role: 'option', 'aria-selected': 'false', 'data-i': idx,
      onclick: () => clickRow(idx)
    },
      icon(item.icon || 'plus'),
      el('span', { class: 't' }, item.title),
      item.where ? el('span', { class: 'where' }, item.where) : null,
      item.kbd ? el('span', { class: 'kbd' }, item.kbd) : null);
  }

  const T = TYPES[item.kind];
  const when = item.when ? ago(item.when) : '';
  const sub = [item.sub, when].filter(Boolean).join(' · ');

  return el('li', {
    class: ['row', 'k-' + item.kind, item.read ? 'read' : '', item.kind === 'vault' ? 'locked-able' : ''].filter(Boolean).join(' '),
    id: 'r' + idx, role: 'option', 'aria-selected': 'false', 'data-i': idx,
    onclick: () => clickRow(idx)
  },
    rowMark(item, T),
    el('span', { class: 'body' },
      el('span', { class: 't' + (item.mono ? ' mono' : '') }, ...highlight(item.title, query)),
      el('span', { class: 'm' },
        // How far along a task list is, readable without opening it.
        item.progress ? el('span', {
          class: 'prog' + (item.progress.done === item.progress.total ? ' all' : ''), 'aria-hidden': 'true'
        }, el('i', { style: `width:${Math.round((item.progress.done / item.progress.total) * 100)}%` })) : null,
        ...item.tags.map((t) => el('span', {
          // The tag's colour as a dot, the name in the normal ink: a yellow
          // name on white could not be read.
          class: 'tg'
        }, state.tagColors[t] ? el('span', { class: 'tg-dot', style: `background:${state.tagColors[t]}` }) : '#', t)),
        ...highlight(sub, query))),
    item.secret ? el('span', { class: 'mark-i', title: 'Looks like a key or token: hidden and left out of search' }, icon('key')) : null,
    item.pinned ? el('span', { class: 'mark-i pinned', title: 'Pinned' }, icon('pin')) : null,
    item.row?.source === 'android' ? el('span', { class: 'mark-i', title: 'Saved from your phone' }, icon('phone')) : null,
    rowActions(item));
}

// What sits at the start of a row. A link shows its site's icon, which is how
// people recognise a page faster than by its title; a note shows its own colour
// as an edge; everything else keeps the dot of its type.
function rowMark(item, T) {
  if (item.kind === 'link') {
    const src = faviconFor(item.row.url);
    if (src) {
      const img = el('img', { class: 'fav', src, alt: '', loading: 'lazy' });
      img.addEventListener('error', () => img.replaceWith(el('span', { class: 'bul', style: `background:${T.color}` })));
      return img;
    }
  }
  return el('span', { class: 'bul', style: `background:${item.kind === 'note' ? colourVar(item.row) : T.color}` });
}

// Chrome's own favicon cache (the "favicon" permission), so nothing is fetched
// from the site and nothing is stored with the row.
function faviconFor(url) {
  if (!/^https?:/i.test(url || '') || !chrome.runtime?.getURL) return null;
  return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`);
}

// The two things you do to a row without wanting to read it first. They appear
// on hover and on the selected row, so a quiet list stays quiet: showing them on
// every row would put forty buttons on screen and make delete easy to hit by
// accident. The detail pane keeps the full set.
function rowActions(item) {
  const stop = (fn) => safe(async (e) => { e.stopPropagation(); await fn(); });
  const kids = [];

  if (item.kind === 'note' || item.kind === 'clip') {
    kids.push(el('button', {
      title: item.pinned ? 'Unpin' : 'Pin', 'aria-label': item.pinned ? 'Unpin' : 'Pin',
      'aria-pressed': String(!!item.pinned),
      'data-row-act': 'pin', onclick: stop(() => togglePin(item))
    }, icon('pin')));
  }
  if (item.kind === 'link') {
    kids.push(el('button', {
      title: item.row.is_read ? 'Mark unread' : 'Mark read',
      'aria-label': item.row.is_read ? 'Mark unread' : 'Mark read',
      'data-row-act': 'read', onclick: stop(() => toggleRead(item))
    }, icon(item.row.is_read ? 'undo' : 'check')));
  }
  if (item.kind === 'vault') {
    kids.push(el('button', {
      title: 'Copy password', 'aria-label': 'Copy password',
      'data-row-act': 'copy', onclick: stop(() => copy(item.row.password || '', 'Password copied'))
    }, icon('key')));
  }

  kids.push(el('button', {
    title: 'Delete', 'aria-label': 'Delete ' + item.title,
    'data-row-act': 'delete', onclick: stop(() => remove(item))
  }, icon('trash')));

  return el('span', { class: 'row-acts' }, ...kids);
}

// Hovering a row only highlights it (CSS :hover). The pane changes when a row
// is chosen, by a click or the arrow keys, as in any mail or file list. It
// used to follow the mouse, so the pane jumped while you moved towards a
// button, and the hovered row looked just like the selected one.
async function clickRow(i) {
  // Awaited: closeEditor clears state.editing when its save resolves, so firing
  // it and carrying on would wipe the session we are about to open. Clicking
  // "New note" with an editor already open lost the new note that way.
  if (state.editing) await closeEditor();
  if (state.vEditing) closeVaultEditor();        // an unsaved login is discarded, by design
  state.picked = true;
  setActive(i, false);
  // An action row is a button, not something to inspect: clicking it runs it.
  // Selecting it and making you click "Do it" in the other pane read as nothing
  // happening at all, which is exactly how "New note" felt.
  const item = state.rows[i];
  if (item && item.kind === 'action') {
    // setActive queued a pane update for the action row. Let it finish, or it
    // lands after the editor opens and paints over it.
    await paneQueue;
    return runRow(item);
  }
  $('#q').focus();
}

// Shared by Enter and by clicking an action row.
function runRow(item) {
  if (item.action === 'vault') return drawVaultGate({ focus: true });
  if (item.action === 'login') return openVaultEditor(null);
  if (item.disabled) return toast(item.action === 'tab' ? "Can't save this page" : 'Not available here');
  runAction(item.action);
}

// What a row is, independent of where it sits in the list.
const rowKey = (r) => (r ? `${r.kind}:${r.id ?? r.action}` : null);

function setActive(i, scroll) {
  state.active = i;
  state.activeKey = rowKey(state.rows[i]);
  // Only a click or an arrow key counts as picking (see clickRow and the #q
  // keydown handler). Counting every setActive did not work: the list is drawn
  // once while the popup is still loading, and that draw selecting the first
  // row hid the welcome on a fresh install behind "Set up your vault".
  const list = $('#list');
  list.querySelectorAll('[role=option]').forEach((e) => e.setAttribute('aria-selected', 'false'));
  const row = list.querySelector('#r' + i);
  const q = $('#q');
  updateKeyHint(state.rows[i]);
  if (!row) { q.removeAttribute('aria-activedescendant'); return; }
  row.setAttribute('aria-selected', 'true');
  q.setAttribute('aria-activedescendant', 'r' + i);
  if (scroll) row.scrollIntoView({ block: 'nearest' });
  if (!state.vEditing) showInPane(state.rows[i]);
}

// The footer names what Enter will do to the row you are on, since that differs
// by kind and nobody reads a shortcut sheet.
const KEY_HINTS = {
  action: '⏎ run',
  note: '⏎ write · ⇧⏎ insert in page',
  link: '⏎ open',
  clip: '⏎ copy · ⇧⏎ insert in page',
  vault: '⏎ fill · Ctrl+⏎ copy password'
};
function updateKeyHint(item) {
  const h = $('#keyhint');
  if (!h) return;
  const what = item ? (item.kind === 'vault' && state.vaultState !== 'open' ? '⏎ unlock' : KEY_HINTS[item.kind]) : '⏎ open';
  h.textContent = `↑↓ move · ${what}`;
}

// A note has no read-only state: the pane renders it the same either way, so an
// Edit button was a click that changed nothing you could see. Selecting a note
// puts it in the pane ready to type in; focus stays in the search field until
// you click into the note or press Enter, so arrowing through the list still
// works as a list.
//
// Switches are serialized for the same reason saves are: leaving a note writes
// it, and starting the next one before that finished used to clear the editor
// out from under itself.
let paneQueue = Promise.resolve();

function showInPane(item) {
  paneQueue = paneQueue.then(async () => {
    const editing = state.editing;
    if (editing && item?.kind === 'note' && item.id && editing.id === item.id) return;  // already open
    if (editing) await closeEditor({ redraw: false, keepWidth: item?.kind === 'note' });
    if (!item) return drawDetail(null);
    if (item.kind === 'note') return openEditor(item, false);
    applyEditorWidth(false);
    drawDetail(item);
  }).catch((e) => console.error(e));
  return paneQueue;
}

// Choosing a type leaves the note you are in: it is saved first, then the
// list shows the new filter. (This used to happen by accident, when the redraw
// opened the highlighted row in the note's place.)
const setFilter = safe(async (f) => {
  if (state.editing) await closeEditor({ redraw: false });
  if (state.vEditing) closeVaultEditor();
  if (state.screen) setScreen(null);
  state.filter = f; state.active = 0;
  draw();
  $('#q').focus();
});
$$('.rail [data-f]').forEach((b) => b.addEventListener('click', () => setFilter(b.dataset.f)));

// ---------- Detail pane ----------
function band(kindKey, title, sub, plain) {
  const T = TYPES[kindKey];
  return el('header', { class: 'd-band' + (plain ? ' plain' : '') },
    el('div', { class: 'd-kind' },
      el('span', { class: 'bul', style: `background:${T ? T.color : 'var(--ink)'}` }),
      T ? T.one : 'Action'),
    el('h2', { class: 'd-title' }, title),
    sub ? el('p', { class: 'd-sub' }, sub) : null);
}

function drawDetail(item) {
  const pane = $('#detail');
  pane.replaceChildren();

  if (!item) {
    if (libraryEmpty() && !$('#q').value.trim()) return drawWelcome();
    pane.append(el('div', { class: 'sc-empty' }, 'Nothing selected.'));
    return;
  }

  if (item.kind === 'action') return drawActionDetail(item);
  if (item.kind === 'vault' && state.vaultState !== 'open') return drawVaultGate();

  const T = TYPES[item.kind];
  const tint = item.kind === 'note'
    ? `background:${colourVar(item.row)};color:${colourFg(item.row)}` : null;
  pane.append(
    el('header', { class: 'd-band', style: tint },
      el('div', { class: 'd-kind' }, el('span', { class: 'bul', style: `background:${T.color}` }), T.one),
      el('h2', { class: 'd-title' + (item.mono ? ' mono' : '') }, item.title),
      el('p', { class: 'd-sub' }, detailSub(item))),
    tagRow(item),
    el('div', { class: 'd-body' }, ...detailBody(item)),
    el('footer', { class: 'd-foot' }, ...detailFoot(item))
  );
}

function detailSub(item) {
  const when = item.when ? ago(item.when) : '';
  if (item.kind === 'link') return [hostOf(item.row.url), item.row.is_read ? 'read' : null, when].filter(Boolean).join(' · ');
  if (item.kind === 'clip') return [item.row.source_url, when].filter(Boolean).join(' · ');
  if (item.kind === 'vault') return item.row.url || '';
  return when;
}

function detailBody(item) {
  if (item.kind === 'note') {
    // Notes are plain text. Legacy HTML notes are flattened to text first, so
    // reading one shows words rather than tags.
    const text = txt.toPlain(item.row);
    return [text.trim()
      ? el('div', { class: 'plain' }, text)
      : el('p', { class: 'muted' }, 'Empty note.')];
  }
  if (item.kind === 'clip') {
    if (item.secret) {
      return [
        el('div', { class: 'wrap v code', id: 'clip-v', 'data-shown': '' }, detect.mask(item.row.content)),
        el('p', { class: 'muted small' },
          'This looks like a key or token, so it is hidden here and left out of search. Copy and Insert still use the real value. Clipboard history is not encrypted: the vault is the safer place for it.')
      ];
    }
    return [el(item.mono ? 'pre' : 'div', { class: item.mono ? 'wrap v code' : 'wrap v' }, item.row.content)];
  }
  if (item.kind === 'link') {
    return [
      el('div', { class: 'field' }, el('span', { class: 'k' }, 'Link'), el('span', { class: 'v' }, item.row.url)),
      el('div', { class: 'field' }, el('span', { class: 'k' }, 'Saved'),
        el('span', { class: 'v' }, item.row.source === 'android' ? 'from your phone' : 'from a browser')),
      linkNote(item)
    ];
  }
  // vault, unlocked
  return [
    el('div', { class: 'field' }, el('span', { class: 'k' }, 'Site'), el('span', { class: 'v' }, item.row.url || '—')),
    el('div', { class: 'field' }, el('span', { class: 'k' }, 'Username'), el('span', { class: 'v' }, item.row.username || '—')),
    el('div', { class: 'field' }, el('span', { class: 'k' }, 'Password'),
      el('span', { class: 'v', id: 'vpw' }, '•'.repeat(Math.min(16, (item.row.password || '').length) || 8))),
    item.row.notes ? el('p', { class: 'wrap', style: 'margin-top:12px' }, item.row.notes) : null
  ].filter(Boolean);
}

function detailFoot(item) {
  const del = el('button', { class: 'ghost', title: 'Delete', 'aria-label': 'Delete', onclick: safe(() => remove(item)) }, icon('trash'));


  if (item.kind === 'link') {
    return [
      el('button', { class: 'primary', onclick: safe(() => openLink(item)) }, icon('open'), 'Open'),
      el('button', { class: 'ghost', onclick: safe(() => toggleRead(item)) },
        icon(item.row.is_read ? 'undo' : 'check'), item.row.is_read ? 'Mark unread' : 'Mark read'),
      el('button', { class: 'ghost', title: 'Copy the link', onclick: safe(() => copy(item.row.url, 'Link copied')) }, icon('copy'), 'Copy'),
      el('span', { class: 'spacer' }), del
    ];
  }
  if (item.kind === 'clip') {
    // Insert puts the clip into the field you were typing in on the page: the
    // reply you send every week, a UTM link, a command for a terminal in a tab.
    const insert = state.tabId
      ? el('button', { class: 'ghost', id: 'clip-insert', title: 'Type it into the field you were in on the page (Shift+Enter)',
          onclick: () => insertIntoPage(item.row.content) }, icon('insert'), 'Insert')
      : null;
    if (item.secret) {
      return [
        el('button', { class: 'primary', onclick: safe(() => copy(item.row.content)) }, icon('copy'), 'Copy'),
        insert,
        el('button', { class: 'ghost', id: 'clip-show', onclick: () => revealClip(item) }, icon('eye'), 'Show'),
        el('button', { class: 'ghost', id: 'clip-vault', title: 'Save it in the vault, encrypted, and remove the clip',
          onclick: () => clipToVault(item) }, icon('shield'), 'To vault'),
        el('span', { class: 'spacer' }), del
      ];
    }
    return [
      el('button', { class: 'primary', onclick: safe(() => copy(item.row.content)) }, icon('copy'), 'Copy'),
      insert,
      el('button', { class: 'ghost', onclick: safe(() => togglePin(item)) }, icon('pin'), item.pinned ? 'Unpin' : 'Pin'),
      el('button', { class: 'ghost', onclick: safe(() => clipToNote(item)) }, icon('edit'), 'As note'),
      el('span', { class: 'spacer' }), del
    ];
  }
  // vault
  const canFill = hostMatches(item.row.url, state.tabHost);
  return [
    canFill
      ? el('button', { class: 'primary', onclick: () => fillItem(item.row) }, icon('fill'), 'Fill on this page')
      : el('button', { class: 'primary', onclick: safe(() => copy(item.row.password || '', 'Password copied')) }, icon('key'), 'Copy password'),
    el('button', { class: 'ghost', onclick: safe(() => copy(item.row.username || '', 'Username copied')) }, icon('user'), 'Copy user'),
    el('button', { class: 'ghost', onclick: () => revealPassword(item) }, icon('eye'), 'Show'),
    el('button', { class: 'ghost', onclick: () => openVaultEditor(item) }, icon('edit'), 'Edit'),
    el('span', { class: 'spacer' }),
    el('button', { class: 'ghost', title: 'Lock the vault', 'aria-label': 'Lock the vault', onclick: safe(lockVault) }, icon('lock')),
    del
  ];
}

function revealPassword(item) {
  const e = $('#vpw');
  if (!e) return;
  const shown = e.dataset.shown === '1';
  e.dataset.shown = shown ? '' : '1';
  e.textContent = shown ? '•'.repeat(Math.min(16, (item.row.password || '').length) || 8) : (item.row.password || '');
}

function revealClip(item) {
  const e = $('#clip-v');
  if (!e) return;
  const shown = e.dataset.shown === '1';
  e.dataset.shown = shown ? '' : '1';
  e.textContent = shown ? detect.mask(item.row.content) : item.row.content;
  const b = $('#clip-show');
  if (b) b.lastChild.textContent = shown ? 'Show' : 'Hide';
}

// A key in clipboard history is a key in plain text. The vault encrypts it, so
// this moves it there and erases the clip, the same way deleting a clip does.
function clipToVault(item) {
  if (state.vaultState !== 'open') {
    toast(state.vaultState === 'setup' ? 'Set up the vault first' : 'Unlock the vault first');
    return drawVaultGate({ focus: true });
  }
  const host = item.row.source_url || '';
  openVaultEditor(null, {
    title: host ? `Key for ${host}` : 'API key', url: host ? 'https://' + host : '',
    username: '', password: item.row.content, notes: '', fromClip: item.id
  });
}

// Your note on a saved link: why you saved it, the quote that mattered, what to
// do with it. The column was in the schema from the start and only the phone
// could write it. Saved as you type, like a note, because the popup can close
// at any moment.
function linkNote(item) {
  const box = el('textarea', { class: 'link-note', id: 'link-note', rows: '3', spellcheck: 'true',
    placeholder: 'Add a note: why you saved it, a quote, what to do with it…',
    'aria-label': 'Your note about this link' });
  box.value = item.row.note || '';
  const save = () => {
    clearTimeout(box._t);
    if ((item.row.note || '') === box.value) return;
    item.row.note = box.value;
    db.update('read_later', item.id, { note: box.value }).catch((e) => { console.error(e); toast('Could not save the note'); });
  };
  linkNote.flush = save;
  box.addEventListener('input', () => { clearTimeout(box._t); box._t = setTimeout(save, 300); });
  box.addEventListener('blur', save);
  box.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); save(); $('#q').focus(); }
  });
  return box;
}

// ---------- Insert into the page ----------
// Runs in the page, in the extension's isolated world, injected only by a click
// or Shift+Enter. It types into whatever field had focus before DeskSync opened:
// opening the popup does not move focus inside the page.
// `html`, when given, is the same text with its bold and italic: a rich editor
// (Gmail, Docs, Notion) gets that, a plain field gets `text`.
function pageInsert(text, html) {
  const el = document.activeElement;
  const fire = (t) => t.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  const typable = el && (el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' && /^(text|search|email|url|tel|)$/i.test(el.type || '')));
  if (typable) {
    if (el.disabled || el.readOnly || el.type === 'password') return { ok: false };
    el.focus();
    try {
      const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? el.value.length;
      el.setRangeText(text, a, b, 'end');
    } catch {
      // email and url inputs have no selection API: add to the end instead.
      el.value += text;
    }
    fire(el);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  }
  if (el && el.isContentEditable) {
    el.focus();
    if (html && document.execCommand('insertHTML', false, html)) return { ok: true };
    if (document.execCommand('insertText', false, text)) return { ok: true };
    const sel = getSelection();
    if (!sel || !sel.rangeCount) return { ok: false };
    const r = sel.getRangeAt(0);
    r.deleteContents();
    r.insertNode(document.createTextNode(text));
    r.collapse(false);
    fire(el);
    return { ok: true };
  }
  return { ok: false };
}

// `formatted`: the text is a note's, whose ** and _ are bold and italic. A
// clip is raw text that may contain them for real (code, a file name), and is
// inserted exactly as it is, the same as Copy gives it.
function insertIntoPage(text, { formatted = false } = {}) {
  const { tabId, tabOrigin } = state;
  if (!tabId || !text) return toast('No page to insert into');
  const run = async () => {
    // Markers off for a plain field; real bold and italic for a rich one.
    const rich = formatted && fmt.hasInline(text) ? fmt.toHtml(text) : null;
    const plain = formatted ? fmt.strip(text) : text;
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: pageInsert, args: [plain, rich] });
    if (!res?.result?.ok) return toast('Click into a text box on the page first, then insert');
    toast('Inserted');
    if (VIEW === 'popup') setTimeout(() => window.close(), 500);
  };
  // Opening the popup granted activeTab for the page behind it. The side panel
  // and a tab get no such grant, so they ask for the site, inside the click
  // (permissions.request needs the gesture, which is why nothing is awaited first).
  const go = VIEW === 'popup' ? run()
    : chrome.permissions.request({ origins: [tabOrigin] })
        .then((ok) => (ok ? run() : toast('DeskSync needs access to this site to insert text')));
  go.catch((e) => { console.error(e); toast(/cannot be scripted|Cannot access/i.test(e?.message || '') ? "Chrome doesn't let extensions type on this page" : (e.message || "Couldn't insert here")); });
}

// ---------- Copy as a list ----------
// What is in the list right now, as text you can paste into a doc, an email or
// a brief. Links keep their URL and your note on them; secret clips and vault
// items are never included.
async function copyList() {
  const items = matches($('#q').value.trim());
  const indent = (t) => t.trim().replace(/\n/g, '\n  ');
  const lines = items.map((i) => {
    if (i.kind === 'link') return `- ${i.title}\n  ${i.row.url}` + (i.row.note?.trim() ? `\n  ${indent(i.row.note)}` : '');
    if (i.kind === 'note') {
      // As it reads, not as it is stored: no ** or _, and tasks as boxes.
      const body = fmt.strip(txt.toPlain(i.row).split('\n').map((l) => {
        const p = tasks.parse(l);
        return p?.kind === 'task' ? `${p.indent}${p.checked ? '☑' : '☐'} ${p.rest}` : l;
      }).join('\n')).trim();
      return `- ${i.title}` + (body && body !== i.title ? `\n  ${indent(body)}` : '');
    }
    if (i.kind === 'clip' && !i.secret) return `- ${indent(i.row.content)}`;
    return null;
  }).filter(Boolean);
  if (!lines.length) return toast('Nothing here to copy');
  await writeClipboard(lines.join('\n'));
  toast(`Copied ${plural(lines.length, 'item')} as a list`);
}

// ---------- Side panel ----------
// Keeps DeskSync open beside the page while you work in it. Called straight
// from the click: sidePanel.open needs the user gesture.
function openSidePanel() {
  if (!chrome.sidePanel?.open || state.windowId == null) return toast('The side panel needs Chrome 116 or later');
  chrome.sidePanel.open({ windowId: state.windowId })
    .then(() => { if (VIEW === 'popup') window.close(); })
    .catch((e) => { console.error(e); toast(e.message || 'Could not open the side panel'); });
}
$('#to-panel').addEventListener('click', openSidePanel);
if (VIEW !== 'popup' || !chrome.sidePanel?.open) $('#to-panel').hidden = true;

// An action's pane shows what it will make, with a button that names the thing
// it does. The header is neutral rather than a type's colour: yellow is a note,
// and an action is not one yet.
function drawActionDetail(item) {
  if (item.action === 'vault') return drawVaultGate();
  if (item.action === 'login') {
    return actionPane(item, [el('p', { class: 'muted' }, 'A username, a password and the site it is for, encrypted before it is saved.')],
      'New login', () => openVaultEditor(null));
  }
  if (item.action === 'tab') {
    if (!state.tabUrl) {
      return actionPane(item, [el('p', { class: 'muted' }, 'This tab is not a web page, so there is nothing to save. Open a page and try again.')],
        'Save tab', null);
    }
    const already = state.later.some((r) => r.url === state.tabUrl);
    return actionPane(item, [
      el('div', { class: 'preview link-preview' },
        state.tabFavicon ? el('img', { class: 'fav', src: state.tabFavicon, alt: '' }) : icon('globe'),
        el('span', { class: 'body' },
          el('span', { class: 't' }, state.tabTitle),
          el('span', { class: 'u' }, state.tabUrl))),
      already ? el('p', { class: 'muted' }, 'Already in Read later. Saving it again adds a second copy.') : null
    ], 'Save tab', () => runAction('tab'), item.kbd);
  }
  if (item.action === 'clip') {
    const box = el('div', { class: 'preview plain clip-preview' }, 'Reading the clipboard…');
    readClipboardPreview(box);
    return actionPane(item, [box,
      el('p', { class: 'muted' }, 'Saved once, now. Copying in the background stays off until you allow a site in Settings.')],
      'Save clipboard', () => runAction('clip'));
  }
}

function actionPane(item, body, label, run, kbd) {
  $('#detail').append(
    el('header', { class: 'd-band act-band' },
      el('div', { class: 'd-kind' }, icon(item.icon || 'plus'), 'Add'),
      el('h2', { class: 'd-title' }, item.title)),
    el('div', { class: 'd-body' }, ...body.filter(Boolean)),
    el('footer', { class: 'd-foot' },
      el('button', { class: 'primary', disabled: !run, onclick: run ? safe(run) : null },
        label, kbd ? el('span', { class: 'kbd-in' }, kbd) : null)));
}

// What "Save clipboard" would save. Reading can fail — nothing copied, or the
// browser refusing without a click — and then the pane says so instead.
async function readClipboardPreview(box) {
  let text = '';
  try { text = (await navigator.clipboard.readText()).trim(); } catch { /* shown below */ }
  if (!box.isConnected) return;
  if (!text) {
    box.classList.add('empty');
    box.textContent = 'The clipboard looks empty. Copy something, then save it here.';
    return;
  }
  box.textContent = text.length > 600 ? text.slice(0, 600) + '…' : text;
}

// A fresh install: nothing saved yet and nothing searched. The pane explains
// the app instead of describing whichever action happens to be first.
function libraryEmpty() {
  return state.loaded && !state.notes.length && !state.later.length && !state.clips.length && !state.vault.length;
}

// Three things to do rather than a page to read: each one is a button that does
// it, and shows a tick once it is done. Knowing the shortcuts comes after.
function drawWelcome() {
  const pane = $('#detail');
  pane.replaceChildren();
  const k = (keys, what) => el('div', { class: 'w-key' }, el('kbd', {}, keys), el('span', {}, what));
  const step = (n, done, label, sub, run, disabled) => el('button', {
    class: 'w-step' + (done ? ' done' : ''), disabled: disabled || null, 'data-step': n,
    onclick: run ? safe(run) : null
  },
    el('span', { class: 'w-n' }, done ? icon('check') : String(n)),
    el('span', { class: 'w-txt' }, el('b', {}, label), el('span', {}, sub)));
  pane.append(
    el('header', { class: 'd-band act-band' },
      el('div', { class: 'd-kind' }, 'Welcome'),
      el('h2', { class: 'd-title' }, 'Everything stays in this browser'),
      el('p', { class: 'd-sub' }, 'No account needed. Notes, links, clips and passwords are saved here, and work offline.')),
    el('div', { class: 'd-body welcome' },
      el('div', { class: 'w-steps' },
        step(1, state.notes.length > 0, 'Take a note', 'A thought, a todo, a reply you keep retyping', () => startFromCompose()),
        step(2, state.later.length > 0, 'Save this tab to read later',
          state.tabHost ? state.tabHost : 'Open a web page first', () => runAction('tab'), !state.tabHost),
        step(3, !!state.clipCapture, 'Keep what you copy', 'Choose the sites, in Settings', () => setScreen('settings')),
        VIEW === 'popup' && chrome.sidePanel?.open
          ? step(4, false, 'Keep it open beside the page', 'The side panel stays while you click around', openSidePanel)
          : null),
      el('div', { class: 'w-keys' },
        k('Alt+Shift+D', 'open DeskSync'),
        k('Alt+Shift+S', 'save the tab you are on'),
        k('Alt+Shift+K', 'new note, from any page'),
        k('ds ␣ …', 'search from the address bar')),
      el('p', { class: 'muted' }, 'Want the same notes in your other Chrome profiles and on your phone? ',
        el('button', { class: 'link-btn', onclick: () => setScreen('settings') }, 'Sign in to sync'),
        ' — optional, and what is here now comes with you.'))
  );
}

// ---------- Item actions ----------
const togglePin = async (item) => {
  if (!item.id) return toast('Write something first, then pin it');
  await db.update(TYPES[item.kind].table, item.id, { pinned: !item.pinned });
  // The open editor is not redrawn by the reload, so its button follows here.
  if (state.editing && state.editing.id === item.id) {
    item.pinned = !item.pinned;
    const b = $('#ed-pin');
    if (b) {
      b.setAttribute('aria-pressed', String(item.pinned));
      b.title = item.pinned ? 'Unpin' : 'Pin to the top';
      b.setAttribute('aria-label', item.pinned ? 'Unpin' : 'Pin');
    }
    toast(item.pinned ? 'Pinned' : 'Unpinned');
  }
  item.kind === 'note' ? loadNotes() : loadClips();
};
const toggleRead = async (item) => {
  await db.update('read_later', item.id, { is_read: !item.row.is_read });
  loadLater();
};
async function openLink(item) {
  if (!/^https?:/i.test(item.row.url)) return toast('Blocked unsafe link');
  // Opening a tab closes the popup, so mark it read first. A failed update shouldn't block reading.
  if (!item.row.is_read) await db.update('read_later', item.id, { is_read: true }).catch(console.error);
  chrome.tabs.create({ url: item.row.url });
}
async function clipToNote(item) {
  await db.insert('notes', { title: item.row.content.slice(0, 40), body: item.row.content, format: 'plain', tags: item.tags });
  toast('Saved as note'); loadNotes();
}
async function remove(item) {
  // Clips have their text blanked on delete, so a copied password can't linger in the trash.
  if (item.kind === 'clip') await db.remove('clips', item.id, { content: '', source_url: null });
  else await db.remove(TYPES[item.kind].table, item.id);
  toast('Deleted');
  // The selection moves to the row that takes the deleted one's place.
  if (state.activeKey === rowKey(item)) state.activeKey = null;
  ({ note: loadNotes, link: loadLater, clip: loadClips, vault: loadVault })[item.kind]();
  // Trash and its count in Settings were only read once, when the popup opened.
  loadTrash();
}

const runAction = safe(async (what) => {
  if (what === 'tab') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!/^https?:/.test(tab?.url || '')) return toast("Can't save this page");
    const row = await db.insert('read_later', { url: tab.url, title: tab.title, favicon: tab.favIconUrl || null });
    toast('Saved to Read later');
    await loadLater();
    // Straight onto the saved link, so the note on why you saved it is one
    // click away while you still remember.
    const i = state.rows.findIndex((r) => r.kind === 'link' && r.id === row?.id);
    if (i > -1 && !state.editing) setActive(i, true);
  } else if (what === 'clip') {
    // Reading has no fallback the way writing does: without the API (a page
    // that is not secure) the clipboard simply cannot be read, so say so.
    if (!navigator.clipboard?.readText) return toast('Reading the clipboard needs DeskSync opened from its icon');
    const text = (await navigator.clipboard.readText()).trim().slice(0, DESKSYNC_CONFIG.CLIP_MAX_LENGTH);
    if (!text) return toast('Clipboard is empty');
    await db.insert('clips', { content: text });
    toast(detect.isSecret(text) ? 'Saved — it looks like a key, so it is hidden in the list' : 'Saved');
    loadClips();
  } else if (what === 'note') {
    newNote();
  }
});

// ---------- Tag row, shared by the detail pane and the editor ----------
function tagRow(item) {
  const box = el('div', { class: 'd-tags' });

  for (const t of item.tags) {
    const color = state.tagColors[t];
    box.append(el('span', { class: 't', style: color ? `background:${color}1f` : null },
      color ? el('span', { class: 'tg-dot', style: `background:${color};margin-right:2px` }) : '#',
      t,
      el('button', {
        class: 'x', 'aria-label': 'Remove tag ' + t,
        onclick: safe(async () => { await saveTags(item, item.tags.filter((x) => x !== t)); refreshAfterTags(item); })
      }, '\u00d7')));
  }

  // At the limit, + Tag says so rather than opening a box that cannot add.
  const full = item.tags.length >= tagRules.MAX_PER_ITEM;
  const add = el('button', {
    class: 'add', disabled: full || null,
    title: full ? `Up to ${tagRules.MAX_PER_ITEM} tags on one item: remove one to add another` : 'Add a tag'
  }, full ? `${tagRules.MAX_PER_ITEM} tags (most)` : '+ Tag');
  add.addEventListener('click', () => openTagPicker(item, box, add));
  box.append(add);
  return box;
}

// Picking a tag.
//
// This used to be an <input list=...> with a <datalist>. The browser draws that
// menu itself, in its own colours, ignoring everything around it — and it gives
// no way to show which name is about to be created rather than reused. The list
// is drawn here instead, so it matches the popup and can say so.
function openTagPicker(item, box, add) {
  // A little over the limit, so typing past it is not simply ignored: the name
  // is shortened when added, and the hint says so.
  const input = el('input', { placeholder: 'tag name', 'aria-label': 'New tag', maxlength: String(tagRules.MAX_LEN + 16),
    role: 'combobox', 'aria-expanded': 'true', 'aria-autocomplete': 'list' });
  const pop = el('div', { class: 'tag-pop', role: 'listbox', 'aria-label': 'Matching tags' });
  add.replaceWith(input);
  box.append(pop);

  let options = [];
  let active = 0;
  let done = false;

  const close = () => { if (!done) { done = true; pop.remove(); refreshAfterTags(item); } };

  const choose = safe(async (name) => {
    if (done) return;
    done = true;
    pop.remove();
    const r = tagRules.check(name, item.tags);
    if (r.ok) {
      await saveTags(item, [...item.tags, r.name]);
      if (r.reason) toast(`#${r.name}: ${r.reason.toLowerCase()}`);
    } else if (r.reason && r.reason !== 'Already on this item') {
      toast(r.reason);
    }
    refreshAfterTags(item);
  });

  const render = () => {
    const typed = normalizeTag(input.value);
    const verdict = tagRules.check(input.value, item.tags);
    // Typed text that cleans up to nothing ("???") matches nothing; it used to
    // match everything, and Enter added whichever tag came first.
    const unusable = !typed && !!input.value.trim();
    const known = unusable ? [] : allTags().filter((t) => !item.tags.includes(t) && (!typed || t.includes(typed)));
    options = known.map((t) => ({ name: t, isNew: false }));
    // Only offered when it is not already a tag, so the list never shows the
    // same name twice with two different meanings. And only when the rules
    // allow it: a name of punctuation is not offered as "new".
    if (verdict.ok && !known.includes(typed)) options.push({ name: typed, isNew: true });

    if (active >= options.length) active = Math.max(0, options.length - 1);
    // Why a name cannot be added, or that it will be shortened, under the list.
    const hint = verdict.reason ? el('div', { class: 'tag-hint', role: 'status' }, verdict.reason) : null;
    pop.replaceChildren(...options.map((o, i) => {
      const colour = state.tagColors[o.name];
      return el('button', {
        role: 'option', 'aria-selected': String(i === active), 'data-tag-option': o.name,
        onmousedown: (e) => { e.preventDefault(); choose(o.name); }
      },
        colour ? el('span', { class: 'tg-dot', style: `background:${colour}` })
               : el('span', { class: 'hash' }, '#'),
        o.name,
        o.isNew ? el('span', { class: 'new' }, 'new') : null);
    }), ...(hint ? [hint] : []));
    pop.hidden = options.length === 0 && !hint;
  };

  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown' && options.length) { e.preventDefault(); active = (active + 1) % options.length; render(); }
    else if (e.key === 'ArrowUp' && options.length) { e.preventDefault(); active = (active - 1 + options.length) % options.length; render(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      choose(options[active]?.name ?? input.value);
    } else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  // A click on the list is handled by mousedown above, so a blur here means the
  // user went somewhere else: take what they typed rather than losing it.
  input.addEventListener('blur', () => { if (!done) choose(input.value); });

  render();
  input.focus();
}

// After a tag change the row in the list is stale too, so redraw both panes.
function refreshAfterTags(item) {
  draw();
  // An editor whose draft is gone (it failed to open, or is closing) has
  // nothing to redraw; the list above is already up to date.
  if (state.editing) { if (state.draft) { drawEditor(); focusEditor(); } }
  else drawDetail(item);
}

// ---------- Note editor ----------
// A note is plain text. There is no toolbar, no markdown, no rich text: what
// you type is exactly what is stored and exactly what every other screen shows.
// A <textarea> is the whole editor, so selection, undo, spellcheck and the
// caret are the browser's own and behave the way they do everywhere else.
//
// There is no Save button either: a popup closes the moment you click anywhere
// else in the browser, so it writes as you type, debounced.

// `wide` gives this one note the whole popup without changing the remembered
// width: starting a note means writing, and writing wants the room. Selecting an
// existing note keeps the list beside it, so arrowing through notes still works.
function newNote(seed = '', tags = [], { wide = false } = {}) {
  const row = { id: null, title: '', body: seed, format: 'plain', tags: [...tags], color: 'yellow', pinned: false };
  openEditor({ kind: 'note', id: null, row, title: '', sub: '', tags: [...tags], when: null, isNew: true, wide });
  // Text that came from the composer never passed through an input event in the
  // editor, so nothing has marked the draft dirty — and an undirty new note is
  // thrown away as "opened and never typed into". Mark and save it here.
  // Tags alone are not a note: without a line of text there is nothing to write
  // yet, and claiming "Saving…" over an empty note would be a lie.
  if (seed.trim()) queueSave();
}

function openEditor(item, focus = true) {
  state.editing = item;
  // A new note gets its id here rather than from the server, so the popup, the
  // draft it may leave behind and the service worker replaying that draft all
  // name the same row. Without one, two of those three racing meant two notes.
  if (!item.id && !item.draftId) item.draftId = crypto.randomUUID();
  // Converted once, on open: a note written before the plain-text editor (HTML,
  // or markdown source) becomes plain text here and is saved that way from now on.
  state.draft = { title: item.row.title || '', body: txt.toPlain(item.row), tags: [...item.tags], dirty: false };
  drawEditor();
  if (focus) focusEditor();
}

function focusEditor() {
  const a = $('#ed-area');
  if (!a) return;
  a.focus();
  // Caret to the end, so typing continues the note rather than overwriting it.
  a.setSelectionRange(a.value.length, a.value.length);
}

const closeEditor = safe(async (opts = {}) => {
  const item = state.editing;
  if (!item) return;
  // Save before clearing state.editing, not after: anything typed inside the
  // autosave debounce is only in state.draft, and the flush needs to know which
  // note it belongs to. Clearing first lost the last few seconds of typing.
  await flushDraft(true, item);
  state.editing = null;
  if (opts.keepWidth !== true) applyEditorWidth(false);
  if (opts.redraw === false) return;
  draw();
  $('#q').focus();
});


// A note can be longer than a 310px list is useful, so the editor can take the
// whole popup. The width belongs to the note on screen, not to a setting: a new
// note starts full-size, a note picked from the list opens beside it, and the
// button switches the one you are in. It used to be remembered for every note,
// and then leaving a note re-selected it in the list and reopened it full-size,
// so Back and Esc looked as if they did nothing.
function applyEditorWidth(on) {
  $('#app').classList.toggle('wide', !!on);
}
const editorIsWide = () => !!state.editing?.wide;

function drawEditor() {
  const item = state.editing;
  const pane = $('#detail');
  pane.replaceChildren();
  applyEditorWidth(editorIsWide());

  const title = el('input', {
    class: 't-in', id: 'ed-title', value: state.draft.title,
    placeholder: 'Untitled', 'aria-label': 'Note title'
  });
  title.addEventListener('input', () => { state.draft.title = title.value; queueSave(); refreshEditorBits(); });
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); focusEditor(); }
    if (e.key === 'Escape') { e.preventDefault(); closeEditor(); }
  });

  // How much of the popup the note gets.
  const widthBtn = el('button', {
        id: 'ed-wide', 'data-wide': String(editorIsWide()),
        title: editorIsWide() ? 'Show the list again' : 'Give the note the whole popup',
        'aria-label': editorIsWide() ? 'Show the list again' : 'Give the note the whole popup',
        'aria-pressed': String(editorIsWide()),
        onclick: safe(async () => {
          const wide = !editorIsWide();
          if (state.editing) state.editing.wide = wide;
          applyEditorWidth(wide);
          const btn = $('#ed-wide');
          btn.setAttribute('aria-pressed', String(wide));
          btn.querySelector('use').setAttribute('href', wide ? '#i-collapse' : '#i-expand');
          btn.title = wide ? 'Show the list again' : 'Give the note the whole popup';
          btn.setAttribute('aria-label', btn.title);
          $('#ed-area')?.focus();
        })
      }, icon(editorIsWide() ? 'collapse' : 'expand'));

  // The way out, where people look for it: top left, labelled.
  const backBtn = el('button', {
    class: 'ed-back', id: 'ed-back', title: 'Back to the list (Esc)', 'aria-label': 'Back to the list',
    onclick: () => closeEditor()
  }, icon('back'), el('span', {}, 'Back'));

  // What you see is what you get: bold is bold, a task is a checkbox, and no
  // ** or [ ] is in sight. The note underneath is still the plain text it
  // always was; see lib/editor.js for how the two are kept the same.
  const body = el('div', {
    class: 'ed-rich', id: 'ed-area', contenteditable: 'true', role: 'textbox',
    'aria-multiline': 'true', spellcheck: 'true', 'aria-label': 'Note',
    'data-placeholder': 'Write, or start a list with [ ] or - …'
  });
  richEditor.make(body, state.draft.body);
  body.addEventListener('input', (e) => {
    if (e.isComposing) return;
    readBack(); queueSave(); refreshEditorBits(); updateTools();
  });
  // The buttons light up for wherever the caret is, however it got there.
  for (const ev of ['mouseup', 'keyup', 'focus']) body.addEventListener(ev, () => setTimeout(updateTools, 0));

  // The formatting buttons, always on screen above the note. mousedown is
  // stopped on every one, so pressing a button never takes the caret or the
  // selection out of the note.
  const fmtBtn = (key, label, title, run, content) => el('button', {
    'data-fmt': key, title, 'aria-label': label, 'aria-pressed': 'false',
    onmousedown: (e) => { e.preventDefault(); run(); },
    // The keyboard reaches them too (Tab from the title): Enter or Space.
    onclick: (e) => { if (e.detail === 0) run(); }
  }, content);
  const tools = el('div', { class: 'ed-tools', id: 'ed-tools', role: 'toolbar', 'aria-label': 'Formatting' },
    fmtBtn('bold', 'Bold', 'Bold (Ctrl+B)', () => applyInline('**'), el('b', {}, 'B')),
    fmtBtn('italic', 'Italic', 'Italic (Ctrl+I)', () => applyInline('_'), el('i', {}, 'I')),
    el('span', { class: 'sep' }),
    fmtBtn('task', 'Checklist', 'Checklist (Ctrl+Enter ticks)', () => applyLines('task'), icon('check')),
    fmtBtn('bullet', 'Bullet list', 'Bullet list', () => applyLines('bullet'), icon('list')),
    fmtBtn('number', 'Numbered list', 'Numbered list', () => applyLines('number'), el('span', { class: 'num' }, '1.')));
  body.addEventListener('keydown', editorKeydown);
  body.addEventListener('mousedown', editorBoxDown);
  body.addEventListener('paste', editorPaste);
  state.find = null;

  // An empty note asks what it is going to be. Gone as soon as it has words.
  // Notes you saved as templates come after the three built-in starts.
  const templates = state.notes
    .filter((n) => (n.tags || []).includes(TEMPLATE_TAG) && n.id !== item.id)
    .slice(0, 4);
  const start = el('div', { class: 'ed-start', id: 'ed-start', role: 'group', 'aria-label': 'Start as' },
    el('span', { class: 'lab' }, 'Start as'),
    el('button', { 'data-start': 'note', onclick: () => focusEditor() }, icon('note'), 'Note'),
    el('button', { 'data-start': 'tasks', onclick: () => startAs('tasks') }, icon('check'), 'Tasks'),
    el('button', { 'data-start': 'email', onclick: () => startAs('email') }, icon('edit'), 'Email'),
    ...templates.map((n) => el('button', {
      class: 'tpl', 'data-template': n.id, title: 'Start from this template',
      onclick: () => startFromTemplate(n)
    }, icon('copy'), (n.title || txt.toText(n)).slice(0, 24) || 'Template')),
    templates.length ? null : el('span', { class: 'tip' }, 'or type /task'));

  // Find in this note. Ctrl+F in a popup finds nothing: the browser's own find
  // bar does not reach it.
  const findIn = el('input', { id: 'ed-find-in', type: 'text', placeholder: 'Find in note',
    'aria-label': 'Find in this note', autocomplete: 'off', spellcheck: 'false' });
  findIn.addEventListener('input', () => runFind(findIn.value));
  findIn.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); closeFind(true); }
  });
  const find = el('div', { class: 'ed-find', id: 'ed-find', hidden: true, role: 'search' },
    icon('search'), findIn,
    el('span', { class: 'n', id: 'ed-find-n', 'aria-live': 'polite' }),
    el('button', { class: 'ghost', title: 'Previous (Shift+Enter)', 'aria-label': 'Previous match', onclick: () => stepFind(-1) }, icon('back')),
    el('button', { class: 'ghost', title: 'Next (Enter)', 'aria-label': 'Next match', onclick: () => stepFind(1) }, icon('chev')),
    el('button', { class: 'ghost close', title: 'Close (Esc)', 'aria-label': 'Close find', onclick: () => closeFind(true) }, '×'));

  // An email note gets the one button that finishes the job.
  const mailBtn = el('button', { class: 'primary mail-btn', id: 'ed-mail', hidden: true,
    title: state.emailInGmail ? 'Open a Gmail compose window with this email' : 'Open your mail app with this email',
    onclick: () => openEmail(state.emailInGmail ? 'gmail' : 'app') }, icon('open'), 'Open in mail');

  const pinned = !!item.pinned;
  pane.append(
    // One row: in a 560px popup every row above the note is a row you cannot
    // write in. The date went to the footer and the "Note" label went, because
    // the yellow already says it.
    el('header', { class: 'd-band ed-head', id: 'ed-band',
      style: `background:${colourVar(item.row)};color:${colourFg(item.row)}` },
      el('div', { class: 'ed-top' }, backBtn, title, widthBtn)),
    tagRow({ ...item, tags: state.draft.tags, row: item.row, kind: 'note' }),
    start,
    find,
    el('div', { class: 'ed', id: 'ed-wrap' }, body),
    el('footer', { class: 'ed-foot' },
      // Formatting first, always in reach under the text, like a mail
      // composer; then the note's state; then what you can do to the note.
      tools,
      el('span', { class: 'saved', id: 'ed-saved', role: 'status', 'aria-live': 'polite' }, item.isNew ? '' : 'Saved'),
      el('button', { class: 'ghost retry', id: 'ed-retry', hidden: true,
        onclick: () => { if (state.draft) state.draft.dirty = true; saveState('Saving…'); flushDraft(false); } }, 'Retry'),
      el('span', { class: 'prog', id: 'ed-prog', hidden: true, 'aria-hidden': 'true' }, el('i')),
      el('span', { class: 'meta', id: 'ed-meta' }),
      el('span', { class: 'spacer' }),
      mailBtn,
      el('button', { class: 'ghost icon-btn', id: 'ed-pin', title: pinned ? 'Unpin' : 'Pin to the top',
        'aria-label': pinned ? 'Unpin' : 'Pin', 'aria-pressed': String(pinned),
        onclick: safe(() => togglePin(item)) }, icon('pin')),
      colourPicker(item),
      noteMenu(item))
  );
  refreshEditorBits();

  // Esc leaves from anywhere in the pane. Ctrl+Enter leaves too, except in the
  // note itself, where it ticks the line you are on.
  pane.onkeydown = (e) => {
    if (!state.editing) return;
    if (e.target.tagName === 'INPUT' && e.target.hasAttribute('list')) return;   // typing a tag
    const ctrlEnter = (e.metaKey || e.ctrlKey) && e.key === 'Enter';
    if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault(); e.stopPropagation(); return openFind();
    }
    if (e.key === 'Escape' && state.find) { e.preventDefault(); e.stopPropagation(); return closeFind(true); }
    if (e.key === 'Escape' || (ctrlEnter && e.target.id !== 'ed-area')) {
      e.preventDefault(); e.stopPropagation(); closeEditor();
    }
  };
}

// Everything in the editor that depends on what is typed, besides the text:
// the start chips, progress, word count, when it was edited, whether this
// note is an email, and the find marks.
function refreshEditorBits() {
  const area = $('#ed-area');
  if (!area || !state.draft) return;
  const text = area.value;
  const startEl = $('#ed-start');
  if (startEl) startEl.hidden = !(tasks.isBlank(text) && !state.draft.title.trim() && !text.trim());
  const p = tasks.progress(text);
  if (state.find) {
    state.find.hits = tasks.findAll(text, state.find.q);
    // Editing can remove the current match: keep the pointer on one that exists.
    const n = state.find.hits.length;
    state.find.cur = n ? Math.min(Math.max(state.find.cur, 0), n - 1) : -1;
  }
  paintFind();
  const email = tasks.parseEmail(text);
  const mail = $('#ed-mail');
  if (mail) mail.hidden = !email;
  const item = state.editing;
  const bar = $('#ed-prog');
  if (bar) {
    bar.hidden = !p.total;
    bar.classList.toggle('all', p.total > 0 && p.done === p.total);
    bar.firstChild.style.width = p.total ? `${Math.round((p.done / p.total) * 100)}%` : '0';
  }
  const bits = [
    email ? (email.to ? `to ${email.to}` : 'email') : null,
    p.total ? (p.done === p.total ? `All ${p.total} done` : `${p.done}/${p.total} done`) : null,
    wordCount(fmt.strip(email ? email.body : text)) || null,
    item?.when ? `edited ${ago(item.when)}` : null
  ].filter(Boolean);
  const meta = $('#ed-meta');
  if (meta) meta.textContent = bits.join(' · ');
}

// ---- find in the note ----
// Matches are marked with the CSS Highlight API: nothing is added to the note's
// page, so finding cannot disturb what you are editing.
function paintFind() {
  if (!window.CSS?.highlights || typeof Highlight === 'undefined') return;
  CSS.highlights.delete('ds-find');
  CSS.highlights.delete('ds-find-cur');
  const f = state.find, area = $('#ed-area');
  if (!f?.hits?.length || !area?.rangeOf) return;
  const all = [], cur = [];
  f.hits.forEach((h, i) => (i === f.cur ? cur : all).push(area.rangeOf(h, h + f.q.length)));
  if (all.length) CSS.highlights.set('ds-find', new Highlight(...all));
  if (cur.length) CSS.highlights.set('ds-find-cur', new Highlight(...cur));
}

function openFind() {
  const bar = $('#ed-find'), input = $('#ed-find-in'), area = $('#ed-area');
  if (!bar || !input) return;
  bar.hidden = false;
  // Selected text is what you most likely want to find.
  const sel = area && area.selectionStart !== area.selectionEnd
    ? fmt.strip(area.value.slice(area.selectionStart, area.selectionEnd)) : '';
  if (sel && !sel.includes('\n')) input.value = sel;
  input.focus();
  input.select();
  runFind(input.value);
}

function runFind(q) {
  const area = $('#ed-area');
  if (!area) return;
  const hits = tasks.findAll(area.value, q);
  // Start from the first match after the caret, as find does everywhere else.
  const from = area.selectionStart;
  const cur = Math.max(0, hits.findIndex((h) => h >= from));
  state.find = { q, hits, cur: hits.length ? cur : -1 };
  showFind();
}

function stepFind(dir) {
  const f = state.find;
  if (!f?.hits.length) return;
  f.cur = (f.cur + dir + f.hits.length) % f.hits.length;
  showFind();
}

function showFind() {
  const f = state.find;
  const n = $('#ed-find-n');
  if (n) n.textContent = !f?.q ? '' : f.hits.length ? `${f.cur + 1}/${f.hits.length}` : 'No matches';
  refreshEditorBits();
  // Bring the current match into view, a third of the way down.
  const area = $('#ed-area');
  if (area?.rangeOf && f?.hits.length && f.cur > -1) {
    const r = area.rangeOf(f.hits[f.cur], f.hits[f.cur] + f.q.length).getBoundingClientRect();
    const box = area.getBoundingClientRect();
    if (r.top < box.top || r.bottom > box.bottom) area.scrollTop += r.top - box.top - area.clientHeight / 3;
  }
}

// Closing leaves the current match selected, so you can type over it.
function closeFind(select) {
  const f = state.find;
  state.find = null;
  const bar = $('#ed-find');
  if (bar) bar.hidden = true;
  refreshEditorBits();
  const area = $('#ed-area');
  if (!area) return;
  area.focus();
  if (select && f?.hits.length && f.cur > -1) area.setSelectionRange(f.hits[f.cur], f.hits[f.cur] + f.q.length);
}

// ---- email ----
function openEmail(where) {
  const area = $('#ed-area');
  const e = area && tasks.parseEmail(area.value);
  if (!e) return toast('Start the note with a To: line to make it an email');
  // A mail link carries plain text only, so the markers come off rather than
  // arriving as asterisks. Copy the email text to keep the formatting.
  e.body = fmt.strip(e.body);
  const url = where === 'gmail' ? tasks.gmailUrl(e) : tasks.mailtoUrl(e);
  // A mailto link longer than this is cut off by some mail apps.
  if (where !== 'gmail' && url.length > 1900) toast('Long email: if it arrives cut short, use Copy text');
  chrome.tabs.create({ url });
}

// What leaves the note when it is copied or inserted: for an email, only what
// you would send, not the To and Subject lines.
function sendableText(text) {
  const e = tasks.parseEmail(text);
  return e ? e.body : text;
}

// ---- templates ----
// A note tagged #template is offered when a new note starts. Starting from one
// copies its text into the new note; the template itself is left as it was.
const TEMPLATE_TAG = 'template';

function startFromTemplate(n) {
  const area = $('#ed-area');
  if (!area || !state.draft) return;
  const text = txt.toPlain(n);
  replaceRange(area, 0, area.value.length, text, text.length);
  // Picked and then left alone, it is still an empty note: not worth saving.
  state.draft.fromTemplate = text;
  area.scrollTop = 0;
}

function toggleTemplate() {
  if (!state.draft) return;
  const on = state.draft.tags.includes(TEMPLATE_TAG);
  state.draft.tags = on ? state.draft.tags.filter((t) => t !== TEMPLATE_TAG) : [...state.draft.tags, TEMPLATE_TAG];
  if (state.editing) state.editing.tags = state.draft.tags;
  queueSave();
  drawEditor();
  focusEditor();
  toast(on ? 'No longer a template' : 'Saved as a template: it is offered when you start a new note');
}

// ---- pasting ----
// Paste is always text: a page's styles and layout never come into a note.
// Text copied from another note keeps its bold and lists exactly. A URL pasted
// over selected words keeps the words and puts the link after them,
// "launch notes (https://…)", rather than replacing what you selected.
function editorPaste(e) {
  const a = e.currentTarget;
  const cd = e.clipboardData;
  if (!cd) return;
  e.preventDefault();
  const from = a.selectionStart, to = a.selectionEnd;
  const own = cd.getData('text/x-desksync');
  const plain = (own || cd.getData('text/plain') || '').replace(/\r\n?/g, '\n');
  if (!plain) return;
  const url = plain.trim();
  const sel = a.value.slice(from, to);
  if (from !== to && !own && /^https?:\/\/\S+$/i.test(url) && !sel.includes('\n') && !/^\s*https?:\/\//i.test(sel)) {
    const text = `${sel} (${url})`;
    return replaceRange(a, from, to, text, from + text.length);
  }
  replaceRange(a, from, to, plain, from + plain.length);
}

// ---- editing the note's text ----
// Every change is made to the note's text, as one step Ctrl+Z can undo, and
// the input event saves it.
function replaceRange(area, from, to, text, caret) {
  area.focus();
  const end = area.setRangeText(text, from, to);
  const c = caret ?? end;
  area.setSelectionRange(c, c);
  area.dispatchEvent(new Event('input', { bubbles: true }));
}

function lineAt(area, pos = area.selectionStart) {
  const v = area.value;
  // lastIndexOf with -1 still looks at index 0, so a note starting with an
  // empty line put the caret's line one too far down.
  const start = pos > 0 ? v.lastIndexOf('\n', pos - 1) + 1 : 0;
  let end = v.indexOf('\n', pos);
  if (end < 0) end = v.length;
  return { start, end, text: v.slice(start, end), index: v.slice(0, start).split('\n').length - 1 };
}

function toggleTaskAt(area, pos) {
  const ln = lineAt(area, pos);
  const next = tasks.toggle(ln.text);
  const caretInLine = pos - ln.start + (next.length - ln.text.length);
  replaceRange(area, ln.start, ln.end, next, ln.start + Math.max(0, Math.min(next.length, caretInLine)));
}

function startAs(kind) {
  const area = $('#ed-area');
  const s = tasks.STARTS[kind];
  if (!area || !s) return;
  replaceRange(area, 0, area.value.length, s.text, s.caret);
}

// Enter. A list carries on; an empty item ends the list. Splitting in the
// middle of bold closes it before the break and opens it again after, so both
// halves stay bold instead of showing a stray "**".
function splitLine(area, shift) {
  let a = area.selectionStart, b = area.selectionEnd;
  const v0 = area.value;
  if (a !== b) {
    // Typing over a selection: the selection goes first.
    const r = richEditor.removeRange(v0, a, b);
    area.value = r.v;
    a = b = r.at;
  }
  const v = area.value;
  const ln = lineAt(area, a);
  const p = tasks.parse(ln.text);
  const off = a - ln.start;

  if (!shift && p && off >= p.prefix && !p.rest.trim()) {
    const r = tasks.onEnter(ln.text);
    return replaceRange(area, ln.start, ln.end, r.line, ln.start + r.line.length);
  }
  const cont = !shift && p && off >= p.prefix ? tasks.onEnter(ln.text).insert.slice(1) : '';

  // Runs of bold or italic the caret is inside. At a run's edge the break
  // goes outside it instead.
  const marks = fmt.inlineMarks(v);
  const runs = [];
  for (let k = 0; k + 2 < marks.length; k += 3) runs.push(marks.slice(k, k + 3));
  let at = a;
  for (const [o, c, cl] of runs) {
    if (at === c.to && at === cl.from) at = cl.to;
    else if (at === c.from && at === o.to) at = o.from;
  }
  // Closing bold before the break and opening it after is done by the
  // editor for any line break going into bold (Enter, or a pasted line), so
  // here it is just the break and the list's next marker.
  const insert = '\n' + cont;
  const open = runs.filter(([, c]) => at > c.from && at < c.to);
  const reopenLen = open.reduce((n, [o]) => n + (o.to - o.from), 0);
  replaceRange(area, at, at, insert, at + insert.length + reopenLen * 2);
}

// ---- the toolbar ----
// The bold or italic run the caret is inside, if any. `mk` tells them apart:
// "**" is two characters, "_" one.
function runAt(v, a, mk) {
  const marks = fmt.inlineMarks(v);
  for (let k = 0; k + 2 < marks.length; k += 3) {
    const [o, c, cl] = marks.slice(k, k + 3);
    if (o.to - o.from === mk.length && a >= c.from && a <= c.to) return [o, c, cl];
  }
  return null;
}

// Each button shows whether it applies where the caret is: inside bold, on a
// checklist line, or with bold switched on for what is typed next.
function updateTools() {
  const area = $('#ed-area'), bar = $('#ed-tools');
  if (!area || !bar) return;
  const v = area.value, a = area.selectionStart, b = area.selectionEnd;
  const on = (mk) => (a !== b ? fmt.isOn(v, a, b, mk) : !!runAt(v, a, mk)) || area.pending?.() === mk;
  const kind = tasks.parse(lineAt(area, a).text)?.kind;
  const set = (key, yes) => bar.querySelector(`[data-fmt=${key}]`)?.setAttribute('aria-pressed', String(!!yes));
  set('bold', on('**'));
  set('italic', on('_'));
  set('task', kind === 'task');
  set('bullet', kind === 'bullet');
  set('number', kind === 'number');
}
document.addEventListener('selectionchange', () => {
  if (document.activeElement?.id === 'ed-area') updateTools();
});

// A button pressed while the note is not being typed in: put the caret in
// the note first, at the end, so what the button does lands somewhere visible.
function editorReady() {
  const area = $('#ed-area');
  if (area && document.activeElement !== area) focusEditor();
  return area;
}

// Bold or italic on the selection, as one edit Ctrl+Z can undo, keeping the
// same words selected so a second press, or the other button, applies to them.
function applyInline(mk) {
  const area = editorReady();
  if (!area) return;
  const a = area.selectionStart, b = area.selectionEnd;
  if (a === b) {
    // Nothing selected. Inside bold, B ends it: the caret steps out past the
    // closing marker, so what is typed next is plain. Anywhere else it
    // switches bold on for what is typed next; the button stays lit to say so.
    const run = runAt(area.value, a, mk);
    if (run) {
      area.setPending?.(null);
      area.setSelectionRange(run[2].to);
    } else {
      area.setPending?.(area.pending?.() === mk ? null : mk);
    }
    return updateTools();
  }
  const r = fmt.wrap(area.value, a, b, mk);
  replaceRange(area, r.start, r.end, r.insert, null);
  area.setSelectionRange(r.selFrom, r.selTo);
  updateTools();
}

function applyLines(kind) {
  const area = editorReady();
  if (!area) return;
  const a = area.selectionStart, b = area.selectionEnd;
  const r = fmt.lines(area.value, a, b, kind);
  replaceRange(area, r.start, r.end, r.insert, null);
  // A caret stays a caret, at the end of its line; a selection stays selected.
  if (a === b) area.setSelectionRange(r.selTo);
  else area.setSelectionRange(r.selFrom, r.selTo);
  updateTools();
}

function editorKeydown(e) {
  const area = e.currentTarget;
  if (e.isComposing) return;
  const collapsed = area.selectionStart === area.selectionEnd;

  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'b' || e.key === 'i')) {
    e.preventDefault();
    return applyInline(e.key === 'b' ? '**' : '_');
  }

  if (e.key === 'Enter' && !e.altKey && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    // "/task" or "/email" as the whole note, then Enter.
    const kind = !e.shiftKey && collapsed && tasks.slash(area.value);
    if (kind) return startAs(kind);
    return splitLine(area, e.shiftKey);
  }
  // Backspace at the start of a list item turns it back into a plain line,
  // keeping its words; the next Backspace joins it to the line above.
  if (e.key === 'Backspace' && collapsed && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const ln = lineAt(area);
    const p = tasks.parse(ln.text);
    if (p && area.selectionStart - ln.start <= p.prefix) {
      e.preventDefault();
      return replaceRange(area, ln.start, ln.start + p.prefix, '', ln.start);
    }
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    return toggleTaskAt(area, area.selectionStart);
  }
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    const ln = lineAt(area);
    const dir = e.key === 'ArrowUp' ? -1 : 1;
    const moved = tasks.moveLine(area.value, ln.index, dir);
    if (moved == null) return;
    const col = area.selectionStart - ln.start;
    const lines = moved.split('\n');
    const newStart = lines.slice(0, ln.index + dir).join('\n').length + (ln.index + dir ? 1 : 0);
    replaceRange(area, 0, area.value.length, moved, newStart + col);
    return;
  }
  // Tab indents a list item and Shift+Tab takes it back out. On any other line
  // Tab keeps its usual job of moving focus.
  if (e.key === 'Tab' && collapsed) {
    const ln = lineAt(area);
    if (!tasks.parse(ln.text)) return;
    e.preventDefault();
    const pos = area.selectionStart;
    if (e.shiftKey) {
      const cut = /^ {1,2}/.exec(ln.text)?.[0].length || 0;
      if (cut) replaceRange(area, ln.start, ln.start + cut, '', Math.max(ln.start, pos - cut));
    } else {
      replaceRange(area, ln.start, ln.start, '  ', pos + 2);
    }
  }
}

// ---- checkboxes ----
// A task's checkbox is drawn by CSS in the line's left margin. Pressing there
// ticks it, on mousedown and with the default stopped, so the caret and the
// selection stay where they were: ticking an item is not a request to start
// typing at it.
function editorBoxDown(e) {
  if (e.button !== 0) return;
  const area = e.currentTarget;
  const L = e.target.closest?.('.ln[data-k="task"]');
  if (!L || L.parentNode !== area) return;
  const pad = parseFloat(getComputedStyle(L).paddingLeft) || 0;
  if (e.clientX - L.getBoundingClientRect().left > pad) return;
  e.preventDefault();
  const i = [...area.children].indexOf(L);
  const focused = document.activeElement === area;
  const keep = [area.selectionStart, area.selectionEnd];
  const start = area.lineStart(i);
  const line = area.value.split('\n')[i];
  area.setRangeText(tasks.toggle(line), start, start + line.length);
  // "[ ]" and "[x]" are the same length, so the caret can go straight back.
  if (focused) area.setSelectionRange(keep[0], keep[1]);
  area.dispatchEvent(new Event('input', { bubbles: true }));
}

// Everything else the note can do, behind one ⋮ — which is how Keep keeps its
// bar short enough to read. Rare things do not deserve a button each.
function noteMenu(item) {
  const sheet = el('div', { class: 'menu', role: 'menu' });

  const button = el('button', {
    class: 'ghost menu-btn', id: 'ed-menu', title: 'More', 'aria-label': 'More actions',
    'aria-haspopup': 'menu', 'aria-expanded': 'false'
  }, icon('dots'));
  // Built on opening: what it offers depends on what the note says now (an
  // email, a task list, a template), not when the editor was drawn.
  const pop = popover(button, sheet, { onOpen: () => fill() });
  button.addEventListener('click', () => {
    pop.toggle();
    if (pop.isOpen()) sheet.querySelector('button')?.focus();
  });
  const close = (focusBack = true) => pop.close(focusBack);

  const entry = (label, run, opts = {}) => el('button', {
    role: 'menuitem', class: opts.danger ? 'danger' : null,
    'aria-checked': opts.checked === undefined ? null : String(opts.checked),
    onclick: safe(async () => { close(false); await run(); })
  }, label, opts.checked ? el('span', { class: 'tick' }, '✓') : null);

  const fill = () => {
    readBack();
    const text = state.draft?.body || '';
    const isEmail = !!tasks.parseEmail(text);
    const isTemplate = (state.draft?.tags || []).includes(TEMPLATE_TAG);
    sheet.replaceChildren(...[
      // The way not taken by the footer's "Open in mail" button.
      isEmail ? entry(state.emailInGmail ? 'Open in mail app' : 'Open in Gmail',
        () => openEmail(state.emailInGmail ? 'app' : 'gmail')) : null,
      state.tabId ? entry(isEmail ? 'Insert the email text into page' : 'Insert into page',
        () => { readBack(); insertIntoPage(sendableText(state.draft?.body || ''), { formatted: true }); }) : null,
      tasks.progress(text).total ? entry('Ticked to the bottom', () => sinkTicked()) : null,
      entry(isTemplate ? 'Remove from templates' : 'Save as template', () => toggleTemplate()),
      entry('Duplicate', () => duplicateNote(item)),
      entry(isEmail ? 'Copy the email text' : 'Copy text', () => copyNoteText()),
      item.isNew ? null
        : entry('Delete note', async () => {
            const it = state.editing;
            await closeEditor({ redraw: false });
            await remove(it);
          }, { danger: true })
    ].filter(Boolean));
  };

  return el('div', { class: 'more' }, button, sheet);
}

// Done items out of the way, list by list. One edit, so one Ctrl+Z undoes it.
function sinkTicked() {
  const area = $('#ed-area');
  if (!area) return;
  const next = tasks.sinkDone(area.value);
  if (next === area.value) return toast(tasks.progress(area.value).total ? 'Already in order' : 'No tasks in this note');
  replaceRange(area, 0, area.value.length, next, 0);
  area.scrollTop = 0;
}

async function duplicateNote(item) {
  readBack();
  // The original first, with whatever was typed in the last moment.
  await flushDraft(false, item);
  if (!state.draft) return;
  const { title, body, tags } = state.draft;
  const row = await writeRow('notes', crypto.randomUUID(),
    { title: (title.trim() ? title.trim() + ' (copy)' : 'Untitled copy'), body,
      format: 'plain', tags: [...tags], color: noteColour(item.row) },
    { upsert: true });
  toast('Duplicated');
  await loadNotes();
  // Straight into the copy: duplicating is almost always the first step of
  // changing the copy.
  const made = state.notes.find((n) => n.id === row?.id);
  if (made) {
    openEditor({ kind: 'note', id: made.id, row: made, when: made.updated_at,
      pinned: made.pinned, title: made.title, sub: '', tags: made.tags || [] });
  }
}

// Text with bold or italic goes on the clipboard twice: as HTML, which Gmail,
// Docs and Notion paste with the formatting, and as plain text without the
// markers, for everywhere else. Text without any goes as it is.
async function copyRich(text) {
  if (!fmt.hasInline(text)) return writeClipboard(text);
  await writeClipboard(fmt.strip(text), fmt.toHtml(text));
}

async function copyNoteText() {
  readBack();
  const { title, body } = state.draft;
  // An email copies as the message alone: the title is your label for it and
  // the To and Subject lines belong in the mail app's own fields.
  const email = tasks.parseEmail(body);
  const text = email ? email.body : [title.trim(), body].filter(Boolean).join('\n\n');
  try {
    await copyRich(text);
    toast(email ? 'Copied the email text' : 'Copied');
  } catch {
    toast('Could not reach the clipboard');
  }
}

// A small panel that opens from a button, the way menus do everywhere: it
// closes on Esc, on a click anywhere outside it, and when a choice is made.
// Before this the colour palette and the ⋮ menu stayed open until you chose
// something or found Esc.
function popover(button, panel, { onOpen } = {}) {
  const isOpen = () => panel.classList.contains('open');
  const outside = (e) => { if (!panel.contains(e.target) && !button.contains(e.target)) close(false); };
  const close = (focusBack = true) => {
    document.removeEventListener('mousedown', outside, true);
    if (!isOpen()) return;
    panel.classList.remove('open');
    button.setAttribute('aria-expanded', 'false');
    if (focusBack && button.isConnected) button.focus();
  };
  const open = () => {
    onOpen?.();
    panel.classList.add('open');
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', outside, true);
  };
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault(); e.stopPropagation();
    close();
  });
  const pop = { open, close, isOpen, toggle: () => (isOpen() ? close(false) : open()) };
  panel._pop = pop;
  return pop;
}

// The colour picker: the note's colour as a dot that opens the palette.
//
// The palette opens upward from the dot and lines up with the right-hand edge
// of the pane, so it always stays inside it: it used to open to the right and
// four of the seven colours were cut off past the edge. It is a set of radio
// choices: the current colour is ticked, and the arrow keys move between them.
function colourPicker(item) {
  const current = noteColour(item.row);
  const row = el('div', { class: 'swatch-row' });
  for (const c of NOTE_COLOURS) {
    const on = current === c.k;
    row.append(el('button', {
      class: 'swatch' + (on ? ' on' : ''),
      // The tick is drawn in the colour's own text colour, so it reads on all seven.
      style: `background:var(--n-${c.k});color:var(--n-${c.k}-fg)`,
      role: 'radio', 'aria-checked': String(on), tabindex: on ? '0' : '-1',
      title: c.label, 'aria-label': c.label, 'data-colour': c.k,
      onclick: safe(() => setNoteColour(item, c.k))
    }, icon('check')));
  }
  const panel = el('div', { class: 'swatches', role: 'radiogroup', 'aria-labelledby': 'ed-colour-title' },
    el('div', { class: 'pop-title', id: 'ed-colour-title' }, 'Note colour'), row);

  const button = el('button', {
    class: 'ghost swatch-btn', id: 'ed-colour', title: 'Note colour',
    'aria-label': 'Note colour', 'aria-haspopup': 'true', 'aria-expanded': 'false'
  }, el('span', { class: 'swatch', style: `background:${colourVar(item.row)}` }));
  const pop = popover(button, panel);
  button.addEventListener('click', () => {
    pop.toggle();
    if (pop.isOpen()) row.querySelector('[aria-checked="true"]')?.focus();
  });

  // Arrows, Home and End move between colours; Enter or Space picks one.
  row.addEventListener('keydown', (e) => {
    const all = [...row.querySelectorAll('.swatch')];
    const i = all.indexOf(document.activeElement);
    const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: all.length - 1 }[e.key];
    if (to === undefined || i < 0) return;
    e.preventDefault();
    all[(to + all.length) % all.length].focus();
  });

  return el('div', { class: 'colour' }, button, panel);
}

async function setNoteColour(item, key) {
  item.row.color = key;
  // Shown before it is written: a colour you have to wait for feels broken, and
  // this is a column of its own that no other save is touching.
  const band = $('#ed-band');
  if (band) {
    band.style.background = colourVar(item.row);
    band.style.color = colourFg(item.row);
  }
  for (const b of $$('.swatches .swatch')) {
    const on = b.dataset.colour === key;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
    b.setAttribute('tabindex', on ? '0' : '-1');
  }
  const dot = $('#ed-colour .swatch');
  if (dot) dot.style.background = colourVar(item.row);
  $('.swatches')?._pop?.close(false);
  $('#ed-area')?.focus();

  // A note that has never been written has nowhere to put this yet: it goes in
  // with the first save.
  if (item.id) await writeRow('notes', item.id, { color: key }, { upsert: true });
  loadNotes();
}

// What is on screen is what gets stored, character for character.
function readBack() {
  const a = $('#ed-area');
  if (a && state.draft) state.draft.body = a.value;
}

// How long typing has to stop before the note is written. The local copy is
// quick because it costs nothing and it is the one that survives the popup being
// dismissed; the server write waits a little longer.
const SAVE_AFTER = 400;
const STASH_AFTER = 150;

function queueSave() {
  if (state.draft) state.draft.dirty = true;
  saveState('Saving…');
  clearTimeout(queueSave._t);
  queueSave._t = setTimeout(() => flushDraft(false), SAVE_AFTER);
  stashDraft();
}

// A new note holding only what it was started with (an empty "[ ] ", the To
// and Subject lines, a template as it was picked) has nothing of yours in it.
function isUntouched(body) {
  return tasks.isBlank(body) || (state.draft?.fromTemplate != null && body === state.draft.fromTemplate);
}

// The note as a row, or null when there is nothing worth writing.
function draftRow(item) {
  if (!item || !state.draft || !state.draft.dirty) return null;
  const { title, body, tags } = state.draft;
  // A note you opened and never typed into is not a note.
  if (item.isNew && !title.trim() && isUntouched(body)) return null;
  return { id: item.id || item.draftId, title: title.trim(), body, format: 'plain', tags: [...tags] };
}

// Keeps a copy of the note somewhere that outlives this window. See `drafts` in
// lib/client.js for why a popup needs that.
function stashDraft(now = false) {
  clearTimeout(stashDraft._t);
  const item = state.editing;
  if (!item) return;
  const write = () => {
    readBack();
    const row = draftRow(item);
    if (row) drafts.put({ table: 'notes', row }).catch((e) => console.warn('[DeskSync] draft', e));
  };
  if (now) write(); else stashDraft._t = setTimeout(write, STASH_AFTER);
}

// The popup is going away.
//
// Nothing here can be awaited — the window is being torn down mid-call — so both
// of these are sent and left. The storage write is the one that matters: the
// service worker picks it up on its next sweep. The message only asks it to come
// sooner, and it is fine for it never to arrive.
window.addEventListener('pagehide', () => {
  linkNote.flush?.();
  if (!state.editing || !state.draft?.dirty) return;
  clearTimeout(queueSave._t);
  stashDraft(true);
  try { chrome.runtime.sendMessage({ type: 'flush-draft' })?.catch?.(() => {}); } catch { /* the port is already gone */ }
});

function saveState(text) {
  const el2 = $('#ed-saved');
  if (el2) el2.textContent = text;
  // Retry only means something after a failure, and only until the next try.
  const retry = $('#ed-retry');
  if (retry) retry.hidden = text !== 'Not saved';
}

// Shown once a note is long enough for the number to matter to someone.
function wordCount(text) {
  const n = (String(text || '').match(/\S+/g) || []).length;
  return n >= 20 ? plural(n, 'word') : '';
}

// Saves run one at a time, in order.
//
// They used to run concurrently, and for a new note that meant two saves could
// both see a row with no id yet and both insert: one note typed, two rows
// written, and later keystrokes landing in whichever row won. It only appeared
// against a real server, because a save that returns instantly cannot overlap
// the next one.
let saveQueue = Promise.resolve();

function flushDraft(final, itemOverride) {
  clearTimeout(queueSave._t);
  saveQueue = saveQueue.then(() => writeDraft(final, itemOverride)).catch((e) => {
    console.error(e);
    // Never leave the label claiming a save is still running: it is not, and the
    // note exists only in this popup, which is about to close.
    saveState('Not saved');
    toast(e?.message || 'Could not save this note');
  });
  return saveQueue;
}

async function writeDraft(final, itemOverride) {
  const item = itemOverride || state.editing;
  if (!item || !state.draft) return;
  // Nothing typed, nothing to write: opening a note and moving on used to save
  // it anyway, which bumped its timestamp and moved it up the list.
  if (!state.draft.dirty) { if (final) state.draft = null; return; }
  readBack();

  const { title, body, tags } = state.draft;

  // A note you opened and never typed into is thrown away rather than left as a blank row.
  if (item.isNew && !title.trim() && isUntouched(body)) { if (final) state.draft = null; return; }

  const id = item.id || item.draftId;
  const row = { title: title.trim(), body, format: 'plain', tags,
    color: noteColour(item.row) };
  const draft = state.draft;
  const sent = JSON.stringify([title, body, tags]);
  const written = await writeRow('notes', id, row, { upsert: true });
  if (!item.id) {
    item.id = written?.id ?? id;
    item.isNew = false;
  }
  // Typed into while that was being written? Then the newer words are not
  // saved yet: the note stays dirty, its local copy stays, and another save
  // follows. Marking it clean regardless lost those words: nothing was left
  // to save them, not even the copy kept for the popup closing.
  if (state.draft === draft && JSON.stringify([draft.title, draft.body, draft.tags]) !== sent) {
    saveState('Saving…');
    if (!final) queueSave();
    else await writeDraft(final, item);
    loadNotes();
    return;
  }
  // Written for real, so the copy left behind for the service worker is no
  // longer needed — and leaving it would have the note written again.
  if (state.draft) state.draft.dirty = false;
  clearTimeout(stashDraft._t);
  await drafts.clear();
  saveState('Saved');
  if (final) state.draft = null;
  loadNotes();
}

// ---------- Vault editor ----------
// Unlike the note editor this one has an explicit Save. A note saved half-typed
// is a note you finish later; a password saved half-typed is a login you can no
// longer use, and the old value is gone. So the write happens when you say so.
function openVaultEditor(item, prefill = null) {
  if (state.vaultState !== 'open') return drawVaultGate();
  const row = item ? item.row : { title: '', url: '', username: '', password: '', notes: '', tags: [] };
  state.vEditing = item || { kind: 'vault', id: null, row, tags: [], isNew: true, fromClip: prefill?.fromClip || null };
  state.vDraft = {
    title: row.title || '', url: row.url || '', username: row.username || '',
    password: row.password || '', notes: row.notes || '', tags: [...(row.tags || [])]
  };
  // A new login is almost always for the page you are on, so start it there.
  if (!item && state.tabHost) {
    state.vDraft.title = state.tabHost;
    state.vDraft.url = 'https://' + state.tabHost;
  }
  if (prefill) {
    for (const k of ['title', 'url', 'username', 'password', 'notes']) if (prefill[k]) state.vDraft[k] = prefill[k];
  }
  drawVaultEditor();
  $('#v-title')?.focus();
}

function closeVaultEditor() {
  state.vEditing = null;
  state.vDraft = null;
  applyEditorWidth(false);
  draw();
  $('#q').focus();
}

function drawVaultEditor() {
  const d = state.vDraft;
  const pane = $('#detail');
  pane.replaceChildren();

  const field = (id, label, value, opts = {}) => {
    const input = el(opts.multiline ? 'textarea' : 'input', {
      id, value: opts.multiline ? null : value,
      type: opts.type || 'text', autocomplete: 'off', spellcheck: 'false',
      placeholder: opts.placeholder || ''
    });
    if (opts.multiline) input.value = value;
    input.addEventListener('input', () => { d[opts.key] = input.value; });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); closeVaultEditor(); }
      if (e.key === 'Enter' && !opts.multiline && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
    });
    return el('div', {}, el('label', { for: id }, label), input);
  };

  const pw = el('input', { id: 'v-pass', type: 'password', value: d.password,
    autocomplete: 'new-password', spellcheck: 'false', placeholder: 'Password' });
  pw.addEventListener('input', () => { d.password = pw.value; });
  pw.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); closeVaultEditor(); }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
  });

  const save = safe(async () => {
    if (!state.vaultKey) return drawVaultGate();
    const item = state.vEditing;
    const payload = { title: d.title.trim(), url: d.url.trim(), username: d.username,
      password: d.password, notes: d.notes, tags: d.tags };
    const { iv, ciphertext } = await vaultCrypto.encrypt(state.vaultKey, JSON.stringify(payload));
    if (item.id) await db.update('vault_items', item.id, { iv, ciphertext });
    else await db.insert('vault_items', { iv, ciphertext });
    // Moved from clipboard history: erase the plain-text copy now that the
    // encrypted one is written.
    if (item.fromClip) {
      await db.remove('clips', item.fromClip, { content: '', source_url: null });
      loadClips();
    }
    toast(item.fromClip ? 'Moved to the vault (encrypted)' : 'Saved (encrypted)');
    state.vEditing = null; state.vDraft = null;
    await loadVault();
    $('#q').focus();
  });

  pane.append(
    el('header', { class: 'd-band' },
      el('div', { class: 'd-kind' }, el('span', { class: 'bul', style: 'background:var(--vault)' }),
        state.vEditing.isNew ? 'Vault · new login' : 'Vault · editing'),
      (() => {
        const t = el('input', { class: 't-in', id: 'v-title', value: d.title,
          placeholder: 'Name, e.g. GitHub', 'aria-label': 'Name' });
        t.addEventListener('input', () => { d.title = t.value; });
        t.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Escape') { e.preventDefault(); closeVaultEditor(); }
        });
        return t;
      })()),
    el('div', { class: 'v-form' },
      field('v-url', 'Website', d.url, { key: 'url', placeholder: 'https://example.com' }),
      field('v-user', 'Username or email', d.username, { key: 'username' }),
      el('div', {},
        el('label', { for: 'v-pass' }, 'Password'),
        el('div', { class: 'v-row' },
          el('div', { class: 'grow' }, pw),
          el('button', { title: 'Show or hide', 'aria-label': 'Show or hide password',
            onclick: () => { pw.type = pw.type === 'password' ? 'text' : 'password'; } }, icon('eye')),
          el('button', { title: 'Generate', 'aria-label': 'Generate a password',
            onclick: () => { pw.value = vaultCrypto.generatePassword(); d.password = pw.value; pw.type = 'text'; } },
            icon('dice')))),
      field('v-notes', 'Notes', d.notes, { key: 'notes', multiline: true })),
    el('footer', { class: 'd-foot' },
      el('button', { class: 'primary', onclick: save }, icon('check'), 'Save'),
      el('button', { class: 'ghost', onclick: closeVaultEditor }, 'Cancel'),
      el('span', { class: 'spacer' }),
      state.vEditing.isNew ? null
        : el('button', { class: 'ghost', title: 'Delete', 'aria-label': 'Delete',
            onclick: safe(async () => {
              await db.remove('vault_items', state.vEditing.id);
              toast('Deleted');
              state.vEditing = null; state.vDraft = null;
              await loadVault();
            }) }, icon('trash')))
  );
}

// ---------- Vault ----------
const checkVault = safe(async () => {
  state.vaultKey = await vaultCrypto.loadSessionKey();
  if (state.vaultKey) { state.vaultState = 'open'; return loadVault(); }
  state.vaultConflict = !!(await store.vaultConflict());
  state.vaultState = (await store.vaultMeta()) ? 'locked' : 'setup';
  state.vault = [];
  draw();
});

const loadVault = safe(async () => {
  if (!state.vaultKey) return;
  const rows = await db.list('vault_items');
  state.vault = [];
  for (const r of rows) {
    try {
      const item = JSON.parse(await vaultCrypto.decrypt(state.vaultKey, r.iv, r.ciphertext));
      state.vault.push({ ...item, tags: item.tags || [], id: r.id, updated_at: r.updated_at });
    } catch { console.warn('Could not decrypt vault item', r.id); }
  }
  state.vault.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  draw();
});

const lockVault = safe(async () => {
  await vaultCrypto.lock();
  state.vaultKey = null; state.vault = []; state.vaultState = 'locked';
  toast('Vault locked');
  draw();
});

// The gate lives in the right pane only: the list keeps working while the vault is
// locked, it simply has no vault rows in it, because their titles are encrypted too.
// `focus` only when unlocking was actually asked for. Merely selecting the vault
// row, or the "Unlock the vault" action, renders the gate too — and focusing the
// password field there would take the cursor out of the search box, so the next
// thing typed would go into the password field instead of the search.
function drawVaultGate({ focus = false } = {}) {
  const pane = $('#detail');
  pane.replaceChildren();
  const setup = state.vaultState === 'setup';

  const p1 = el('input', { type: 'password', placeholder: setup ? 'Master password (min 10)' : 'Master password',
    'aria-label': 'Master password', autocomplete: 'off' });
  const p2 = setup ? el('input', { type: 'password', placeholder: 'Repeat master password', 'aria-label': 'Repeat master password', autocomplete: 'off' }) : null;
  const msg = el('p', { class: 'msg', role: 'alert' });

  const go = safe(async () => {
    if (setup) {
      if (p1.value.length < 10) return (msg.textContent = 'Use at least 10 characters.');
      if (p1.value !== p2.value) return (msg.textContent = "Passwords don't match.");
      msg.textContent = 'Creating…';
      const salt = b64.from(vaultCrypto.randomBytes(16));
      const key = await vaultCrypto.deriveKey(p1.value, salt);
      const v = await vaultCrypto.encrypt(key, VAULT_VERIFIER);
      await store.setVaultMeta({ salt, iterations: 600000, verifier_iv: v.iv, verifier_ct: v.ciphertext });
      sync.soon();
      await vaultCrypto.storeSessionKey(key);
    } else {
      msg.textContent = 'Unlocking…';
      const meta = await store.vaultMeta();
      if (!meta) { state.vaultState = 'setup'; return drawVaultGate({ focus: true }); }
      const key = await vaultCrypto.deriveKey(p1.value, meta.salt, meta.iterations);
      try {
        if ((await vaultCrypto.decrypt(key, meta.verifier_iv, meta.verifier_ct)) !== VAULT_VERIFIER) throw 0;
      } catch { msg.textContent = 'Wrong master password.'; p1.select(); return; }
      await vaultCrypto.storeSessionKey(key);
    }
    p1.value = ''; if (p2) p2.value = '';
    state.vaultKey = await vaultCrypto.loadSessionKey();
    state.vaultState = 'open';
    await loadVault();
    toast(setup ? 'Vault created' : 'Vault unlocked');
  });

  for (const input of [p1, p2].filter(Boolean)) {
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); go(); } });
  }

  pane.append(
    el('header', { class: 'd-band plain' },
      el('div', { class: 'd-kind' }, el('span', { class: 'bul', style: 'background:var(--vault)' }),
        setup ? 'Vault · not set up' : 'Vault · locked')),
    el('div', { class: 'gate' },
      el('div', { class: 'ic' }, icon(setup ? 'shield' : 'lock')),
      el('h3', {}, setup ? 'Set up your vault' : 'Vault locked'),
      el('p', {}, setup
        ? 'Pick a master password. It never leaves this device and cannot be recovered — if you forget it, the vault is lost.'
        : 'Your master password unlocks every saved login for this session. It is not stored anywhere and cannot be recovered.'),
      p1, p2,
      el('button', { class: 'primary', onclick: go }, setup ? 'Create vault' : 'Unlock'),
      msg)
  );
  if (focus) p1.focus();
}

// Does a saved item belong to the site in the front tab?
function hostMatches(itemUrl, tabHost) {
  if (!tabHost || !itemUrl) return false;
  let host;
  try { host = new URL(/^https?:\/\//i.test(itemUrl) ? itemUrl : 'https://' + itemUrl).hostname.replace(/^www\./, ''); }
  catch { return false; }
  // The page may be the login's site or a subdomain of it (a login for
  // github.com fills on gist.github.com). Not the reverse: a login saved for
  // a.example.com is not offered on example.com, or on b.example.com.
  return host === tabHost || tabHost.endsWith('.' + host);
}

// ---------- Autofill ----------
// Runs in the page, in the extension's isolated world: it can reach the DOM but
// shares nothing else with the page. Only ever injected by the click handler below,
// into the tab in front, for an item saved for that site.
function fillForm(username, password) {
  const shown = (el) => el.getClientRects().length > 0 && !el.disabled && !el.readOnly;
  const setValue = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const inputs = [...document.querySelectorAll('input')].filter(shown);
  const pw = inputs.find((i) => i.type === 'password');
  if (!pw) return { filled: 0, foundPassword: false };
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
  // Checked again now, not only when the button was drawn: in the side panel
  // the tab in front can change while a login is shown, and filling GitHub's
  // password into whatever site you had switched to must never happen.
  if (!hostMatches(v.url, state.tabHost)) return toast(`This login is for ${hostOf(v.url) || 'another site'}, not ${state.tabHost}`);
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
    if (VIEW === 'popup') setTimeout(() => window.close(), 700);
  }).catch((e) => { console.error(e); toast(e.message || "Couldn't fill this page"); });
}

// ---------- Screens: settings and trash ----------
function setScreen(name) {
  state.screen = name;
  const on = !!name;
  $('#mid').hidden = on;
  $('#detail').hidden = on;
  $('#screen').hidden = !on;
  $$('.rail [data-screen]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.screen === name)));
  if (on) { drawScreen(); $('#screen').focus(); if (name === 'trash') loadTrash(); }
  else { draw(); $('#q').focus(); }
}
$$('.rail [data-screen]').forEach((b) =>
  b.addEventListener('click', () => setScreen(state.screen === b.dataset.screen ? null : b.dataset.screen)));
$('#to-settings').addEventListener('click', () => setScreen('settings'));
$('#screen').addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !(e.target.tagName === 'INPUT')) { e.preventDefault(); setScreen(null); }
});

function drawScreen() { state.screen === 'trash' ? drawTrash() : drawSettings(); }
const backButton = () => el('button', { class: 'ghost', 'aria-label': 'Back to the list', onclick: () => setScreen(null) }, icon('back'));

// ---------- Trash ----------
// Clips are left out on purpose: `remove` blanks their text, so there is nothing to restore.
const TRASH = {
  notes: { kind: 'note', reload: () => loadNotes() },
  read_later: { kind: 'link', reload: () => loadLater() },
  vault_items: { kind: 'vault', reload: () => state.vaultKey && loadVault() }
};

async function trashTitle(r) {
  if (r._table === 'notes') return r.title || txt.toText(r).slice(0, 80) || 'Untitled';
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
  if (state.screen === 'trash') drawTrash();
});

function drawTrash() {
  const pane = $('#screen');
  pane.replaceChildren();

  const empty = el('button', {
    class: 'ghost', disabled: !state.trash.length,
    onclick: safe(async function emptyTrash(e) {
      // Emptying can't be undone, so the button asks a second time rather than
      // opening a dialog — a modal dialog would freeze the popup.
      // currentTarget, not `this`: safe() calls the handler without a receiver.
      const btn = e.currentTarget;
      if (!btn.dataset.armed) {
        btn.dataset.armed = '1';
        btn.textContent = 'Delete everything?';
        clearTimeout(emptyTrash._t);
        emptyTrash._t = setTimeout(() => { if (state.screen === 'trash') drawTrash(); }, 5000);
        return;
      }
      await Promise.all(Object.keys(TRASH).map((t) => db.purgeAll(t)));
      toast('Trash emptied');
      Object.values(TRASH).forEach((k) => k.reload());
      loadTrash();
    })
  }, 'Empty trash');

  pane.append(
    el('header', { class: 'sc-head' },
      backButton(), el('h2', {}, 'Trash'),
      el('span', { class: 'n' }, state.trash.length ? `${plural(state.trash.length, 'item')} · removed after 30 days` : ''),
      el('span', { class: 'right' }, empty)),
    el('div', { class: 'sc-body' }, ...(state.trash.length
      ? state.trash.map((r) => {
          const kind = TRASH[r._table];
          const T = TYPES[kind.kind];
          return el('div', { class: 'tr-row' },
            el('span', { class: 'tg-dot', style: `background:${T.color}` }),
            el('span', { class: 'body' },
              el('span', { class: 't' }, r._title),
              el('span', { class: 'm' }, `${T.one} · deleted ${ago(r.deleted_at)}`)),
            el('button', { onclick: safe(async () => { await db.restore(r._table, r.id); toast('Restored'); kind.reload(); loadTrash(); }) },
              icon('undo'), 'Restore'),
            el('button', { onclick: safe(async () => { await db.purge(r._table, r.id); toast('Deleted forever'); loadTrash(); }) },
              'Delete forever'));
        })
      : [el('div', { class: 'sc-empty' }, 'Trash is empty. Anything you delete waits here for 30 days.')]))
  );
}

// ---------- Settings ----------
const SWATCHES = ['', '#3d7bfa', '#19bf7a', '#ffd84d', '#ff8a3d', '#e0557b', '#8b5cf6'];

function drawSettings() {
  const pane = $('#screen');
  const counts = {};
  for (const i of state.items) for (const t of i.tags) counts[t] = (counts[t] || 0) + 1;
  const tags = allTags();

  const row = (label, note, control) => el('div', { class: 'sc-row' },
    el('span', { class: 'lab' }, el('b', {}, label), note ? el('span', {}, note) : null), control);

  // One switch per stored setting. Written as a merge: writing the one key on
  // its own used to wipe every other setting.
  const toggle = (key, label) => el('button', {
    class: 'sw', role: 'switch', 'aria-checked': String(!!state[key]), 'aria-label': label, 'data-setting': key,
    onclick: safe(async () => {
      state[key] = !state[key];
      await saveSettings({ [key]: state[key] });
      drawSettings();
    })
  });
  const captureSwitch = toggle('clipCapture', 'Capture what you copy');
  const shortcut = (name, fallback) => state.commands?.[name] ?? fallback;

  const allowBtn = el('button', {
    class: 'act', disabled: !state.tabOrigin || (state.captureOrigins || []).includes(state.tabOrigin),
    // permissions.request needs the click's user gesture, so nothing is awaited before it.
    onclick: safe(async () => {
      if (!(await chrome.permissions.request({ origins: [state.tabOrigin] }))) return;
      const origins = [...new Set([...(state.captureOrigins || []), state.tabOrigin])];
      await chrome.storage.local.set({ captureOrigins: origins });
      state.captureOrigins = origins;
      toast('Site approved'); drawSettings();
    })
  }, state.tabOrigin ? `Allow ${hostOfOrigin(state.tabOrigin)}` : 'Allow this site');

  // Two steps for anything that destroys data: the first click says what will
  // happen, the second does it. Five seconds later the button resets.
  const armed = (label, warning, run, cls = 'act danger') => el('button', {
    // currentTarget, not `this`: safe() calls the handler without a receiver.
    class: cls, onclick: safe(async function go(e) {
      const btn = e.currentTarget;
      if (!btn.dataset.armed) {
        btn.dataset.armed = '1';
        btn.textContent = warning;
        clearTimeout(go._t); go._t = setTimeout(() => drawSettings(), 5000);
        return;
      }
      await run();
    })
  }, label);

  const accountRows = state.email
    ? [
        row(state.email, 'Synced across your Chrome profiles and your phone. Signing out keeps everything on this device.',
          el('button', { class: 'act', onclick: safe(async () => {
            await vaultCrypto.lock();
            await sb.auth.signOut();
            location.reload();
          }) }, 'Sign out')),
        row('Sign out and erase this device',
          'Removes every note, link, clip and vault item from this browser. Your account keeps its copy.',
          armed('Erase', 'Erase this device?', async () => {
            await vaultCrypto.lock();
            await store.clear();
            await sb.auth.signOut();
            location.reload();
          }))
      ]
    : [row('Saved on this device',
        'Nothing leaves this browser. Uninstalling DeskSync, or clearing its data, deletes it — export a backup below, or sign in to sync.',
        null),
       signInForm()];

  const vaultConflictRows = state.vaultConflict ? [
    row('Two vaults', 'This device and your account each have a vault, with different master passwords. Keep one; the other one’s items are deleted.', null),
    row('Keep this device’s vault', 'The account’s vault items are deleted.',
      armed('Keep this one', 'Delete the account’s vault?', async () => {
        await vaultCrypto.lock();
        await sync.resolveVault('device');
        location.reload();
      })),
    row('Keep the account’s vault', 'This device’s vault items are deleted.',
      armed('Keep account’s', 'Delete this device’s vault?', async () => {
        await vaultCrypto.lock();
        await sync.resolveVault('account');
        location.reload();
      }))
  ] : [];

  const importInput = el('input', { type: 'file', accept: 'application/json,.json', class: 'hidden',
    'aria-label': 'Choose a DeskSync export file' });
  importInput.addEventListener('change', safe(async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { toast('That file is not JSON'); return; }
    const { counts, skippedVault } = await store.importAll(data);
    const n = Object.values(counts).reduce((a, b) => a + b, 0);
    toast(skippedVault
      ? `Imported ${plural(n, 'item')}; ${plural(skippedVault, 'vault item')} skipped — that file's vault has a different master password`
      : `Imported ${plural(n, 'item')}`);
    sync.soon();
    loadNotes(); loadLater(); loadClips(); checkVault(); loadTrash();
  }));

  pane.replaceChildren(
    el('header', { class: 'sc-head' }, backButton(), el('h2', {}, 'Settings')),
    el('div', { class: 'sc-body' },
      el('div', { class: 'sc-sec' }, state.email ? 'Account' : 'Sync'),
      ...accountRows,

      el('div', { class: 'sc-sec' }, 'Clipboard'),
      row('Capture what you copy',
        'Off until you allow it, then per site. Password fields are always skipped.', captureSwitch),
      row('Approved sites',
        (state.captureOrigins || []).length ? (state.captureOrigins || []).map(hostOfOrigin).join(', ') : 'None yet',
        allowBtn),
      ...(state.captureOrigins || []).map((origin) => row(hostOfOrigin(origin), 'Capturing what you copy here',
        el('button', {
          class: 'act danger',
          onclick: safe(async () => {
            const left = (await captureOrigins()).filter((o) => o !== origin);
            await chrome.storage.local.set({ captureOrigins: left });
            await chrome.permissions.remove({ origins: [origin] });
            state.captureOrigins = left;
            drawSettings();
          })
        }, 'Stop'))),
      row('Leave out keys and tokens',
        'An API key, token or password copied on an approved site is not recorded. Clips you save yourself are kept, and hidden in the list.',
        toggle('skipSecrets', 'Leave out keys and tokens')),
      el('p', { class: 'sc-sec', style: 'font-weight:400;text-transform:none' },
        'Copied text is stored unencrypted on this device, and in your account if you sign in, including anything a site’s own copy button puts on the clipboard. Avoid approving password managers or banking sites.'),

      el('div', { class: 'sc-sec' }, 'Vault'),
      ...vaultConflictRows,
      row(state.vaultState === 'open' ? 'Unlocked' : state.vaultState === 'setup' ? 'Not set up yet' : 'Locked',
        'The master password cannot be recovered.',
        el('button', {
          class: 'act',
          onclick: safe(async () => {
            if (state.vaultState === 'open') { await lockVault(); drawSettings(); }
            else {
              // The filter's own redraw is queued; wait for it, or it paints
              // over the gate (and on a fresh install, the welcome did).
              setScreen(null);
              await setFilter('vault');
              state.picked = true;
              await paneQueue;
              drawVaultGate({ focus: true });
            }
          })
        }, state.vaultState === 'open' ? 'Lock now' : state.vaultState === 'setup' ? 'Set up' : 'Unlock')),
      row('Autofill',
        'In the vault, an item saved for the site you are on has a Fill button. Filling asks for access to that site the first time, and never captures your clipboard there.',
        null),

      el('div', { class: 'sc-sec' }, `Tags · ${tags.length}`),
      el('p', { class: 'sc-rules' },
        `A tag is up to ${tagRules.MAX_LEN} characters: letters in any language, numbers, - and _. ` +
        `Spaces become -, and capitals small, so “Weekly Shop” is #weekly-shop. ` +
        `Up to ${tagRules.MAX_PER_ITEM} tags on one item. Click a name to rename it.`),
      ...(tags.length
        ? tags.map((t) => tagSettingRow(t, counts[t]))
        : [el('div', { class: 'sc-row' }, el('span', { class: 'lab' }, el('span', {}, 'No tags yet. Add one from any item.')))]),

      el('div', { class: 'sc-sec' }, 'Everyday'),
      row('Start on Today', 'Open on pinned items, unread links and what is new since yesterday, instead of everything.',
        toggle('startOnToday', 'Start on Today')),
      row('Unread count on the icon', 'How many Read later links you have not opened yet.',
        toggle('unreadBadge', 'Unread count on the icon')),
      row('Emails open in Gmail', 'A note that starts with To: has an Open in mail button. Off: your mail app. On: a Gmail compose window.',
        toggle('emailInGmail', 'Emails open in Gmail')),
      VIEW === 'popup' && chrome.sidePanel?.open
        ? row('Side panel', 'Keeps DeskSync open beside the page instead of closing when you click away.',
            el('button', { class: 'act', onclick: openSidePanel }, 'Open'))
        : null,

      el('div', { class: 'sc-sec' }, 'Keyboard'),
      row('Open DeskSync', null, el('span', { class: 'val' }, shortcut('_execute_action', 'Alt+Shift+D') || 'Not set')),
      row('Save this tab', null, el('span', { class: 'val' }, shortcut('save-tab', 'Alt+Shift+S') || 'Not set')),
      row('New note', 'From any page', el('span', { class: 'val' }, shortcut('new-note', 'Alt+Shift+K') || 'Not set')),
      row('Save the clipboard', 'From any page', el('span', { class: 'val' }, shortcut('save-clipboard', 'Alt+Shift+V') || 'Not set')),
      row('Search from the address bar', 'Type ds, a space, then what you are looking for', el('span', { class: 'val' }, 'ds ␣')),
      row('Insert into the page', 'Click into a text box, open DeskSync, pick a note or clip, Shift+Enter', el('span', { class: 'val' }, '⇧⏎')),
      row('Change these', 'chrome://extensions/shortcuts', el('button', {
        class: 'act', onclick: () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })
      }, 'Open')),

      el('div', { class: 'sc-sec' }, 'Data'),
      row('Trash', 'Deleted items wait here until you empty it.',
        el('button', { class: 'act', onclick: () => setScreen('trash') }, plural(state.trash.length, 'item'))),
      row('Export everything', 'One JSON file. Vault items stay encrypted in it.',
        el('button', { class: 'act', onclick: safe(exportAll) }, 'Export')),
      row('Import', 'Merges a DeskSync export into what is here. Newer copies win.',
        el('span', {}, el('button', { class: 'act', onclick: () => importInput.click() }, 'Import'), importInput))
    )
  );
}

// Signing in is optional, so it lives here rather than in front of the app.
function signInForm() {
  const email = el('input', { type: 'email', placeholder: 'Email', autocomplete: 'username', 'aria-label': 'Email' });
  const pass = el('input', { type: 'password', placeholder: 'Password (min 8)', minlength: '8',
    autocomplete: 'current-password', 'aria-label': 'Password' });
  const msg = el('p', { class: 'msg', role: 'alert' });
  const go = (mode) => safe(async (e) => {
    e?.preventDefault?.();
    msg.textContent = '';
    if (!email.value.trim() || pass.value.length < 8) { msg.textContent = 'Enter an email and a password of 8 or more characters.'; return; }
    msg.textContent = mode === 'signup' ? 'Creating…' : 'Signing in…';
    msg.textContent = (await signIn(mode, email.value.trim(), pass.value)) || '';
  });
  for (const input of [email, pass]) {
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') go('signin')(e); });
  }
  return el('div', { class: 'sc-row signin', id: 'signin' },
    el('span', { class: 'lab' }, el('b', {}, 'Sign in to sync'),
      el('span', {}, 'Keeps this browser, your other Chrome profiles and your phone in step. What is here now goes into the account.')),
    el('div', { class: 'signin-form' }, email, pass,
      el('div', { class: 'signin-actions' },
        el('button', { class: 'primary', onclick: go('signin') }, 'Sign in'),
        el('button', { class: 'ghost', onclick: go('signup') }, 'Create account')),
      msg));
}

async function exportAll() {
  const data = await store.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `desksync-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast('Exported');
}

// Rename and delete act on every item carrying the tag, which is why they are here
// and not on a single item's chip.
function tagSettingRow(t, count) {
  const row = el('div', { class: 'tg-row' });

  const name = el('span', { class: 'name', title: 'Rename' }, t);
  name.addEventListener('click', () => {
    const input = el('input', { class: 'rn', value: t, 'aria-label': 'Rename tag ' + t, maxlength: String(tagRules.MAX_LEN + 16) });
    name.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const commit = safe(async () => {
      if (done) return; done = true;
      const v = normalizeTag(input.value);
      if (!v && input.value.trim()) toast('Use letters or numbers');
      if (v && v !== t) await renameTag(t, v);
      drawSettings();
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); done = true; drawSettings(); }
    });
    input.addEventListener('blur', commit);
  });

  row.append(
    name,
    el('span', { class: 'swatches' }, ...SWATCHES.map((col) => el('button', {
      class: 'sws' + (col ? '' : ' none'),
      style: col ? `background:${col}` : null,
      'aria-pressed': String((state.tagColors[t] || '') === col),
      'aria-label': col ? 'Colour ' + col : 'No colour',
      onclick: safe(async () => {
        if (col) state.tagColors[t] = col; else delete state.tagColors[t];
        await chrome.storage.local.set({ tagColors: state.tagColors });
        drawSettings();
      })
    }))),
    el('span', { class: 'count' }, String(count)),
    el('button', {
      class: 'x', 'aria-label': 'Delete tag ' + t,
      onclick: safe(async () => { await deleteTag(t); drawSettings(); })
    }, icon('trash'))
  );
  return row;
}

// Rewrites the tag on every item that carries it, and in the search box if you were
// filtering by it. Deleting only takes the label off — it never deletes the item.
async function renameTag(from, to) {
  await eachTagged(from, (tags) => [...new Set(tags.map((x) => (x === from ? to : x)))]);
  if (state.tagColors[from]) { state.tagColors[to] = state.tagColors[from]; delete state.tagColors[from]; }
  await chrome.storage.local.set({ tagColors: state.tagColors });
  $('#q').value = retagQuery($('#q').value, from, to);
  toast(`Renamed #${from} to #${to}`);
}
async function deleteTag(t) {
  await eachTagged(t, (tags) => tags.filter((x) => x !== t));
  delete state.tagColors[t];
  await chrome.storage.local.set({ tagColors: state.tagColors });
  $('#q').value = retagQuery($('#q').value, t);
  toast(`Removed #${t} from every item`);
}

async function eachTagged(tag, change) {
  for (const item of state.items) {
    if (!item.tags.includes(tag)) continue;
    await saveTags(item, change(item.tags));
  }
  loadNotes(); loadLater(); loadClips();
  if (state.vaultKey) loadVault();
}

// ---------- Settings data ----------
// Approved sites are the extension's granted host permissions, e.g. *://*.github.com/*
function originFor(hostname) {
  const host = hostname.replace(/^www\./, '');
  const single = !host.includes('.') || /^[\d.]+$/.test(host) || host.startsWith('[');
  return single ? `*://${host}/*` : `*://*.${host}/*`;
}
const hostOfOrigin = (origin) => origin.replace(/^\*:\/\/(\*\.)?/, '').replace(/\/\*$/, '');

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

const DEFAULT_SETTINGS = { clipCapture: false, skipSecrets: true, unreadBadge: true, startOnToday: false, emailInGmail: false };

async function saveSettings(patch) {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS, ...(settings || {}), ...patch } });
}

async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) state[k] = settings?.[k] ?? v;
  // The shortcuts as they are bound, which may not be the suggested ones.
  try {
    const cmds = await chrome.commands?.getAll?.();
    if (cmds) state.commands = Object.fromEntries(cmds.map((c) => [c.name, c.shortcut || '']));
  } catch { /* shown with the suggested keys */ }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.windowId = tab?.windowId ?? null;
  const onPage = /^https?:/.test(tab?.url || '');
  state.tabId = onPage ? tab.id : null;
  state.tabHost = onPage ? hostOf(tab.url) : null;
  state.tabUrl = onPage ? tab.url : null;
  state.tabTitle = onPage ? (tab.title || tab.url) : null;
  state.tabFavicon = onPage ? (tab.favIconUrl || null) : null;
  state.tabOrigin = onPage ? originFor(new URL(tab.url).hostname) : null;
  state.captureOrigins = await captureOrigins();
  loadTrash();
}

// ---------- Keyboard ----------
// Focus never leaves the search field: the highlighted row is tracked with
// aria-activedescendant, so typing keeps working while you move through results.
const qEl = $('#q');
qEl.addEventListener('input', () => { state.active = 0; draw(); });
// From the welcome (nothing picked), the first arrow press lands on the first or
// last row rather than skipping one.
qEl.addEventListener('keydown', (e) => {
  const n = state.rows.length;
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n) state.picked = true;
  if (e.key === 'ArrowDown' && n) { e.preventDefault(); setActive(state.active < 0 ? 0 : (state.active + 1) % n, true); }
  else if (e.key === 'ArrowUp' && n) { e.preventDefault(); setActive(state.active < 0 ? n - 1 : (state.active - 1 + n) % n, true); }
  else if (e.key === 'Enter') { e.preventDefault(); openActive(e); }
  else if (e.key === 'Escape') {
    if (state.screen) setScreen(null);
    else if (qEl.value) { qEl.value = ''; state.active = 0; draw(); }
    // Only the popup closes on Escape: the panel and a tab are meant to stay.
    else if (VIEW === 'popup') window.close();
  } else if ((e.metaKey || e.ctrlKey) && /^[1-5]$/.test(e.key)) {
    e.preventDefault();
    setFilter(['all', ...TYPE_KEYS][+e.key - 1]);
  } else if ((e.metaKey || e.ctrlKey) && e.key === '0') {
    e.preventDefault();
    setFilter('today');
  }
});

// ---------- The add-note section ----------
// Enter makes the note and hands it straight to the editor with the caret at the
// end, so the line you typed is the note's first line rather than something you
// now have to retype. Empty, it does what "New note" does: an empty note, open.
const composeEl = $('#compose-in');
// `raw` keeps what was typed exactly (the first letter, a leading space); Enter
// on a typed line trims it, as before.
const addFromCompose = safe(async ({ raw = false } = {}) => {
  const text = raw ? composeEl.value : composeEl.value.trim();
  composeEl.value = '';
  // Awaited for the same reason clickRow awaits it: closeEditor clears
  // state.editing when its save resolves, which would wipe the session opened
  // after it and lose the note just typed. No redraw: redrawing the list
  // re-selects the row that was open and puts that note back in the pane, on
  // top of the new one. The list catches up when the new note is first saved.
  if (state.editing) await closeEditor({ redraw: false });
  if (state.vEditing) closeVaultEditor();
  await paneQueue;
  // A tag filter says what you are looking at, so a note made under one carries
  // that tag and stays in the list it was made in.
  newNote(text, parseQuery($('#q').value).tags, { wide: true });
});

// "Take a note…" is a way in, not a place to write: clicking it, or typing the
// first letter into it, opens the note with the whole popup to write in. A
// one-line box where nothing happened until you found Enter was the confusing
// part, and half a pane was too little room for a note.
//
// Opening the note takes a moment (the open one is saved first). Letters typed
// meanwhile land in this box again; they are carried into the new note rather
// than starting a second one.
let composing = null;
function startFromCompose(opts) {
  if (composing) return composing;
  composing = addFromCompose(opts).finally(() => {
    composing = null;
    const extra = composeEl.value;
    const area = $('#ed-area');
    if (extra && area) {
      composeEl.value = '';
      area.value += extra;
      area.setSelectionRange(area.value.length, area.value.length);
      readBack(); queueSave();
    }
  });
  return composing;
}
composeEl.addEventListener('mousedown', (e) => {
  e.preventDefault();          // the editor takes focus, not this box
  startFromCompose();
});
composeEl.addEventListener('input', () => {
  if (composeEl.value) startFromCompose({ raw: true });
});
composeEl.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') { e.preventDefault(); startFromCompose(); }
  else if (e.key === 'Escape') {
    // One Escape clears what you typed, a second one goes back to the search
    // field. Neither closes the popup out from under a half-written note.
    e.preventDefault();
    if (composeEl.value) composeEl.value = '';
    else $('#q').focus();
  }
});

function openActive(e) {
  const item = state.rows[state.active];
  if (!item) return;
  if (item.kind === 'action') return runRow(item);
  // Shift+Enter types a note or clip into the page: a saved reply, a snippet.
  if (e.shiftKey && (item.kind === 'note' || item.kind === 'clip')) {
    return item.kind === 'note'
      ? insertIntoPage(sendableText(txt.toPlain(item.row)), { formatted: true })
      : insertIntoPage(item.row.content);
  }
  if (item.kind === 'note') return focusEditor();
  if (item.kind === 'link') return safe(() => openLink(item))();
  if (item.kind === 'clip') return safe(() => copy(item.row.content))();
  if (item.kind === 'vault') {
    if (state.vaultState !== 'open') return drawVaultGate({ focus: true });
    // Ctrl+Enter copies the password; plain Enter fills, when the page matches.
    if (e.metaKey || e.ctrlKey) return safe(() => copy(item.row.password || '', 'Password copied'))();
    return hostMatches(item.row.url, state.tabHost) ? fillItem(item.row) : safe(() => copy(item.row.password || '', 'Password copied'))();
  }
}


// ---------- Writing a row ----------
// Every write lands in the local store at once; sync takes it to the server
// later, and adjusts it there if the database is behind the code.
function writeRow(table, id, row, opts = {}) {
  if (opts.upsert) return db.upsert(table, { id, ...row });
  return id ? db.update(table, id, row) : db.insert(table, row);
}

// ---------- The logo is "take me back" ----------
// One button that undoes whatever state you wandered into: a type filter, tag
// chips, a half-typed search, settings, the trash, an open editor. Every list
// UI needs one of these and the brand mark is where people already look for it.
const goHome = safe(async () => {
  if (state.editing) await closeEditor();       // saves the draft on its way out
  if (state.vEditing) closeVaultEditor();
  applyEditorWidth(false);
  if (state.screen) setScreen(null);
  $('#q').value = '';
  state.filter = 'all';
  state.active = 0;
  draw();
  $('#list').scrollTop = 0;
  $('#q').focus();
});
$('#home').addEventListener('click', goHome);

// ---------- Theme ----------
// Two states, light and dark, light by default. The button toggles between
// them. The icon shows the state you are in, so the button reads as a status as
// well as a control. Stored per device, like the tag colours. A stored 'system'
// from the older three-state switch reads as light.
const THEMES = [
  { key: 'light', icon: 'sun',  label: 'Theme: light' },
  { key: 'dark',  icon: 'moon', label: 'Theme: dark' }
];

function applyTheme(key) {
  const t = THEMES.find((x) => x.key === key) || THEMES[0];
  // Always set, so the OS dark-mode preference never overrides the choice.
  document.documentElement.dataset.theme = t.key;

  state.theme = t.key;
  const btn = $('#theme');
  btn.querySelector('use').setAttribute('href', '#i-' + t.icon);
  const next = THEMES[(THEMES.indexOf(t) + 1) % THEMES.length];
  btn.title = `${t.label} — click for ${next.key}`;
  btn.setAttribute('aria-label', btn.title);
}

$('#theme').addEventListener('click', safe(async () => {
  const i = THEMES.findIndex((x) => x.key === state.theme);
  const next = THEMES[(i + 1) % THEMES.length].key;
  applyTheme(next);
  await chrome.storage.local.set({ theme: next });
}));

// ---------- Fitting Chrome's popup window ----------
// Chrome caps a popup at 800x600 DEVICE pixels. At any browser zoom above 100%
// that cap is fewer CSS pixels than our 780x560, so the document overflows the
// window and the right-hand column and the bottom row get clipped.
//
// This cannot be expressed in CSS. vw/vh units are evaluated before Chrome has
// decided the window size and can resolve against a viewport that does not exist
// yet, which collapses the document and the popup never opens at all. Measuring
// after layout is the only reliable way, so the size is applied here instead.
function fitToWindow() {
  // The side panel and a tab are sized by CSS: they have a real viewport.
  if (VIEW !== 'popup') return;
  const de = document.documentElement;
  const w = de.clientWidth, h = de.clientHeight;
  if (w) document.body.style.width = Math.min(780, w) + 'px';
  if (h) document.body.style.height = Math.min(560, h) + 'px';
}
// Twice: removing the overflow gives the scrollbars' width back, which changes
// clientWidth, so the second pass settles on the real figure.
fitToWindow();
requestAnimationFrame(fitToWindow);
addEventListener('resize', fitToWindow);

// ---------- Staying current in the side panel and a tab ----------
// The popup is opened fresh each time, so it never sees anything change. The
// panel stays open for hours while you switch tabs and save things from the
// context menu, so it follows the front tab and the store.
if (VIEW !== 'popup') {
  const onlyIfIdle = () => !state.editing && !state.vEditing && !state.screen;
  const refreshTab = () => {
    clearTimeout(refreshTab._t);
    refreshTab._t = setTimeout(safe(async () => {
      await loadSettings();
      // Redraw only when the pane shows nothing of yours: an action (Save this
      // tab names the page) or nothing at all.
      const cur = state.rows[state.active];
      if (onlyIfIdle() && (!cur || cur.kind === 'action' || state.active < 0)) draw();
      // A login or a clip offers Fill or Insert for the page in front, so its
      // buttons are redrawn for the new page. (A link's pane is left alone: it
      // has a note box you may be typing in.)
      else if (onlyIfIdle() && (cur.kind === 'vault' || cur.kind === 'clip')) drawDetail(cur);
    }), 150);
  };
  chrome.tabs.onActivated?.addListener(refreshTab);
  chrome.tabs.onUpdated?.addListener((id, info) => { if (info.url || info.status === 'complete') refreshTab(); });
  chrome.windows?.onFocusChanged?.addListener(refreshTab);

  const LOADERS = { notes: () => loadNotes(), read_later: () => loadLater(), clips: () => loadClips(),
    vault_items: () => state.vaultKey && loadVault() };
  const changed = new Set();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const k of Object.keys(changes)) if (k.startsWith(LOCAL_PREFIX)) changed.add(k.slice(LOCAL_PREFIX.length));
    clearTimeout(changed._t);
    changed._t = setTimeout(() => {
      // Typing in a field in the pane (a link's note, a vault form) would lose
      // its caret to a redraw. Wait for the next change instead.
      const a = document.activeElement;
      if (!state.editing && a && $('#detail').contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName)) return;
      for (const t of changed) LOADERS[t]?.();
      changed.clear();
    }, 300);
  });
}

boot();
