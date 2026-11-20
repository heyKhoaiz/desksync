// The rules for tag names, in one place.
//
//   - Letters in any language, numbers, "-" and "_". Bangla, Arabic or
//     Chinese tags work like English ones, combining marks included.
//   - Spaces, "." and "/" become "-": "Weekly Shop" is "weekly-shop".
//   - Lower case, so "Work" and "work" are one tag.
//   - 1 to 32 characters. A longer name is shortened, not refused.
//   - Up to 10 tags on one item.
//
// The phone app applies the same rules (mobile/lib/data/models.dart,
// parseTags), so a tag made on either is the same tag. Pure string work: runs
// in the popup and in the Node tests.

const tagRules = (() => {
  const MAX_LEN = 32;
  const MAX_PER_ITEM = 10;
  // One tag character. \p{M} keeps vowel signs and other combining marks,
  // without which most Indic scripts cannot be written.
  const CHAR = '[\\p{L}\\p{N}\\p{M}_-]';
  // A #tag inside the search box: at the start of a word only, so "foo#work"
  // is a word to search for, not a tag the chip could never switch off.
  const IN_QUERY = new RegExp(`(^|\\s)#(${CHAR}+)`, 'gu');

  function normalize(raw) {
    let t = String(raw ?? '').normalize('NFC').trim().replace(/^#+/, '').toLowerCase();
    t = t.replace(/[\s./]+/g, '-')
      .replace(new RegExp(`[^${CHAR.slice(1, -1)}]`, 'gu'), '')
      .replace(/-{2,}/g, '-')
      .replace(/^[-_]+|[-_]+$/g, '');
    if ([...t].length > MAX_LEN) t = [...t].slice(0, MAX_LEN).join('').replace(/[-_]+$/, '');
    return t;
  }

  // Whether a typed name can be added to an item that already has `current`,
  // and if not, why, in words to show beside the box.
  function check(raw, current = []) {
    const name = normalize(raw);
    if (!String(raw ?? '').trim()) return { ok: false, name, reason: '' };
    if (!name) return { ok: false, name, reason: 'Use letters or numbers' };
    if (current.includes(name)) return { ok: false, name, reason: 'Already on this item' };
    if (current.length >= MAX_PER_ITEM) return { ok: false, name, reason: `Up to ${MAX_PER_ITEM} tags on one item` };
    const cut = [...String(raw).trim().replace(/^#+/, '')].length > MAX_LEN && name.length > 0;
    return { ok: true, name, reason: cut ? `Shortened to ${MAX_LEN} characters` : '' };
  }

  // A whole list made to follow the rules: normalised, no repeats, no empties,
  // at most MAX_PER_ITEM, in the order given.
  function clean(list) {
    const out = [];
    for (const t of list || []) {
      const n = normalize(t);
      if (n && !out.includes(n)) out.push(n);
      if (out.length === MAX_PER_ITEM) break;
    }
    return out;
  }

  // The #tags typed in a search, and the text left over.
  function fromQuery(raw) {
    const tags = [];
    const text = String(raw || '').replace(IN_QUERY, (m, pre, t) => { const n = normalize(t); if (n) tags.push(n); return pre || ' '; }).trim();
    return { text, tags };
  }

  return { MAX_LEN, MAX_PER_ITEM, normalize, check, clean, fromQuery };
})();

if (typeof module !== 'undefined') module.exports = tagRules;
