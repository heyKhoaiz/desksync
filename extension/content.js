// Captures text the user copies or cuts on approved sites and hands it to the background.
// Registered only for sites the user allowed in Settings. Never captures from password fields.
(() => {
  if (window.__desksyncCapture) return;
  window.__desksyncCapture = true;

  function selectedText() {
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      if (el.type === 'password' || el.autocomplete === 'current-password' || el.autocomplete === 'new-password') return '';
      try { return el.value.substring(el.selectionStart, el.selectionEnd); } catch { return ''; }
    }
    return String(window.getSelection() || '');
  }

  function onCopy() {
    const text = selectedText().trim();
    if (!text) return;
    chrome.runtime.sendMessage({ type: 'clip', content: text }).catch(() => {});
  }

  document.addEventListener('copy', onCopy, true);
  document.addEventListener('cut', onCopy, true);
})();
