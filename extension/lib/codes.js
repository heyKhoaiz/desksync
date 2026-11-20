// Backup codes: the one-time codes a site gives you for when you cannot get
// your second factor. Kept inside a vault item's encrypted payload as
//   codes: [{ c: 'abcd-1234', used: null | '2026-11-20T10:00:00Z' }]
//
// A code is never deleted when used, only marked: you can see which ones are
// gone, undo a mistaken copy, and the count of codes left is always true.
// Pure string work, so it runs in the popup and in the Node tests.

const backupCodes = (() => {
  // One code: 6 to 32 letters and digits, with "-" or a single space inside,
  // and at least one digit. The digit rule keeps out the words in a pasted
  // heading ("Save these codes somewhere safe").
  const looksLikeCode = (t) => {
    const core = t.replace(/[-\s]/g, '');
    return /^[A-Za-z0-9-]+$/.test(t) && core.length >= 6 && core.length <= 32 && /\d/.test(core);
  };

  // The codes in a pasted block, in order, without repeats. Handles one per
  // line, several per line, numbered or bulleted lists, and Google's
  // "1234 5678" (one code with a space in it).
  function parse(text) {
    const out = [];
    const add = (c) => { if (looksLikeCode(c.replace(/ /g, '')) && !out.includes(c)) out.push(c); };
    for (let line of String(text || '').split(/\r?\n/)) {
      line = line.trim().replace(/^(?:\d{1,2}[.)]|[-*•])\s+/, '');
      if (!line) continue;
      for (const part of line.split(/\s{2,}|\t|[,;|]/).map((s) => s.trim()).filter(Boolean)) {
        const tokens = part.split(/\s+/);
        // Google's codes: two groups of four digits, one code.
        if (tokens.length === 2 && tokens.every((t) => /^\d{4}$/.test(t))) { add(tokens.join(' ')); continue; }
        // A line of words with a code in it is a heading, not codes: only
        // take a part when every word in it is a code.
        if (tokens.every((t) => looksLikeCode(t))) tokens.forEach(add);
      }
    }
    return out;
  }

  // Codes pasted into an item that may already have some. `replace`: the site
  // made a new set, so the old ones no longer work and go. Otherwise new codes
  // are added and the ones already there keep their used state.
  function merge(existing = [], pasted, { replace = false } = {}) {
    const fresh = parse(pasted);
    if (replace && fresh.length) return fresh.map((c) => ({ c, used: null }));
    const out = existing.map((x) => ({ ...x }));
    for (const c of fresh) if (!out.some((x) => x.c === c)) out.push({ c, used: null });
    return out;
  }

  const left = (list = []) => list.filter((x) => !x.used).length;

  // Marking used, and back. Returns a new list; nothing is changed in place.
  const setUsed = (list, code, used) => list.map((x) => (x.c === code ? { ...x, used: used ? new Date().toISOString() : null } : x));

  // How the count reads, and whether it is time to make new codes.
  function summary(list = []) {
    const n = left(list), total = list.length;
    if (!total) return { text: '', low: false };
    return { text: `${n} of ${total} codes left`, low: n <= 2 };
  }

  return { parse, merge, left, setUsed, summary, LOW: 2 };
})();

if (typeof module !== 'undefined') module.exports = backupCodes;
