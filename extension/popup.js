// DeskSync popup UI.
//
// The popup used to be four tabs, each with its own search box, so the thing you
// wanted was usually in a tab you were not in. It is now one search field over all
// four kinds of thing, with the types as filters on the rail and your own tags as
// chips under the search. Selecting a row opens it in the pane on the right instead
// of navigating away from the list — which is what the 780px width is for.

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const state = {
  theme: 'system',
  notes: [], later: [], clips: [], vault: [], trash: [],
  vaultKey: null, vaultState: 'locked',     // 'setup' | 'locked' | 'open'
  items: [], rows: [], active: 0, vEditing: null, vDraft: null, editorWide: false,
  filter: 'all', screen: null, editing: null,
  tagColors: {},
  tabId: null, tabHost: null, tabOrigin: null
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
async function copy(text, label = 'Copied') { await navigator.clipboard.writeText(text); toast(label); }
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

// ---------- Auth ----------
// The source folder ships with placeholders; `make ext` fills them in for dist/extension.
const isConfigured = !DESKSYNC_CONFIG.SUPABASE_URL.includes('YOUR-PROJECT');

async function boot() {
  const user = await currentUser();
  $('#auth').classList.toggle('hidden', !!user);
  $('#app').classList.toggle('hidden', !user);
  if (!isConfigured) $('#auth-msg').textContent = 'Not configured: run make ext, then load dist/extension.';
  if (!user) {
    const { theme } = await chrome.storage.local.get('theme');
    applyTheme(theme || 'system');
    $('#auth-email').focus();
    return;
  }
  state.email = user.email;
  // Drops a previous account's cached rows and queued writes before showing anything.
  await cache.claim(user.id);
  const { tagColors, theme, editorWide } = await chrome.storage.local.get(['tagColors', 'theme', 'editorWide']);
  state.tagColors = tagColors || {};
  state.editorWide = !!editorWide;
  applyTheme(theme || 'system');
  await loadSettings();
  loadNotes(); loadLater(); loadClips();
  checkVault();
  subscribeRealtime(user.id);
  updateOfflineBar();
  syncNow();
  draw();
  $('#q').focus();
}

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
  
// ---------- Writing rows when the database is behind the code ----------
// PostgREST answers "Could not find the 'format' column of 'notes' in the schema
// cache" when supabase/migrations/001_tags_and_markdown.sql has not been run.
// The old behaviour was to throw, which meant the note you had just typed was
// thrown away along with the request. Dropping the column the server does not
// know about and saving the rest keeps the writing; the warning says what to run.
const MISSING_COLUMN = /Could not find the '([^']+)' column/i;
const warnedColumns = new Set();

async function writeRow(table, id, row) {
  const payload = { ...row };
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return id ? await db.update(table, id, payload) : await db.insert(table, payload);
    } catch (e) {
      const column = MISSING_COLUMN.exec(e?.message || '')?.[1];
      if (!column || !(column in payload)) throw e;
      delete payload[column];
      if (!warnedColumns.has(column)) {
        warnedColumns.add(column);
        toast(`Saved, but your database has no '${column}' column yet — run supabase/migrations/001_tags_and_markdown.sql`);
      }
    }
  }
  throw new Error('Could not save this row');
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
// Three states, because "follow the OS" is the right default but not everyone
// wants it: system -> light -> dark -> system. The icon shows the state you are
// in, not the one you would move to, so the button reads as a status as well as
// a control. Stored per device, like the tag colours.
const THEMES = [
  { key: 'system', icon: 'monitor', label: 'Theme: following your system' },
  { key: 'light',  icon: 'sun',     label: 'Theme: light' },
  { key: 'dark',   icon: 'moon',    label: 'Theme: dark' }
];

function applyTheme(key) {
  const t = THEMES.find((x) => x.key === key) || THEMES[0];
  // No attribute at all means the prefers-color-scheme rule is left in charge.
  if (t.key === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t.key;

  state.theme = t.key;
  const btn = $('#theme');
  btn.querySelector('use').setAttribute('href', '#i-' + t.icon);
  const next = THEMES[(THEMES.indexOf(t) + 1) % THEMES.length];
  btn.title = `${t.label} — click for ${next.key === 'system' ? 'system' : next.key}`;
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

boot();
}));

// ---------- Offline ----------
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
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[OUTBOX_KEY]) updateOfflineBar();
});

function subscribeRealtime(uid) {
  const reload = { notes: loadNotes, read_later: loadLater, clips: loadClips, vault_items: () => state.vaultKey && loadVault() };
  const ch = sb.channel('desksync');
  for (const table of Object.keys(reload)) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `user_id=eq.${uid}` }, () => reload[table]());
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
    items.push({
      kind: 'note', id: n.id, row: n, when: n.updated_at, pinned: n.pinned,
      title: n.title || md.toText(n).slice(0, 60) || 'Untitled',
      sub: md.toText(n).slice(0, 90), tags: n.tags || []
    });
  }
  for (const r of state.later) {
    items.push({
      kind: 'link', id: r.id, row: r, when: r.created_at, read: r.is_read,
      title: r.title || r.url, sub: hostOf(r.url), tags: r.tags || []
    });
  }
  for (const c of state.clips) {
    items.push({
      kind: 'clip', id: c.id, row: c, when: c.created_at, pinned: c.pinned, mono: true,
      title: c.content, sub: c.source_url || '', tags: c.tags || []
    });
  }
  // Vault titles are inside the ciphertext, so a locked vault has nothing to list.
  for (const v of state.vault) {
    items.push({
      kind: 'vault', id: v.id, row: v, when: v.updated_at || null,
      title: v.title || v.url || 'Untitled', sub: v.username || hostOf(v.url), tags: v.tags || []
    });
  }

  items.sort((a, b) => (!!b.pinned - !!a.pinned) || (new Date(b.when || 0) - new Date(a.when || 0)));
  state.items = items;
}

// ---------- Tags ----------
// Tags are held in the search box as #tokens, so the chips and the typed text are
// the same state and cannot disagree.
function parseQuery(raw) {
  const tags = [];
  const text = raw.replace(/#([\w-]+)/g, (m, t) => { tags.push(t.toLowerCase()); return ' '; }).trim();
  return { text, tags };
}
const normalizeTag = (v) => v.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-');

function allTags() {
  const c = {};
  for (const i of state.items) for (const t of i.tags) c[t] = (c[t] || 0) + 1;
  return Object.keys(c).sort((a, b) => c[b] - c[a] || a.localeCompare(b));
}

function toggleTag(t) {
  const q = $('#q');
  const { tags } = parseQuery(q.value);
  q.value = tags.includes(t)
    ? q.value.replace(new RegExp('#' + t + '\\b', 'i'), '').replace(/\s+/g, ' ').trim()
    : (q.value.trim() + ' #' + t).trim();
  state.active = 0; draw(); q.focus();
}

// Writing a tag list back to whichever table the item came from. Vault tags go
// inside the encrypted payload, so they need a re-encrypt rather than a column write.
async function saveTags(item, tags) {
  item.tags = tags;
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
  if (item.tags.some((x) => x.toLowerCase().includes(s))) return 10;
  return 0;
}

function matches(raw) {
  const { text, tags } = parseQuery(raw);
  const pool = state.items.filter((i) =>
    (state.filter === 'all' || i.kind === state.filter) && tags.every((t) => i.tags.includes(t)));
  if (!text) return pool;
  return pool
    .map((i) => [score(i, text), i])
    .filter(([n]) => n > 0)
    .sort((a, b) => (TYPE_KEYS.indexOf(a[1].kind) - TYPE_KEYS.indexOf(b[1].kind)) || (b[0] - a[0]))
    .map(([, i]) => i);
}

// ---------- Capture actions ----------
// The three things you come here to add. They used to be spread across the tabs.
// The way to add a thing has to be reachable from wherever you are. Filtering to
// Notes used to hide every action, so an empty Notes list was a dead end with no
// way to create one. Each filter keeps the action that makes its own kind.
function actions() {
  const f = state.filter;
  const forAll = f === 'all';
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
  if (forAll || f === 'note') {
    list.push({ action: 'note', icon: 'plus', title: 'New note', sub: 'Start an empty note' });
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

  const found = matches(raw);
  // Shown under a type filter too, so a filtered empty list still offers the
  // way to fill it. Hidden once you are searching: then you want results.
  const showActions = !raw;
  state.rows = showActions ? [...actions(), ...found] : found;

  const list = $('#list');
  list.replaceChildren();

  if (!state.rows.length) {
    list.append(emptyRow(text, tags));
    if (!state.editing && !state.vEditing) drawDetail(null);
    return;
  }

  let last = null;
  state.rows.forEach((item, idx) => {
    const group = item.kind === 'action' ? null
      : text ? TYPES[item.kind].label
      : state.filter === 'all' ? 'Recent'
      : TYPES[item.kind].label;
    if (group && group !== last) { list.append(el('li', { class: 'g-head' }, group)); last = group; }
    list.append(rowFor(item, idx, text));
  });

  const acts = list.querySelectorAll('.row.act');
  if (acts.length) {
    acts[0].classList.add('act-first');
    acts[acts.length - 1].classList.add('act-last');
  }

  if (state.active >= state.rows.length) state.active = 0;
  setActive(state.active, true);
}

function emptyRow(text, tags) {
  if (state.filter === 'vault' && state.vaultState !== 'open') {
    return el('li', { class: 'empty' }, 'The vault is locked, so its items are not listed. Unlock it on the right.');
  }
  const bits = [];
  if (text) bits.push(`matching “${text}”`);
  if (tags.length) bits.push(`tagged ${tags.map((t) => '#' + t).join(' and ')}`);
  return el('li', { class: 'empty' }, bits.length ? `Nothing ${bits.join(' ')}.` : 'Nothing here yet.');
}

function drawHead(text, tags) {
  const head = $('#listhead');
  const T = TYPES[state.filter];
  const parts = [T ? T.label : null, ...tags.map((t) => '#' + t)].filter(Boolean);
  const where = parts.length ? parts.join(' ') : (text ? 'Results' : 'Everything');
  const n = matches($('#q').value.trim()).length;

  // replaceChildren does not skip nulls the way el() does, so filter first.
  head.replaceChildren(...[
    T ? el('span', { class: 'dot', style: `background:${T.color}` }) : null,
    el('span', { class: 'where' }, where),
    el('span', { class: 'n' }, text ? (n === 1 ? '1 match' : `${n} matches`) : plural(n, 'item')),
    (state.filter !== 'all' || text || tags.length)
      ? el('button', { class: 'clear', onclick: () => { $('#q').value = ''; setFilter('all'); } }, 'Clear')
      : null
  ].filter(Boolean));
}

function drawTagbar(text, tags) {
  const bar = $('#tagbar');
  // Each chip's count is what would be left if you also pressed it, so a chip can
  // never lead to an empty list without saying so first.
  const pool = state.items.filter((i) =>
    (state.filter === 'all' || i.kind === state.filter) &&
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
      onmousemove: () => hoverRow(idx), onclick: () => clickRow(idx)
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
    class: ['row', item.read ? 'read' : '', item.kind === 'vault' ? 'locked-able' : ''].filter(Boolean).join(' '),
    id: 'r' + idx, role: 'option', 'aria-selected': 'false', 'data-i': idx,
    onmousemove: () => hoverRow(idx), onclick: () => clickRow(idx)
  },
    el('span', { class: 'bul', style: `background:${T.color}` }),
    el('span', { class: 'body' },
      el('span', { class: 't' + (item.mono ? ' mono' : '') }, ...highlight(item.title, query)),
      el('span', { class: 'm' },
        ...item.tags.map((t) => el('span', {
          class: 'tg',
          style: state.tagColors[t] ? `background:${state.tagColors[t]}22;color:${state.tagColors[t]}` : null
        }, '#' + t)),
        ...highlight(sub, query))),
    item.pinned ? el('span', { class: 'mark-i' }, icon('pin')) : null,
    item.row?.source === 'android' ? el('span', { class: 'mark-i', title: 'Saved from your phone' }, icon('phone')) : null,
    rowActions(item));
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

function hoverRow(i) { if (!state.editing && i !== state.active) setActive(i, false); }
async function clickRow(i) {
  // Awaited: closeEditor clears state.editing when its save resolves, so firing
  // it and carrying on would wipe the session we are about to open. Clicking
  // "New note" with an editor already open lost the new note that way.
  if (state.editing) await closeEditor();
  if (state.vEditing) closeVaultEditor();        // an unsaved login is discarded, by design
  setActive(i, false);
  // An action row is a button, not something to inspect: clicking it runs it.
  // Selecting it and making you click "Do it" in the other pane read as nothing
  // happening at all, which is exactly how "New note" felt.
  const item = state.rows[i];
  if (item && item.kind === 'action') { runRow(item); return; }
  $('#q').focus();
}

// Shared by Enter and by clicking an action row.
function runRow(item) {
  if (item.action === 'vault') return drawVaultGate();
  if (item.action === 'login') return openVaultEditor(null);
  if (item.disabled) return toast(item.action === 'tab' ? "Can't save this page" : 'Not available here');
  runAction(item.action);
}

function setActive(i, scroll) {
  state.active = i;
  const list = $('#list');
  list.querySelectorAll('[role=option]').forEach((e) => e.setAttribute('aria-selected', 'false'));
  const row = list.querySelector('#r' + i);
  const q = $('#q');
  if (!row) { q.removeAttribute('aria-activedescendant'); return; }
  row.setAttribute('aria-selected', 'true');
  q.setAttribute('aria-activedescendant', 'r' + i);
  if (scroll) row.scrollIntoView({ block: 'nearest' });
  if (!state.editing) drawDetail(state.rows[i]);
}

function setFilter(f) {
  if (state.screen) setScreen(null);
  state.filter = f; state.active = 0;
  draw();
  $('#q').focus();
}
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

  if (!item) { pane.append(el('div', { class: 'sc-empty' }, 'Nothing selected.')); return; }

  if (item.kind === 'action') return drawActionDetail(item);
  if (item.kind === 'vault' && state.vaultState !== 'open') return drawVaultGate();

  const T = TYPES[item.kind];
  pane.append(
    el('header', { class: 'd-band' },
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
    // Legacy notes are HTML; markdown.js converts before rendering so both look the same.
    return [el('div', { class: 'md', html: md.render(md.toMarkdown(item.row)) || '<p class="muted">Empty note.</p>' })];
  }
  if (item.kind === 'clip') return [el('div', { class: 'wrap v' }, item.row.content)];
  if (item.kind === 'link') {
    return [
      el('div', { class: 'field' }, el('span', { class: 'k' }, 'Link'), el('span', { class: 'v' }, item.row.url)),
      el('div', { class: 'field' }, el('span', { class: 'k' }, 'Saved'),
        el('span', { class: 'v' }, item.row.source === 'android' ? 'from your phone' : 'from a browser')),
      item.row.note ? el('p', { class: 'wrap', style: 'margin-top:12px' }, item.row.note) : null
    ].filter(Boolean);
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

  if (item.kind === 'note') {
    return [
      el('button', { class: 'primary', onclick: () => openEditor(item) }, icon('edit'), 'Edit'),
      el('button', { class: 'ghost', onclick: safe(() => togglePin(item)) }, icon('pin'), item.pinned ? 'Unpin' : 'Pin'),
      el('span', { class: 'spacer' }), del
    ];
  }
  if (item.kind === 'link') {
    return [
      el('button', { class: 'primary', onclick: safe(() => openLink(item)) }, icon('open'), 'Open'),
      el('button', { class: 'ghost', onclick: safe(() => toggleRead(item)) },
        icon(item.row.is_read ? 'undo' : 'check'), item.row.is_read ? 'Mark unread' : 'Mark read'),
      el('span', { class: 'spacer' }), del
    ];
  }
  if (item.kind === 'clip') {
    return [
      el('button', { class: 'primary', onclick: safe(() => copy(item.row.content)) }, icon('copy'), 'Copy'),
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

function drawActionDetail(item) {
  const COPY = {
    tab:   'Saves the tab you are on, with its title and favicon, to Read later.',
    clip:  'Reads the clipboard once, on your click. Background capture stays off until you turn it on per site in Settings.',
    note:  'Opens an empty markdown note in this pane.',
    vault: 'Your master password unlocks every saved login for this session. It is not stored anywhere and cannot be recovered.'
  };
  if (item.action === 'vault') return drawVaultGate();
  $('#detail').append(
    el('header', { class: 'd-band' },
      el('div', { class: 'd-kind' }, el('span', { class: 'bul', style: 'background:var(--ink)' }), 'Action'),
      el('h2', { class: 'd-title' }, item.title),
      el('p', { class: 'd-sub' }, item.sub)),
    el('div', { class: 'd-body' }, el('p', {}, COPY[item.action])),
    el('footer', { class: 'd-foot' },
      el('button', { class: 'primary', disabled: item.disabled, onclick: () => runAction(item.action) },
        icon('plus'), item.kbd ? `Do it · ${item.kbd}` : 'Do it'))
  );
}

// ---------- Item actions ----------
const togglePin = async (item) => {
  await db.update(TYPES[item.kind].table, item.id, { pinned: !item.pinned });
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
  await db.insert('notes', { title: item.row.content.slice(0, 40), body: item.row.content, format: 'markdown', tags: item.tags });
  toast('Saved as note'); loadNotes();
}
async function remove(item) {
  // Clips have their text blanked on delete, so a copied password can't linger in the trash.
  if (item.kind === 'clip') await db.remove('clips', item.id, { content: '', source_url: null });
  else await db.remove(TYPES[item.kind].table, item.id);
  toast('Deleted');
  state.active = Math.max(0, state.active - 1);
  ({ note: loadNotes, link: loadLater, clip: loadClips, vault: loadVault })[item.kind]();
}

const runAction = safe(async (what) => {
  if (what === 'tab') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!/^https?:/.test(tab?.url || '')) return toast("Can't save this page");
    await db.insert('read_later', { url: tab.url, title: tab.title, favicon: tab.favIconUrl || null });
    toast('Saved to Read later'); loadLater();
  } else if (what === 'clip') {
    const text = (await navigator.clipboard.readText()).trim().slice(0, DESKSYNC_CONFIG.CLIP_MAX_LENGTH);
    if (!text) return toast('Clipboard is empty');
    await db.insert('clips', { content: text }); toast('Saved'); loadClips();
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

  const add = el('button', { class: 'add' }, '+ Tag');
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
  const input = el('input', { placeholder: 'tag name', 'aria-label': 'New tag',
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
    const v = normalizeTag(name);
    if (v && !item.tags.includes(v)) await saveTags(item, [...item.tags, v]);
    refreshAfterTags(item);
  });

  const render = () => {
    const typed = normalizeTag(input.value);
    const known = allTags().filter((t) => !item.tags.includes(t) && (!typed || t.includes(typed)));
    options = known.map((t) => ({ name: t, isNew: false }));
    // Only offered when it is not already a tag, so the list never shows the
    // same name twice with two different meanings.
    if (typed && !known.includes(typed)) options.push({ name: typed, isNew: true });

    if (active >= options.length) active = Math.max(0, options.length - 1);
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
    }));
    pop.hidden = options.length === 0;
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
  if (state.editing) { drawEditor(); focusEditor(); }
  else drawDetail(item);
}

// ---------- Note editor ----------
// The note is edited as it looks, not as markdown source: bold text is bold
// while you type it. There is no Preview button because there is nothing to
// preview — the editing surface is the rendered note.
//
// Markdown is still what gets stored. The note is rendered to HTML on open and
// turned back into markdown on save, so the file format does not depend on the
// browser's contenteditable quirks and the Android app keeps reading one thing.
//
// There is also no Save button: a popup closes the moment you click anywhere
// else in the browser, so it writes as you type, debounced.
const TOOLS = [
  { k: 'bold',   cls: 'b',    txt: 'B',  label: 'Bold',          cmd: 'bold' },
  { k: 'italic', cls: 'i-t',  txt: 'I',  label: 'Italic',        cmd: 'italic' },
  { k: 'strike', cls: 's',    txt: 'S',  label: 'Strikethrough', cmd: 'strikeThrough' },
  { sep: true },
  { k: 'h',      cls: '',     txt: 'H',  label: 'Heading',       block: 'H2' },
  { k: 'ul',     cls: '',     txt: '•', label: 'Bullet list',   cmd: 'insertUnorderedList' },
  { k: 'ol',     cls: '',     txt: '1.', label: 'Numbered list', cmd: 'insertOrderedList' },
  { k: 'task',   cls: '',     txt: '☐', label: 'Task list',     tasks: true },
  { k: 'quote',  cls: '',     txt: '“', label: 'Quote',         block: 'BLOCKQUOTE' },
  { sep: true },
  { k: 'code',   cls: 'mono', txt: '{}', label: 'Code',          wrap: 'code' },
  { k: 'link',   cls: 'mono', txt: '[]', label: 'Link',          link: true }
];

function newNote() {
  const row = { id: null, title: '', body: '', format: 'markdown', tags: [], color: 'yellow', pinned: false };
  openEditor({ kind: 'note', id: null, row, title: '', sub: '', tags: [], when: null, isNew: true });
}

function openEditor(item) {
  state.editing = item;
  // Converted once, on open: a note written before the markdown editor becomes
  // markdown here and is saved that way from now on.
  state.draft = { title: item.row.title || '', body: md.toMarkdown(item.row), tags: [...item.tags] };
  drawEditor();
  focusEditor();
}

function focusEditor() {
  const a = $('#ed-area');
  if (!a) return;
  a.focus();
  // Caret to the end, so typing continues the note rather than overwriting it.
  const r = document.createRange();
  r.selectNodeContents(a);
  r.collapse(false);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

const closeEditor = safe(async () => {
  const item = state.editing;
  if (!item) return;
  // Save before clearing state.editing, not after: anything typed inside the
  // autosave debounce is only in state.draft, and the flush needs to know which
  // note it belongs to. Clearing first lost the last few seconds of typing.
  await flushDraft(true, item);
  state.editing = null;
  applyEditorWidth(false);
  draw();
  $('#q').focus();
});


// A note can be longer than a 310px list is useful, so the editor can take the
// whole popup. Only while editing: the list comes back when you are done, and
// the choice is remembered for the next note.
function applyEditorWidth(on) {
  $('#app').classList.toggle('wide', !!on);
}

function drawEditor() {
  const item = state.editing;
  const pane = $('#detail');
  pane.replaceChildren();
  applyEditorWidth(state.editorWide);

  const title = el('input', {
    class: 't-in', id: 'ed-title', value: state.draft.title,
    placeholder: 'Untitled note', 'aria-label': 'Note title'
  });
  title.addEventListener('input', () => { state.draft.title = title.value; queueSave(); });
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); focusEditor(); }
    if (e.key === 'Escape') { e.preventDefault(); closeEditor(); }
  });

  // The formatting tools scroll; nothing else in the bar does. In a pane this
  // narrow the toolbar does not fit, and losing a control off the right edge is
  // worse than having to scroll for a less-used one.
  const bar = el('div', { class: 'ed-bar' },
    el('span', { class: 'tools' },
      ...TOOLS.map((t) => t.sep
        ? el('span', { class: 'sep' })
        : el('button', {
            class: t.cls, title: t.label, 'aria-label': t.label, 'data-tool': t.k,
            // mousedown, not click: the selection in the note must survive being
            // formatted, and clicking a button would move focus first.
            onmousedown: (e) => { e.preventDefault(); applyTool(t.k); }
          }, t.txt))),
    el('span', { class: 'right' },
      el('button', {
        id: 'ed-wide', 'data-wide': String(!!state.editorWide),
        title: state.editorWide ? 'Show the list again' : 'Give the note the whole popup',
        'aria-label': state.editorWide ? 'Show the list again' : 'Give the note the whole popup',
        'aria-pressed': String(!!state.editorWide),
        onclick: safe(async () => {
          state.editorWide = !state.editorWide;
          applyEditorWidth(state.editorWide);
          await chrome.storage.local.set({ editorWide: state.editorWide });
          const btn = $('#ed-wide');
          btn.setAttribute('aria-pressed', String(state.editorWide));
          btn.querySelector('use').setAttribute('href', state.editorWide ? '#i-collapse' : '#i-expand');
          btn.title = state.editorWide ? 'Show the list again' : 'Give the note the whole popup';
          btn.setAttribute('aria-label', btn.title);
          $('#ed-area')?.focus();
        })
      }, icon(state.editorWide ? 'collapse' : 'expand'))));

  const body = el('div', {
    class: 'ed-rich md', id: 'ed-area', contenteditable: 'true', spellcheck: 'true',
    role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Note',
    'data-placeholder': 'Write your note…'
  });
  body.innerHTML = md.render(state.draft.body);
  body.addEventListener('input', () => { readBack(); queueSave(); });
  body.addEventListener('keydown', editorKeys);
  // A task box is a control, not text: clicking one ticks it off.
  body.addEventListener('click', (e) => {
    const box = e.target.closest('.box');
    if (!box) return;
    const li = box.closest('li');
    const done = box.classList.toggle('on');
    li?.classList.toggle('done', done);
    readBack(); queueSave();
  });

  pane.append(
    el('header', { class: 'd-band' },
      el('div', { class: 'd-kind' }, el('span', { class: 'bul', style: 'background:var(--note)' }), 'Note'),
      title,
      el('p', { class: 'd-sub' }, item.when ? ago(item.when) : 'New note')),
    tagRow({ ...item, tags: state.draft.tags, row: item.row, kind: 'note' }),
    el('div', { class: 'ed' }, bar, body),
    el('footer', { class: 'ed-foot' },
      el('button', { class: 'primary', onclick: closeEditor }, 'Done'),
      el('span', { class: 'saved', id: 'ed-saved' }, 'Saved'),
      el('span', { class: 'spacer' }),
      el('span', { class: 'hint' }, '⌘↵ done · esc back'))
  );

  // Esc and Cmd+Enter work anywhere in the pane, including from a tag input.
  pane.onkeydown = (e) => {
    if (!state.editing) return;
    if (e.target.tagName === 'INPUT' && e.target.hasAttribute('list')) return;   // typing a tag
    if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) {
      e.preventDefault(); e.stopPropagation(); closeEditor();
    }
  };
}

// What is on screen is the source of truth; markdown is derived from it.
function readBack() {
  const a = $('#ed-area');
  if (a && state.draft) state.draft.body = md.fromHtml(a.innerHTML);
}

function queueSave() {
  saveState('Saving…');
  clearTimeout(queueSave._t);
  queueSave._t = setTimeout(() => flushDraft(false), 700);
}

function saveState(text) {
  const el2 = $('#ed-saved');
  if (el2) el2.textContent = text;
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
  readBack();

  const { title, body, tags } = state.draft;

  // A note you opened and never typed into is thrown away rather than left as a blank row.
  if (item.isNew && !title.trim() && !body.trim()) { if (final) state.draft = null; return; }

  const row = { title: title.trim(), body, format: 'markdown', tags };
  const written = await writeRow('notes', item.id, row);
  if (!item.id) {
    item.id = written?.id ?? item.id;
    item.isNew = false;
  }
  saveState('Saved');
  if (final) state.draft = null;
  loadNotes();
}

// Returns the block element the caret sits in, within the note.
function currentBlock() {
  const a = $('#ed-area');
  let node = getSelection()?.anchorNode;
  while (node && node !== a) {
    if (node.nodeType === Node.ELEMENT_NODE && /^(H[1-6]|BLOCKQUOTE|P|DIV|LI|PRE)$/.test(node.tagName)) return node;
    node = node.parentNode;
  }
  return null;
}

// The nearest ancestor of a kind, stopping at the editor itself.
function ancestor(test) {
  const a = $('#ed-area');
  let node = getSelection()?.anchorNode;
  while (node && node !== a) {
    if (node.nodeType === Node.ELEMENT_NODE && test(node)) return node;
    node = node.parentNode;
  }
  return null;
}

const unwrap = (node) => node.replaceWith(...node.childNodes);

// Puts the caret at the end of a node.
//
// An empty element gets a text node first: a caret collapsed inside an element
// with no children is a place Chrome will not type into, so the next keystroke
// lands outside it. That is what made the second task item stay empty while the
// text appeared after the list.
function caretTo(node) {
  if (!node) return;
  if (node.nodeType === Node.ELEMENT_NODE && !node.firstChild) node.append(document.createTextNode(''));
  const target = node.nodeType === Node.ELEMENT_NODE && node.lastChild?.nodeType === Node.TEXT_NODE
    ? node.lastChild : node;
  const r = document.createRange();
  if (target.nodeType === Node.TEXT_NODE) r.setStart(target, target.nodeValue.length);
  else { r.selectNodeContents(target); r.collapse(false); }
  r.collapse(true);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

// Typing into an empty note leaves a bare text node directly under the editor,
// with no block around it at all. Every block tool asks "which block is the
// caret in", gets nothing back, and acts on nothing: pressing Task next to a
// line of text added an empty checkbox beside it instead of converting it.
//
// The nodes are moved into the paragraph rather than copied, so the caret, which
// points at one of them, comes along and the cursor does not jump.
function ensureBlocks() {
  const a = $('#ed-area');
  if (!a) return;
  const BLOCK = /^(H[1-6]|UL|OL|PRE|BLOCKQUOTE|P|DIV|HR)$/;

  let run = [];
  const flush = () => {
    if (!run.length) return;
    const p = document.createElement('p');
    run[0].before(p);
    p.append(...run);          // moves them: any range inside stays valid
    run = [];
  };

  for (const node of [...a.childNodes]) {
    const isBlock = node.nodeType === Node.ELEMENT_NODE && BLOCK.test(node.tagName);
    if (isBlock) flush();
    else if (node.nodeType === Node.TEXT_NODE && !node.nodeValue.trim()) continue;
    else run.push(node);
  }
  flush();
}

// execCommand leaves the DOM in states markdown has no way to express: a quote
// inside a quote inside a quote, or three one-item lists in a row where one list
// of three was meant. Tidying after each command is what keeps what you see and
// what gets stored the same thing.
function tidyEditor() {
  const a = $('#ed-area');
  if (!a) return;
  ensureBlocks();

  // Nested quotes flatten: markdown has one level and the bars just stack up.
  let guard = 0;
  let nested = a.querySelector('blockquote blockquote');
  while (nested && guard++ < 50) {
    unwrap(nested);
    nested = a.querySelector('blockquote blockquote');
  }

  // Lists split by a command are joined back up, so numbering keeps counting.
  for (const list of [...a.querySelectorAll('ul, ol')]) {
    let next = list.nextElementSibling;
    while (next && next.tagName === list.tagName &&
           next.classList.contains('tasks') === list.classList.contains('tasks')) {
      list.append(...next.children);
      next.remove();
      next = list.nextElementSibling;
    }
  }

  // A task item is exactly a box and a span of text. Typing can land a bare text
  // node straight into the <li>, beside the span rather than inside it, and then
  // the item looks empty to everything that reads it — which is how a typed line
  // got thrown away when the list ended.
  for (const list of a.querySelectorAll('ul.tasks')) {
    for (const li of list.children) {
      if (li.tagName !== 'LI') continue;

      let box = li.querySelector(':scope > .box');
      if (!box) {
        box = document.createElement('span');
        box.className = 'box';
        li.prepend(box);
      }
      box.setAttribute('contenteditable', 'false');

      let span = [...li.children].find((c) => c !== box && !c.classList.contains('box'));
      if (!span) {
        span = document.createElement('span');
        li.append(span);
      }
      // Anything loose in the item belongs in that span.
      for (const node of [...li.childNodes]) {
        if (node !== box && node !== span) span.append(node);
      }

      if (!span.textContent.trim()) { box.classList.remove('on'); li.classList.remove('done'); }
      li.classList.toggle('done', box.classList.contains('on'));
    }
  }

  // execCommand likes to leave empty wrappers behind.
  for (const el2 of a.querySelectorAll('p, div, blockquote, h1, h2, h3')) {
    if (!el2.textContent.trim() && !el2.querySelector('br, img, .box') && a.children.length > 1) el2.remove();
  }
}

// Turns the block the caret is in into a task list, or back out of one.
function toggleTasks() {
  const a = $('#ed-area');
  const block = currentBlock();
  const li = block && block.tagName === 'LI' ? block : block?.closest?.('li');
  const list = li?.parentElement;

  if (list && list.classList.contains('tasks')) {
    // back to ordinary paragraphs
    const frag = document.createDocumentFragment();
    let last = null;
    for (const item of [...list.children]) {
      const p = document.createElement('p');
      const textSpan = [...item.children].find((c) => !c.classList.contains('box'));
      p.innerHTML = textSpan ? textSpan.innerHTML : item.innerHTML;
      frag.append(p);
      last = p;
    }
    list.replaceWith(frag);
    if (last) caretTo(last);
    return;
  }

  if (list && (list.tagName === 'UL' || list.tagName === 'OL')) {
    // an existing list becomes a task list, keeping its items
    const ul = document.createElement('ul');
    ul.className = 'tasks';
    for (const item of [...list.children]) {
      if (item.tagName !== 'LI') continue;
      const next = document.createElement('li');
      next.innerHTML = `<span class="box" contenteditable="false"></span><span>${item.innerHTML}</span>`;
      ul.append(next);
    }
    list.replaceWith(ul);
    caretTo(ul.lastElementChild);
    return;
  }

  const ul = document.createElement('ul');
  ul.className = 'tasks';
  const item = document.createElement('li');
  item.innerHTML = `<span class="box" contenteditable="false"></span><span>${block ? block.innerHTML : ''}</span>`;
  ul.append(item);
  if (block) block.replaceWith(ul); else a.append(ul);
  caretTo(item.lastElementChild);
}

function applyTool(k) {
  const t = TOOLS.find((x) => x.k === k);
  const a = $('#ed-area');
  if (!t || !a) return;
  a.focus();
  ensureBlocks();      // so there is a block to act on, even in an empty note

  if (t.cmd) {
    document.execCommand(t.cmd, false, null);
  } else if (t.tasks) {
    toggleTasks();
  } else if (t.block === 'BLOCKQUOTE') {
    // formatBlock wraps, it does not toggle: pressing Quote twice used to put a
    // quote inside a quote, and the bars stacked up one per press.
    const bq = ancestor((n) => n.tagName === 'BLOCKQUOTE');
    if (bq) unwrap(bq);
    else document.execCommand('formatBlock', false, 'BLOCKQUOTE');
  } else if (t.block) {
    // Pressing Heading inside a heading takes it back off, rather than doing nothing.
    const here = ancestor((n) => /^H[1-6]$/.test(n.tagName));
    document.execCommand('formatBlock', false, here ? 'P' : t.block);
  } else if (t.wrap) {
    const sel = getSelection();
    const text = sel?.toString();
    if (text) document.execCommand('insertHTML', false, `<${t.wrap}>${md.escape(text)}</${t.wrap}>`);
  } else if (t.link) {
    return askForLink();
  }

  tidyEditor();
  readBack();
  queueSave();
}

// A link needs a URL, and window.prompt closes the popup on some platforms, so
// the toolbar grows a field instead.
function askForLink() {
  const bar = $('.ed-bar .tools');
  if (!bar || bar.querySelector('.link-in')) return;
  const sel = getSelection();
  const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;

  const input = el('input', { class: 'link-in', placeholder: 'https://…', 'aria-label': 'Link address' });
  bar.append(input);
  input.focus();

  const done = (apply) => {
    const url = input.value.trim();
    input.remove();
    if (!apply || !url) return;
    const a = $('#ed-area');
    a.focus();
    if (range) { const s2 = getSelection(); s2.removeAllRanges(); s2.addRange(range); }
    if (getSelection().toString()) document.execCommand('createLink', false, url);
    else document.execCommand('insertHTML', false, `<a href="${md.escape(url)}">${md.escape(url)}</a>`);
    readBack(); queueSave();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); done(true); }
    if (e.key === 'Escape') { e.preventDefault(); done(false); }
  });
  input.addEventListener('blur', () => done(true));
}

function editorKeys(e) {
  // Esc and Cmd+Enter belong to the pane; contenteditable handles Enter, lists
  // and Ctrl+B/I itself.
  if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) return;

  if (e.key !== 'Enter' || e.shiftKey) return;
  const li = ancestor((n) => n.tagName === 'LI');
  const list = li?.parentElement;
  if (!list || !list.classList.contains('tasks')) return;

  e.preventDefault();
  tidyEditor();        // put any loose typing back inside its span first
  const textSpan = [...li.children].find((c) => !c.classList.contains('box'));
  // Enter on an empty item ends the list, the same as every other editor.
  if (!textSpan || !textSpan.textContent.trim()) {
    const p = document.createElement('p');
    p.innerHTML = '<br>';
    list.after(p);
    li.remove();
    caretTo(p);
  } else {
    const next = document.createElement('li');
    next.innerHTML = '<span class="box" contenteditable="false"></span><span></span>';
    li.after(next);
    caretTo(next.lastElementChild);
  }
  tidyEditor();
  readBack();
  queueSave();
}

// ---------- Vault editor ----------
// Unlike the note editor this one has an explicit Save. A note saved half-typed
// is a note you finish later; a password saved half-typed is a login you can no
// longer use, and the old value is gone. So the write happens when you say so.
function openVaultEditor(item) {
  if (state.vaultState !== 'open') return drawVaultGate();
  const row = item ? item.row : { title: '', url: '', username: '', password: '', notes: '', tags: [] };
  state.vEditing = item || { kind: 'vault', id: null, row, tags: [], isNew: true };
  state.vDraft = {
    title: row.title || '', url: row.url || '', username: row.username || '',
    password: row.password || '', notes: row.notes || '', tags: [...(row.tags || [])]
  };
  // A new login is almost always for the page you are on, so start it there.
  if (!item && state.tabHost) {
    state.vDraft.title = state.tabHost;
    state.vDraft.url = 'https://' + state.tabHost;
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
    toast('Saved (encrypted)');
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
  const { data, error } = await sb.from('vault_meta').select('user_id').maybeSingle();
  if (error && navigator.onLine) throw error;
  state.vaultState = data ? 'locked' : 'setup';
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
function drawVaultGate() {
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
      const { error } = await sb.from('vault_meta').insert({ salt, iterations: 600000, verifier_iv: v.iv, verifier_ct: v.ciphertext });
      if (error) throw error;
      await vaultCrypto.storeSessionKey(key);
    } else {
      msg.textContent = 'Unlocking…';
      const { data: meta, error } = await sb.from('vault_meta').select('*').single();
      if (error) throw error;
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
  p1.focus();
}

// Does a saved item belong to the site in the front tab?
function hostMatches(itemUrl, tabHost) {
  if (!tabHost || !itemUrl) return false;
  let host;
  try { host = new URL(/^https?:\/\//i.test(itemUrl) ? itemUrl : 'https://' + itemUrl).hostname.replace(/^www\./, ''); }
  catch { return false; }
  return host === tabHost || tabHost.endsWith('.' + host) || host.endsWith('.' + tabHost);
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

// ---------- Screens: settings and trash ----------
function setScreen(name) {
  state.screen = name;
  const on = !!name;
  $('#mid').hidden = on;
  $('#detail').hidden = on;
  $('#screen').hidden = !on;
  $$('.rail [data-screen]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.screen === name)));
  if (on) { drawScreen(); $('#screen').focus(); }
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
  if (r._table === 'notes') return r.title || md.toText(r).slice(0, 80) || 'Untitled';
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
    onclick: safe(async function emptyTrash() {
      // Emptying can't be undone, so the button asks a second time rather than
      // opening a dialog — a modal dialog would freeze the popup.
      if (!this.dataset.armed) {
        this.dataset.armed = '1';
        this.textContent = 'Delete everything?';
        clearTimeout(emptyTrash._t);
        emptyTrash._t = setTimeout(() => drawTrash(), 5000);
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

  const captureSwitch = el('button', {
    class: 'sw', role: 'switch', 'aria-checked': String(!!state.clipCapture), 'aria-label': 'Capture what you copy',
    onclick: safe(async () => {
      state.clipCapture = !state.clipCapture;
      await chrome.storage.local.set({ settings: { clipCapture: state.clipCapture } });
      drawSettings();
    })
  });

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

  const signOut = el('button', {
    class: 'act', onclick: safe(async function out() {
      // Signing out clears the cache and the outbox, so unsynced changes are lost.
      const pending = await outbox.count();
      if (pending && !this.dataset.armed) {
        this.dataset.armed = '1';
        this.textContent = `${plural(pending, 'change')} unsynced — sign out anyway?`;
        clearTimeout(out._t); out._t = setTimeout(() => drawSettings(), 5000);
        return;
      }
      await vaultCrypto.lock();
      await cache.clear();
      await sb.auth.signOut();
      location.reload();
    })
  }, 'Sign out');

  pane.replaceChildren(
    el('header', { class: 'sc-head' }, backButton(), el('h2', {}, 'Settings')),
    el('div', { class: 'sc-body' },
      el('div', { class: 'sc-sec' }, 'Account'),
      row(state.email || 'Signed in', 'Synced across your Chrome profiles and your phone', signOut),

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
      el('p', { class: 'sc-sec', style: 'font-weight:400;text-transform:none' },
        'Copied text is stored unencrypted in your account, including anything a site’s own copy button puts on the clipboard. Avoid approving password managers or banking sites.'),

      el('div', { class: 'sc-sec' }, 'Vault'),
      row(state.vaultState === 'open' ? 'Unlocked' : state.vaultState === 'setup' ? 'Not set up yet' : 'Locked',
        'The master password cannot be recovered.',
        el('button', {
          class: 'act',
          onclick: safe(async () => {
            if (state.vaultState === 'open') { await lockVault(); drawSettings(); }
            else { setScreen(null); setFilter('vault'); drawVaultGate(); }
          })
        }, state.vaultState === 'open' ? 'Lock now' : state.vaultState === 'setup' ? 'Set up' : 'Unlock')),
      row('Autofill',
        'In the vault, an item saved for the site you are on has a Fill button. Filling asks for access to that site the first time, and never captures your clipboard there.',
        null),

      el('div', { class: 'sc-sec' }, `Tags · ${tags.length}`),
      ...(tags.length
        ? tags.map((t) => tagSettingRow(t, counts[t]))
        : [el('div', { class: 'sc-row' }, el('span', { class: 'lab' }, el('span', {}, 'No tags yet. Add one from any item.')))]),

      el('div', { class: 'sc-sec' }, 'Keyboard'),
      row('Open DeskSync', null, el('span', { class: 'val' }, 'Alt+Shift+D')),
      row('Save this tab', null, el('span', { class: 'val' }, 'Alt+Shift+S')),
      row('Change these', 'chrome://extensions/shortcuts', el('button', {
        class: 'act', onclick: () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })
      }, 'Open')),

      el('div', { class: 'sc-sec' }, 'Data'),
      row('Trash', 'Deleted items wait 30 days.',
        el('button', { class: 'act', onclick: () => setScreen('trash') }, plural(state.trash.length, 'item')))
    )
  );
}

// Rename and delete act on every item carrying the tag, which is why they are here
// and not on a single item's chip.
function tagSettingRow(t, count) {
  const row = el('div', { class: 'tg-row' });

  const name = el('span', { class: 'name', title: 'Rename' }, t);
  name.addEventListener('click', () => {
    const input = el('input', { class: 'rn', value: t, 'aria-label': 'Rename tag ' + t });
    name.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const commit = safe(async () => {
      if (done) return; done = true;
      const v = normalizeTag(input.value);
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
  $('#q').value = $('#q').value.replace(new RegExp('#' + from + '\\b', 'i'), '#' + to);
  toast(`Renamed #${from} to #${to}`);
}
async function deleteTag(t) {
  await eachTagged(t, (tags) => tags.filter((x) => x !== t));
  delete state.tagColors[t];
  await chrome.storage.local.set({ tagColors: state.tagColors });
  $('#q').value = $('#q').value.replace(new RegExp('#' + t + '\\b', 'i'), '').replace(/\s+/g, ' ').trim();
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

async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  state.clipCapture = settings?.clipCapture ?? false;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onPage = /^https?:/.test(tab?.url || '');
  state.tabId = onPage ? tab.id : null;
  state.tabHost = onPage ? hostOf(tab.url) : null;
  state.tabOrigin = onPage ? originFor(new URL(tab.url).hostname) : null;
  state.captureOrigins = await captureOrigins();
  loadTrash();
}

// ---------- Keyboard ----------
// Focus never leaves the search field: the highlighted row is tracked with
// aria-activedescendant, so typing keeps working while you move through results.
const qEl = $('#q');
qEl.addEventListener('input', () => { state.active = 0; draw(); });
qEl.addEventListener('keydown', (e) => {
  const n = state.rows.length;
  if (e.key === 'ArrowDown' && n) { e.preventDefault(); setActive((state.active + 1) % n, true); }
  else if (e.key === 'ArrowUp' && n) { e.preventDefault(); setActive((state.active - 1 + n) % n, true); }
  else if (e.key === 'Enter') { e.preventDefault(); openActive(e); }
  else if (e.key === 'Escape') {
    if (state.screen) setScreen(null);
    else if (qEl.value) { qEl.value = ''; state.active = 0; draw(); }
    else window.close();
  } else if ((e.metaKey || e.ctrlKey) && /^[1-5]$/.test(e.key)) {
    e.preventDefault();
    setFilter(['all', ...TYPE_KEYS][+e.key - 1]);
  }
});

function openActive(e) {
  const item = state.rows[state.active];
  if (!item) return;
  if (item.kind === 'action') return runRow(item);
  if (item.kind === 'note') return openEditor(item);
  if (item.kind === 'link') return safe(() => openLink(item))();
  if (item.kind === 'clip') return safe(() => copy(item.row.content))();
  if (item.kind === 'vault') {
    if (state.vaultState !== 'open') return drawVaultGate();
    // Ctrl+Enter copies the password; plain Enter fills, when the page matches.
    if (e.metaKey || e.ctrlKey) return safe(() => copy(item.row.password || '', 'Password copied'))();
    return hostMatches(item.row.url, state.tabHost) ? fillItem(item.row) : copy(item.row.password || '', 'Password copied');
  }
}


// ---------- Writing rows when the database is behind the code ----------
// PostgREST answers "Could not find the 'format' column of 'notes' in the schema
// cache" when supabase/migrations/001_tags_and_markdown.sql has not been run.
// The old behaviour was to throw, which meant the note you had just typed was
// thrown away along with the request. Dropping the column the server does not
// know about and saving the rest keeps the writing; the warning says what to run.
const MISSING_COLUMN = /Could not find the '([^']+)' column/i;
const warnedColumns = new Set();

async function writeRow(table, id, row) {
  const payload = { ...row };
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return id ? await db.update(table, id, payload) : await db.insert(table, payload);
    } catch (e) {
      const column = MISSING_COLUMN.exec(e?.message || '')?.[1];
      if (!column || !(column in payload)) throw e;
      delete payload[column];
      if (!warnedColumns.has(column)) {
        warnedColumns.add(column);
        toast(`Saved, but your database has no '${column}' column yet — run supabase/migrations/001_tags_and_markdown.sql`);
      }
    }
  }
  throw new Error('Could not save this row');
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
// Three states, because "follow the OS" is the right default but not everyone
// wants it: system -> light -> dark -> system. The icon shows the state you are
// in, not the one you would move to, so the button reads as a status as well as
// a control. Stored per device, like the tag colours.
const THEMES = [
  { key: 'system', icon: 'monitor', label: 'Theme: following your system' },
  { key: 'light',  icon: 'sun',     label: 'Theme: light' },
  { key: 'dark',   icon: 'moon',    label: 'Theme: dark' }
];

function applyTheme(key) {
  const t = THEMES.find((x) => x.key === key) || THEMES[0];
  // No attribute at all means the prefers-color-scheme rule is left in charge.
  if (t.key === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t.key;

  state.theme = t.key;
  const btn = $('#theme');
  btn.querySelector('use').setAttribute('href', '#i-' + t.icon);
  const next = THEMES[(THEMES.indexOf(t) + 1) % THEMES.length];
  btn.title = `${t.label} — click for ${next.key === 'system' ? 'system' : next.key}`;
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

boot();
