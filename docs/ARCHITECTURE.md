# DeskSync — Architecture Plan

One account → notes, read-later, clipboard history and a password vault, synced across
every Chrome profile and an Android app.

## 1. Components

```
 Chrome profile A ─┐                         ┌─ Android app (Flutter, Play Store)
 Chrome profile B ─┼─ Chrome extension ──►  Supabase  ◄── share sheet, vault autofill
 Chrome profile C ─┘   (MV3, this repo)     (Auth + Postgres + RLS + Realtime)
```

| Part | Tech | Status |
|---|---|---|
| Backend | Supabase: email auth, Postgres, Row Level Security, Realtime | `supabase/schema.sql` ✅ |
| Chrome extension | Manifest V3, plain JS, vendored supabase-js 2.x | `extension/` ✅ MVP |
| Android app | Flutter + `supabase_flutter` | `mobile/` login, notes, read later + share sheet; clipboard and vault next |

## 2. Data model (all tables: `user_id`, `created_at`, `updated_at`, `deleted_at`)

| Table | Key columns |
|---|---|
| `notes` | title, body (sanitized HTML), color, tags[], pinned |
| `read_later` | url, title, favicon, note, is_read, source (`extension`/`android`) |
| `clips` | content (≤ 20k chars), source_url (hostname only), pinned |
| `vault_meta` | salt, iterations, verifier_iv, verifier_ct (one row per user) |
| `vault_items` | iv, ciphertext (whole item encrypted) |

**Sync rules**
- Supabase is the source of truth. Clients read, write and subscribe to Realtime changes.
- Deletes are soft (`deleted_at`) so every device sees them; a cron job can purge rows older than 30 days.
- Deleting a clip also blanks `content` and `source_url`, because clips can hold copied secrets in plaintext.
- Conflicts: last write wins on `updated_at` (fine for single-user data).
- RLS policy on every table: `user_id = auth.uid()`.

## 3. Vault crypto (must match exactly in Flutter)

| Step | Spec |
|---|---|
| Key derivation | PBKDF2-HMAC-SHA256, 600,000 iterations, 16-byte random salt → 256-bit key |
| Encryption | AES-256-GCM, 12-byte random IV per write, 16-byte tag appended to ciphertext |
| Encoding | standard base64 |
| Payload | JSON `{title, url, username, password, notes}` |
| Password check | decrypt `verifier_ct`; must equal `desksync-ok` |

- Master password and key never leave the device. Server stores only ciphertext.
- Extension keeps the unlocked key in `chrome.storage.session` (memory only), auto-locks after 15 min.
- Forgotten master password = vault lost (state this clearly in the UI and store listing).
- Flutter: use the `cryptography` package (`Pbkdf2`, `AesGcm.with256bits()`); its `SecretBox` = ciphertext + 16-byte MAC, matching WebCrypto's output.

## 4. Chrome extension (built)

- **Popup tabs:** Notes · Read later · Clipboard · Vault · Settings
- **Notes:** rich text (bold, italic, underline, strike, list, highlight), 6 colors, tags, pin, search, `#tag` filter
- **Read later:** save tab (button, `Alt+Shift+S`, right-click page/link), save all tabs, mark read, open
- **Clipboard:** opt-in; content script captures copy/cut only on sites the user approved (skips password fields), search, pin, copy back, save as note, manual "+ Paste"
- **Vault:** create / unlock / lock, add & edit items, password generator, copy username/password, prefill from current tab
- **Realtime:** popup refreshes when another profile or the phone changes data

## 5. Android app (`mobile/`, Flutter)

| Screen / feature | Notes |
|---|---|
| Login | same Supabase account |
| Notes | list + editor; renders the limited HTML as text spans; edits text only, keeping the stored body unless the text changes |
| Read later | list; **Share → DeskSync** intent saves links from any app |
| Clipboard | history synced from desktop; "save current clipboard" button (Android 10+ blocks background clipboard reading) |
| Vault | biometric unlock (key wrapped in Android Keystore), **AutofillService** for other apps and browsers |
| Offline | local cache (Drift/Isar), sync on reconnect |

## 6. Roadmap

1. ✅ Schema + extension MVP (all 4 features)
2. ✅ Flutter app: login, notes, read later + share intent (share sheet still to try on a device)
3. Flutter: clipboard view, vault with biometric unlock
4. Android AutofillService; extension autofill on login forms
5. Offline cache in the extension; trash with restore
6. Freemium: free = notes + read-later on 1 device class; Pro = sync everywhere, clipboard, vault
7. Store launch: Chrome Web Store + Play Store (privacy policy, data-safety form, justify optional host access)

## 7. Store-review notes

- No host access at install. Clipboard capture asks per site through `optional_host_permissions`, and the
  granted permissions are the allowlist. Supabase calls rely on CORS, not host permissions.
- Declare that vault data is end-to-end encrypted, and that clipboard text is stored in the user's account.
