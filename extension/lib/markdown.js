// Markdown for notes.
//
// A deliberately small subset — headings, bold, italic, strikethrough, inline and
// fenced code, bullet/numbered/task lists, quotes, links and rules — chosen for what
// actually goes in a note. It is about 100 lines, which is why there is no library
// here: MV3 forbids loading remote code, so a dependency would have to be vendored
// and kept up to date for a feature this size.
//
// Notes written before the markdown editor are stored as sanitized HTML and carry
// format='html'. They keep rendering as HTML until you edit one, at which point
// htmlToMarkdown converts it and the row is saved with format='markdown'.

const md = (() => {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Inline pass. Code spans are pulled out first and put back last, so a `*` inside
  // `code` is never read as emphasis.
  function inline(t) {
    t = esc(t);
    const held = [];
    t = t.replace(/`([^`]+)`/g, (m, c) => `\u0000${held.push(`<code>${c}</code>`) - 1}\u0000`);
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) =>
      /^https?:\/\//i.test(href) ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>` : label);
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    t = t.replace(/==([^=]+)==/g, '<mark>$1</mark>');
    return t.replace(/\u0000(\d+)\u0000/g, (m, i) => held[+i]);
  }

  function render(src) {
    const lines = (src || '').split('\n');
    let out = '', list = null, para = [], fence = null;

    const closePara = () => { if (para.length) { out += `<p>${inline(para.join(' '))}</p>`; para = []; } };
    const closeList = () => { if (list) { out += `</${list}>`; list = null; } };
    const open = (tag, cls) => {
      if (list !== tag) { closeList(); out += `<${tag}${cls ? ` class="${cls}"` : ''}>`; list = tag; }
    };

    for (const raw of lines) {
      if (/^\s*```/.test(raw)) {
        if (fence === null) { closePara(); closeList(); fence = []; }
        else { out += `<pre><code>${fence.join('\n')}</code></pre>`; fence = null; }
        continue;
      }
      if (fence !== null) { fence.push(esc(raw)); continue; }

      let m;
      if (!raw.trim()) { closePara(); closeList(); continue; }

      if ((m = raw.match(/^(#{1,3})\s+(.*)$/))) {
        closePara(); closeList();
        out += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`;
      } else if (/^\s*(---+|\*\*\*+)\s*$/.test(raw)) {
        closePara(); closeList(); out += '<hr>';
      } else if ((m = raw.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/))) {
        closePara(); open('ul', 'tasks');
        const on = m[1].toLowerCase() === 'x';
        out += `<li class="${on ? 'done' : ''}"><span class="box ${on ? 'on' : ''}"></span><span>${inline(m[2])}</span></li>`;
      } else if ((m = raw.match(/^\s*[-*]\s+(.*)$/))) {
        closePara(); open('ul'); out += `<li>${inline(m[1])}</li>`;
      } else if ((m = raw.match(/^\s*\d+[.)]\s+(.*)$/))) {
        closePara(); open('ol'); out += `<li>${inline(m[1])}</li>`;
      } else if ((m = raw.match(/^>\s?(.*)$/))) {
        closePara(); closeList(); out += `<blockquote>${inline(m[1])}</blockquote>`;
      } else {
        closeList(); para.push(raw.trim());
      }
    }

    if (fence !== null) out += `<pre><code>${fence.join('\n')}</code></pre>`;
    closePara(); closeList();
    return out;
  }

  // One line of plain text, for a row's second line and for searching.
  function plain(src) {
    return (src || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/^#{1,3}\s+/gm, '')
      .replace(/^\s*[-*]\s+\[[ xX]\]\s+/gm, '')
      .replace(/^\s*[-*]\s+/gm, '')
      .replace(/^\s*\d+[.)]\s+/gm, '')
      .replace(/^>\s?/gm, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_~`#=]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Legacy notes: the old editor was contenteditable and produced a small, known set
  // of tags (see ALLOWED in the old popup.js), so this only has to handle those.
  function fromHtml(html) {
    const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');

    const walk = (node) => {
      let out = '';
      for (const n of node.childNodes) {
        if (n.nodeType === Node.TEXT_NODE) { out += n.nodeValue.replace(/\s+/g, ' '); continue; }
        if (n.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = n.tagName;
        const inner = walk(n);
        if (tag === 'BR') out += '\n';
        else if (tag === 'B' || tag === 'STRONG') out += inner.trim() ? `**${inner.trim()}**` : '';
        else if (tag === 'I' || tag === 'EM') out += inner.trim() ? `*${inner.trim()}*` : '';
        else if (tag === 'S' || tag === 'STRIKE') out += inner.trim() ? `~~${inner.trim()}~~` : '';
        // Underline has no markdown. The old editor also had a highlighter, and both
        // read as emphasis, so they become == highlight == rather than being dropped.
        else if (tag === 'U') out += inner.trim() ? `==${inner.trim()}==` : '';
        else if (tag === 'SPAN') out += n.style?.backgroundColor && inner.trim() ? `==${inner.trim()}==` : inner;
        else if (tag === 'UL' || tag === 'OL') {
          let i = 1;
          for (const li of n.children) {
            const t = walk(li).trim();
            if (t) out += `\n${tag === 'OL' ? i++ + '.' : '-'} ${t}`;
          }
          out += '\n';
        } else if (tag === 'LI') out += inner;
        else if (tag === 'P' || tag === 'DIV') out += (inner.trim() ? inner.trim() : '') + '\n';
        else out += inner;
      }
      return out;
    };

    return walk(doc.body.firstChild)
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+$/gm, '')
      .trim();
  }

  // A note row may be markdown or legacy HTML; everything else reads one of these.
  const toMarkdown = (note) => (note.format === 'markdown' ? note.body : fromHtml(note.body));
  const toText = (note) => (note.format === 'markdown' ? plain(note.body) : plain(fromHtml(note.body)));

  return { render, plain, fromHtml, toMarkdown, toText, escape: esc, inline };
})();
