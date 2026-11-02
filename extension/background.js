// Service worker: read-later saving (context menu + shortcut), clipboard capture, vault auto-lock.
importScripts('lib/supabase.js', 'config.js', 'lib/client.js', 'lib/crypto.js');

const DEFAULT_SETTINGS = { clipCapture: false };

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

function badge(text, color = '#16a34a') {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2000);
}

// ---------- Read later ----------
async function saveTab(tab) {
  if (!tab?.url || !/^https?:/.test(tab.url)) { badge('×', '#dc2626'); return; }
  if (!(await currentUser())) { badge('!', '#dc2626'); return; }
  try {
    await db.insert('read_later', {
      url: tab.url,
      title: tab.title || tab.url,
      favicon: tab.favIconUrl || null,
      source: 'extension'
    });
    badge('✓');
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
  syncCaptureScripts();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'save-page') return saveTab(tab);
  if (info.menuItemId === 'save-link') return saveTab({ url: info.linkUrl, title: info.linkUrl });
  if (info.menuItemId === 'save-note') {
    if (!(await currentUser())) return badge('!', '#dc2626');
    try {
      await db.insert('notes', { title: tab?.title || 'Clipped', body: escapeHtml(info.selectionText) });
      badge('✓');
    } catch (e) { console.error(e); badge('×', '#dc2626'); }
  }
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'save-tab') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  saveTab(tab);
});

// ---------- Clipboard capture ----------
let lastClip = '';
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'clip') { handleClip(msg, sender); return false; }
  if (msg?.type === 'save-current-tab') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => saveTab(t)).then(() => sendResponse({ ok: true }));
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
  // Tabs opened before a site was removed keep the script running, so re-check here.
  if (!(await chrome.permissions.contains({ origins: [`${url.protocol}//${url.hostname}/*`] }))) return;
  if (!(await currentUser())) return;
  lastClip = content;
  // Hostname only: full URLs can carry secrets such as reset tokens.
  try { await db.insert('clips', { content, source_url: url.hostname }); }
  catch (e) { console.error('[DeskSync] clip', e); }
}

// The content script runs only on sites the user approved, and only while capture is on.
// Granted host permissions are the allowlist.
let captureSync = Promise.resolve();
function syncCaptureScripts() {
  captureSync = captureSync.then(async () => {
    const { clipCapture } = await getSettings();
    const { origins = [] } = await chrome.permissions.getAll();
    await chrome.scripting.unregisterContentScripts();
    if (!clipCapture || !origins.length) return;
    await chrome.scripting.registerContentScripts([
      { id: 'clip-capture', js: ['content.js'], matches: origins, runAt: 'document_idle', allFrames: false }
    ]);
    // Already-open tabs would otherwise need a reload; content.js ignores repeat injection.
    for (const tab of await chrome.tabs.query({ url: origins })) {
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => {});
    }
  }).catch((e) => console.error('[DeskSync] capture sync', e));
  return captureSync;
}
chrome.permissions.onAdded.addListener(syncCaptureScripts);
chrome.permissions.onRemoved.addListener(syncCaptureScripts);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) syncCaptureScripts();
});

// ---------- Vault auto-lock ----------
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'vault-autolock') return;
  const { vaultLockAt } = await chrome.storage.session.get('vaultLockAt');
  if (vaultLockAt && Date.now() > vaultLockAt) await vaultCrypto.lock();
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
