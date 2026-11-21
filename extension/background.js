// Service worker: read-later saving (context menu + shortcut), clipboard capture, vault auto-lock.
importScripts('lib/supabase.js', 'config.js', 'lib/store.js', 'lib/client.js', 'lib/crypto.js', 'lib/detect.js', 'lib/sites.js', 'lib/fill.js');

// skipSecrets: a key or token copied on an approved site is not recorded. On by
// default, because clipboard history is stored as plain text.
// unreadBadge: the icon shows how many Read later links are still unread.
const DEFAULT_SETTINGS = { clipCapture: false, skipSecrets: true, unreadBadge: true, emailInGmail: false, clearClipboard: true };

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

chrome.runtime.onInstalled.addListener(({ reason }) => {
  // When DeskSync was first installed: the review prompt waits a week after it.
  if (reason === 'install') chrome.storage.local.set({ installedAt: Date.now() });
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
      // Free keeps a set number of notes (PLANS in lib/client.js): at it, the
      // badge says no rather than the note going missing.
      const max = (await plan.limits()).notes;
      if ((await db.list('notes')).length >= max) return badge('×', '#dc2626');
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

// ---------- Alt+Shift+L: fill a saved login on this page ----------
// Works without opening DeskSync. The shortcut grants activeTab for the page
// in front, so no access to every site is needed. One saved login for the
// site fills at once; several show a chooser on the page with names and
// usernames only. A locked vault opens DeskSync to unlock it.
async function vaultLogins() {
  const key = await vaultCrypto.loadSessionKey();
  if (!key) return null;
  const out = [];
  for (const r of await db.list('vault_items')) {
    try { out.push({ ...JSON.parse(await vaultCrypto.decrypt(key, r.iv, r.ciphertext)), id: r.id }); }
    catch { /* an item from another vault: skipped */ }
  }
  return out;
}

const inject = (tabId, func, args = []) => chrome.scripting.executeScript({ target: { tabId }, func, args })
  .then(([r]) => r?.result);

async function fillLogin(tabId, login) {
  const r = await inject(tabId, fillForm, [login.username || '', login.password || '']);
  if (r?.usernameOnly) { badge('1/2'); return inject(tabId, pageNotice, ['Username filled. Continue, then press Alt+Shift+L again for the password.']); }
  if (!r?.foundPassword) return inject(tabId, pageNotice, ['No sign-in form found on this page.']);
  badge('✓');
}

async function fillOnPage(tab) {
  if (!tab?.id || !/^https?:/.test(tab.url || '')) return badge('×', '#dc2626');
  const host = sites.hostOf(tab.url);
  try {
    const logins = await vaultLogins();
    if (!logins) {
      await inject(tab.id, pageNotice, ['DeskSync: unlock the vault, then press Alt+Shift+L again.']);
      return openWith('vault');
    }
    const here = logins.filter((l) => sites.matches(l.url, host));
    if (!here.length) return inject(tab.id, pageNotice, [`DeskSync has no saved login for ${host}.`]);
    if (here.length === 1) return fillLogin(tab.id, here[0]);
    // Several: the page is shown names and usernames, never passwords, with a
    // one-time token. The choice comes back as a message, checked below.
    const token = crypto.randomUUID();
    await chrome.storage.session.set({ fillChoice: { tabId: tab.id, host, ids: here.map((l) => l.id), token, at: Date.now() } });
    // By name, so the same site always lists its accounts in the same order.
    const offered = here.map((l) => ({ id: l.id, title: l.title || host, username: l.username || '' }))
      .sort((a, b) => a.title.localeCompare(b.title) || a.username.localeCompare(b.username));
    await inject(tab.id, pageChooser, [offered, token]);
  } catch (e) {
    console.warn('[DeskSync] fill', e);
    badge('×', '#dc2626');
  }
}

// The account picked in the chooser. Taken only from the tab it was offered
// in, with the token it was offered with, within a minute, for one of the ids
// offered, and only once.
async function fillChoice(msg, sender) {
  const { fillChoice: c } = await chrome.storage.session.get('fillChoice');
  if (!c || !sender.tab || sender.tab.id !== c.tabId || msg.token !== c.token || !c.ids.includes(msg.id)) return;
  if (Date.now() - c.at > 60000 || sites.hostOf(sender.tab.url || '') !== c.host) return;
  await chrome.storage.session.remove('fillChoice');
  const login = (await vaultLogins())?.find((l) => l.id === msg.id);
  if (login) await fillLogin(sender.tab.id, login);
}

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd === 'fill-login') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return fillOnPage(tab);
  }
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
  // From the chooser on a page: checked against what was offered, in fillChoice.
  if (msg?.type === 'fill-choice' && sender.id === chrome.runtime.id && sender.tab) { fillChoice(msg, sender); return false; }
  // A popup on its way out, asking for the note it was typing to be written.
  // It will not be there to hear the answer, which is why the draft is in
  // storage rather than in this message.
  // From the extension's own pages only (popup, side panel, or DeskSync open
  // in a tab). Our content script shares the extension's id, so the id alone
  // does not tell them apart; the page's address does: only the extension's
  // own pages live at chrome-extension://<id>/.
  const fromPage = sender.id === chrome.runtime.id && (sender.url || '').startsWith(chrome.runtime.getURL(''));
  if (msg?.type === 'flush-draft') {
    if (!fromPage) return false;
    flushDraft().then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  // A password or code was copied: clear it from the clipboard in 30 s.
  if (msg?.type === 'clear-clipboard-later') {
    if (!fromPage || typeof msg.hash !== 'string') return false;
    chrome.storage.session.set({ clipClear: { hash: msg.hash } })
      .then(() => chrome.alarms.create('clip-clear', { when: Date.now() + 30000 }))
      .then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
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
// Free keeps the newest 200 captured clips; Pro keeps them all (lib/client.js,
// PLANS). Only captured clips count: those carry the site they came from.
// Clips you saved yourself (no site) and pinned ones are never removed.
async function trimClips() {
  const limit = (await plan.limits()).clips;
  if (!Number.isFinite(limit)) return;
  const clips = await db.list('clips', { order: 'created_at' });
  const extra = clips.filter((c) => !c.pinned && c.source_url).slice(limit);
  for (const c of extra) await db.remove('clips', c.id, { content: '', source_url: null });
}

// The trash keeps a deleted item for 30 days on Free, a year on Pro, then
// deletes it for good. Checked a few times a day; cheap when there is nothing.
const TRASH_TABLES = ['notes', 'read_later', 'clips', 'vault_items'];
async function sweepTrash() {
  const cutoff = Date.now() - (await plan.limits()).trashDays * 86400000;
  for (const t of TRASH_TABLES) {
    for (const r of await db.listDeleted(t)) {
      if (new Date(r.deleted_at).getTime() < cutoff) await db.purge(t, r.id);
    }
  }
}

// ---------- Clearing a copied password ----------
// The service worker has no clipboard of its own, so an offscreen document
// does the reading and clearing. It only clears when the clipboard still holds
// what was copied (compared by hash): anything copied since is left alone.
async function clearClipboardIfUnchanged() {
  const { clipClear } = await chrome.storage.session.get('clipClear');
  if (!clipClear?.hash) return { cleared: false };
  await chrome.storage.session.remove('clipClear');
  try {
    if (!(await chrome.offscreen.hasDocument?.())) {
      await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['CLIPBOARD'],
        justification: 'Clear a copied password or backup code from the clipboard' });
    }
    return await chrome.runtime.sendMessage({ target: 'offscreen', type: 'clear-if-same', hash: clipClear.hash });
  } catch (e) {
    console.warn('[DeskSync] could not clear the clipboard', e);
    return { cleared: false };
  } finally {
    chrome.offscreen.closeDocument().catch(() => {});
  }
}

// A worker started for any reason (not only install or browser start) makes
// sure its alarms exist and the badge is right.
chrome.alarms.get('vault-autolock').then((a) => { if (!a) chrome.alarms.create('vault-autolock', { periodInMinutes: 1 }); });
chrome.alarms.get('outbox-flush').then((a) => { if (!a) chrome.alarms.create('outbox-flush', { periodInMinutes: 1 }); });
chrome.alarms.get('trash-sweep').then((a) => { if (!a) chrome.alarms.create('trash-sweep', { delayInMinutes: 1, periodInMinutes: 360 }); });
updateBadge();

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === 'badge-reset') { badge._flash = false; return updateBadge(); }
  if (a.name === 'trash-sweep') return sweepTrash().catch((e) => console.error('[DeskSync] trash sweep', e));
  if (a.name === 'clip-clear') return clearClipboardIfUnchanged();
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

