import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:html/dom.dart' as dom;
import 'package:html/parser.dart' as html;

// The notes body is limited HTML written by the extension. It's only ever turned
// into text spans here, never rendered as a web page, so nothing in it can execute.

const _skipped = {'script', 'style', 'iframe', 'object', 'embed', 'template', 'svg', 'math', 'head'};
const _blocks = {'div', 'p', 'li', 'ul', 'ol'};
const _formatting = {'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'ul', 'ol', 'li'};

/// Note text with line breaks kept, for previews, search and the plain-text editor.
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
      final block = _blocks.contains(tag);
      if (block) breakLine();
      if (tag == 'li') out.write('• ');
      node.nodes.forEach(walk);
      if (block) breakLine();
    }
  }

  html.parseFragment(body).nodes.forEach(walk);
  return out.toString().trim();
}

/// True if saving the body as plain text would lose bold, lists, highlights and so on.
bool hasFormatting(String body) {
  bool walk(dom.Node node) {
    if (node is dom.Element) {
      final tag = node.localName ?? '';
      if (_skipped.contains(tag)) return false;
      if (_formatting.contains(tag) || _highlight(node) != null) return true;
    }
    return node.nodes.any(walk);
  }

  return html.parseFragment(body).nodes.any(walk);
}

/// Plain text from the phone editor as the limited HTML the extension expects.
String plainToNoteHtml(String text) => const LineSplitter()
    .convert(text)
    .map(const HtmlEscape(HtmlEscapeMode.element).convert)
    .join('<br>');

/// Note body as styled spans for the read-only view.
List<InlineSpan> noteSpans(String body) {
  final spans = <InlineSpan>[];

  void breakLine() {
    if (spans.isEmpty) return;
    final last = spans.last;
    if (last is TextSpan && (last.text ?? '').endsWith('\n')) return;
    spans.add(const TextSpan(text: '\n'));
  }

  void walk(dom.Node node, TextStyle style) {
    if (node is dom.Text) {
      spans.add(TextSpan(text: node.text, style: style));
    } else if (node is dom.Element) {
      final tag = node.localName ?? '';
      if (_skipped.contains(tag)) return;
      if (tag == 'br') {
        spans.add(const TextSpan(text: '\n'));
        return;
      }
      final block = _blocks.contains(tag);
      if (block) breakLine();
      if (tag == 'li') spans.add(TextSpan(text: '• ', style: style));
      var next = style;
      switch (tag) {
        case 'b' || 'strong':
          next = next.copyWith(fontWeight: FontWeight.bold);
        case 'i' || 'em':
          next = next.copyWith(fontStyle: FontStyle.italic);
        case 'u':
          next = next.copyWith(decoration: TextDecoration.combine([?next.decoration, TextDecoration.underline]));
        case 's' || 'strike':
          next = next.copyWith(decoration: TextDecoration.combine([?next.decoration, TextDecoration.lineThrough]));
      }
      final bg = _highlight(node);
      if (bg != null) next = next.copyWith(backgroundColor: bg, color: Colors.black);
      for (final child in node.nodes) {
        walk(child, next);
      }
      if (block) breakLine();
    }
  }

  for (final node in html.parseFragment(body).nodes) {
    walk(node, const TextStyle());
  }
  return spans;
}

Color? _highlight(dom.Element el) {
  final style = el.attributes['style'];
  if (style == null) return null;
  final rgb = RegExp(r'background-color:\s*rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)').firstMatch(style);
  if (rgb != null) {
    return Color.fromARGB(255, int.parse(rgb[1]!).clamp(0, 255), int.parse(rgb[2]!).clamp(0, 255), int.parse(rgb[3]!).clamp(0, 255));
  }
  final hex = RegExp(r'background-color:\s*#([0-9a-fA-F]{6})').firstMatch(style);
  return hex == null ? null : Color(0xFF000000 | int.parse(hex[1]!, radix: 16));
}
