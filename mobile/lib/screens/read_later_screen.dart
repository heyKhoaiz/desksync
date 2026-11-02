import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show RealtimeChannel;
import 'package:url_launcher/url_launcher.dart';

import '../data/models.dart';
import '../data/repository.dart';
import '../share/share.dart';
import 'time_ago.dart';

class ReadLaterScreen extends StatefulWidget {
  const ReadLaterScreen({super.key, required this.repo});

  final Repository repo;

  @override
  State<ReadLaterScreen> createState() => _ReadLaterScreenState();
}

class _ReadLaterScreenState extends State<ReadLaterScreen> {
  List<ReadLaterItem>? _items;
  String? _error;
  bool _showRead = false;
  late final RealtimeChannel _channel;

  @override
  void initState() {
    super.initState();
    _channel = widget.repo.watch('read_later', _load);
    _load();
  }

  @override
  void dispose() {
    _channel.unsubscribe();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final items = await widget.repo.readLater();
      if (mounted) {
        setState(() {
          _items = items;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = "Couldn't load your list. Pull down to retry.");
    }
  }

  void _toast(String message) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));

  Future<void> _run(Future<void> Function() action) async {
    try {
      await action();
      await _load();
    } catch (e) {
      if (mounted) _toast("That didn't go through. Check your connection and try again.");
    }
  }

  Future<void> _open(ReadLaterItem item) async {
    final uri = Uri.tryParse(item.url);
    // Links can come from any device, so only ever open web addresses.
    if (uri == null || !(uri.isScheme('http') || uri.isScheme('https'))) {
      _toast('Blocked unsafe link');
      return;
    }
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      if (mounted) _toast("Couldn't open that link");
      return;
    }
    if (!item.isRead) _run(() => widget.repo.setRead(item.id, true));
  }

  Future<void> _addLink() async {
    final text = await showDialog<String>(context: context, builder: (_) => const _AddLinkDialog());
    if (text == null) return;
    final link = parseShare(text, null);
    if (link == null) {
      _toast('Enter a link starting with http:// or https://');
      return;
    }
    await _run(() => widget.repo.saveLink(link.url, link.title));
  }

  @override
  Widget build(BuildContext context) {
    final all = _items;
    final items = (all ?? const <ReadLaterItem>[]).where((r) => _showRead || !r.isRead).toList();
    return Scaffold(
      floatingActionButton: FloatingActionButton(
        heroTag: 'new-link',
        tooltip: 'Save a link',
        onPressed: _addLink,
        child: const Icon(Icons.add_link),
      ),
      body: Column(
        children: [
          SwitchListTile(
            dense: true,
            title: const Text('Show read'),
            value: _showRead,
            onChanged: (v) => setState(() => _showRead = v),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _load,
              child: all == null && _error == null
                  ? const Center(child: CircularProgressIndicator())
                  : ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.only(bottom: 88),
                      children: [
                        if (_error != null) Padding(padding: const EdgeInsets.all(24), child: Text(_error!, textAlign: TextAlign.center)),
                        if (_error == null && items.isEmpty)
                          const Padding(
                            padding: EdgeInsets.all(24),
                            child: Text('Nothing saved. Share a link from any app and pick DeskSync.', textAlign: TextAlign.center),
                          ),
                        for (final r in items) _tile(r),
                      ],
                    ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _tile(ReadLaterItem r) {
    final host = Uri.tryParse(r.url)?.host ?? '';
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return ListTile(
      onTap: () => _open(r),
      leading: Icon(r.source == 'android' ? Icons.smartphone : Icons.computer, color: muted),
      title: Text(
        r.title.isEmpty ? r.url : r.title,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: r.isRead ? TextStyle(color: muted) : null,
      ),
      subtitle: Text('$host · ${timeAgo(r.createdAt)}', maxLines: 1, overflow: TextOverflow.ellipsis),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            tooltip: r.isRead ? 'Mark unread' : 'Mark read',
            icon: Icon(r.isRead ? Icons.undo : Icons.check),
            onPressed: () => _run(() => widget.repo.setRead(r.id, !r.isRead)),
          ),
          IconButton(
            tooltip: 'Delete',
            icon: const Icon(Icons.delete_outline),
            onPressed: () => _run(() => widget.repo.deleteLink(r.id)),
          ),
        ],
      ),
    );
  }
}

class _AddLinkDialog extends StatefulWidget {
  const _AddLinkDialog();

  @override
  State<_AddLinkDialog> createState() => _AddLinkDialogState();
}

// Owns its controller because the field is still on screen while the dialog animates closed.
class _AddLinkDialogState extends State<_AddLinkDialog> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Save a link'),
      content: TextField(
        controller: _controller,
        autofocus: true,
        keyboardType: TextInputType.url,
        decoration: const InputDecoration(hintText: 'https://…'),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        FilledButton(onPressed: () => Navigator.pop(context, _controller.text), child: const Text('Save')),
      ],
    );
  }
}
