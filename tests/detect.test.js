// Tests for extension/lib/detect.js: is this clip a secret, is it code.
//
// The fake credentials are put together from pieces so that no secret scanner
// (GitHub push protection included) mistakes this file for a leak.
//   node tests/detect.test.js      (or: make test-ext)
const assert = require('assert');
const detect = require('../extension/lib/detect.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('  ok  ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; }
}
const secret = (name, s) => test(name, () => assert.strictEqual(detect.isSecret(s), true, s));
const notSecret = (name, s) => test(name, () => assert.strictEqual(detect.isSecret(s), false, s));
const code = (name, s) => test(name, () => assert.strictEqual(detect.isCode(s), true, s));
const notCode = (name, s) => test(name, () => assert.strictEqual(detect.isCode(s), false, s));

const R = 'Zq7Xk2Lm9Pw4Rt8Yv3Bn6Hc1Jd5Fg0Ts';   // 32 mixed characters

console.log('detect: secrets');
secret('an AWS access key id', 'AKIA' + 'IOSFODNN7EXAMPLE');
secret('a GitHub token', 'gh' + 'p_' + R + 'abcd');
secret('an OpenAI-style key', 'sk-' + 'proj-' + R);
secret('an Anthropic-style key', 'sk-' + 'ant-api03-' + R);
secret('a Stripe secret key', 'sk' + '_live_' + R);
secret('a Slack token', 'xo' + 'xb-1234567890-' + R);
secret('a Google API key', 'AI' + 'za' + R + 'abc');
secret('a JWT', 'ey' + 'JhbGciOiJIUzI1NiJ9.ey' + 'JzdWIiOiIxMjM0NTY3ODkwIn0.' + R);
secret('a PEM private key', '-----BEGIN ' + 'RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----');
secret('a database URL with a password', 'postgres://admin:' + 'hunter2pass@db.example.com:5432/app');
secret('an env line', 'STRIPE_SECRET_KEY=' + R);
secret('a JSON key/value', '"api_key": "' + R + '"');
secret('a long random token with no prefix', R + 'Qw8');

notSecret('an ordinary sentence', 'Remember to email Sam about the launch on Friday.');
notSecret('a URL', 'https://example.com/docs/getting-started?ref=nav');
notSecret('an address', '14 Rosewood Avenue, Flat 2, Manchester M14 5TP');
notSecret('a UUID', '3f2504e0-4f89-11d3-9a0c-0305e82c3301');
notSecret('a git commit hash', 'f081af3c9e2b8d7a6f5e4d3c2b1a0f9e8d7c6b5a');
notSecret('a shell command', 'npx supabase gen types typescript --project-id abcdefgh > types.ts');
notSecret('a placeholder in docs', 'API_KEY=<your key here>');
notSecret('a file path', '/home/user/projects/desksync/extension/lib/detect.js');
notSecret('an empty string', '');
notSecret('a short word', 'password');

test('mask keeps the ends and hides the middle', () => {
  const m = detect.mask('sk-' + 'proj-' + R);
  assert.ok(m.startsWith('sk-p') && m.endsWith(R.slice(-4)) && m.includes('••••'), m);
  assert.ok(!m.includes(R.slice(4, 20)), m);
});
test('mask hides a short value entirely', () => {
  assert.strictEqual(detect.mask('abc123'), '••••••••');
});

console.log('\ndetect: code');
code('a shell command', 'npx supabase gen types typescript --project-id abcdefgh > types.ts');
code('a prompt-prefixed command', '$ git push origin main');
code('a line of JS', 'const user = await getUser(id);');
code('an arrow function', 'items.map((i) => i.id)');
code('a block of code', 'function add(a, b) {\n  return a + b;\n}');
code('a SQL query', 'SELECT id, title FROM notes WHERE user_id = $1;');
code('an HTML snippet', '<div class="card">\n  <h2>Title</h2>\n</div>');
notCode('a sentence', 'Remember to email Sam about the launch on Friday.');
notCode('an address', '14 Rosewood Avenue, Flat 2, Manchester M14 5TP');
notCode('a paragraph of prose', 'We tried the new onboarding.\nIt went well.\nUsers finished it faster than before.');
notCode('marketing copy', 'Save hours every week. Try it free today!');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
