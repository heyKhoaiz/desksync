import 'package:desksync/data/models.dart';
import 'package:desksync/data/note_html.dart';
import 'package:desksync/screens/time_ago.dart';
import 'package:desksync/share/share.dart';
import 'package:flutter_test/flutter_test.dart';

Note note(String title, {String body = '', String format = 'plain', List<String> tags = const [], bool pinned = false, int age = 0}) => Note(
      id: title,
      title: title,
      body: body,
      format: format,
      color: 'yellow',
      tags: tags,
      pinned: pinned,
      updatedAt: DateTime(2026).subtract(Duration(minutes: age)),
    );


void main() {
  group('parseShare', () {
    test('finds a bare link', () {
      final l = parseShare('https://a.dev/x?y=1', null)!;
      expect(l.url, 'https://a.dev/x?y=1');
      expect(l.title, 'https://a.dev/x?y=1');
    });
    test('uses the surrounding text as the title', () {
      final l = parseShare('Great read https://a.dev/x', null)!;
      expect(l.url, 'https://a.dev/x');
      expect(l.title, 'Great read');
    });
    test('prefers the subject', () {
      expect(parseShare('Great read https://a.dev/x', 'Subject')!.title, 'Subject');
    });
    test('drops trailing punctuation', () {
      expect(parseShare('see https://a.dev/x.', null)!.url, 'https://a.dev/x');
    });
    test('rejects text without a web link', () {
      expect(parseShare('no link here', null), isNull);
      expect(parseShare('javascript:alert(1)', null), isNull);
      expect(parseShare('file:///etc/passwd', null), isNull);
      expect(parseShare(null, null), isNull);
    });
  });

  group('plain text notes', () {
    test('a plain note is shown exactly as stored', () {
      const body = '**not bold**\n<b>not a tag</b> & co\n- [ ] not a checkbox';
      expect(notePlain(note('p', body: body)), body);
    });
    test('an old HTML note keeps its line structure', () {
      expect(noteText('<div>one</div><div>two</div>'), 'one\ntwo');
      expect(noteText('a<br>b'), 'a\nb');
      expect(noteText('<ul><li>x</li><li>y</li></ul>'), '- x\n- y');
      expect(notePlain(note('h', body: '<b>old</b> note', format: 'html')), 'old note');
    });
    test('an old HTML tick box becomes text', () {
      expect(noteText('<ul class="tasks"><li class="done"><span class="box on"></span><span>done it</span></li></ul>'), '[x] done it');
    });
    test('an old HTML note never surfaces active content', () {
      expect(noteText('safe<script>alert(1)</script><style>p{}</style>'), 'safe');
    });
    test('an old markdown note loses its marks, keeps its words', () {
      expect(markdownText('## Shopping\n\n- [ ] milk\n- [x] bread'), 'Shopping\n\n[ ] milk\n[x] bread');
      expect(markdownText('**bold** *it* ~~out~~ ==hi== `code`'), 'bold it out hi code');
      expect(markdownText('[Docs](https://example.com)'), 'Docs (https://example.com)');
      expect(notePlain(note('m', body: '> quoted', format: 'markdown')), 'quoted');
    });
  });

  group('filterNotes', () {
    final notes = [
      note('old', age: 10, tags: ['Work']),
      note('new', body: '<b>Needle</b>', format: 'html'),
      note('pinned', age: 99, pinned: true),
    ];
    test('pinned first, then newest', () {
      expect(filterNotes(notes, '', notePlain).map((n) => n.title), ['pinned', 'new', 'old']);
    });
    test('searches an old HTML note by its text, not its tags', () {
      expect(filterNotes(notes, 'needle', notePlain).map((n) => n.title), ['new']);
      expect(filterNotes(notes, '<b>', notePlain), isEmpty);
    });
    test('#tag is an exact match', () {
      expect(filterNotes(notes, '#work', notePlain).map((n) => n.title), ['old']);
      expect(filterNotes(notes, '#wor', notePlain), isEmpty);
    });
  });

  test('parseTags matches the extension', () {
    expect(parseTags(' #a, b ,,c '), ['a', 'b', 'c']);
  });

  group('tag rules, the same as extension/lib/tags.js', () {
    test('lower case, spaces become one hyphen', () => expect(normalizeTag('  Weekly   Shop '), 'weekly-shop'));
    test('punctuation is removed', () => expect(normalizeTag('Q&A! (draft)'), 'qa-draft'));
    test('Bangla works, vowel signs and all', () => expect(normalizeTag('কাজের তালিকা'), 'কাজের-তালিকা'));
    test('32 characters at most', () => expect(normalizeTag('a' * 40).length, 32));
    test('no repeats, and at most 10', () {
      expect(parseTags('Work, work, home'), ['work', 'home']);
      expect(parseTags(List.generate(14, (i) => 't$i').join(',')).length, 10);
    });
  });

  test('timeAgo', () {
    final now = DateTime(2026, 1, 2);
    expect(timeAgo(now.subtract(const Duration(seconds: 5)), now: now), 'just now');
    expect(timeAgo(now.subtract(const Duration(minutes: 5)), now: now), '5m ago');
    expect(timeAgo(now.subtract(const Duration(hours: 5)), now: now), '5h ago');
    expect(timeAgo(now.subtract(const Duration(days: 5)), now: now), '5d ago');
  });
}
