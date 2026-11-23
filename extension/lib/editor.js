// The note editor: what you see is what you get, over a plain-text note.
//
// The note is, and stays, plain text: "**bold**", "_italic_", "[ ] task",
// "- bullet". That is what is saved, synced and shown on the phone. This file
// shows that text formatted, with no markers in sight, and lets you edit it.
//
// How it stays correct:
//   - The text is the only truth (`ed.value`). The page is drawn from it.
//   - Every edit is made to the text, never by the browser to the page: typing,
//     deleting, Enter and paste are all taken from `beforeinput` and applied
//     to the text, which is then redrawn. A rich editor that lets the browser
//     change the page and reads it back is how notes drift from what was typed.
//   - The markers are still in the page, hidden and uneditable, so the page
//     always reads back as exactly the text, and the caret can never land
//     inside one.
//   - Only the lines that changed are redrawn, so typing does not rebuild
//     the note.
//
// The element keeps a textarea's API (value, selectionStart, selectionEnd,
// setSelectionRange, setRangeText) in text offsets, so the code around it can
// treat the note as text. Needs lib/tasks.js and lib/format.js.

const richEditor = (() => {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- drawing ----------
  // A line's words, with bold and italic as styled spans and the markers kept
  // but hidden.
  // Web addresses are drawn as links (Ctrl or Cmd + click opens one; a plain
  // click still puts the caret there, as in any editor). Only the drawing
  // changes: the text, and so every offset, stays exactly what was typed.
  const OPEN_HINT = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '') ? '⌘+click to open' : 'Ctrl+click to open';
  const URL_RE = /\bhttps?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]'*_]/g;
  function urlMarks(rest) {
    const out = [];
    for (const m of rest.matchAll(URL_RE)) out.push({ from: m.index, to: m.index + m[0].length, cls: 'url' });
    return out;
  }

  function inlineHtml(rest) {
    if (!rest) return '<br>';
    const marks = [...fmt.inlineMarks(rest), ...urlMarks(rest)];
    if (!marks.length) return esc(rest);
    const cuts = new Set([0, rest.length]);
    for (const m of marks) { cuts.add(m.from); cuts.add(m.to); }
    const pts = [...cuts].sort((a, b) => a - b);
    let html = '';
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const cls = marks.filter((m) => m.from <= a && m.to >= b).map((m) => m.cls);
      const chunk = esc(rest.slice(a, b));
      if (cls.includes('mk')) html += `<span class="mk" contenteditable="false">${chunk}</span>`;
      else if (cls.includes('url')) {
        const href = marks.find((m) => m.cls === 'url' && m.from <= a && m.to >= b);
        html += `<span class="${cls.join(' ')}" data-href="${esc(rest.slice(href.from, href.to))}" title="${OPEN_HINT}">${chunk}</span>`;
      } else if (cls.length) html += `<span class="${cls.join(' ')}">${chunk}</span>`;
      else html += chunk;
    }
    return html;
  }

  // One line of the note. A list line's marker ("[ ] ", "- ", "2. ") is not
  // in the editable text: it is kept on the element and drawn by CSS, as a
  // checkbox, a bullet or a number.
  function lineHtml(line) {
    const p = tasks.parse(line);
    if (!p) return `<div class="ln">${inlineHtml(line)}</div>`;
    const prefix = line.slice(0, p.prefix);
    const attrs = [`class="ln"`, `data-p="${esc(prefix)}"`, `data-k="${p.kind}"`];
    if (p.indent) attrs.push(`style="--ind:${p.indent.length}"`);
    if (p.kind === 'task' && p.checked) attrs.push('data-done=""');
    if (p.kind === 'number') attrs.push(`data-n="${p.num}${p.sep}"`);
    return `<div ${attrs.join(' ')}>${inlineHtml(line.slice(p.prefix))}</div>`;
  }

  // Redraws only the lines that differ from what is on screen.
  function draw(ed, v) {
    const lines = v.split('\n');
    const old = ed._lines;
    const kids = [...ed.childNodes];
    const intact = old && kids.length === old.length && kids.every((n) => n.nodeType === 1 && n.classList.contains('ln'));
    if (!intact) {
      ed.innerHTML = lines.map(lineHtml).join('');
    } else {
      let a = 0;
      while (a < lines.length && a < old.length && lines[a] === old[a]) a++;
      let b = 0;
      while (b < lines.length - a && b < old.length - a && lines[lines.length - 1 - b] === old[old.length - 1 - b]) b++;
      const gone = kids.slice(a, old.length - b);
      const ref = kids[old.length - b] || null;
      const t = document.createElement('template');
      t.innerHTML = lines.slice(a, lines.length - b).map(lineHtml).join('');
      for (const n of gone) n.remove();
      ed.insertBefore(t.content, ref);
    }
    ed._lines = lines;
    ed._v = v;
    ed.classList.toggle('empty', v === '');
  }

  // What the page says, read back: each line's marker plus its text. Only
  // needed after typing with an input method (Chinese, Japanese, dictation),
  // which the browser writes into the page itself.
  function readPage(ed) {
    return [...ed.childNodes].map((n) => (n.nodeType === 1 && n.classList.contains('ln')
      ? (n.dataset.p || '') + n.textContent
      : n.textContent)).join('\n').replace(/ /g, ' ');
  }

  // ---------- text offsets and the page ----------
  function lineStart(ed, i) {
    let s = 0;
    for (let j = 0; j < i; j++) s += ed._lines[j].length + 1;
    return s;
  }

  function locate(ed, s) {
    let start = 0;
    for (let i = 0; i < ed._lines.length; i++) {
      const len = ed._lines[i].length;
      if (s <= start + len || i === ed._lines.length - 1) return { i, start };
      start += len + 1;
    }
    return { i: 0, start: 0 };
  }

  const lineOf = (ed, node) => {
    let L = node;
    while (L && L.parentNode !== ed) L = L.parentNode;
    return L && L.nodeType === 1 ? L : null;
  };

  // A point in the page as an offset in the text.
  function toText(ed, node, offset) {
    if (node === ed) {
      if (offset >= ed.children.length) return ed._v.length;
      return lineStart(ed, offset);
    }
    const L = lineOf(ed, node);
    if (!L) return null;
    const i = [...ed.children].indexOf(L);
    const r = document.createRange();
    r.setStart(L, 0);
    r.setEnd(node, offset);
    return lineStart(ed, i) + (L.dataset.p || '').length + r.toString().length;
  }

  function textNodes(L) {
    const out = [];
    const w = document.createTreeWalker(L, NodeFilter.SHOW_TEXT);
    let pos = 0;
    for (let t = w.nextNode(); t; t = w.nextNode()) {
      out.push({ node: t, hidden: !!t.parentElement?.closest('.mk'), from: pos, to: pos + t.data.length });
      pos += t.data.length;
    }
    return out;
  }

  // An offset in the text as a point in the page. A point inside or beside a
  // hidden marker is moved onto visible text: before the marker for 'end',
  // after it for 'start'. So a caret at the end of a bold word stays in the
  // bold, and a selection starting at a bold word starts at its first letter.
  function toPage(ed, s, bias = 'end') {
    const { i, start } = locate(ed, s);
    const L = ed.children[i];
    if (!L) return [ed, 0];
    let off = Math.max(0, s - start - (L.dataset.p || '').length);
    const nodes = textNodes(L);
    for (let moved = true; moved;) {
      moved = false;
      for (const n of nodes) {
        if (!n.hidden || n.to === n.from) continue;
        const inside = off > n.from && off < n.to;
        if (bias === 'start' && (inside || off === n.from)) { off = n.to; moved = true; }
        else if (bias !== 'start' && (inside || off === n.to)) { off = n.from; moved = true; }
      }
    }
    const vis = nodes.filter((n) => !n.hidden);
    const hit = bias === 'start'
      ? vis.find((n) => off >= n.from && off < n.to) || vis.find((n) => off === n.to)
      : vis.find((n) => off > n.from && off <= n.to) || vis.find((n) => off === n.from);
    if (hit) return [hit.node, off - hit.from];
    return [L, 0];
  }

  // The hidden markers, as text ranges: a selection must not start just
  // before one or end just after one, or bold would see "**word" selected.
  function markerRanges(v) {
    return fmt.inlineMarks(v).filter((m) => m.cls === 'mk');
  }

  // ---------- editing the text ----------
  // Removing [a, b) without leaving half a pair of markers behind. A run whose
  // words are all removed loses its markers too; a run cut in half keeps its
  // markers, so "**bo|ld**" minus "ld" is "**bo**", not "**bo".
  // `replacing`: text is going in where this comes out (typing over a bold
  // word, making a word italic). Then a run whose words are all selected keeps
  // its markers, so what goes in is bold too.
  function removeRange(v, a, b, replacing = false) {
    if (a >= b) return { v, at: a };
    const marks = fmt.inlineMarks(v);
    const runs = [];
    for (let k = 0; k + 2 < marks.length; k += 3) runs.push(marks.slice(k, k + 3));
    // Until nothing changes: widening over an italic run can take in the
    // whole of the bold run around it ("**_x_**"), whose markers must go too,
    // or "****" was left on screen.
    if (!replacing) {
      for (let grew = true; grew;) {
        grew = false;
        for (const [o, c, cl] of runs) {
          if (c.from >= a && c.to <= b && c.to > c.from && (o.from < a || cl.to > b)) {
            a = Math.min(a, o.from); b = Math.max(b, cl.to); grew = true;
          }
        }
      }
    }
    let kept = '';
    for (const [o, c, cl] of runs) {
      if (o.from >= a && cl.to <= b) continue;          // the whole run goes
      for (const m of [o, cl]) if (m.from >= a && m.to <= b) kept += v.slice(m.from, m.to);
    }
    return { v: v.slice(0, a) + kept + v.slice(b), at: a, kept: kept.length };
  }

  function make(ed, initial = '') {
    ed._hist = [];
    ed._redo = [];
    ed._sel = [0, 0];
    draw(ed, initial);

    const fire = () => ed.dispatchEvent(new Event('input', { bubbles: true }));

    // Undo. Typing is grouped into words: one Ctrl+Z takes back a word, not a letter.
    let lastKind = null, lastAt = 0;
    const remember = (kind, data = '') => {
      const now = Date.now();
      // A run of typing, or of Backspace, is one step to undo, up to a pause or a space.
      const group = (kind === 'type' || kind === 'delete') && lastKind === kind && now - lastAt < 1200 && !/\s/.test(data);
      if (!group) {
        ed._hist.push({ v: ed._v, sel: [ed.selectionStart, ed.selectionEnd] });
        if (ed._hist.length > 200) ed._hist.shift();
        ed._redo = [];
      }
      lastKind = kind;
      lastAt = now;
    };
    const restore = (from, to) => {
      const s = from.pop();
      if (!s) return;
      to.push({ v: ed._v, sel: [ed.selectionStart, ed.selectionEnd] });
      draw(ed, s.v);
      ed.setSelectionRange(...s.sel);
      lastKind = null;
      fire();
    };
    ed.undo = () => restore(ed._hist, ed._redo);
    ed.redo = () => restore(ed._redo, ed._hist);

    Object.defineProperty(ed, 'value', {
      get() { return ed._v; },
      set(v) { remember('set'); draw(ed, String(v ?? '')); },
      configurable: true
    });

    // Where setSelectionRange last put the caret, in the page. Several text
    // offsets share one point on screen (either side of a hidden "**"), so
    // while the caret has not moved, the offset it was given is the answer.
    let placed = null;
    const current = () => {
      const sel = getSelection();
      if (sel.rangeCount && ed.contains(sel.anchorNode)) {
        const r = sel.getRangeAt(0);
        if (placed && r.startContainer === placed[0] && r.startOffset === placed[1] &&
            r.endContainer === placed[2] && r.endOffset === placed[3]) return ed._sel;
        placed = null;
        let a = toText(ed, r.startContainer, r.startOffset);
        let b = toText(ed, r.endContainer, r.endOffset);
        if (a == null || b == null) return ed._sel;
        if (a !== b) {
          const mk = markerRanges(ed._v);
          for (let moved = true; moved;) { moved = false; for (const m of mk) if (a === m.from) { a = m.to; moved = true; } }
          for (let moved = true; moved;) { moved = false; for (const m of mk) if (b === m.to) { b = m.from; moved = true; } }
          if (b < a) b = a;
        }
        ed._sel = [a, b];
      }
      return ed._sel;
    };
    Object.defineProperty(ed, 'selectionStart', { get: () => current()[0], configurable: true });
    Object.defineProperty(ed, 'selectionEnd', { get: () => current()[1], configurable: true });

    ed.setSelectionRange = (a, b = a) => {
      const len = ed._v.length;
      // A position that is not a number (a stale find match) is the end, not
      // NaN: NaN stored here put the next letter typed at the very start.
      if (!Number.isFinite(a)) a = len;
      if (!Number.isFinite(b)) b = a;
      a = Math.max(0, Math.min(len, a)); b = Math.max(a, Math.min(len, b));
      const [n1, o1] = toPage(ed, a, a === b ? 'end' : 'start');
      const [n2, o2] = a === b ? [n1, o1] : toPage(ed, b, 'end');
      const r = document.createRange();
      r.setStart(n1, o1);
      r.setEnd(n2, o2);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      ed._sel = [a, b];
      placed = [n1, o1, n2, o2];
    };

    // A page Range for a stretch of text: used to mark matches when finding.
    ed.rangeOf = (a, b) => {
      const r = document.createRange();
      const [n1, o1] = toPage(ed, a, 'start');
      const [n2, o2] = toPage(ed, b, 'end');
      r.setStart(n1, o1);
      r.setEnd(n2, o2);
      return r;
    };
    ed.lineStart = (i) => lineStart(ed, i);

    // Bold or italic switched on at the caret, for what is typed next. An
    // empty "****" in the note would be shown as four asterisks, so nothing
    // is written until there is a letter to make bold.
    let pending = null;
    ed.setPending = (mk) => { pending = mk ? { mk, at: ed.selectionStart } : null; };
    ed.pending = () => pending?.mk || null;

    // A change to the text, as one undoable step.
    ed.setRangeText = (text, a = ed.selectionStart, b = ed.selectionEnd, kind = 'op') => {
      remember(kind, text);
      // Typing over a whole bold word keeps it bold, but only if what goes in
      // has words: "** **" is not bold, and shows its asterisks.
      const removed = removeRange(ed._v, a, b, text.trim() !== '');
      // Text with line breaks going into the middle of bold: each break closes
      // the bold and opens it again on the next line, as Enter does, or the
      // markers end up on different lines and show.
      if (text.includes('\n')) {
        const marks = fmt.inlineMarks(removed.v);
        const open = [];
        for (let k = 0; k + 2 < marks.length; k += 3) {
          const [o, c] = marks.slice(k, k + 3);
          if (removed.at > c.from && removed.at < c.to) open.push([o.from, removed.v.slice(o.from, o.to)]);
        }
        // Outermost first when opening, innermost first when closing.
        const mks = open.sort((x, y) => x[0] - y[0]).map(([, m]) => m);
        // A list marker starting the new line ("[ ] " from Enter in a task)
        // goes before the reopened bold, where a marker has to be.
        if (mks.length) text = text.replace(/\n((?:[ \t]*(?:\[[ xX]\]|[-*•]|\d{1,4}[.)]) )?)/g,
          (m, prefix) => [...mks].reverse().join('') + '\n' + prefix + mks.join(''));
      }
      const v = removed.v.slice(0, removed.at) + text + removed.v.slice(removed.at);
      draw(ed, v);
      return removed.at + text.length;
    };

    // Everything typed or deleted arrives here first, and is done to the text.
    ed.addEventListener('beforeinput', (e) => {
      if (e.isComposing || e.inputType === 'insertCompositionText') return;
      e.preventDefault();
      const t = e.inputType;
      let [a, b] = [ed.selectionStart, ed.selectionEnd];
      const ranges = e.getTargetRanges?.() || [];
      // A collapsed target is just the caret, which the selection already
      // gives, and more exactly: either side of a hidden "**" is the same
      // point on screen, and only the selection remembers which side
      // B or Ctrl+B put it on. Deletions do need the browser's range: it knows
      // how far Ctrl+Backspace reaches.
      const r0 = ranges[0];
      if (r0 && !(r0.collapsed && !t.startsWith('delete'))) {
        const x = toText(ed, ranges[0].startContainer, ranges[0].startOffset);
        const y = toText(ed, ranges[0].endContainer, ranges[0].endOffset);
        if (x != null && y != null) [a, b] = [Math.min(x, y), Math.max(x, y)];
      }
      if (t === 'insertText' || t === 'insertReplacementText') {
        const data = e.data ?? e.dataTransfer?.getData('text/plain') ?? '';
        // Ctrl+B with nothing selected, then typing: the typing goes in bold,
        // and the caret stays inside so the next letters do too.
        const p = pending;
        pending = null;
        if (p && a === b && a === p.at && data) {
          // Bold starts at the first letter: "** word**" is not bold, so a
          // space typed first goes in plain and bold stays switched on.
          const lead = /^\s*/.exec(data)[0];
          if (lead === data) {
            const at = ed.setRangeText(data, a, b, 'type');
            pending = { mk: p.mk, at };
            ed.setSelectionRange(at);
            return fire();
          }
          const at = ed.setRangeText(lead + p.mk + data.slice(lead.length) + p.mk, a, b, 'type') - p.mk.length;
          ed.setSelectionRange(at);
          return fire();
        }
        const at = ed.setRangeText(data, a, b, 'type');
        // "- ", "1. " or "[ ] " typed at the start of a list item switches the
        // item to that kind, as it would at the start of a plain line: Enter
        // on a checklist item, then "- ", makes a bullet, not "☐ - ".
        const v = ed._v;
        const ls = v.lastIndexOf('\n', at - 1) + 1;
        let le = v.indexOf('\n', at); if (le < 0) le = v.length;
        const line = v.slice(ls, le);
        const lp = tasks.parse(line);
        if (data === ' ' && lp && at === ls + lp.prefix + (/^(?:\[[ xX]\]|[-*•]|\d{1,4}[.)]) /.exec(lp.rest)?.[0].length ?? -1)) {
          const next = lp.indent + lp.rest;
          draw(ed, v.slice(0, ls) + next + v.slice(le));
          ed.setSelectionRange(at - (lp.prefix - lp.indent.length));   // the old marker is gone
          return fire();
        }
        ed.setSelectionRange(at);
        return fire();
      }
      pending = null;
      if (t === 'insertParagraph' || t === 'insertLineBreak') {
        // Normally handled on keydown by the editor around this one; this is
        // for Enter arriving another way (an on-screen keyboard).
        ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: t === 'insertLineBreak', bubbles: true, cancelable: true }));
        return;
      }
      if (t.startsWith('delete')) {
        if (a === b) {
          // No range from the browser: one visible character, either way.
          const mk = markerRanges(ed._v);
          const inMk = (p) => mk.some((m) => p >= m.from && p < m.to);
          if (/Backward/.test(t)) { let p = a - 1; while (p >= 0 && inMk(p)) p--; if (p < 0) return; a = p; b = p + 1; }
          else { let p = a; while (p < ed._v.length && inMk(p)) p++; if (p >= ed._v.length) return; a = p; b = p + 1; }
        }
        const removed = removeRange(ed._v, a, b);
        remember('delete');
        draw(ed, removed.v);
        ed.setSelectionRange(removed.at);
        return fire();
      }
      if (t === 'historyUndo') return ed.undo();
      if (t === 'historyRedo') return ed.redo();
      if (t === 'formatBold' || t === 'formatItalic') {
        ed.dispatchEvent(new KeyboardEvent('keydown', { key: t === 'formatBold' ? 'b' : 'i', ctrlKey: true, bubbles: true, cancelable: true }));
      }
      // Anything else (dropping text, the browser's own formatting) is not done.
    });

    ed.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); ed.undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); ed.redo(); }
    });

    // An input method writes into the page itself; when it is done, the text
    // is read back from the page and the page redrawn from it.
    ed.addEventListener('compositionend', () => {
      const caret = ed.selectionStart;
      remember('type');
      ed._lines = null;               // force a full redraw
      draw(ed, readPage(ed));
      ed.setSelectionRange(caret);
      fire();
    });

    // Copying out of the note: formatted for other apps, the exact text for
    // pasting back into a note.
    const copyOut = (e) => {
      const [a, b] = [ed.selectionStart, ed.selectionEnd];
      if (a === b) return null;
      const s = ed._v.slice(a, b);
      e.preventDefault();
      e.clipboardData.setData('text/plain', fmt.strip(s));
      e.clipboardData.setData('text/html', fmt.toHtml(s));
      e.clipboardData.setData('text/x-desksync', s);
      return [a, b];
    };
    ed.addEventListener('copy', copyOut);
    ed.addEventListener('cut', (e) => {
      const r = copyOut(e);
      if (!r) return;
      const removed = removeRange(ed._v, r[0], r[1]);
      remember('delete');
      draw(ed, removed.v);
      ed.setSelectionRange(removed.at);
      fire();
    });
    ed.addEventListener('dragstart', (e) => e.preventDefault());

    // Keep the last selection, for code that asks while focus is elsewhere.
    ed._current = current;
    active = ed;
    return ed;
  }

  // One listener for the page, whichever note is open, rather than one more
  // each time the editor is drawn.
  let active = null;
  document.addEventListener('selectionchange', () => {
    if (active?.isConnected && document.activeElement === active) active._current();
  });

  return { make, removeRange };
})();
