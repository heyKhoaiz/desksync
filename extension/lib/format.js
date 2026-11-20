// Bold and italic in a plain-text note.
//
// The note stays plain text: **bold** and _italic_ are characters in it, the
// way people already type them in chat apps and READMEs. The editor draws them
// (see renderMirror in popup.js), and these functions turn them into real
// formatting when the text leaves DeskSync: copied, inserted into a page.
//
// Pure string work, so it runs in the popup and in the Node tests. Needs
// lib/tasks.js loaded first, for the list lines.

const fmt = (() => {
  const T = typeof tasks !== 'undefined' ? tasks : require('./tasks.js');

  // The opening marker must touch a word ("2 ** 3" is not bold). The closing
  // one may have spaces before it: "**word **" is what you get by typing a
  // space at the end of a bold word, and it must stay bold.
  const BOLD = /\*\*(?=\S)([^\n]+?)\*\*/g;
  // Underscores inside a word (snake_case, file_names) are not italic: the
  // marker must have a non-word character, or the line's edge, on its outside.
  // A "*" just outside is fine: that is italic inside bold, "**_word_**".
  const ITALIC = /(^|[^\w])_(?=\S)([^\n]+?)_(?!\w)/gm;

  // Where the bold and italic runs are: the markers, to be dimmed, and the
  // words between them.
  function inlineMarks(text) {
    const out = [];
    const s = String(text || '');
    for (const m of s.matchAll(BOLD)) {
      const a = m.index, b = a + m[0].length;
      out.push({ from: a, to: a + 2, cls: 'mk' }, { from: a + 2, to: b - 2, cls: 'b' }, { from: b - 2, to: b, cls: 'mk' });
    }
    for (const m of s.matchAll(ITALIC)) {
      const a = m.index + m[1].length, b = m.index + m[0].length;
      out.push({ from: a, to: a + 1, cls: 'mk' }, { from: a + 1, to: b - 1, cls: 'em' }, { from: b - 1, to: b, cls: 'mk' });
    }
    return out;
  }

  const hasInline = (text) => inlineMarks(text).length > 0;

  // The words without their markers, for anywhere that cannot show formatting:
  // a plain text field, a mailto link, the preview line in the list.
  function strip(text) {
    return String(text || '').replace(BOLD, '$1').replace(ITALIC, '$1$2');
  }

  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // The note as HTML, for a clipboard or an editor that takes formatting
  // (Gmail, Google Docs, Notion). Boxes become ☐ and ☑, so a task list still
  // reads as one where there are no checkboxes.
  function toHtml(text) {
    const lines = String(text || '').split('\n').map((line) => {
      const p = T.parse(line);
      let head = '', body = line;
      if (p?.kind === 'task') { head = p.indent + (p.checked ? '☑ ' : '☐ '); body = p.rest; }
      return esc(head) + esc(body)
        .replace(BOLD, '<b>$1</b>')
        .replace(ITALIC, '$1<i>$2</i>');
    });
    return `<div>${lines.join('<br>')}</div>`;
  }

  // Bold or italic on, or off, for a selection. Returns what to replace and
  // what to select afterwards, so the editor can make it one undoable edit.
  //   - nothing selected: a pair of markers, with the caret between them
  //   - already wrapped (markers just outside, or the selection includes
  //     them): the markers come off
  //   - several lines: each line's words are wrapped on their own, after any
  //     list marker, because a marker cannot span a line break
  function wrap(text, from, to, mk) {
    const n = mk.length;
    if (from === to) return { start: from, end: to, insert: mk + mk, selFrom: from + n, selTo: from + n };

    let sel = text.slice(from, to);
    if (sel.includes('\n')) return wrapLines(text, from, to, mk);

    // Markers must touch the words, so spaces at the edges stay outside.
    const lead = /^\s*/.exec(sel)[0].length;
    const trail = /\s*$/.exec(sel)[0].length;
    if (lead === sel.length) return { start: from, end: to, insert: sel, selFrom: from, selTo: to };
    from += lead; to -= trail; sel = text.slice(from, to);

    // Already on, possibly with the other kind just inside it: "**_word_**"
    // with "word" selected is bold, so B takes the outer ** off.
    const other = mk === '**' ? '_' : '**';
    let f = from, t = to;
    while (text.slice(f - other.length, f) === other && text.slice(t, t + other.length) === other) {
      f -= other.length; t += other.length;
    }
    // Spaces between the words and the closing marker ("**word **") still
    // mean the words are bold.
    let close = t;
    while (text[close] === ' ') close++;
    if (text.slice(f - n, f) === mk && text.slice(close, close + n) === mk && !doubled(text, f, close, mk)) {
      return { start: f - n, end: close + n, insert: text.slice(f, close), selFrom: from - n, selTo: to - n };
    }
    if (sel.length > 2 * n && sel.startsWith(mk) && sel.endsWith(mk)) {
      const inner = sel.slice(n, -n);
      return { start: from, end: to, insert: inner, selFrom: from, selTo: from + inner.length };
    }

    // Italic in the middle of a word ("foo_bar_") is not italic at all, and
    // its underscores would show: make the whole word italic instead.
    if (mk === '_') {
      while (from > 0 && /[\p{L}\p{N}_]/u.test(text[from - 1])) from--;
      while (to < text.length && /[\p{L}\p{N}_]/u.test(text[to])) to++;
    }
    // Runs of the same kind that the selection overlaps are merged into one:
    // making "ld pl" bold in "**bold** plain" used to give "**bo**ld** pl**ain",
    // whose markers show. Their markers come out, and the one new run covers
    // the selection and all of them.
    const same = [];
    const marks = inlineMarks(text);
    for (let k = 0; k + 2 < marks.length; k += 3) {
      const [o, c, cl] = marks.slice(k, k + 3);
      if (o.to - o.from === n && o.from < to && cl.to > from) same.push([o, cl]);
    }
    if (same.length) {
      const a = Math.min(from, ...same.map(([o]) => o.from));
      const b = Math.max(to, ...same.map(([, cl]) => cl.to));
      let inner = '';
      for (let i = a; i < b; i++) {
        if (same.some(([o, cl]) => (i >= o.from && i < o.to) || (i >= cl.from && i < cl.to))) continue;
        inner += text[i];
      }
      return { start: a, end: b, insert: mk + inner + mk, selFrom: a + n, selTo: a + n + inner.length };
    }
    sel = text.slice(from, to);
    return { start: from, end: to, insert: mk + sel + mk, selFrom: from + n, selTo: to + n };
  }

  // "*" just outside an italic "_" is fine, but for bold, "**" seen outside
  // could be the inside half of "****": only count markers that are exactly
  // that many characters.
  function doubled(text, from, to, mk) {
    if (mk !== '_') return text[from - mk.length - 1] === mk[0] || text[to + mk.length] === mk[0];
    return text[from - 2] === '_' || text[to + 1] === '_';
  }

  function wrapLines(text, from, to, mk) {
    const start = from > 0 ? text.lastIndexOf('\n', from - 1) + 1 : 0;
    let end = text.indexOf('\n', text[to - 1] === '\n' ? to - 1 : to);
    if (end < 0) end = text.length;
    const lines = text.slice(start, end).split('\n');
    const split = (l) => {
      const p = T.parse(l);
      const head = p ? l.slice(0, p.prefix) : /^\s*/.exec(l)[0];
      return [head, l.slice(head.length)];
    };
    const n = mk.length;
    const isWrapped = (w) => w.length > 2 * n && w.startsWith(mk) && w.endsWith(mk);
    const filled = lines.map(split).filter(([, w]) => w.trim());
    const off = filled.length > 0 && filled.every(([, w]) => isWrapped(w.trim()));
    const insert = lines.map((l) => {
      const [head, words] = split(l);
      const w = words.trimEnd();
      if (!w.trim()) return l;
      return head + (off ? w.slice(n, -n) : mk + w + mk) + words.slice(w.length);
    }).join('\n');
    return { start, end, insert, selFrom: start, selTo: start + insert.length };
  }

  // Is the selection already bold (or italic)? The toolbar shows the button
  // pressed when it is.
  function isOn(text, from, to, mk) {
    if (from === to) return false;
    const r = wrap(text, from, to, mk);
    return r.insert.length < r.end - r.start;
  }

  // The selected lines as tasks, or as bullets. If they all already are,
  // the markers come off instead. A task can become a bullet and back.
  function lines(text, from, to, kind) {
    const start = from > 0 ? text.lastIndexOf('\n', from - 1) + 1 : 0;
    let end = text.indexOf('\n', to > from && text[to - 1] === '\n' ? to - 1 : to);
    if (end < 0) end = text.length;
    const ls = text.slice(start, end).split('\n');
    const all = ls.filter((l) => l.trim()).every((l) => T.parse(l)?.kind === kind);
    let n = 0;                                    // a numbered list counts from 1
    const insert = ls.map((l) => {
      if (!l.trim()) return l;
      const p = T.parse(l);
      const indent = p ? p.indent : /^\s*/.exec(l)[0];
      const rest = p ? p.rest : l.slice(indent.length);
      if (all) return indent + rest;
      return indent + (kind === 'task' ? '[ ] ' : kind === 'number' ? `${++n}. ` : '- ') + rest;
    }).join('\n');
    return { start, end, insert, selFrom: start, selTo: start + insert.length };
  }

  return { inlineMarks, hasInline, strip, toHtml, wrap, isOn, lines };
})();

if (typeof module !== 'undefined') module.exports = fmt;
