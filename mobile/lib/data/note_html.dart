import 'package:html/dom.dart' as dom;
import 'package:html/parser.dart' as html;

import 'models.dart';

// Notes are plain text: stored exactly as typed, shown exactly as stored.
//
// The only work here is for notes written by the editors that came before:
// format 'html' (the first rich editor) and 'markdown' (the one after it). Both
// are flattened to text when shown, and saved back as 'plain' once edited.
// Nothing is ever rendered as a web page, so nothing in a body can execute.

const _skipped = {'script', 'style', 'iframe', 'object', 'embed', 'template', 'svg', 'math', 'head'};
const _blocks = {'div', 'p', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre'};

/// The note as text, whatever it was stored as. For the list, search and the editor.
String notePlain(Note note) => switch (note.format) {
      'html' => noteText(note.body),
      'markdown' => markdownText(note.body),
      _ => note.body,
    };

/// Legacy HTML as text, line breaks kept.
String noteText(String body) {
  final out = StringBuffer();

  void breakLine() {
    final s = out.toString();
    if (s.isNotEmpty && !s.endsWith('\n')) out.write('\n');
  }

  void walk(dom.Node node) {
    if (node is dom.Text) {
      out.write(node.text);
    } else if (node is dom.Element) {
      final tag = node.localName ?? '';
      if (_skipped.contains(tag)) return;
      if (tag == 'br') {
        out.write('\n');
        return;
      }
      if (tag == 'span' && node.classes.contains('box')) {
        out.write(node.classes.contains('on') ? '[x] ' : '[ ] ');
        return;
      }
      final block = _blocks.contains(tag);
      if (block) breakLine();
      if (tag == 'li' && !node.classes.contains('done') && node.querySelector('.box') == null) out.write('- ');
      node.nodes.forEach(walk);
      if (block) breakLine();
    }
  }

  html.parseFragment(body).nodes.forEach(walk);
  return out.toString().trim();
}

/// Legacy markdown as text. Mirrors fromMarkdown in extension/lib/plaintext.js.
String markdownText(String src) => src
    .replaceAll(RegExp(r'^```.*$', multiLine: true), '')
    .replaceAll(RegExp(r'^#{1,6}\s+', multiLine: true), '')
    .replaceAllMapped(RegExp(r'^(\s*)[-*]\s+\[([ xX])\]\s+', multiLine: true),
        (m) => '${m[1]}[${m[2]!.toLowerCase() == 'x' ? 'x' : ' '}] ')
    .replaceAllMapped(RegExp(r'^(\s*)[-*]\s+', multiLine: true), (m) => '${m[1]}- ')
    .replaceAll(RegExp(r'^>\s?', multiLine: true), '')
    .replaceAllMapped(RegExp(r'\[([^\]]+)\]\(([^)\s]+)\)'), (m) => '${m[1]} (${m[2]})')
    .replaceAllMapped(RegExp(r'\*\*([^*]+)\*\*'), (m) => m[1]!)
    .replaceAllMapped(RegExp(r'(^|[^*])\*([^*\n]+)\*'), (m) => '${m[1]}${m[2]}')
    .replaceAllMapped(RegExp(r'~~([^~]+)~~'), (m) => m[1]!)
    .replaceAllMapped(RegExp(r'==([^=]+)=='), (m) => m[1]!)
    .replaceAllMapped(RegExp(r'`([^`]+)`'), (m) => m[1]!)
    .replaceAll(RegExp(r'\n{3,}'), '\n\n')
    .trim();
