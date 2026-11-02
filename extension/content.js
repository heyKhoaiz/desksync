// Captures text the user copies or cuts on web pages and hands it to the background.
// Never captures from password fields, and does nothing unless clipboard capture is enabled.
(() => {
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
    chrome.runtime.sendMessage({ type: 'clip', content: text, url: location.href }).catch(() => {});
  }

  document.addEventListener('copy', onCopy, true);
  document.addEventListener('cut', onCopy, true);
})();
