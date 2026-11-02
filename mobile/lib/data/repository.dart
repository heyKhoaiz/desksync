import 'package:supabase_flutter/supabase_flutter.dart';

import 'models.dart';

/// Reads and writes the same tables as the extension. Deletes are soft so
/// other devices pick them up; Row Level Security scopes every query to the user.
class Repository {
  Repository(this._sb);

  final SupabaseClient _sb;

  Future<List<Note>> notes() async {
    final rows = await _sb
        .from('notes')
        .select()
        .isFilter('deleted_at', null)
        .order('updated_at', ascending: false)
        .limit(500);
    return rows.map(Note.fromRow).toList();
  }

  Future<void> saveNote({
    String? id,
    required String title,
    String? body, // null keeps the stored body untouched
    required String color,
    required List<String> tags,
  }) async {
    final row = {'title': title, 'color': color, 'tags': tags, 'body': ?body};
    if (id == null) {
      await _sb.from('notes').insert(row);
    } else {
      await _sb.from('notes').update(row).eq('id', id);
    }
  }

  Future<void> setNotePinned(String id, bool pinned) =>
      _sb.from('notes').update({'pinned': pinned}).eq('id', id);

  Future<void> deleteNote(String id) => _softDelete('notes', id);

  Future<List<ReadLaterItem>> readLater() async {
    final rows = await _sb
        .from('read_later')
        .select()
        .isFilter('deleted_at', null)
        .order('created_at', ascending: false)
        .limit(500);
    return rows.map(ReadLaterItem.fromRow).toList();
  }

  Future<void> saveLink(String url, String title) =>
      _sb.from('read_later').insert({'url': url, 'title': title, 'source': 'android'});

  Future<void> setRead(String id, bool isRead) =>
      _sb.from('read_later').update({'is_read': isRead}).eq('id', id);

  Future<void> deleteLink(String id) => _softDelete('read_later', id);

  Future<void> _softDelete(String table, String id) => _sb
      .from(table)
      .update({'deleted_at': DateTime.now().toUtc().toIso8601String()}).eq('id', id);

  /// Calls [onChange] when another device changes [table]. Cancel with [RealtimeChannel.unsubscribe].
  RealtimeChannel watch(String table, void Function() onChange) {
    final uid = _sb.auth.currentUser!.id;
    return _sb
        .channel('desksync-$table')
        .onPostgresChanges(
          event: PostgresChangeEvent.all,
          schema: 'public',
          table: table,
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'user_id',
            value: uid,
          ),
          callback: (_) => onChange(),
        )
        .subscribe();
  }
}
