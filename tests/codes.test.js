// Tests for extension/lib/codes.js: backup codes kept with a vault login.
//   node tests/codes.test.js      (or: make test-ext)
const assert = require('assert');
const codes = require('../extension/lib/codes.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('  ok  ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; }
}
const eq = (a, b) => assert.deepStrictEqual(a, b);

console.log('codes: reading a pasted block');
test('Google: two groups of four digits are one code', () =>
  eq(codes.parse('1234 5678\n2345 6789\n3456 7890'), ['1234 5678', '2345 6789', '3456 7890']));
test('GitHub: hyphenated codes, one per line', () =>
  eq(codes.parse('a1b2c-3d4e5\nf6a7b-8c9d0'), ['a1b2c-3d4e5', 'f6a7b-8c9d0']));
test('a numbered list', () => eq(codes.parse('1. abcd1234\n2) efgh5678'), ['abcd1234', 'efgh5678']));
test('several to a line, by tabs or wide spaces', () =>
  eq(codes.parse('1234 5678\t2345 6789\nabcd1234    efgh5678'), ['1234 5678', '2345 6789', 'abcd1234', 'efgh5678']));
test('headings and blank lines are left out', () =>
  eq(codes.parse('Your backup codes\n\nSave these somewhere safe.\n1234 5678\nGenerated on 2026-11-20 for you\n'), ['1234 5678']));
test('repeats are taken once', () => eq(codes.parse('abcd1234\nabcd1234'), ['abcd1234']));
test('words alone are not codes', () => eq(codes.parse('password\nletmein'), []));
test('Windows line endings', () => eq(codes.parse('abcd1234\r\nefgh5678\r\n'), ['abcd1234', 'efgh5678']));

console.log('\ncodes: keeping them');
const mk = (...c) => c.map((x) => ({ c: x, used: null }));
test('new codes are added, old ones keep their used state', () => {
  const old = [{ c: 'abcd1234', used: '2026-01-01T00:00:00.000Z' }];
  eq(codes.merge(old, 'abcd1234\nefgh5678'), [{ c: 'abcd1234', used: '2026-01-01T00:00:00.000Z' }, { c: 'efgh5678', used: null }]);
});
test('a new set replaces the old one', () => eq(codes.merge(mk('abcd1234'), 'zzzz9999', { replace: true }), mk('zzzz9999')));
test('replacing with nothing usable keeps what was there', () => eq(codes.merge(mk('abcd1234'), 'no codes here', { replace: true }), mk('abcd1234')));
test('marking used, and back', () => {
  const used = codes.setUsed(mk('a1b2c3', 'd4e5f6'), 'a1b2c3', true);
  eq([codes.left(used), !!used[0].used], [1, true]);
  eq(codes.left(codes.setUsed(used, 'a1b2c3', false)), 2);
});
test('the summary counts what is left', () => eq(codes.summary(codes.setUsed(mk('a1b2c3', 'd4e5f6', 'g7h8i9'), 'a1b2c3', true)).text, '2 of 3 codes left'));
test('and says when it is time to make new ones', () => {
  eq(codes.summary(mk('a1b2c3', 'd4e5f6')).low, true);
  eq(codes.summary(mk('a1b2c3', 'd4e5f6', 'g7h8i9')).low, false);
});
test('no codes, no summary', () => eq(codes.summary([]), { text: '', low: false }));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
