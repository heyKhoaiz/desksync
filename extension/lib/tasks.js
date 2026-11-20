// Lists and tasks inside a plain-text note.
//
// A note stays plain text: a task is a line that starts with "[ ] " or "[x] ",
// a bullet starts with "- " or "* ", a numbered item with "1. ". That is what is
// stored, what syncs and what the phone shows. These functions only work out
// what the editor should do to those lines when you press Enter, tick a box or
// move a line. They take and return strings, so they run in the popup and in
// the Node tests alike.

const tasks = (() => {
  const LINE = /^(\s*)(?:(\[([ xX])\])|([-*•])|(\d{1,4})([.)]))( |$)(.*)$/;

  // What kind of list line this is, if any.
  function parse(line) {
    const m = LINE.exec(line);
    if (!m) return null;
    const [, indent, box, mark, bullet, num, numSep, , rest] = m;
    const prefix = line.length - rest.length;
    if (box) return { kind: 'task', indent, checked: mark !== ' ', rest, prefix };
    if (bullet) return { kind: 'bullet', indent, bullet, rest, prefix };
    return { kind: 'number', indent, num: +num, sep: numSep, rest, prefix };
  }

  // The start of the next item in the same list. A new task is never ticked.
  function nextPrefix(p) {
    if (p.kind === 'task') return `${p.indent}[ ] `;
    if (p.kind === 'bullet') return `${p.indent}${p.bullet} `;
    return `${p.indent}${p.num + 1}${p.sep} `;
  }

  // Enter at the end of a list line. Returns null for an ordinary line, so the
  // browser handles it. On an empty item the list ends: the marker goes and
  // the line is left blank, as in every editor people already know.
  function onEnter(line) {
    const p = parse(line);
    if (!p) return null;
    if (!p.rest.trim()) return { line: p.indent ? p.indent.slice(2) : '', insert: '' };
    return { line, insert: '\n' + nextPrefix(p) };
  }

  // Tick or untick. A line that is not a task becomes one, keeping its text:
  // a bullet becomes a task, a plain line gets a box.
  function toggle(line) {
    const p = parse(line);
    if (p?.kind === 'task') return `${p.indent}[${p.checked ? ' ' : 'x'}] ${p.rest}`;
    if (p) return `${p.indent}[ ] ${p.rest}`;
    const indent = /^\s*/.exec(line)[0];
    return `${indent}[ ] ${line.slice(indent.length)}`;
  }

  function progress(text) {
    let done = 0, total = 0;
    for (const line of String(text || '').split('\n')) {
      const p = parse(line);
      if (p?.kind !== 'task') continue;
      total++;
      if (p.checked) done++;
    }
    return { done, total, open: total - done };
  }

  // Ticked items to the bottom of their own list. Each run of task lines is a
  // list; ticked ones keep their order among themselves, so nothing jumps
  // further than it has to.
  function sinkDone(text) {
    const lines = String(text || '').split('\n');
    const out = [];
    let run = [];
    const flush = () => {
      out.push(...run.filter((l) => !parse(l).checked), ...run.filter((l) => parse(l).checked));
      run = [];
    };
    for (const line of lines) {
      if (parse(line)?.kind === 'task') run.push(line);
      else { flush(); out.push(line); }
    }
    flush();
    return out.join('\n');
  }

  // Swap line i with the one above (-1) or below (+1). Null at either end.
  function moveLine(text, i, dir) {
    const lines = String(text).split('\n');
    const j = i + dir;
    if (i < 0 || i >= lines.length || j < 0 || j >= lines.length) return null;
    [lines[i], lines[j]] = [lines[j], lines[i]];
    return lines.join('\n');
  }

  // A note that holds nothing but a starting template ("[ ] ", "To: ") has
  // nothing in it yet, and is not saved as if it did.
  function isBlank(text) {
    return !String(text || '')
      .replace(/^\s*(?:\[[ xX]\]|[-*•]|\d{1,4}[.)]|To:|Subject:)?\s*$/gm, '')
      .trim();
  }

  // What each way of starting a note puts in it, and where the caret goes.
  const STARTS = {
    tasks: { text: '[ ] ', caret: 4 },
    email: { text: 'To: \nSubject: \n\n', caret: 4 }
  };
  // "/task" or "/email" alone on the first line, then Enter.
  function slash(text) {
    const m = /^\s*\/(tasks?|todos?|checklist|email|mail)\s*$/i.exec(String(text || ''));
    if (!m) return null;
    return /mail/i.test(m[1]) ? 'email' : 'tasks';
  }

  // ---------- A note that is an email ----------
  // "To:" on the first line, then optional Cc:, Bcc: and Subject: lines, then
  // the body after them. Still plain text, so the phone shows it as written.
  function parseEmail(text) {
    const lines = String(text || '').split('\n');
    if (!/^To:/i.test(lines[0] || '')) return null;
    const head = {};
    let i = 0;
    for (; i < lines.length; i++) {
      const m = /^(To|Cc|Bcc|Subject):[ \t]*(.*)$/i.exec(lines[i]);
      if (!m) break;
      head[m[1].toLowerCase()] = m[2].trim();
    }
    while (i < lines.length && !lines[i].trim()) i++;
    return {
      to: head.to || '', cc: head.cc || '', bcc: head.bcc || '', subject: head.subject || '',
      body: lines.slice(i).join('\n').replace(/\s+$/, '')
    };
  }

  const addresses = (s) => String(s || '').split(/[,;]\s*/).map((a) => a.trim()).filter(Boolean);

  function mailtoUrl(e) {
    const q = [];
    for (const k of ['cc', 'bcc']) if (e[k]) q.push(`${k}=${addresses(e[k]).map(encodeURIComponent).join(',')}`);
    if (e.subject) q.push('subject=' + encodeURIComponent(e.subject));
    if (e.body) q.push('body=' + encodeURIComponent(e.body));
    return `mailto:${addresses(e.to).map(encodeURIComponent).join(',')}${q.length ? '?' + q.join('&') : ''}`;
  }

  // Gmail's compose window, for people whose mail is a tab rather than an app.
  function gmailUrl(e) {
    const p = new URLSearchParams({ view: 'cm', fs: '1' });
    if (e.to) p.set('to', addresses(e.to).join(','));
    if (e.cc) p.set('cc', addresses(e.cc).join(','));
    if (e.bcc) p.set('bcc', addresses(e.bcc).join(','));
    if (e.subject) p.set('su', e.subject);
    if (e.body) p.set('body', e.body);
    return 'https://mail.google.com/mail/?' + p.toString();
  }

  // Where every match of a search is, case-insensitive.
  function findAll(text, q) {
    const out = [];
    if (!q) return out;
    const hay = String(text).toLowerCase(), needle = q.toLowerCase();
    for (let i = hay.indexOf(needle); i > -1; i = hay.indexOf(needle, i + needle.length)) out.push(i);
    return out;
  }

  return { parse, onEnter, toggle, progress, sinkDone, moveLine, isBlank, STARTS, slash,
    parseEmail, mailtoUrl, gmailUrl, findAll };
})();

if (typeof module !== 'undefined') module.exports = tasks;
