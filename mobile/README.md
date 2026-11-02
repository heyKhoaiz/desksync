# DeskSync for Android

Flutter app using the same Supabase project as the Chrome extension. This first version covers
login, notes, and read later, including saving links from Android's share sheet.
Clipboard and vault come next (see `docs/ARCHITECTURE.md`).

## Run

```bash
flutter pub get
flutter run --dart-define=SUPABASE_URL=https://YOUR-PROJECT.supabase.co --dart-define=SUPABASE_ANON_KEY=YOUR-ANON-KEY
```

Build an APK by replacing `run` with `build apk --release`. Without the two defines the app only shows a
setup message. Release builds are signed with the debug key for now, so add a real signing config before publishing.

## Test

```bash
flutter analyze
flutter test
```

## Notes on the formats shared with the extension

- Note bodies are limited HTML. `lib/data/note_html.dart` turns them into text spans and never renders them as a web page.
- The phone edits text only. Changing a title, tags or color leaves the stored body untouched.
  Changing the text of a formatted note saves it without its formatting, and the editor says so.
- The login session is stored in `flutter_secure_storage`, not the default SharedPreferences.
