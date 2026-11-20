// Tests for extension/lib/format.js: **bold** and _italic_ in a plain-text note.
//   node tests/format.test.js      (or: make test-ext)
const assert = require('assert');
const fmt = require('../extension/lib/format.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('  ok  ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; }
}
const eq = (a, b) => assert.deepStrictEqual(a, b);
// Apply a wrap/lines result to the text, the way the editor does.
const apply = (text, r) => text.slice(0, r.start) + r.insert + text.slice(r.end);

console.log('format: reading');
test('bold is found, markers apart', () => eq(fmt.inlineMarks('a **big** day').map((m) => m.cls), ['mk', 'b', 'mk']));
test('italic is found', () => eq(fmt.inlineMarks('so _very_ good').find((m) => m.cls === 'em'), { from: 4, to: 8, cls: 'em' }));
test('snake_case is not italic', () => eq(fmt.hasInline('call get_user_name now'), false));
test('a lone ** is not bold', () => eq(fmt.hasInline('2 ** 3 is 8'), false));
test('bold does not cross a line', () => eq(fmt.hasInline('**start\nend**'), false));
test('a space before the closing ** keeps it bold', () => eq(fmt.strip('**vadsvdas;vlamdsv **'), 'vadsvdas;vlamdsv '));
test('an empty pair is not bold', () => eq(fmt.hasInline('****'), false));
test('B takes bold off "**word **" too', () => eq(apply('**word **', fmt.wrap('**word **', 2, 6, '**')), 'word '));
test('strip takes the markers off', () => eq(fmt.strip('a **big** and _small_ day'), 'a big and small day'));

console.log('\nformat: HTML for the clipboard');
test('bold and italic become tags', () => eq(fmt.toHtml('a **big** _day_'), '<div>a <b>big</b> <i>day</i></div>'));
test('tasks become boxes', () => eq(fmt.toHtml('[ ] milk\n[x] eggs'), '<div>☐ milk<br>☑ eggs</div>'));
test('HTML in the note is escaped', () => eq(fmt.toHtml('<script> **x**'), '<div>&lt;script&gt; <b>x</b></div>'));

console.log('\nformat: bold and italic on a selection');
const t = 'make it bold now';
test('wraps the selection', () => {
  const r = fmt.wrap(t, 8, 12, '**');
  eq(apply(t, r), 'make it **bold** now');
  eq([r.selFrom, r.selTo], [10, 14]);
});
test('a second press takes it off', () => {
  const t2 = 'make it **bold** now';
  eq(apply(t2, fmt.wrap(t2, 10, 14, '**')), t);
});
test('so does selecting the markers too', () => {
  const t2 = 'make it **bold** now';
  eq(apply(t2, fmt.wrap(t2, 8, 16, '**')), t);
});
test('spaces at the edges stay outside', () => eq(apply(t, fmt.wrap(t, 7, 13, '**')), 'make it **bold** now'));
test('nothing selected puts the caret between a pair', () => {
  const r = fmt.wrap('ab', 1, 1, '_');
  eq([apply('ab', r), r.selFrom], ['a__b', 2]);
});
test('italic inside bold is its own thing', () => {
  const t2 = '**big day**';
  eq(apply(t2, fmt.wrap(t2, 2, 5, '_')), '**_big_ day**');
});
test('bold comes off text that is also italic', () => {
  const t2 = 'a **_big_** day';
  const r = fmt.wrap(t2, 5, 8, '**');
  eq(apply(t2, r), 'a _big_ day');
  eq(apply(t2, r).slice(r.selFrom, r.selTo), 'big');
});
test('and italic comes off text that is also bold', () => {
  const t2 = 'a _**big**_ day';
  eq(apply(t2, fmt.wrap(t2, 5, 8, '_')), 'a **big** day');
});
test('isOn sees bold through the italic inside it', () => eq(fmt.isOn('a **_big_** day', 5, 8, '**'), true));
test('bold over part of a bold word merges into one run', () => {
  const t2 = '**bold** plain';
  const out = apply(t2, fmt.wrap(t2, 4, 11, '**'));
  eq(out, '**bold pl**ain');
  eq(fmt.strip(out), 'bold plain');
});
test('bold over a line that already holds bold merges it', () => eq(apply('x **a** y', fmt.wrap('x **a** y', 0, 9, '**')), '**x a y**'));
test('italic inside a word takes the whole word', () => {
  const out = apply('foo_bar', fmt.wrap('foo_bar', 4, 7, '_'));
  eq([out, fmt.hasInline(out)], ['_foo_bar_', true]);
});
test('several lines are wrapped one by one, after their list markers', () => {
  const t2 = '[ ] milk\n- eggs';
  eq(apply(t2, fmt.wrap(t2, 0, t2.length, '**')), '[ ] **milk**\n- **eggs**');
});
test('and unwrapped the same way', () => {
  const t2 = '[ ] **milk**\n- **eggs**';
  eq(apply(t2, fmt.wrap(t2, 0, t2.length, '**')), '[ ] milk\n- eggs');
});
test('isOn says whether it is already bold', () => {
  eq(fmt.isOn('a **b** c', 4, 5, '**'), true);
  eq(fmt.isOn('a b c', 2, 3, '**'), false);
});

console.log('\nformat: lines');
test('selected lines become tasks', () => {
  const t2 = 'milk\n\neggs';
  eq(apply(t2, fmt.lines(t2, 0, t2.length, 'task')), '[ ] milk\n\n[ ] eggs');
});
test('a partly selected line counts', () => eq(apply('milk\neggs', fmt.lines('milk\neggs', 2, 7, 'bullet')), '- milk\n- eggs'));
test('lines that already are tasks lose the boxes', () => eq(apply('[x] a\n[ ] b', fmt.lines('[x] a\n[ ] b', 0, 11, 'task')), 'a\nb'));
test('only the lines the selection touches change', () => eq(apply('[x] a\n[ ] b', fmt.lines('[x] a\n[ ] b', 0, 5, 'task')), 'a\n[ ] b'));
test('lines become a numbered list, counting from 1', () =>
  eq(apply('a\n\nb\nc', fmt.lines('a\n\nb\nc', 0, 7, 'number')), '1. a\n\n2. b\n3. c'));
test('and back again', () => eq(apply('1. a\n2. b', fmt.lines('1. a\n2. b', 0, 9, 'number')), 'a\nb'));
test('bullets become tasks', () => eq(apply('- a\n- b', fmt.lines('- a\n- b', 0, 7, 'task')), '[ ] a\n[ ] b'));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
