// Tests for extension/lib/health.js: password strength, reuse and 2FA codes.
//   node tests/health.test.js      (or: make test-ext)
const assert = require('assert');
const health = require('../extension/lib/health.js');

let pass = 0, fail = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }
const eq = (a, b) => assert.deepStrictEqual(a, b);

test('an empty password is weak', () => eq(health.strength('').level, 'weak'));
test('a short password is weak', () => eq(health.strength('Ab1!x').level, 'weak'));
test('a common password is weak, however it is dressed up', () => eq(health.strength('Password123456!').level, 'weak'));
test('a run of digits is weak', () => eq(health.strength('12345678').level, 'weak'));
test('a word with a year is weak', () => eq(health.strength('summer2024').level, 'weak'));
test('a capitalised word, digits and a ! is weak', () => eq(health.strength('Dragon99!').level, 'weak'));
test('a medium mixed password is fair', () => eq(health.strength('Tulip7garden').level, 'fair'));
test('a generated password is strong', () => eq(health.strength('x7#kP9!mQ2vT8$wZ3@nL').level, 'strong'));

test('logins sharing a password point at each other', () => {
  const r = health.reused([{ id: 'a', password: 'same' }, { id: 'b', password: 'same' }, { id: 'c', password: 'other' }, { id: 'd', password: '' }]);
  eq(r.get('a'), ['b']); eq(r.get('b'), ['a']); eq(r.has('c'), false); eq(r.has('d'), false);
});

test('a setup key with spaces is read', () =>
  eq(health.parseOtp('jbsw y3dp ehpk 3pxp'), { secret: 'JBSWY3DPEHPK3PXP', digits: 6, period: 30, algorithm: 'SHA-1' }));
test('an otpauth link is read with its settings', () =>
  eq(health.parseOtp('otpauth://totp/GitHub:me?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&digits=8&period=60&algorithm=SHA256'),
    { secret: 'JBSWY3DPEHPK3PXP', digits: 8, period: 60, algorithm: 'SHA-256' }));
test('text that is not a key is refused', () => eq(health.parseOtp('hello world!'), null));
test('a key too short to be real is refused', () => eq(health.parseOtp('ABCD'), null));
test('an HOTP link is refused', () => eq(health.parseOtp('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1'), null));

const WORDS = require('../extension/lib/words.js');
test('the word list is the EFF short list, minus yo-yo', () => {
  eq(WORDS.length, 1295); eq(new Set(WORDS).size, 1295); eq(WORDS.every((w) => /^[a-z]+$/.test(w)), true);
});
test('a passphrase has the words asked for and a number', () => {
  const p = health.passphrase(WORDS, 5).split('-');
  eq(p.length, 6); eq(p.slice(0, 5).every((w) => WORDS.includes(w)), true); eq(/^[1-9][0-9]$/.test(p[5]), true);
});
test('passphrases differ each time', () => eq(health.passphrase(WORDS) === health.passphrase(WORDS), false));
test('a five-word passphrase rates strong', () => eq(health.strength(health.passphrase(WORDS, 5)).level, 'strong'));

// RFC 6238 appendix B, SHA-1 secret "12345678901234567890", 8 digits.
const RFC = { secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', digits: 8, period: 30, algorithm: 'SHA-1' };
test('RFC 6238 vector at 59 s', async () => eq((await health.otpCode(RFC, 59 * 1000)).code, '94287082'));
test('RFC 6238 vector at 1111111109 s', async () => eq((await health.otpCode(RFC, 1111111109 * 1000)).code, '07081804'));
test('RFC 6238 vector at 20000000000 s', async () => eq((await health.otpCode(RFC, 20000000000 * 1000)).code, '65353130'));
test('seconds left count down to the next code', async () => eq((await health.otpCode(RFC, 59 * 1000)).left, 1));

(async () => {
  console.log('health: strength, reuse, 2FA codes');
  for (const [name, fn] of queue) {
    try { await fn(); console.log('  ok  ' + name); pass++; }
    catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
