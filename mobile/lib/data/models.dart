class Note {
  const Note({
    required this.id,
    required this.title,
    required this.body,
    required this.color,
    required this.tags,
    required this.pinned,
    required this.updatedAt,
  });

  factory Note.fromRow(Map<String, dynamic> r) => Note(
        id: r['id'] as String,
        title: r['title'] as String? ?? '',
        body: r['body'] as String? ?? '',
        color: r['color'] as String? ?? 'yellow',
        tags: (r['tags'] as List?)?.cast<String>() ?? const [],
        pinned: r['pinned'] as bool? ?? false,
        updatedAt: DateTime.parse(r['updated_at'] as String),
      );

  final String id;
  final String title;
  final String body; // limited HTML, shared with the extension
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
List<Note> filterNotes(List<Note> notes, String query, String Function(String html) textOf) {
  final q = query.trim().toLowerCase();
  final out = notes.where((n) {
    if (q.isEmpty) return true;
    if (q.startsWith('#')) return n.tags.any((t) => t.toLowerCase() == q.substring(1));
    return '${n.title} ${textOf(n.body)} ${n.tags.join(' ')}'.toLowerCase().contains(q);
  }).toList()
    ..sort((a, b) {
      if (a.pinned != b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt.compareTo(a.updatedAt);
    });
  return out;
}

List<String> parseTags(String input) => input
    .split(',')
    .map((t) => t.trim().replaceFirst(RegExp(r'^#'), ''))
    .where((t) => t.isNotEmpty)
    .toList();
