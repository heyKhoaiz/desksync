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

  // HTML back to markdown.
  //
  // Two callers: notes written before the markdown editor, and the editor itself,
  // which now edits rendered HTML in place rather than markdown source. That
  // means everything render() can produce has to survive the trip back, or
  // editing a note would quietly drop its headings, quotes, code and links.
  function fromHtml(html) {
    const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
    const root = doc.body.firstChild;
    const BLOCK = /^(H[1-6]|UL|OL|PRE|BLOCKQUOTE|HR|P|DIV|LI)$/;

    // Everything inside one block, as a single line of markdown.
    const inlineOf = (node) => {
      let out = '';
      for (const n of node.childNodes) {
        if (n.nodeType === Node.TEXT_NODE) { out += n.nodeValue.replace(/\s+/g, ' '); continue; }
        if (n.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = n.tagName;
        const inner = inlineOf(n);
        const t = inner.trim();
        if (tag === 'BR') out += '\n';
        else if (tag === 'B' || tag === 'STRONG') out += t ? `**${t}**` : '';
        else if (tag === 'I' || tag === 'EM') out += t ? `*${t}*` : '';
        else if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') out += t ? `~~${t}~~` : '';
        // Underline has no markdown, and the old editor's highlighter read the
        // same way, so both become a highlight rather than being dropped.
        else if (tag === 'U' || tag === 'MARK') out += t ? `==${t}==` : '';
        else if (tag === 'CODE') out += t ? '`' + t + '`' : '';
        else if (tag === 'A') {
          const href = n.getAttribute('href') || '';
          out += href ? `[${t || href}](${href})` : t;
        } else if (tag === 'SPAN') {
          if (n.classList.contains('box')) continue;          // a task checkbox
          out += n.style?.backgroundColor && t ? `==${t}==` : inner;
        } else out += inner;
      }
      return out;
    };

    const chunks = [];
    const push = (text) => { if (text && text.trim()) chunks.push(text.replace(/[ \t]+$/gm, '')); };

    const walk = (node) => {
      for (const n of node.childNodes) {
        if (n.nodeType === Node.TEXT_NODE) { push(n.nodeValue.trim()); continue; }
        if (n.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = n.tagName;

        if (/^H[1-6]$/.test(tag)) {
          push('#'.repeat(Math.min(3, +tag[1])) + ' ' + inlineOf(n).trim());
        } else if (tag === 'HR') {
          push('---');
        } else if (tag === 'PRE') {
          push('```\n' + (n.textContent || '').replace(/\n+$/, '') + '\n```');
        } else if (tag === 'BLOCKQUOTE') {
          push(inlineOf(n).split('\n').map((l) => '> ' + l.trim()).join('\n'));
        } else if (tag === 'UL' || tag === 'OL') {
          const lines = [];
          let i = 1;
          for (const li of n.children) {
            if (li.tagName !== 'LI') continue;
            const box = li.querySelector(':scope > .box');
            const text = inlineOf(li).trim();
            if (box || n.classList.contains('tasks')) {
              const done = li.classList.contains('done') || box?.classList.contains('on');
              lines.push(`- [${done ? 'x' : ' '}] ${text}`);
            } else {
              lines.push((tag === 'OL' ? `${i++}.` : '-') + ' ' + text);
            }
          }
          push(lines.join('\n'));
        } else if (tag === 'P' || tag === 'DIV') {
          // contenteditable wraps blocks in divs, so recurse when it holds any.
          if ([...n.children].some((c) => BLOCK.test(c.tagName))) walk(n);
          else push(inlineOf(n).trim());
        } else {
          push(inlineOf(n).trim());
        }
      }
    };

    walk(root);
    return chunks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // A note row may be markdown or legacy HTML; everything else reads one of these.
  const toMarkdown = (note) => (note.format === 'markdown' ? note.body : fromHtml(note.body));
  const toText = (note) => (note.format === 'markdown' ? plain(note.body) : plain(fromHtml(note.body)));

  return { render, plain, fromHtml, toMarkdown, toText, escape: esc, inline };
})();
