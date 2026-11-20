// Tests for extension/lib/tags.js: the rules for tag names.
//   node tests/tags.test.js      (or: make test-ext)
const assert = require('assert');
const tagRules = require('../extension/lib/tags.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('  ok  ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; }
}
const eq = (a, b) => assert.deepStrictEqual(a, b);
const n = tagRules.normalize;

console.log('tags: names');
test('lower case', () => eq(n('Work'), 'work'));
test('a leading # is dropped', () => eq(n('##launch'), 'launch'));
test('spaces become one hyphen', () => eq(n('  Weekly   Shop '), 'weekly-shop'));
test('dots and slashes become hyphens', () => eq(n('v2.1/beta'), 'v2-1-beta'));
test('punctuation is removed', () => eq(n('Q&A! (draft)'), 'qa-draft'));
test('hyphens and underscores are kept, not doubled', () => eq(n('to--do__list'), 'to-do__list'));
test('no hyphen at either end', () => eq(n('-launch-'), 'launch'));
test('Bangla works, vowel signs and all', () => eq(n('কাজের তালিকা'), 'কাজের-তালিকা'));
test('Arabic works', () => eq(n('عمل'), 'عمل'));
test('numbers on their own are fine', () => eq(n('2026'), '2026'));
test('emoji are not tag characters', () => eq(n('🔥hot'), 'hot'));
test('nothing usable is empty', () => eq(n('!!!'), ''));
test('32 characters at most', () => eq(n('a'.repeat(40)).length, 32));
test('shortening never leaves a hyphen at the end', () => eq(n('a'.repeat(31) + '-bbbb'), 'a'.repeat(31)));
test('the limit counts characters, not bytes', () => eq([...n('ক'.repeat(40))].length, 32));

console.log('\ntags: adding to an item');
test('a new name is fine', () => eq(tagRules.check('Home', ['work']), { ok: true, name: 'home', reason: '' }));
test('one already on the item is refused', () => eq(tagRules.check('#Work', ['work']).reason, 'Already on this item'));
test('the eleventh tag is refused', () => eq(tagRules.check('x', Array.from({ length: 10 }, (_, i) => 't' + i)).reason, 'Up to 10 tags on one item'));
test('a name with no letters or numbers is refused', () => eq(tagRules.check('???', []).reason, 'Use letters or numbers'));
test('a long name is taken, and says it was shortened', () => {
  const r = tagRules.check('a'.repeat(50), []);
  eq([r.ok, r.name.length, r.reason], [true, 32, 'Shortened to 32 characters']);
});
test('an empty box says nothing', () => eq(tagRules.check('  ', []), { ok: false, name: '', reason: '' }));

console.log('\ntags: lists and search');
test('a list is cleaned: normalised, no repeats, no empties', () => eq(tagRules.clean(['Work', 'work', '', '!!', 'Home']), ['work', 'home']));
test('and capped at 10', () => eq(tagRules.clean(Array.from({ length: 14 }, (_, i) => 't' + i)).length, 10));
test('#tags come out of a search', () => eq(tagRules.fromQuery('milk #Home #weekly-shop'), { text: 'milk', tags: ['home', 'weekly-shop'] }));
test('a # in the middle of a word is not a tag', () => eq(tagRules.fromQuery('foo#work bar'), { text: 'foo#work bar', tags: [] }));
test('a Bangla #tag is found in a search', () => eq(tagRules.fromQuery('#কাজ রিপোর্ট').tags, ['কাজ']));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
