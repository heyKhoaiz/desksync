import 'package:flutter/material.dart';

import '../data/repository.dart';

/// Shows [child] to a Pro account, and to everyone else a screen saying the
/// phone app is part of Pro. Without Pro the server returns no rows, so the
/// lists would otherwise just look empty.
class ProGate extends StatefulWidget {
  const ProGate({super.key, required this.repo, required this.email, required this.onSignOut, required this.child});

  final Repository repo;
  final String email;
  final Future<void> Function() onSignOut;
  final Widget child;

  @override
  State<ProGate> createState() => _ProGateState();
}

class _ProGateState extends State<ProGate> {
  late Future<bool> _pro = widget.repo.isPro();

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<bool>(
      future: _pro,
      builder: (context, snap) {
        if (!snap.hasData) return const Scaffold(body: Center(child: CircularProgressIndicator()));
        if (snap.data!) return widget.child;
        return Scaffold(
          body: SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('The phone app is part of DeskSync Pro', style: Theme.of(context).textTheme.headlineSmall),
                  const SizedBox(height: 12),
                  Text(
                    '${widget.email} is on the Free plan. Free keeps everything in your browser; '
                    'Pro syncs it to your other computers and this phone.',
                  ),
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: () => setState(() => _pro = widget.repo.isPro()),
                    child: const Text('I have Pro: check again'),
                  ),
                  TextButton(onPressed: widget.onSignOut, child: const Text('Sign out')),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
