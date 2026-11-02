import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Keeps the login session in the Android Keystore-backed store instead of the
/// default plain SharedPreferences, because the refresh token unlocks all synced data.
class SecureSessionStorage extends LocalStorage {
  const SecureSessionStorage();

  static const _key = 'desksync-auth';
  static const _storage = FlutterSecureStorage();

  @override
  Future<void> initialize() async {}

  @override
  Future<bool> hasAccessToken() => _storage.containsKey(key: _key);

  @override
  Future<String?> accessToken() => _storage.read(key: _key);

  @override
  Future<void> removePersistedSession() => _storage.delete(key: _key);

  @override
  Future<void> persistSession(String persistSessionString) {
    jsonDecode(persistSessionString); // refuse to store anything malformed
    return _storage.write(key: _key, value: persistSessionString);
  }
}
