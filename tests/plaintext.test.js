// Tests for extension/lib/plaintext.js.
//
// Notes are plain text now; this file only has to prove that the notes written
// by the two editors that came before — HTML and markdown — still read as words
// when they are opened. fromMarkdown() is pure string work and needs nothing;
// fromHtml() walks a DOM, so those cases run only when a DOMParser is available.
// Skipped cases are reported, not silently passed.
//   node tests/plaintext.test.js      (or: make test-ext)
const vm = require('vm');
const fs = require('fs');
const assert = require('assert');

const ctx = vm.createContext({ console, DOMParser: globalThis.DOMParser, Node: globalThis.Node });
vm.runInContext(fs.readFileSync(__dirname + '/../extension/lib/plaintext.js', 'utf8'), ctx);
// A top-level `const` in a vm script is not a property of its global, so ask for it.
const txt = vm.runInContext('txt', ctx);

let pass = 0, fail = 0, skip = 0;
function test(name, fn) {
  try { fn(); console.log('  ok  ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; }
}
function testDom(name, fn) {
  if (!ctx.DOMParser) { console.log('  --  ' + name + ' (no DOMParser in this Node)'); skip++; return; }
  test(name, fn);
}

console.log('plaintext');

// ---------- a plain note is left alone ----------
test('a plain note comes back character for character', () => {
  const body = '  two  spaces\n\n* not a list *\n# not a heading\n';
  assert.strictEqual(txt.toPlain({ format: 'plain', body }), body);
});

test('a row with no format is treated as plain', () => {
  assert.strictEqual(txt.toPlain({ body: 'just words' }), 'just words');
});

test('an empty note is an empty string, not undefined', () => {
  assert.strictEqual(txt.toPlain({ format: 'plain' }), '');
  assert.strictEqual(txt.toPlain(null), '');
});

// ---------- the one-line preview ----------
test('toText collapses a note onto one line', () => {
  assert.strictEqual(txt.toText({ format: 'plain', body: 'one\n\ntwo   three\n' }), 'one two three');
});

// ---------- legacy markdown ----------
test('headings lose their hashes', () => {
  assert.strictEqual(txt.toPlain({ format: 'markdown', body: '## Shopping' }), 'Shopping');
});

test('bold, italic, strike, highlight and code lose their marks', () => {
  assert.strictEqual(
    txt.toPlain({ format: 'markdown', body: '**bold** *it* ~~out~~ ==hi== `code`' }),
    'bold it out hi code');
});

test('a checklist keeps its boxes as text', () => {
  assert.strictEqual(
    txt.toPlain({ format: 'markdown', body: '- [ ] milk\n- [x] bread' }),
    '[ ] milk\n[x] bread');
});

test('a bullet list keeps its dashes', () => {
  assert.strictEqual(txt.toPlain({ format: 'markdown', body: '* one\n- two' }), '- one\n- two');
});

test('a quote loses its angle bracket', () => {
  assert.strictEqual(txt.toPlain({ format: 'markdown', body: '> quoted' }), 'quoted');
});

test('a link keeps both the label and the address', () => {
  assert.strictEqual(
    txt.toPlain({ format: 'markdown', body: '[Docs](https://example.com)' }),
    'Docs (https://example.com)');
});

test('a fenced block keeps its code, without the fences', () => {
  assert.strictEqual(
    txt.toPlain({ format: 'markdown', body: '```\nrun me\n```' }),
    'run me');
});

// ---------- legacy HTML ----------
testDom('paragraphs become lines', () => {
  assert.strictEqual(txt.toPlain({ format: 'html', body: '<p>one</p><p>two</p>' }), 'one\ntwo');
});

testDom('a <br> breaks the line', () => {
  assert.strictEqual(txt.toPlain({ format: 'html', body: 'one<br>two' }), 'one\ntwo');
});

testDom('tags are dropped, their words are kept', () => {
  assert.strictEqual(
    txt.toPlain({ format: 'html', body: '<p><strong>bold</strong> and <em>italic</em></p>' }),
    'bold and italic');
});

testDom('a list item keeps a dash', () => {
  assert.strictEqual(txt.toPlain({ format: 'html', body: '<ul><li>one</li><li>two</li></ul>' }), '- one\n- two');
});

testDom('an old tick box becomes text', () => {
  assert.strictEqual(
    txt.toPlain({ format: 'html', body:
      '<ul class="tasks"><li><span class="box on"></span><span>done it</span></li></ul>' }),
    '[x] done it');
});

testDom('a heading is just its words', () => {
  assert.strictEqual(txt.toPlain({ format: 'html', body: '<h2>Shopping</h2><p>milk</p>' }), 'Shopping\nmilk');
});

// ---------- escaping ----------
test('escape() still guards anything put into innerHTML', () => {
  assert.strictEqual(txt.escape('<img src=x onerror=1>'), '&lt;img src=x onerror=1&gt;');
});

console.log(`\n${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ''}\n`);
process.exit(fail ? 1 : 0);
