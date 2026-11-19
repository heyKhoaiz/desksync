// Markdown tests for extension/lib/markdown.js.
//
// Runs the real markdown.js inside a vm. render() and plain() are pure string work
// and need nothing; fromHtml() walks a DOM, so those cases run only when a DOMParser
// is available (Node 22+ has one behind --experimental-... on some builds, and
// jsdom is not a dependency here). Skipped cases are reported, not silently passed.
//   node tests/markdown.test.js      (or: make test-ext)
const vm = require('vm');
const fs = require('fs');
const assert = require('assert');

const ctx = vm.createContext({ console, DOMParser: globalThis.DOMParser, Node: globalThis.Node });
vm.runInContext(fs.readFileSync(__dirname + '/../extension/lib/markdown.js', 'utf8'), ctx);
// A top-level `const` in a vm script is not a property of its global, so ask for it.
const md = vm.runInContext('md', ctx);

let pass = 0, fail = 0, skip = 0;
function test(name, fn) {
  try { fn(); console.log('  ok  ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; }
}
function testDom(name, fn) {
  if (!ctx.DOMParser) { console.log('  --  ' + name + ' (no DOMParser in this Node)'); skip++; return; }
  test(name, fn);
}

console.log('markdown');

// ---------- escaping ----------
test('html in a note is escaped, not rendered', () => {
  const out = md.render('<img src=x onerror=alert(1)>');
  assert.ok(!out.includes('<img'), 'tag survived: ' + out);
  assert.ok(out.includes('&lt;img'), out);
});

test('a blockquote marker is not eaten by escaping', () => {
  // Regression: escaping the whole source up front turned "> q" into "&gt; q",
  // so the blockquote rule never matched and the > showed up literally.
  assert.strictEqual(md.render('> quoted'), '<blockquote>quoted</blockquote>');
});

test('a javascript: link is rendered as text, not a link', () => {
  const out = md.render('[click](javascript:alert(1))');
  assert.ok(!out.includes('<a '), out);
  assert.ok(out.includes('click'), out);
});

// ---------- blocks ----------
test('headings, only up to three levels', () => {
  assert.strictEqual(md.render('# One'), '<h1>One</h1>');
  assert.strictEqual(md.render('### Three'), '<h3>Three</h3>');
  assert.ok(md.render('#### Four').startsWith('<p>'), 'h4 should stay a paragraph');
});

test('a bullet list becomes one ul', () => {
  const out = md.render('- a\n- b');
  assert.strictEqual(out, '<ul><li>a</li><li>b</li></ul>');
});

test('a numbered list becomes one ol', () => {
  assert.strictEqual(md.render('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
});

test('task list draws boxes and strikes the done ones', () => {
  const out = md.render('- [x] done\n- [ ] todo');
  assert.ok(out.includes('class="tasks"'), out);
  assert.ok(out.includes('<li class="done">'), out);
  assert.ok(out.includes('box on'), out);
});

test('a blank line ends a list', () => {
  const out = md.render('- a\n\nafter');
  assert.strictEqual(out, '<ul><li>a</li></ul><p>after</p>');
});

test('fenced code keeps its characters', () => {
  const out = md.render('```\nif (a < b) { x(); }\n```');
  assert.ok(out.includes('<pre><code>'), out);
  assert.ok(out.includes('a &lt; b'), out);
});

test('an unclosed fence still closes', () => {
  assert.ok(md.render('```\nstuck').includes('</code></pre>'));
});

test('a rule is a rule', () => {
  assert.strictEqual(md.render('---'), '<hr>');
});

// ---------- inline ----------
test('bold, italic, strike, highlight', () => {
  assert.ok(md.render('**b**').includes('<strong>b</strong>'));
  assert.ok(md.render('*i*').includes('<em>i</em>'));
  assert.ok(md.render('~~s~~').includes('<del>s</del>'));
  assert.ok(md.render('==h==').includes('<mark>h</mark>'));
});

test('a star inside a code span is not emphasis', () => {
  const out = md.render('`a * b * c`');
  assert.ok(!out.includes('<em>'), out);
  assert.ok(out.includes('<code>a * b * c</code>'), out);
});

test('bold wins over italic on the same run', () => {
  assert.ok(md.render('**bold**').includes('<strong>bold</strong>'));
});

test('an http link gets noopener', () => {
  const out = md.render('[x](https://example.com)');
  assert.ok(out.includes('rel="noopener noreferrer"'), out);
  assert.ok(out.includes('target="_blank"'), out);
});

// ---------- plain ----------
test('plain strips markup for the list row', () => {
  assert.strictEqual(md.plain('## Title\n\n- [ ] **do** `this`'), 'Title do this');
});

test('plain drops fenced code rather than inlining it', () => {
  assert.strictEqual(md.plain('before\n```\nnoise\n```\nafter'), 'before after');
});

// ---------- legacy HTML notes ----------
testDom('legacy html converts to markdown', () => {
  assert.strictEqual(md.fromHtml('<b>bold</b>'), '**bold**');
  assert.strictEqual(md.fromHtml('<i>it</i>'), '*it*');
  assert.strictEqual(md.fromHtml('<s>no</s>'), '~~no~~');
});

testDom('a legacy bullet list converts', () => {
  assert.strictEqual(md.fromHtml('<ul><li>a</li><li>b</li></ul>'), '- a\n- b');
});

testDom('a legacy numbered list is renumbered', () => {
  assert.strictEqual(md.fromHtml('<ol><li>a</li><li>b</li></ol>'), '1. a\n2. b');
});

testDom('underline and highlight both become ==', () => {
  assert.strictEqual(md.fromHtml('<u>u</u>'), '==u==');
  assert.strictEqual(md.fromHtml('<span style="background-color:#fde047">h</span>'), '==h==');
});

testDom('a round trip through fromHtml then render keeps the text', () => {
  const out = md.render(md.fromHtml('<div>Hello <b>world</b></div>'));
  assert.ok(out.includes('<strong>world</strong>'), out);
  assert.ok(out.includes('Hello'), out);
});

testDom('toMarkdown picks the right source for each format', () => {
  assert.strictEqual(md.toMarkdown({ format: 'markdown', body: '**x**' }), '**x**');
  assert.strictEqual(md.toMarkdown({ format: 'html', body: '<b>x</b>' }), '**x**');
});

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ''}${skip ? `, ${skip} skipped` : ''}`);
process.exit(fail ? 1 : 0);
