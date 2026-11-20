// Tests for extension/lib/tasks.js: lists and tasks in a plain-text note.
//   node tests/tasks.test.js      (or: make test-ext)
const assert = require('assert');
const tasks = require('../extension/lib/tasks.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('  ok  ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; }
}
const eq = (a, b) => assert.deepStrictEqual(a, b);

console.log('tasks: reading a line');
test('an open task', () => eq(tasks.parse('[ ] milk').checked, false));
test('a ticked task, either case', () => { eq(tasks.parse('[x] milk').checked, true); eq(tasks.parse('[X] milk').checked, true); });
test('an indented task keeps its indent', () => eq(tasks.parse('  [ ] milk').indent, '  '));
test('a bullet', () => eq(tasks.parse('- milk').kind, 'bullet'));
test('a numbered item', () => eq(tasks.parse('3. milk').num, 3));
test('an ordinary line is not a list', () => eq(tasks.parse('milk and eggs'), null));
test('a hyphenated word is not a bullet', () => eq(tasks.parse('-milk'), null));
test('a date is not a numbered item', () => eq(tasks.parse('2026.11.20'), null));

console.log('\ntasks: Enter');
test('Enter on a task starts the next one, unticked', () => eq(tasks.onEnter('[x] milk'), { line: '[x] milk', insert: '\n[ ] ' }));
test('Enter keeps the indent', () => eq(tasks.onEnter('  [ ] milk').insert, '\n  [ ] '));
test('Enter on a bullet continues it', () => eq(tasks.onEnter('- milk').insert, '\n- '));
test('Enter on a numbered item counts on', () => eq(tasks.onEnter('9) milk').insert, '\n10) '));
test('Enter on an empty item ends the list', () => eq(tasks.onEnter('[ ] '), { line: '', insert: '' }));
test('Enter on an empty indented item outdents it', () => eq(tasks.onEnter('    - ').line, '  '));
test('Enter on an ordinary line is left to the browser', () => eq(tasks.onEnter('hello'), null));

console.log('\ntasks: ticking');
test('tick', () => eq(tasks.toggle('[ ] milk'), '[x] milk'));
test('untick', () => eq(tasks.toggle('  [x] milk'), '  [ ] milk'));
test('a bullet becomes a task', () => eq(tasks.toggle('- milk'), '[ ] milk'));
test('a plain line gets a box', () => eq(tasks.toggle('  milk'), '  [ ] milk'));

console.log('\ntasks: progress and order');
test('progress counts tasks only', () => eq(tasks.progress('Shop\n[x] a\n[ ] b\n- c\n[X] d'), { done: 2, total: 3, open: 1 }));
test('a note with no tasks has none', () => eq(tasks.progress('just text').total, 0));
test('ticked items sink within their own list', () => eq(
  tasks.sinkDone('Shop\n[x] a\n[ ] b\n[x] c\n[ ] d\n\nWork\n[x] e\n[ ] f'),
  'Shop\n[ ] b\n[ ] d\n[x] a\n[x] c\n\nWork\n[ ] f\n[x] e'));
test('moving a line down', () => eq(tasks.moveLine('a\nb\nc', 0, 1), 'b\na\nc'));
test('moving past the end does nothing', () => eq(tasks.moveLine('a\nb', 1, 1), null));

console.log('\ntasks: starting a note');
test('a lone empty box is a blank note', () => eq(tasks.isBlank('[ ] '), true));
test('an untouched email template is blank', () => eq(tasks.isBlank(tasks.STARTS.email.text), true));
test('a box with words is not', () => eq(tasks.isBlank('[ ] milk'), false));
test('/task starts a task list', () => eq(tasks.slash('/task'), 'tasks'));
test('/email starts an email', () => eq(tasks.slash(' /Email '), 'email'));
test('a slash in a sentence is nothing', () => eq(tasks.slash('and/or'), null));

console.log('\ntasks: email');
const mail = 'To: sam@example.com, kim@example.com\nCc: boss@example.com\nSubject: Launch & next steps\n\nHi both,\n\nShipping Friday.\n';
test('an email note is read into its parts', () => eq(tasks.parseEmail(mail), {
  to: 'sam@example.com, kim@example.com', cc: 'boss@example.com', bcc: '',
  subject: 'Launch & next steps', body: 'Hi both,\n\nShipping Friday.' }));
test('a note not starting with To: is not an email', () => eq(tasks.parseEmail('Subject: x\n\nhi'), null));
test('an empty template is an email with nothing in it', () =>
  eq(tasks.parseEmail(tasks.STARTS.email.text), { to: '', cc: '', bcc: '', subject: '', body: '' }));
test('mailto keeps every part, encoded', () => eq(tasks.mailtoUrl(tasks.parseEmail(mail)),
  'mailto:sam%40example.com,kim%40example.com?cc=boss%40example.com&subject=Launch%20%26%20next%20steps&body=Hi%20both%2C%0A%0AShipping%20Friday.'));
test('the Gmail link fills the compose window', () => {
  const u = new URL(tasks.gmailUrl(tasks.parseEmail(mail)));
  eq([u.searchParams.get('to'), u.searchParams.get('su'), u.searchParams.get('body')],
    ['sam@example.com,kim@example.com', 'Launch & next steps', 'Hi both,\n\nShipping Friday.']);
});

console.log('\ntasks: find');
test('every match, any case', () => eq(tasks.findAll('Milk, milk and MILK', 'milk'), [0, 6, 15]));
test('nothing to find finds nothing', () => eq(tasks.findAll('milk', ''), []));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
