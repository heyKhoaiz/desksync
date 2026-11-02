// Service worker: read-later saving (context menu + shortcut), clipboard capture, vault auto-lock.
importScripts('lib/supabase.js', 'config.js', 'lib/client.js', 'lib/crypto.js');

const DEFAULT_SETTINGS = { clipCapture: true, clipIgnoreSites: [] };

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
  let host = '';
  try { host = new URL(msg.url).hostname; } catch {}
  if (s.clipIgnoreSites.some((h) => host === h || host.endsWith('.' + h))) return;
  if (!(await currentUser())) return;
  lastClip = content;
  try { await db.insert('clips', { content, source_url: msg.url || null }); }
  catch (e) { console.error('[DeskSync] clip', e); }
}

// ---------- Vault auto-lock ----------
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'vault-autolock') return;
  const { vaultLockAt } = await chrome.storage.session.get('vaultLockAt');
  if (vaultLockAt && Date.now() > vaultLockAt) await vaultCrypto.lock();
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
