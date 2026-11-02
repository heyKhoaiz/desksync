import 'dart:async';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'config.dart';
import 'data/repository.dart';
import 'data/session_storage.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'share/share.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (supabaseUrl.isEmpty || supabaseAnonKey.isEmpty) {
    runApp(const MaterialApp(
      home: Scaffold(body: Center(child: Text('Build with --dart-define SUPABASE_URL and SUPABASE_ANON_KEY'))),
    ));
    return;
  }
  await Supabase.initialize(
    url: supabaseUrl,
    publishableKey: supabaseAnonKey,
    authOptions: const FlutterAuthClientOptions(
      localStorage: SecureSessionStorage(),
      detectSessionInUri: false,
    ),
  );
  runApp(const DeskSyncApp());
}

class DeskSyncApp extends StatefulWidget {
  const DeskSyncApp({super.key});

  @override
  State<DeskSyncApp> createState() => _DeskSyncAppState();
}

class _DeskSyncAppState extends State<DeskSyncApp> {
  final _messenger = GlobalKey<ScaffoldMessengerState>();
  final _sb = Supabase.instance.client;
  late final _repo = Repository(_sb);
  late final StreamSubscription<AuthState> _auth;
  SharedLink? _pending; // shared while signed out; saved right after sign-in

  @override
  void initState() {
    super.initState();
    _auth = _sb.auth.onAuthStateChange.listen((_) {
      setState(() {});
      _savePending();
    });
    ShareInbox.listen(_onShare);
  }

  @override
  void dispose() {
    _auth.cancel();
    super.dispose();
  }

  void _onShare(String? text, String? subject) {
    final link = parseShare(text, subject);
    if (link == null) {
      _toast('No link found in what you shared');
      return;
    }
    _pending = link;
    if (_sb.auth.currentSession == null) {
      _toast('Sign in to save this link');
    } else {
      _savePending();
    }
  }

  Future<void> _savePending() async {
    final link = _pending;
    if (link == null || _sb.auth.currentSession == null) return;
    _pending = null;
    try {
      await _repo.saveLink(link.url, link.title);
      _toast('Saved to Read later');
    } catch (e) {
      _pending = link; // keep it so the next sign-in or share can retry
      _toast('Could not save the link: $e');
    }
  }

  void _toast(String message) =>
      _messenger.currentState?.showSnackBar(SnackBar(content: Text(message)));

  @override
  Widget build(BuildContext context) {
    final user = _sb.auth.currentUser;
    return MaterialApp(
      title: 'DeskSync',
      scaffoldMessengerKey: _messenger,
      theme: ThemeData(colorSchemeSeed: const Color(0xFF2563EB)),
      darkTheme: ThemeData(colorSchemeSeed: const Color(0xFF2563EB), brightness: Brightness.dark),
      home: _sb.auth.currentSession == null
          ? LoginScreen(auth: _sb.auth)
          : HomeScreen(key: ValueKey(user?.id), repo: _repo, email: user?.email ?? '', onSignOut: _sb.auth.signOut),
    );
  }
}
