import 'package:desksync/data/models.dart';
import 'package:desksync/data/note_html.dart';
import 'package:desksync/screens/time_ago.dart';
import 'package:desksync/share/share.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Note note(String title, {String body = '', List<String> tags = const [], bool pinned = false, int age = 0}) => Note(
      id: title,
      title: title,
      body: body,
      color: 'yellow',
      tags: tags,
      pinned: pinned,
      updatedAt: DateTime(2026).subtract(Duration(minutes: age)),
    );

String plain(InlineSpan s) => s.toPlainText();

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

  group('note html', () {
    test('keeps line structure from extension HTML', () {
      expect(noteText('<div>one</div><div>two</div>'), 'one\ntwo');
      expect(noteText('a<br>b'), 'a\nb');
      expect(noteText('<ul><li>x</li><li>y</li></ul>'), '• x\n• y');
    });
    test('never surfaces active content', () {
      expect(noteText('safe<script>alert(1)</script><style>p{}</style>'), 'safe');
      expect(noteSpans('<script>alert(1)</script>'), isEmpty);
    });
    test('plain text round-trips and is escaped', () {
      const text = '<b>not bold</b> & co\nsecond line';
      final html = plainToNoteHtml(text);
      expect(html, '&lt;b&gt;not bold&lt;/b&gt; &amp; co<br>second line');
      expect(noteText(html), text);
      expect(hasFormatting(html), isFalse);
    });
    test('detects formatting that plain editing would lose', () {
      expect(hasFormatting('<b>x</b>'), isTrue);
      expect(hasFormatting('<ul><li>x</li></ul>'), isTrue);
      expect(hasFormatting('<span style="background-color: rgb(253, 224, 71);">x</span>'), isTrue);
      expect(hasFormatting('<div>x</div>a<br>b'), isFalse);
    });
    test('styles the extension format', () {
      final spans = noteSpans('<b>b</b><i>i</i><u>u</u><s>s</s><span style="background-color: rgb(253, 224, 71);">h</span>').cast<TextSpan>();
      expect(spans[0].style!.fontWeight, FontWeight.bold);
      expect(spans[1].style!.fontStyle, FontStyle.italic);
      expect(spans[2].style!.decoration, TextDecoration.underline);
      expect(spans[3].style!.decoration, TextDecoration.lineThrough);
      expect(spans[4].style!.backgroundColor, const Color.fromARGB(255, 253, 224, 71));
    });
    test('nested bold keeps text in order', () {
      expect(noteSpans('<b>a<i>b</i></b>c').map(plain).join(), 'abc');
    });
  });

  group('filterNotes', () {
    final notes = [
      note('old', age: 10, tags: ['Work']),
      note('new', body: '<b>Needle</b>'),
      note('pinned', age: 99, pinned: true),
    ];
    test('pinned first, then newest', () {
      expect(filterNotes(notes, '', noteText).map((n) => n.title), ['pinned', 'new', 'old']);
    });
    test('searches body text, not HTML', () {
      expect(filterNotes(notes, 'needle', noteText).map((n) => n.title), ['new']);
      expect(filterNotes(notes, '<b>', noteText), isEmpty);
    });
    test('#tag is an exact match', () {
      expect(filterNotes(notes, '#work', noteText).map((n) => n.title), ['old']);
      expect(filterNotes(notes, '#wor', noteText), isEmpty);
    });
  });

  test('parseTags matches the extension', () {
    expect(parseTags(' #a, b ,,c '), ['a', 'b', 'c']);
  });

  test('timeAgo', () {
    final now = DateTime(2026, 1, 2);
    expect(timeAgo(now.subtract(const Duration(seconds: 5)), now: now), 'just now');
    expect(timeAgo(now.subtract(const Duration(minutes: 5)), now: now), '5m ago');
    expect(timeAgo(now.subtract(const Duration(hours: 5)), now: now), '5h ago');
    expect(timeAgo(now.subtract(const Duration(days: 5)), now: now), '5d ago');
  });
}
