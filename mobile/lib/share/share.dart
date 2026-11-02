import 'package:flutter/services.dart';

class SharedLink {
  const SharedLink(this.url, this.title);
  final String url;
  final String title;
}

final _urlPattern = RegExp(r'''https?://[^\s<>"']+''', caseSensitive: false);

/// Finds the link in shared text. Apps often send "Some title https://...", so the
/// rest of the text becomes the title when the app didn't send a subject.
SharedLink? parseShare(String? text, String? subject) {
  if (text == null) return null;
  final match = _urlPattern.firstMatch(text);
  if (match == null) return null;
  final url = match[0]!.replaceFirst(RegExp(r'[.,;:!?)\]]+$'), '');
  if (Uri.tryParse(url)?.host.isNotEmpty != true) return null;
  final rest = text.replaceFirst(match[0]!, '').trim();
  final title = (subject?.trim().isNotEmpty ?? false) ? subject!.trim() : (rest.isNotEmpty ? rest : url);
  return SharedLink(url, title);
}

/// Receives Android's share sheet. See MainActivity.kt for the other end.
class ShareInbox {
  static const _channel = MethodChannel('desksync/share');

  /// [onShare] runs with the text the app was launched with, if any, and with
  /// every later share while the app is open.
  static Future<void> listen(void Function(String? text, String? subject) onShare) async {
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'share') onShare(call.arguments['text'] as String?, call.arguments['subject'] as String?);
    });
    try {
      final first = await _channel.invokeMapMethod<String, String?>('initialShare');
      if (first != null) onShare(first['text'], first['subject']);
    } on MissingPluginException {
      // Not on Android (tests); there's no share sheet to listen to.
    }
  }
}
