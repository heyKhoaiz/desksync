// Notes are plain text.
//
// Nothing here formats anything: a note is stored exactly as it was typed and
// shown exactly as it was stored. This file exists only for the notes written
// before that was true — rows carrying format='html' (the old rich editor) or
// format='markdown' (the markdown editor that replaced it). Those are flattened
// to text on the way in, and the row is saved back as format='plain' the first
// time it is edited.

const txt = (() => {
  const escape = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Legacy HTML to text. Block elements become line breaks, everything else is
  // dropped; a checkbox from the old task lists becomes "[ ] " so the note still
  // reads as a list.
  function fromHtml(html) {
    const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
    const root = doc.body.firstChild;
    const BLOCK = /^(H[1-6]|UL|OL|PRE|BLOCKQUOTE|HR|P|DIV|LI|TR|SECTION|ARTICLE)$/;
    const lines = [];
    let line = '';

    const flush = () => { lines.push(line.replace(/[ \t]+$/, '')); line = ''; };

    const walk = (node) => {
      for (const n of node.childNodes) {
        if (n.nodeType === Node.TEXT_NODE) { line += n.nodeValue.replace(/\s+/g, ' '); continue; }
        if (n.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = n.tagName;
        if (tag === 'BR') { flush(); continue; }
        if (tag === 'SPAN' && (n.hasAttribute('data-ui') || n.classList.contains('box'))) {
          // A tick box is a control, not words: keep what it said, drop the control.
          line += n.classList.contains('on') ? '[x] ' : '[ ] ';
          continue;
        }
        if (tag === 'HR') { flush(); lines.push('---'); continue; }
        if (!BLOCK.test(tag)) { walk(n); continue; }
        if (line.trim()) flush();
        if (tag === 'LI' && !/^\s*\[/.test(n.textContent || '')) line += '- ';
        if (tag === 'PRE') { line += (n.textContent || '').trim(); flush(); continue; }
        walk(n);
        if (line.trim()) flush();
      }
    };

    walk(root);
    if (line.trim()) flush();
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // Markdown source to text, for rows written by the editor that came before
  // this one. Only the marks that editor could produce are stripped.
  function fromMarkdown(src) {
    return (src || '')
      .replace(/^```.*$/gm, '')
      .replace(/^(#{1,6})\s+/gm, '')
      .replace(/^(\s*)[-*]\s+\[([ xX])\]\s+/gm, (m, pad, box) =>
        `${pad}[${box.toLowerCase() === 'x' ? 'x' : ' '}] `)
      .replace(/^(\s*)[-*]\s+/gm, '$1- ')
      .replace(/^>\s?/gm, '')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/==([^=]+)==/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // The note as text, whatever it was stored as.
  const toPlain = (note) => {
    if (!note) return '';
    if (note.format === 'html') return fromHtml(note.body);
    if (note.format === 'markdown') return fromMarkdown(note.body);
    return note.body || '';
  };

  // One line of it, for a row's second line and for searching.
  const toText = (note) => toPlain(note).replace(/\s+/g, ' ').trim();

  return { fromHtml, fromMarkdown, toPlain, toText, escape };
})();
