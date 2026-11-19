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
  notes: [], later: [], clips: [], vault: [], trash: [],
  vaultKey: null, vaultState: 'locked',     // 'setup' | 'locked' | 'open'
  items: [], rows: [], active: 0,
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
  if (!user) { $('#auth-email').focus(); return; }
  state.email = user.email;
  // Drops a previous account's cached rows and queued writes before showing anything.
  await cache.claim(user.id);
  const { tagColors } = await chrome.storage.local.get('tagColors');
  state.tagColors = tagColors || {};
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
    await db.update(TYPES[item.kind].table, item.id, { tags });
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
function actions() {
  const list = [
    { action: 'tab',   title: 'Save this tab to Read later', sub: state.tabHost || 'No page to save',
      kbd: 'Alt+Shift+S', disabled: !state.tabHost },
    { action: 'clip',  title: 'Save what is on the clipboard', sub: 'Adds the clipboard as a clip' },
    { action: 'note',  title: 'New note', sub: 'Start an empty note' }
  ];
  if (state.vaultState !== 'open') {
    list.unshift({ action: 'vault', title: state.vaultState === 'setup' ? 'Set up your vault' : 'Unlock the vault',
      sub: 'Saved logins are hidden until you do' });
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
  const showActions = !raw && state.filter === 'all';
  state.rows = showActions ? [...actions(), ...found] : found;

  const list = $('#list');
  list.replaceChildren();

  if (!state.rows.length) {
    list.append(emptyRow(text, tags));
    if (!state.editing) drawDetail(null);
    return;
  }

  let last = null;
  state.rows.forEach((item, idx) => {
    const group = item.kind === 'action' ? 'Add'
      : text ? TYPES[item.kind].label
      : state.filter === 'all' ? 'Recent'
      : TYPES[item.kind].label;
    if (group !== last) { list.append(el('li', { class: 'g-head' }, group)); last = group; }
    list.append(rowFor(item, idx, text));
  });

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
    return el('li', {
      class: 'row act', id: 'r' + idx, role: 'option', 'aria-selected': 'false', 'data-i': idx,
      onmousemove: () => hoverRow(idx), onclick: () => clickRow(idx)
    },
      el('span', { class: 'bul' }),
      el('span', { class: 'body' },
        el('span', { class: 't' }, item.title),
        el('span', { class: 'm' }, item.sub)),
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
    item.row?.source === 'android' ? el('span', { class: 'mark-i', title: 'Saved from your phone' }, icon('phone')) : null);
}

function hoverRow(i) { if (!state.editing && i !== state.active) setActive(i, false); }
function clickRow(i) {
  if (state.editing) closeEditor();
  setActive(i, false);
  $('#q').focus();
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
      }, '×')));
  }

  const add = el('button', { class: 'add' }, '+ Tag');
  add.addEventListener('click', () => {
    const input = el('input', { list: 'tag-list', placeholder: 'tag name', 'aria-label': 'New tag' });
    add.replaceWith(input);
    input.focus();
    let done = false;
    const commit = safe(async () => {
      if (done) return; done = true;
      const v = normalizeTag(input.value);
      if (v && !item.tags.includes(v)) await saveTags(item, [...item.tags, v]);
      refreshAfterTags(item);
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); done = true; refreshAfterTags(item); }
    });
    input.addEventListener('blur', commit);
  });
  box.append(add);

  // Suggests names already in use, so the list doesn't grow a "work", "Work" and "wrk".
  box.append(el('datalist', { id: 'tag-list' }, ...allTags().map((t) => el('option', { value: t }))));
  return box;
}

// After a tag change the row in the list is stale too, so redraw both panes.
function refreshAfterTags(item) {
  draw();
  if (state.editing) { drawEditor(state.editorMode); focusEditor(); }
  else drawDetail(item);
}

// ---------- Note editor ----------
// A popup closes the moment you click anywhere else in the browser, so there is no
// Save button: it writes as you type, debounced.
const TOOLS = [
  { k: 'b', cls: 'b', txt: 'B', label: 'Bold', wrap: ['**', '**'] },
  { k: 'i', cls: 'i-t', txt: 'I', label: 'Italic', wrap: ['*', '*'] },
  { k: 's', cls: 's', txt: 'S', label: 'Strikethrough', wrap: ['~~', '~~'] },
  { sep: true },
  { k: 'h', cls: '', txt: 'H', label: 'Heading', line: '## ' },
  { k: 'ul', cls: '', txt: '•', label: 'Bullet list', line: '- ' },
  { k: 'task', cls: '', txt: '☐', label: 'Task list', line: '- [ ] ' },
  { k: 'quote', cls: '', txt: '“', label: 'Quote', line: '> ' },
  { sep: true },
  { k: 'code', cls: 'mono', txt: '{}', label: 'Code', wrap: ['`', '`'] },
  { k: 'link', cls: 'mono', txt: '[]', label: 'Link', wrap: ['[', '](https://)'] }
];

function newNote() {
  const row = { id: null, title: '', body: '', format: 'markdown', tags: [], color: 'yellow', pinned: false };
  openEditor({ kind: 'note', id: null, row, title: '', sub: '', tags: [], when: null, isNew: true });
}

function openEditor(item) {
  state.editing = item;
  // Converted once, on open: a legacy HTML note becomes markdown and is saved that way.
  state.draft = { title: item.row.title || '', body: md.toMarkdown(item.row), tags: [...item.tags] };
  state.editorMode = 'write';
  drawEditor('write');
  focusEditor();
}

function focusEditor() {
  const a = $('.ed-area');
  if (a) { a.focus(); a.setSelectionRange(a.value.length, a.value.length); }
}

const closeEditor = safe(async () => {
  const item = state.editing;
  state.editing = null;
  if (!item) return;
  await flushDraft(true);
  draw();
  $('#q').focus();
});

function drawEditor(mode) {
  state.editorMode = mode;
  const item = state.editing;
  const pane = $('#detail');
  pane.replaceChildren();

  const title = el('input', {
    class: 't-in', id: 'ed-title', value: state.draft.title,
    placeholder: 'Untitled note', 'aria-label': 'Note title'
  });
  title.addEventListener('input', () => { state.draft.title = title.value; queueSave(); });
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); focusEditor(); }
    if (e.key === 'Escape') { e.preventDefault(); closeEditor(); }
  });

  const bar = el('div', { class: 'ed-bar' },
    ...TOOLS.map((t) => t.sep
      ? el('span', { class: 'sep' })
      : el('button', {
          class: t.cls, title: t.label, 'aria-label': t.label,
          onmousedown: (e) => { e.preventDefault(); applyTool(t.k); }
        }, t.txt)),
    el('span', { class: 'right' },
      el('button', { class: 'tab', 'aria-pressed': String(mode === 'write'), onclick: () => drawEditor('write') }, 'Write'),
      el('button', { class: 'tab', 'aria-pressed': String(mode === 'preview'), onclick: () => drawEditor('preview') }, 'Preview')));

  let body;
  if (mode === 'write') {
    body = el('textarea', {
      class: 'ed-area', id: 'ed-area', spellcheck: 'true',
      placeholder: 'Write in markdown…', 'aria-label': 'Note body'
    });
    body.value = state.draft.body;
    body.addEventListener('input', () => { state.draft.body = body.value; queueSave(); });
    body.addEventListener('keydown', editorKeys);
  } else {
    body = el('div', { class: 'ed-prev md', html: md.render(state.draft.body) || '<p class="muted">Nothing to preview.</p>' });
  }

  pane.append(
    el('header', { class: 'd-band' },
      el('div', { class: 'd-kind' }, el('span', { class: 'bul', style: 'background:var(--note)' }), 'Note · editing'),
      title,
      el('p', { class: 'd-sub' }, 'Markdown' + (item.when ? ' · ' + ago(item.when) : ''))),
    tagRow({ ...item, tags: state.draft.tags, row: item.row, kind: 'note' }),
    el('div', { class: 'ed' }, bar, body),
    el('footer', { class: 'ed-foot' },
      el('button', { class: 'primary', onclick: closeEditor }, 'Done'),
      el('span', { class: 'saved', id: 'ed-saved' }, 'Saved'),
      el('span', { class: 'spacer' }),
      el('span', { class: 'hint' }, '⌘↵ done · esc back'))
  );

  // Esc and Cmd+Enter work anywhere in the pane, including on the Preview tab.
  pane.onkeydown = (e) => {
    if (!state.editing) return;
    if (e.target.tagName === 'INPUT' && e.target.hasAttribute('list')) return;   // typing a tag
    if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) {
      e.preventDefault(); e.stopPropagation(); closeEditor();
    }
  };
}

function queueSave() {
  const el2 = $('#ed-saved');
  if (el2) el2.textContent = 'Saving…';
  clearTimeout(queueSave._t);
  queueSave._t = setTimeout(() => flushDraft(false), 700);
}

const flushDraft = safe(async (final) => {
  clearTimeout(queueSave._t);
  const item = state.editing || flushDraft._last;
  if (!item || !state.draft) return;
  flushDraft._last = item;

  const { title, body, tags } = state.draft;

  // A note you opened and never typed into is thrown away rather than left as a blank row.
  if (item.isNew && !title.trim() && !body.trim()) { if (final) state.draft = null; return; }

  const row = { title: title.trim(), body, format: 'markdown', tags };
  if (item.id) {
    await db.update('notes', item.id, row);
  } else {
    const created = await db.insert('notes', row);
    item.id = created?.id ?? item.id;
    item.isNew = false;
  }
  const saved = $('#ed-saved');
  if (saved) saved.textContent = 'Saved';
  if (final) state.draft = null;
  loadNotes();
});

function applyTool(k) {
  const t = TOOLS.find((x) => x.k === k);
  const a = $('#ed-area');
  if (!t) return;
  if (!a) { drawEditor('write'); return; }                   // pressed while on Preview

  const s0 = a.selectionStart, e0 = a.selectionEnd, v = a.value;
  if (t.wrap) {
    const [L, R] = t.wrap;
    const sel = v.slice(s0, e0);
    a.value = v.slice(0, s0) + L + sel + R + v.slice(e0);
    const caret = sel ? s0 + L.length + sel.length + R.length : s0 + L.length;
    a.setSelectionRange(caret, caret);
  } else {
    // Toggles the prefix on every line the selection touches.
    const ls = v.lastIndexOf('\n', s0 - 1) + 1;
    let le = v.indexOf('\n', e0); if (le < 0) le = v.length;
    const body = v.slice(ls, le).split('\n')
      .map((ln) => (ln.startsWith(t.line) ? ln.slice(t.line.length) : t.line + ln)).join('\n');
    a.value = v.slice(0, ls) + body + v.slice(le);
    a.setSelectionRange(ls + body.length, ls + body.length);
  }
  a.focus();
  state.draft.body = a.value;
  queueSave();
}

function editorKeys(e) {
  const a = e.target;
  if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) return;   // handled on the pane
  if ((e.metaKey || e.ctrlKey) && 'bik'.includes(e.key.toLowerCase())) {
    e.preventDefault();
    applyTool({ b: 'b', i: 'i', k: 'link' }[e.key.toLowerCase()]);
    return;
  }
  // Enter in a list carries the marker down; Enter on an empty marker ends the list.
  if (e.key === 'Enter' && !e.shiftKey) {
    const v = a.value, s0 = a.selectionStart;
    const ls = v.lastIndexOf('\n', s0 - 1) + 1;
    const m = v.slice(ls, s0).match(/^(\s*)(- \[[ xX]\] |[-*] |\d+[.)] )(.*)$/);
    if (!m) return;
    e.preventDefault();
    if (!m[3].trim()) {
      a.value = v.slice(0, ls) + v.slice(s0);
      a.setSelectionRange(ls, ls);
    } else {
      let marker = m[2].replace(/\[[xX]\]/, '[ ]');
      const num = marker.match(/^(\d+)([.)] )$/);
      if (num) marker = (+num[1] + 1) + num[2];
      const ins = '\n' + m[1] + marker;
      a.value = v.slice(0, s0) + ins + v.slice(a.selectionEnd);
      a.setSelectionRange(s0 + ins.length, s0 + ins.length);
    }
    state.draft.body = a.value;
    queueSave();
  }
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
  if (item.kind === 'action') return item.action === 'vault' ? drawVaultGate() : runAction(item.action);
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
