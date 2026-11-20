// Tests for extension/lib/sites.js: matching logins to pages, reading exports.
//   node tests/sites.test.js      (or: make test-ext)
const assert = require('assert');
const sites = require('../extension/lib/sites.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('  ok  ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; }
}
const eq = (a, b) => assert.deepStrictEqual(a, b);

console.log('sites: which logins belong on a page');
test('the same site', () => eq(sites.matches('https://github.com/login', 'github.com'), true));
test('www. does not matter', () => eq(sites.matches('https://www.github.com', 'github.com'), true));
test('a login for a site fills on its subdomains', () => eq(sites.matches('github.com', 'gist.github.com'), true));
test('but not the other way', () => eq(sites.matches('https://gist.github.com', 'github.com'), false));
test('nor on a sibling', () => eq(sites.matches('https://a.example.com', 'b.example.com'), false));
test('a look-alike domain is not a match', () => eq(sites.matches('https://github.com', 'github.com.evil.io'), false));
test('nor a name that merely ends the same', () => eq(sites.matches('https://hub.com', 'github.com'), false));
test('no page, no match', () => eq(sites.matches('https://github.com', null), false));

console.log('\nsites: reading a password export');
test('Chrome\'s export', () => {
  const r = sites.loginsFromCsv('name,url,username,password,note\ngithub.com,https://github.com/,me,pw1,\nInstagram,https://www.instagram.com/,brand_a,"p,w ""2""",client A\n');
  eq(r.logins.map((l) => [l.title, l.url, l.username, l.password, l.notes]),
    [['github.com', 'https://github.com/', 'me', 'pw1', ''], ['Instagram', 'https://www.instagram.com/', 'brand_a', 'p,w "2"', 'client A']]);
  eq(r.skipped, 0);
});
test('columns found by name, in any order', () => {
  const r = sites.loginsFromCsv('login_password,login_username,login_uri,title\nsecret,me,https://x.com,X');
  eq(r.logins[0], { title: 'X', url: 'https://x.com', username: 'me', password: 'secret', notes: '', tags: [] });
});
test('a note with a line break inside quotes', () => eq(sites.loginsFromCsv('name,url,username,password,note\na,https://a.com,u,p,"line one\nline two"').logins[0].notes, 'line one\nline two'));
test('Windows line endings and a byte-order mark', () => eq(sites.loginsFromCsv('﻿name,url,username,password\r\na,https://a.com,u,p\r\n').logins.length, 1));
test('a row with neither username nor password is skipped', () => eq(sites.loginsFromCsv('name,url,username,password\na,https://a.com,,').skipped, 1));
test('a file that is not an export says so', () => eq(!!sites.loginsFromCsv('date,amount\n1,2').error, true));
test('the same login is recognised', () => eq(sites.sameLogin({ url: 'https://www.github.com/x', username: 'me' }, { url: 'github.com', username: 'me' }), true));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
