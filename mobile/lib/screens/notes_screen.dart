import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show RealtimeChannel;

import '../data/models.dart';
import '../data/note_html.dart';
import '../data/repository.dart';
import 'time_ago.dart';

// Same palette as the extension's popup.css.
const noteColors = ['yellow', 'green', 'blue', 'pink', 'purple', 'gray'];
Color noteColor(String name, Brightness b) {
  final light = b == Brightness.light;
  return switch (name) {
    'green' => Color(light ? 0xFFDCFCE7 : 0xFF14361F),
    'blue' => Color(light ? 0xFFDBEAFE : 0xFF172B4D),
    'pink' => Color(light ? 0xFFFCE7F3 : 0xFF47162F),
    'purple' => Color(light ? 0xFFEDE9FE : 0xFF2E1F5E),
    'gray' => Color(light ? 0xFFF3F4F6 : 0xFF1F2937),
    _ => Color(light ? 0xFFFEF9C3 : 0xFF423D12),
  };
}

class NotesScreen extends StatefulWidget {
  const NotesScreen({super.key, required this.repo});

  final Repository repo;

  @override
  State<NotesScreen> createState() => _NotesScreenState();
}

class _NotesScreenState extends State<NotesScreen> {
  List<Note>? _notes;
  String? _error;
  String _query = '';
  late final RealtimeChannel _channel;

  @override
  void initState() {
    super.initState();
    _channel = widget.repo.watch('notes', _load);
    _load();
  }

  @override
  void dispose() {
    _channel.unsubscribe();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final notes = await widget.repo.notes();
      if (mounted) {
        setState(() {
          _notes = notes;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = "Couldn't load notes. Pull down to retry.");
    }
  }

  Future<void> _open(Note? note) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => NoteEditorScreen(repo: widget.repo, note: note),
    ));
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final notes = _notes;
    final items = notes == null ? const <Note>[] : filterNotes(notes, _query, noteText);
    return Scaffold(
      floatingActionButton: FloatingActionButton(
        heroTag: 'new-note',
        tooltip: 'New note',
        onPressed: () => _open(null),
        child: const Icon(Icons.add),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
            child: TextField(
              decoration: const InputDecoration(
                hintText: 'Search notes or #tag',
                prefixIcon: Icon(Icons.search),
                border: OutlineInputBorder(),
                isDense: true,
              ),
              onChanged: (v) => setState(() => _query = v),
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _load,
              child: notes == null && _error == null
                  ? const Center(child: CircularProgressIndicator())
                  : ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.fromLTRB(12, 0, 12, 88),
                      children: [
                        if (_error != null) Padding(padding: const EdgeInsets.all(24), child: Text(_error!, textAlign: TextAlign.center)),
                        if (_error == null && items.isEmpty)
                          Padding(
                            padding: const EdgeInsets.all(24),
                            child: Text(_query.isEmpty ? 'No notes yet. Tap + to write one.' : 'No matching notes', textAlign: TextAlign.center),
                          ),
                        for (final n in items) _NoteCard(note: n, onTap: () => _open(n), onPin: () async {
                          await widget.repo.setNotePinned(n.id, !n.pinned);
                          _load();
                        }),
                      ],
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

class _NoteCard extends StatelessWidget {
  const _NoteCard({required this.note, required this.onTap, required this.onPin});

  final Note note;
  final VoidCallback onTap;
  final VoidCallback onPin;

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).textTheme.bodySmall;
    final preview = noteText(note.body);
    return Card(
      color: noteColor(note.color, Theme.of(context).brightness),
      child: ListTile(
        onTap: onTap,
        title: Text(note.title.isEmpty ? 'Untitled' : note.title, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (preview.isNotEmpty) Text(preview, maxLines: 3, overflow: TextOverflow.ellipsis),
            Text([...note.tags.map((t) => '#$t'), timeAgo(note.updatedAt)].join('  '), style: muted),
          ],
        ),
        trailing: IconButton(
          tooltip: note.pinned ? 'Unpin' : 'Pin',
          icon: Icon(note.pinned ? Icons.push_pin : Icons.push_pin_outlined),
          onPressed: onPin,
        ),
      ),
    );
  }
}

class NoteEditorScreen extends StatefulWidget {
  const NoteEditorScreen({super.key, required this.repo, this.note});

  final Repository repo;
  final Note? note;

  @override
  State<NoteEditorScreen> createState() => _NoteEditorScreenState();
}

class _NoteEditorScreenState extends State<NoteEditorScreen> {
  late final _title = TextEditingController(text: widget.note?.title);
  late final _text = TextEditingController(text: _originalText);
  late final _tags = TextEditingController(text: widget.note?.tags.join(', '));
  late final String _originalText = noteText(widget.note?.body ?? '');
  late String _color = widget.note?.color ?? 'yellow';
  late final bool _rich = hasFormatting(widget.note?.body ?? '');
  late bool _editing = !_rich; // formatted notes open read-only so the formatting is visible
  bool _busy = false;

  @override
  void dispose() {
    _title.dispose();
    _text.dispose();
    _tags.dispose();
    super.dispose();
  }

  Future<void> _guard(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Couldn't save. Check your connection and try again.")));
      }
    }
  }

  void _save() => _guard(() => widget.repo.saveNote(
        id: widget.note?.id,
        title: _title.text.trim(),
        // Only rewrite the body if the text changed, so changing a title or tag never strips formatting.
        body: widget.note != null && _text.text == _originalText ? null : plainToNoteHtml(_text.text),
        color: _color,
        tags: parseTags(_tags.text),
      ));

  @override
  Widget build(BuildContext context) {
    final note = widget.note;
    return Scaffold(
      appBar: AppBar(
        title: Text(note == null ? 'New note' : 'Edit note'),
        actions: [
          if (note != null)
            IconButton(
              tooltip: 'Delete',
              icon: const Icon(Icons.delete_outline),
              onPressed: _busy ? null : () => _guard(() => widget.repo.deleteNote(note.id)),
            ),
          TextButton(onPressed: _busy ? null : _save, child: const Text('Save')),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          TextField(controller: _title, decoration: const InputDecoration(labelText: 'Title', border: OutlineInputBorder())),
          const SizedBox(height: 12),
          if (_editing) ...[
            if (_rich)
              const Padding(
                padding: EdgeInsets.only(bottom: 8),
                child: Text('Changing the text here saves it without its formatting.'),
              ),
            TextField(
              controller: _text,
              autofocus: note == null,
              minLines: 8,
              maxLines: null,
              keyboardType: TextInputType.multiline,
              decoration: const InputDecoration(labelText: 'Note', alignLabelWithHint: true, border: OutlineInputBorder()),
            ),
          ] else ...[
            InputDecorator(
              decoration: const InputDecoration(labelText: 'Note', border: OutlineInputBorder()),
              child: SelectableText.rich(TextSpan(style: Theme.of(context).textTheme.bodyLarge, children: noteSpans(note!.body))),
            ),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(onPressed: () => setState(() => _editing = true), child: const Text('Edit text')),
            ),
          ],
          const SizedBox(height: 12),
          TextField(controller: _tags, decoration: const InputDecoration(labelText: 'Tags, comma separated', border: OutlineInputBorder())),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            children: [
              for (final c in noteColors)
                ChoiceChip(
                  label: Text(c),
                  selected: _color == c,
                  selectedColor: noteColor(c, Theme.of(context).brightness),
                  onSelected: (_) => setState(() => _color = c),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
