// Service worker: read-later saving (context menu + shortcut), clipboard capture, vault auto-lock.
importScripts('lib/supabase.js', 'config.js', 'lib/store.js', 'lib/client.js', 'lib/crypto.js', 'lib/detect.js');

// skipSecrets: a key or token copied on an approved site is not recorded. On by
// default, because clipboard history is stored as plain text.
// unreadBadge: the icon shows how many Read later links are still unread.
const DEFAULT_SETTINGS = { clipCapture: false, skipSecrets: true, unreadBadge: true, startOnToday: false, emailInGmail: false };

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

// Sites approved for clipboard capture. This is deliberately NOT "every origin the
// extension was granted": autofill also asks for host access, and filling a password
// on a site must never quietly start recording what you copy there.
async function captureOrigins() {
  const { captureOrigins } = await chrome.storage.local.get('captureOrigins');
  if (captureOrigins) return captureOrigins;
  // Upgrade from the version where granted origins were the capture list. On a
  // fresh install there are none, so this seeds an empty list.
  const { origins = [] } = await chrome.permissions.getAll();
  await chrome.storage.local.set({ captureOrigins: origins });
  return origins;
}

// A short-lived mark for something that just happened (saved, failed), after
// which the icon goes back to showing the unread count.
function badge(text, color = '#16a34a') {
  clearTimeout(badge._t);
  badge._flash = true;
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  badge._t = setTimeout(() => { badge._flash = false; updateBadge(); }, 2000);
  // The service worker can be stopped inside those 2 seconds, taking the timer
  // with it, and the ✓ stayed on the icon. An alarm survives that.
  chrome.alarms.create('badge-reset', { when: Date.now() + 2500 });
}

// The number of unread Read later links, on the icon. A reason to come back
// that costs nothing to look at, and it can be turned off in Settings.
async function updateBadge() {
  if (badge._flash) return;
  try {
    const { unreadBadge } = await getSettings();
    const unread = unreadBadge ? (await db.list('read_later')).filter((r) => !r.is_read).length : 0;
    chrome.action.setBadgeBackgroundColor({ color: '#3d7bfa' });
    chrome.action.setBadgeText({ text: unread ? (unread > 99 ? '99+' : String(unread)) : '' });
  } catch (e) { console.warn('[DeskSync] badge', e); }
}

// ---------- Read later ----------
async function saveTab(tab) {
  if (!tab?.url || !/^https?:/.test(tab.url)) { badge('×', '#dc2626'); return; }
  try {
    const row = await db.insert('read_later', {
      url: tab.url,
      title: tab.title || tab.url,
      favicon: tab.favIconUrl || null,
      source: 'extension'
    });
    // Saved on this device; sync takes it to the server when it can.
    if (row) badge('✓'); else badge('×', '#dc2626');
  } catch (e) {
    console.error('[DeskSync] saveTab', e);
    badge('×', '#dc2626');
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'save-page', title: 'Save page to Read Later', contexts: ['page'] });
  chrome.contextMenus.create({ id: 'save-link', title: 'Save link to Read Later', contexts: ['link'] });
  chrome.contextMenus.create({ id: 'save-note', title: 'Save selection as a note', contexts: ['selection'] });
  chrome.alarms.create('vault-autolock', { periodInMinutes: 1 });
  chrome.alarms.create('outbox-flush', { periodInMinutes: 1 });
  syncCaptureScripts();
  updateBadge();
});

// Alarms survive a service-worker restart but not a reinstall of the browser profile.
chrome.runtime.onStartup.addListener(() => {
  // Both alarms, not only the sync one: Chrome may clear alarms on restart,
  // and without vault-autolock an unlocked vault's key stayed in memory past
  // its lock time until the next popup checked it.
  chrome.alarms.create('outbox-flush', { periodInMinutes: 1 });
  chrome.alarms.create('vault-autolock', { periodInMinutes: 1 });
  store.migrate().then(() => sync.run()).catch(console.error);
  updateBadge();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'save-page') return saveTab(tab);
  if (info.menuItemId === 'save-link') return saveTab({ url: info.linkUrl, title: info.linkUrl });
  if (info.menuItemId === 'save-note') {
    try {
      // Notes are plain text: the selection is stored as it is, not escaped.
      await db.insert('notes', { title: tab?.title || 'Clipped', body: withSource(info.selectionText, info.pageUrl || tab?.url), format: 'plain' });
      badge('✓');
    } catch (e) { console.error(e); badge('×', '#dc2626'); }
  }
});

// A quote without its source is half a quote: whoever saves a line to use later
// (a swipe file, a citation, a bug report) needs to know where it came from.
// The page goes at the foot of the note, as text, so it syncs and reads the same
// on the phone. The #fragment is dropped; the query string is kept, because on
// many sites it is the page.
function withSource(text, url) {
  const body = String(text || '').trim();
  if (!/^https?:/i.test(url || '')) return body;
  let clean = url;
  try { const u = new URL(url); u.hash = ''; clean = u.toString(); } catch { /* keep as is */ }
  return `${body}\n\nSource: ${clean}`;
}

// Shortcuts that need the popup: it can read the clipboard and hold an editor,
// which the service worker cannot. What to do is left in session storage for the
// popup to pick up as it opens. openPopup needs Chrome 127; before that, or with
// no browser window focused, the same page opens in a tab instead.
async function openWith(action) {
  await chrome.storage.session.set({ pendingAction: action });
  try {
    await chrome.action.openPopup();
  } catch {
    await chrome.storage.session.remove('pendingAction');
    chrome.tabs.create({ url: chrome.runtime.getURL(`popup.html?view=tab&do=${action}`) });
  }
}

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd === 'new-note') return openWith('note');
  if (cmd === 'save-clipboard') return openWith('clip');
  if (cmd !== 'save-tab') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  saveTab(tab);
});

// ---------- Clipboard capture ----------
let lastClip = '';
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'clip') { handleClip(msg, sender); return false; }
  // A popup on its way out, asking for the note it was typing to be written.
  // It will not be there to hear the answer, which is why the draft is in
  // storage rather than in this message.
  // From the extension's own pages only: our content script shares the
  // extension's id, so the id alone does not tell a page from a tab.
  const fromPage = sender.id === chrome.runtime.id && !sender.tab;
  if (msg?.type === 'flush-draft') {
    if (!fromPage) return false;
    flushDraft().then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  if (msg?.type === 'save-current-tab') {
    if (!fromPage) return false;
    chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => saveTab(t))
      .then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  return false;
});

async function handleClip(msg, sender) {
  // Only accept messages from our own content script running in a tab.
  if (sender.id !== chrome.runtime.id || !sender.tab) return;
  const s = await getSettings();
  if (!s.clipCapture) return;
  const content = String(msg.content || '').slice(0, DESKSYNC_CONFIG.CLIP_MAX_LENGTH);
  if (!content || content === lastClip) return;
  let url;
  try { url = new URL(sender.url); } catch { return; }
  // Tabs opened before a site was removed keep the script running, so re-check both
  // the host permission and the capture list here.
  if (!(await chrome.permissions.contains({ origins: [`${url.protocol}//${url.hostname}/*`] }))) return;
  if (!matchesAny(await captureOrigins(), url)) return;
  lastClip = content;
  // An API key copied from a dashboard is the most likely secret to end up in
  // clipboard history, and the history is not encrypted. Leave it out, and say so.
  if (s.skipSecrets && detect.isSecret(content)) { badge('key', '#ff8a3d'); return; }
  // Hostname only: full URLs can carry secrets such as reset tokens.
  try { await db.insert('clips', { content, source_url: url.hostname }); await trimClips(); }
  catch (e) { console.error('[DeskSync] clip', e); }
}

// Does a URL fall under one of our `*://*.host/*` match patterns?
function matchesAny(origins, url) {
  const host = url.hostname.replace(/^www\./, '');
  return origins.some((o) => {
    const pattern = o.replace(/^\*:\/\/(\*\.)?/, '').replace(/\/\*$/, '');
    return host === pattern || host.endsWith('.' + pattern);
  });
}

// The content script runs only on sites approved for capture, which have host
// permission too, and only while capture is on.
let captureSync = Promise.resolve();
function syncCaptureScripts() {
  captureSync = captureSync.then(async () => {
    const { clipCapture } = await getSettings();
    const { origins = [] } = await chrome.permissions.getAll();
    const approved = (await captureOrigins()).filter((o) => origins.includes(o));
    await chrome.scripting.unregisterContentScripts();
    if (!clipCapture || !approved.length) return;
    await chrome.scripting.registerContentScripts([
      { id: 'clip-capture', js: ['content.js'], matches: approved, runAt: 'document_idle', allFrames: false }
    ]);
    // Already-open tabs would otherwise need a reload; content.js ignores repeat injection.
    for (const tab of await chrome.tabs.query({ url: approved })) {
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => {});
    }
  }).catch((e) => console.error('[DeskSync] capture sync', e));
  return captureSync;
}
chrome.permissions.onAdded.addListener(syncCaptureScripts);
chrome.permissions.onRemoved.addListener(syncCaptureScripts);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings || changes.captureOrigins) syncCaptureScripts();
  if (changes[LOCAL_PREFIX + 'read_later'] || changes.settings) updateBadge();
});

// ---------- Address bar: "ds" then a search ----------
// Searching from the address bar, without opening anything first. Notes, links
// and clips only: vault titles are encrypted and the service worker never holds
// the key. A secret clip is never offered, since the suggestion shows its text.
const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
// Control characters are not allowed in a suggestion's XML, and one in any
// note made Chrome reject every suggestion for that keystroke.
const oneLine = (s, n = 70) => String(s || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  .replace(/\s+/g, ' ').trim().slice(0, n);

async function omniboxMatches(text) {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  const [notes, links, clips] = await Promise.all([db.list('notes'), db.list('read_later'), db.list('clips')]);
  const out = [];
  for (const n of notes) {
    const hay = `${n.title} ${n.body}`.toLowerCase();
    if (hay.includes(q)) out.push({ rank: (n.title || '').toLowerCase().includes(q) ? 2 : 1,
      content: `note:${n.id}`, description: `<dim>Note</dim> ${xml(oneLine(n.title || n.body))}` });
  }
  for (const r of links) {
    const hay = `${r.title} ${r.url} ${r.note || ''}`.toLowerCase();
    if (hay.includes(q)) out.push({ rank: (r.title || '').toLowerCase().includes(q) ? 2 : 1,
      content: r.url, description: `<dim>Read later</dim> ${xml(oneLine(r.title || r.url))} <url>${xml(oneLine(r.url, 60))}</url>` });
  }
  for (const c of clips) {
    if (detect.isSecret(c.content)) continue;
    if ((c.content || '').toLowerCase().includes(q)) out.push({ rank: 1,
      content: `clip:${c.id}`, description: `<dim>Clip</dim> ${xml(oneLine(c.content))}` });
  }
  return out.sort((a, b) => b.rank - a.rank).slice(0, 6).map(({ content, description }) => ({ content, description }));
}

chrome.omnibox.setDefaultSuggestion({ description: 'Search DeskSync for <match>%s</match>' });
chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  omniboxMatches(text).then(suggest).catch((e) => console.warn('[DeskSync] omnibox', e));
});
chrome.omnibox.onInputEntered.addListener((text, disposition) => {
  // A link opens where you asked. Anything else opens DeskSync on that item, or
  // on the search, in a tab: the popup cannot be opened from here.
  const url = /^https?:\/\//i.test(text) ? text
    : /^(note|clip):[\w-]+$/.test(text) ? chrome.runtime.getURL(`popup.html?view=tab&open=${encodeURIComponent(text)}`)
    : chrome.runtime.getURL(`popup.html?view=tab&q=${encodeURIComponent(text)}`);
  if (disposition === 'currentTab') chrome.tabs.update({ url });
  else chrome.tabs.create({ url, active: disposition !== 'newBackgroundTab' });
});

// ---------- Vault auto-lock, offline sync ----------
// Captured clips are kept to CLIP_HISTORY_LIMIT, newest first; pinned ones
// never count against it. Without this the history grew for ever, and every
// save and every address-bar search re-read all of it.
async function trimClips() {
  const limit = DESKSYNC_CONFIG.CLIP_HISTORY_LIMIT || 200;
  const clips = await db.list('clips', { order: 'created_at' });
  const extra = clips.filter((c) => !c.pinned).slice(limit);
  for (const c of extra) await db.remove('clips', c.id, { content: '', source_url: null });
}

// A worker started for any reason (not only install or browser start) makes
// sure its alarms exist and the badge is right.
chrome.alarms.get('vault-autolock').then((a) => { if (!a) chrome.alarms.create('vault-autolock', { periodInMinutes: 1 }); });
chrome.alarms.get('outbox-flush').then((a) => { if (!a) chrome.alarms.create('outbox-flush', { periodInMinutes: 1 }); });
updateBadge();

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === 'badge-reset') { badge._flash = false; return updateBadge(); }
  if (a.name === 'vault-autolock') {
    const { vaultLockAt } = await chrome.storage.session.get('vaultLockAt');
    if (vaultLockAt && Date.now() > vaultLockAt) await vaultCrypto.lock();
    return;
  }
  // Syncs, whether the popup is open or not (a no-op while signed out), and
  // writes a note whose popup closed before the save could run.
  if (a.name === 'outbox-flush') {
    if (navigator.onLine) await sync.run().catch(console.error);
    // Old enough that no open popup is still typing into it.
    await flushDraft({ minAgeMs: 5000 });
  }
});

async function flushDraft(opts) {
  try {
    await drafts.flush(opts);
  } catch (e) {
    // db.upsert only writes locally, so this fails only if storage itself does.
    console.error('[DeskSync] draft flush', e);
  }
}

