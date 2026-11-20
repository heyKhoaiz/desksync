# DeskSync — Architecture Plan

Notes, read-later, clipboard history and a password vault, saved in the browser first
(`extension/lib/store.js`) and usable with no account. An optional account syncs them across
every Chrome profile and the Android app, through Supabase; the phone app requires one.

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
- RLS policy on every table: `user_id = (select auth.uid())` (wrapped so it is evaluated once per query, not per row).
- Rows get a client-generated uuid, so one created offline keeps its id once it syncs.

## 3. Vault crypto (must match exactly in Flutter)

| Step | Spec |
|---|---|
| Key derivation | PBKDF2-HMAC-SHA256, 600,000 iterations, 16-byte random salt → 256-bit key |
| Vault key | Random 256-bit key that encrypts every item; never changes. Vaults from before migration 005 use PBKDF2(master password, `salt`) instead |
| Master password wrap | `pw_wrap_ct` = AES-GCM(PBKDF2(master password, `pw_salt`), base64(vault key)). When present, it is the only way the master password opens the vault |
| Recovery key wrap | `rk_wrap_ct` = AES-GCM(PBKDF2(recovery key, `rk_salt`), base64(vault key)). Recovery key: 20 random bytes in Crockford base32, 8 groups of 4; uppercased with I/L read as 1 and O as 0 before use |
| Encryption | AES-256-GCM, 12-byte random IV per write, 16-byte tag appended to ciphertext |
| Encoding | standard base64 |
| Payload | JSON `{title, url, username, password, notes}` |
| Password check | decrypt `verifier_ct`; must equal `desksync-ok` |

- Master password and key never leave the device. Server stores only ciphertext.
- Extension keeps the unlocked key in `chrome.storage.session` (memory only), auto-locks after 15 min.
- Forgotten master password: the recovery key opens the vault and sets a new one. No recovery key = vault lost; the only way out is Reset, which deletes its items (state this clearly in the UI and store listing).
- Changing the master password or the recovery key rewrites only `vault_meta`; items are never re-encrypted, and `salt` + `verifier_ct` (the vault's identity for sync) stay the same.
- Code: `extension/lib/crypto.js` (`vaultKeys`), tests in `tests/vaultkeys.test.js`.
- Flutter: use the `cryptography` package (`Pbkdf2`, `AesGcm.with256bits()`); its `SecretBox` = ciphertext + 16-byte MAC, matching WebCrypto's output.

## 4. Chrome extension (built)

- **Popup layout:** 780x560 landscape (Chrome caps a popup at 800x600). A rail of the four
  types, one search field over all of them, and a detail pane on the right — selecting a row
  reads it in place instead of navigating. Replaced four tabs that each had their own search,
  where the thing you wanted was usually in a tab you were not in.
- **Search:** one field across notes, links, clips and vault. Scored title-prefix > title >
  second line > tag. `#tag` tokens in the same field are the tag filter, so the chips and the
  typed text are one piece of state.
- **Tags:** on all four types, not just notes. Rename, delete and colour live in Settings
  because they act on every item carrying the tag. Vault tags are stored inside the encrypted
  payload, never in a column
- **Notes:** plain text (`format` column: `plain`; `html` and `markdown` rows from the older
  editors are flattened to text by `lib/plaintext.js` when shown, and saved back as `plain`
  on first edit). The editor is a `<textarea>`: no toolbar, no markdown, no checklists, and
  undo, selection and spellcheck are the browser's own. No Save button — a popup can be
  dismissed at any moment, so it autosaves. No Edit button either: selecting a note shows it
  ready to type in. Focus stays in the search field until you click into the note or press Enter,
  so the list still arrows. Selecting without typing does not write
- **Vault editor:** create and edit logins, with a generator and show/hide. Explicit Save,
  unlike notes: a half-typed password overwrites a working one
- **Read later:** save tab (button, `Alt+Shift+S`, right-click page/link), save all tabs, mark read, open
- **Clipboard:** opt-in; content script captures copy/cut only on sites the user approved for capture (skips password fields), search, pin, copy back, save as note, manual "Save from clipboard"
- **Vault:** create / unlock / lock, add & edit items, password generator, copy username/password, prefill from current tab
- **Autofill:** an item saved for the site in front gets a Fill button; explicit click only, active tab only, host must match. Asks for host access to that site, which is kept separate from the clipboard-capture allowlist
- **Trash:** restore or permanently delete soft-deleted notes, links and vault items (clips are excluded: their text is erased on delete)
- **Vault lock:** gates the detail pane only. The list keeps working while the vault is locked;
  vault items simply are not in it, because their titles live inside the ciphertext too
- **Offline:** reads come from a chrome.storage.local cache; writes queue in an outbox and replay in order, from the popup or a one-minute service-worker alarm
- **Realtime:** popup refreshes when another profile or the phone changes data

## 5. Android app (`mobile/`, Flutter)

| Screen / feature | Notes |
|---|---|
| Login | same Supabase account |
| Notes | list + plain-text editor; reads `format` and flattens older `html`/`markdown` notes to text (`note_html.dart`); saves as `format='plain'`, keeping the stored body untouched unless the text changes |
| Read later | list; **Share → DeskSync** intent saves links from any app |
| Clipboard | history synced from desktop; "save current clipboard" button (Android 10+ blocks background clipboard reading) |
| Vault | biometric unlock (key wrapped in Android Keystore), **AutofillService** for other apps and browsers |
| Offline | local cache (Drift/Isar), sync on reconnect |

## 6. Roadmap

1. ✅ Schema + extension MVP (all 4 features)
2. ✅ Flutter app: login, notes, read later + share intent (share sheet still to try on a device)
3. Flutter: clipboard view, vault with biometric unlock
4. ✅ Extension autofill on login forms · ⬜ Android AutofillService
5. ✅ Offline cache in the extension; trash with restore
6. Freemium: free = notes + read-later on 1 device class; Pro = sync everywhere, clipboard, vault
7. Store launch: Chrome Web Store + Play Store (privacy policy, data-safety form, justify optional host access)

## 7. Store-review notes

- No host access at install. Both clipboard capture and autofill ask per site through
  `optional_host_permissions`. Supabase calls rely on CORS, not host permissions.
- Granted origins are not themselves the capture allowlist: capture runs only on sites explicitly
  approved in Settings, so filling a password on a site does not start recording copies there.
- Declare that vault data is end-to-end encrypted, and that clipboard text is stored on the device, and in the user's account only if they sign in.
