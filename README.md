# DeskSync

Notes, read-later, clipboard history and an encrypted password vault — one account across
every Chrome profile and an Android app (`mobile/`, in progress). See `docs/ARCHITECTURE.md` for the full plan.

## Setup (10 minutes)

### 1. Supabase
1. Create a free project at supabase.com.
2. **SQL Editor** → paste `supabase/schema.sql` → **Run**.
3. **Authentication → Providers → Email**: enabled. (Turn off "Confirm email" while testing if you like.)
4. **Project Settings → API**: copy the Project URL and the `anon` public key.

### 2. Your keys
Run `make env`, then put the Project URL and anon key in `.env` (gitignored).

### 3. Extension
1. `make ext` builds it into `dist/extension`.
2. Chrome → `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick `dist/extension`.
3. Pin DeskSync, create an account, done.
4. In each other Chrome profile: load the same folder and sign in with the same account.

After changing extension code, run `make ext` again and click reload on the extension's card.

### 4. Android app
Plug in a phone with USB debugging on, then run `make app`. See `mobile/README.md`.

### Commands
Run `make` to list them all: `env`, `ext`, `app`, `apk`, `devices`, `test`, `clean`.

## Use
| Action | How |
|---|---|
| Open | click the icon or `Alt+Shift+D` |
| Save tab to read later | `Alt+Shift+S`, right-click → *Save page/link to Read Later*, or the popup button |
| Save selected text as a note | right-click → *Save selection as a note* |
| Clipboard history | off by default: in ⚙, turn on capture and click *Allow* on each site, or use *+ Paste* in the Clipboard tab |
| Vault | Vault tab → set a master password (cannot be recovered) |

Change shortcuts at `chrome://extensions/shortcuts`.

## Files
```
supabase/schema.sql       tables, RLS, realtime
extension/manifest.json   MV3 manifest
extension/background.js   context menus, shortcut, clipboard capture, vault auto-lock
extension/content.js      captures copy/cut on approved sites (skips password fields)
extension/popup.*         UI
extension/lib/client.js   Supabase client + data helpers
extension/lib/crypto.js   vault encryption (PBKDF2 + AES-GCM)
extension/lib/supabase.js vendored supabase-js 2.118 (MV3 forbids remote code)
mobile/                   Flutter Android app (see mobile/README.md)
```

## Before publishing
- Add icons (16/48/128 px) to the manifest.
- Write a privacy policy (clipboard text is stored in the user's account; vault is end-to-end encrypted).
