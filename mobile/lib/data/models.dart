class Note {
  const Note({
    required this.id,
    required this.title,
    required this.body,
    this.format = 'plain',
    required this.color,
    required this.tags,
    required this.pinned,
    required this.updatedAt,
  });

  factory Note.fromRow(Map<String, dynamic> r) => Note(
        id: r['id'] as String,
        title: r['title'] as String? ?? '',
        body: r['body'] as String? ?? '',
        // The column's default is 'html': a row without one predates plain text.
        format: r['format'] as String? ?? 'html',
        color: r['color'] as String? ?? 'yellow',
        tags: (r['tags'] as List?)?.cast<String>() ?? const [],
        pinned: r['pinned'] as bool? ?? false,
        updatedAt: DateTime.parse(r['updated_at'] as String),
      );

  final String id;
  final String title;
  final String body; // see `format`
  final String format; // 'plain'; 'html' or 'markdown' for notes from the older editors
  final String color;
  final List<String> tags;
  final bool pinned;
  final DateTime updatedAt;
}

class ReadLaterItem {
  const ReadLaterItem({
    required this.id,
    required this.url,
    required this.title,
    required this.isRead,
    required this.source,
    required this.createdAt,
  });

  factory ReadLaterItem.fromRow(Map<String, dynamic> r) => ReadLaterItem(
        id: r['id'] as String,
        url: r['url'] as String,
        title: r['title'] as String? ?? '',
        isRead: r['is_read'] as bool? ?? false,
        source: r['source'] as String? ?? 'extension',
        createdAt: DateTime.parse(r['created_at'] as String),
      );

  final String id;
  final String url;
  final String title;
  final bool isRead;
  final String source;
  final DateTime createdAt;
}

/// Same matching as the extension's notes search: `#tag` is an exact tag match,
/// anything else searches title, text and tags. Pinned first, then newest.
List<Note> filterNotes(List<Note> notes, String query, String Function(Note note) textOf) {
  final q = query.trim().toLowerCase();
  final out = notes.where((n) {
    if (q.isEmpty) return true;
    if (q.startsWith('#')) return n.tags.any((t) => t.toLowerCase() == q.substring(1));
    return '${n.title} ${textOf(n)} ${n.tags.join(' ')}'.toLowerCase().contains(q);
  }).toList()
    ..sort((a, b) {
      if (a.pinned != b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt.compareTo(a.updatedAt);
    });
  return out;
}

// The rules for tag names, the same as the extension's (extension/lib/tags.js),
// so a tag made on either is the same tag:
//   letters in any language, numbers, - and _; spaces, "." and "/" become -;
//   lower case; 1 to 32 characters; up to 10 on one item.
const maxTagLength = 32;
const maxTagsPerItem = 10;
final _notTagChar = RegExp(r'[^\p{L}\p{N}\p{M}_-]', unicode: true);

String normalizeTag(String raw) {
  var t = raw.trim().replaceFirst(RegExp(r'^#+'), '').toLowerCase();
  t = t
      .replaceAll(RegExp(r'[\s./]+'), '-')
      .replaceAll(_notTagChar, '')
      .replaceAll(RegExp(r'-{2,}'), '-')
      .replaceAll(RegExp(r'^[-_]+|[-_]+$'), '');
  final chars = t.runes.toList();
  if (chars.length > maxTagLength) {
    t = String.fromCharCodes(chars.take(maxTagLength)).replaceAll(RegExp(r'[-_]+$'), '');
  }
  return t;
}

/// Tags typed as a comma separated list, made to follow the rules: normalised,
/// no repeats, no empties, at most [maxTagsPerItem].
List<String> parseTags(String input) {
  final out = <String>[];
  for (final part in input.split(',')) {
    final t = normalizeTag(part);
    if (t.isNotEmpty && !out.contains(t)) out.add(t);
    if (out.length == maxTagsPerItem) break;
  }
  return out;
}
