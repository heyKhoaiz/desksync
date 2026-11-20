// Clears the clipboard for the service worker, but only if it still holds
// what DeskSync copied: the worker sends a hash of that, and if you have
// copied something else since, it is left alone.
//
// An offscreen document is not focused, so navigator.clipboard is refused
// here; the paste and copy commands on a text box work instead, which is what
// Chrome's own offscreen clipboard example does.

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readClipboard() {
  const pad = document.getElementById('pad');
  pad.value = '';
  pad.focus();
  document.execCommand('paste');
  return pad.value;
}

function emptyClipboard() {
  const fill = (e) => { e.clipboardData.setData('text/plain', ''); e.preventDefault(); };
  document.addEventListener('copy', fill, { once: true });
  const pad = document.getElementById('pad');
  pad.value = ' ';
  pad.select();
  const ok = document.execCommand('copy');
  document.removeEventListener('copy', fill);
  return ok;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== 'offscreen' || sender.id !== chrome.runtime.id) return false;
  if (msg.type === 'clear-if-same') {
    (async () => {
      const now = readClipboard();
      if (!now || (await sha256(now)) !== msg.hash) return sendResponse({ cleared: false });
      sendResponse({ cleared: emptyClipboard() });
    })().catch((e) => sendResponse({ cleared: false, error: String(e) }));
    return true;
  }
  return false;
});
