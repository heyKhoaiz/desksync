import 'package:flutter/material.dart';

import '../data/repository.dart';
import 'notes_screen.dart';
import 'read_later_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.repo, required this.email, required this.onSignOut});

  final Repository repo;
  final String email;
  final Future<void> Function() onSignOut;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_tab == 0 ? 'Notes' : 'Read later'),
        actions: [
          PopupMenuButton<void>(
            itemBuilder: (_) => [
              PopupMenuItem(enabled: false, child: Text(widget.email)),
              PopupMenuItem(onTap: widget.onSignOut, child: const Text('Sign out')),
            ],
          ),
        ],
      ),
      // IndexedStack keeps both lists loaded and listening for changes from other devices.
      body: IndexedStack(
        index: _tab,
        children: [NotesScreen(repo: widget.repo), ReadLaterScreen(repo: widget.repo)],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.sticky_note_2_outlined), label: 'Notes'),
          NavigationDestination(icon: Icon(Icons.bookmark_border), label: 'Read later'),
        ],
      ),
    );
  }
}
