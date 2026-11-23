# DeskSync

Notes, read-later, clipboard history and an encrypted password vault. Everything is saved in
the browser and works with no account. Signing in is optional: it syncs your data across Chrome
profiles and the Android app (`mobile/`, which needs an account). See `docs/ARCHITECTURE.md`.

## Without an account (1 minute)
Chrome → `chrome://extensions` → **Developer mode** → **Load unpacked** → pick the `extension/`
folder. That's it: nothing leaves the browser. Back up with Settings → **Export**, because
uninstalling the extension deletes its data.

## With sync (10 minutes)

### 1. Supabase
1. Create a free project at supabase.com.
2. **SQL Editor** → paste `supabase/schema.sql` → **Run**.
   Already had DeskSync running before the redesign? Also run `supabase/migrations/001_tags_and_markdown.sql`
   and then `supabase/migrations/002_plain_text_notes.sql` — `create table if not exists` does not add the
   new `tags` and `format` columns, or allow `format = 'plain'`, on tables you already have.
   Selling Pro? Also run `supabase/migrations/004_plans.sql`: sync then needs Pro (see *Free and Pro*
   below). For a project of your own, skip it and every account syncs.
3. **Authentication → Providers → Email**: enabled. (Turn off "Confirm email" while testing if you like.)
4. **Project Settings → API**: copy the Project URL and the `anon` public key.

### 2. Your keys
Run `make env`, then put the Project URL and anon key in `.env` (gitignored).

### 3. Extension
1. `make ext` builds it into `dist/extension`.
2. Chrome → `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick `dist/extension`.
3. Pin DeskSync. It works straight away; to sync, open Settings and sign in or create an account.
   Whatever is already on this device goes into the account.
4. In each other Chrome profile: load the same folder and sign in with the same account.

After changing extension code, run `make ext` again and click reload on the extension's card.

### 4. Android app
Plug in a phone with USB debugging on, then run `make app`. See `mobile/README.md`.

### Commands
Run `make` to list them all: `env`, `ext`, `zip`, `site`, `store-check`, `admin`, `icons`, `app`, `apk`, `devices`, `test`, `test-ext`, `test-ui`, `clean`.

### Publishing
See [docs/STORE_LISTING.md](docs/STORE_LISTING.md): what to paste into the Chrome Web Store, the
images in `docs/store/`, and the checklist. `make store-check` checks the build against the store's
rules, and `make site` builds the website (landing page, privacy policy, sync waitlist) into
`dist/site`, and `make publish-site` copies it to the VPS that serves desksync.org
(`deploy/vps/`: a small Caddy container behind the server's main Caddy, which handles HTTPS).

## Use
| Action | How |
|---|---|
| Open | click the icon or `Alt+Shift+D`. The popup opens with the cursor in the search field |
| Find anything | just type — one search covers notes, links, clipboard and vault. Arrow to move, Enter to open |
| Filter by type | the rail down the left, or `Ctrl+1` to `Ctrl+5` |
| Filter by tag | click a chip, or type `#tag` in the search field — they are the same thing |
| Tag something | select it, then *+ Tag* in the pane on the right. Works on all four types |
| Tag rules | up to 32 characters: letters in any language (Bangla included), numbers, `-` and `_`. Spaces become `-` and capitals small, so "Weekly Shop" is `#weekly-shop`. Up to 10 tags on one item. The same rules on the phone (`extension/lib/tags.js`, `parseTags` in `mobile/lib/data/models.dart`) |
| Rename or delete a tag | Settings → Tags. Renaming rewrites it everywhere; deleting only removes the label, never the item |
| Save tab to read later | `Alt+Shift+S`, right-click → *Save page/link to Read Later*, or the popup button |
| Save selected text as a note | right-click → *Save selection as a note*. The page's address is added at the foot as `Source: …` |
| New note from any page | `Alt+Shift+K` |
| Save the clipboard from any page | no key by default (Chrome allows an extension four): set one at `chrome://extensions/shortcuts` |
| Fill a login | `Alt+Shift+L` on a sign-in page, without opening DeskSync. One saved login for the site fills at once; with several, a small chooser on the page shows names and usernames (never passwords). On a two-step sign-in it fills the username, then the password on the next page, then the 2FA code on the page that asks for it (for a login with a 2FA setup key). A locked vault opens DeskSync to unlock it |
| Import passwords | Settings → Vault → *Import*: a CSV export from Chrome, Edge, Firefox or another manager. Logins already saved are skipped. Delete the CSV afterwards |
| Add a note fast | type the line in *Take a note…* at the top of the list and press Enter — the note is made with that line in it and the editor opens on it, caret at the end. Enter on an empty box starts a blank note, as *New note* does. A tag filter that is on is added to the note |
| Write a note | select it and type. Bold, italic, checkboxes and lists show as they look; underneath, the note is plain text. It saves as you type (the popup closes the moment you click elsewhere); the footer says *Saved*, or *Not saved* with a *Retry* button |
| Start a note as… | an empty note offers *Note*, *Tasks* and *Email*; or type `/task` or `/email` and press Enter |
| Tasks | `[ ] ` starts one. Enter adds the next, Enter on an empty one ends the list. `Ctrl+Enter` or a click on the box ticks it. `Alt+↑/↓` moves a line, `Tab`/`Shift+Tab` indents. ⋮ → *Ticked to the bottom*. The list row shows *2/5 done*, and an unfinished list stays in Today |
| Lists | `- ` and `1. ` carry on to the next line on Enter, like tasks |
| Write an email | start a note as *Email*, or begin it with a `To:` line (then `Cc:`, `Bcc:`, `Subject:` if you want them, a blank line, and the message). *Open in mail* opens your mail app with everything filled in; ⋮ offers Gmail instead, and Settings → *Emails open in Gmail* swaps the two. Copy and Insert take the message alone |
| Templates | ⋮ → *Save as template* on any note. New notes then offer it beside Note, Tasks and Email; picking one copies its text, and the template is left as it was |
| Bold, italic, lists | select text and a bar appears above it: **B**, *I*, tasks, bullets. `Ctrl+B` and `Ctrl+I` work too. The editor shows real bold and italic with no markers; the note stores `**bold**` and `_italic_` as text. Copy and Insert give Gmail, Docs and Notion real formatting and plain fields the words without markers. *Open in mail* sends plain text (mail links cannot carry formatting): use *Copy the email text* to keep it |
| Find in a note | `Ctrl+F` in the editor. Enter for the next match, Shift+Enter for the one before, Esc to close with the match selected |
| Link some words | select them and paste a URL: you get `the words (https://…)` instead of losing them |
| Room to write | the ⤢ button gives the note the whole popup |
| Keep it open | the panel button at the foot of the rail moves DeskSync into Chrome's side panel, where it stays while you click around the page. Narrow panels stack the list above the pane |
| Today | the second rail button: pinned items, unread links, and notes and clips from the last day. `Ctrl+0`. Settings → *Start on Today* makes it the default |
| Insert into a page | click into a text box on the page, open DeskSync, pick a note or clip, then `Shift+Enter` (or *Insert*). Notes work as saved replies and snippets: the title is the name you search by |
| Note on a link | select a Read later link and type in its note field: why you saved it, a quote. Search finds links by their note |
| Copy a list | filter by type, tag or search, then the list button beside the count copies what is shown as text: links with their URL and note, notes with their text |
| Search from the address bar | type `ds`, a space, then the search. Links open directly; notes and clips open DeskSync in a tab |
| Keys and tokens | a clip that looks like an API key, token or private key is shown masked and left out of search. *To vault* moves it into the encrypted vault. Captured clipboard leaves them out entirely (Settings → *Leave out keys and tokens*) |
| Add a login | Vault → *New login*. Editing one has an explicit Save, unlike notes: a password saved half-typed is a login you can no longer use |
| Clipboard history | off by default: in Settings, turn on capture and click *Allow* on each site, or use *Save from clipboard* in the Clipboard tab |
| Vault | Vault tab → set a master password, then save the recovery key it shows: the only way back in if you forget the password. Settings → Vault makes a new recovery key or changes the master password |
| 2FA codes | Vault → a login → *Edit* → *2FA setup key*: the key or `otpauth://` link a site shows when you set up an authenticator app. The login then shows the current code with a countdown and *Copy*, and *Fill* puts it into the site's code box |
| Password health | each login shows *Weak*, *Fair* or *Strong* under its password, and says when the same password is used for other logins; the list marks those with a warning. Worked out on this device, nothing is sent |
| Generate a password | Vault → *Edit* → the dice: *Random* (8–64 characters, symbols optional) or *Words*, a passphrase like `maple-orbit-tiny-crane-47` (3–10 words) |
| Backup codes | Vault → a login → *Edit*, then paste the codes the site gave you (any common format; headings are skipped). The login shows *7 of 10 codes left*; *Copy* on a code copies it and marks it used, with *Undo*. Used codes fold away and can be restored. A new set from the site replaces the old one |
| Copied passwords | a password, backup code or key you copy is cleared from the clipboard after 30 seconds, unless you copied something else since. Settings → Vault to turn it off |
| Fill a login | open the site, then Vault → the item saved for that site → *Fill*. On a 2FA step it fills the code |
| Unread count | the icon shows how many Read later links are unread. Settings → *Unread count on the icon* turns it off |
| Undo a delete | the trash icon on the rail, or Settings → Trash → *Restore*. The trash keeps items 30 days (Pro: a year) |

Change shortcuts at `chrome://extensions/shortcuts`.

## Files
```
supabase/schema.sql       tables, RLS, realtime
supabase/migrations/      changes to run against a database that already exists
extension/manifest.json   MV3 manifest
extension/background.js   context menus, shortcut, clipboard capture, vault auto-lock
extension/content.js      captures copy/cut on approved sites (skips password fields)
extension/popup.*         UI (780x560 landscape: rail, search list, detail pane). The same page is the side panel (`?view=panel`) and a full tab (`?view=tab`)
extension/lib/detect.js   tells a secret (API key, token) or code apart from ordinary copied text
extension/lib/plaintext.js turns notes from the older editors (HTML, markdown) into plain text
extension/icons/          generated by tools/make_icons.py (`make icons`)
extension/lib/store.js    the local store: every row, kept in the browser
extension/lib/client.js   Supabase client, sync, and the `db` API on top of the store
extension/lib/crypto.js   vault encryption (PBKDF2 + AES-GCM)
extension/lib/health.js   password strength and reuse, 2FA codes (TOTP), passphrases
extension/lib/words.js    the passphrase word list (EFF short list, CC BY 3.0 US)
tests/                    extension tests: offline sync, plain text, secret detection, autofill (`make test-ext`), popup UI (`make test-ui`)
extension/lib/supabase.js vendored supabase-js 2.118 (MV3 forbids remote code)
mobile/                   Flutter Android app (see mobile/README.md)
```

## Free and Pro
Free is every feature on one device. Pro adds sync (other computers, the Android app) and lifts
three limits. The numbers live in one place, `PLANS` in `extension/lib/client.js`.

| | Free | Pro |
|---|---|---|
| Notes, links, logins, backup codes | No limit | No limit |
| Captured clips kept | Newest 200 (saved by hand and pinned: all) | All |
| Templates | 10 | No limit |
| Trash kept for | 30 days | A year |
| Sync and the Android app | — | ✓ |

Never limited: export, encryption, auto-lock, clearing copied passwords.

The server decides (`plans` table, `supabase/migrations/004_plans.sql`): row level security refuses
synced rows to an account without Pro, and the phone app shows a Pro screen. The extension keeps
the last answer so it works offline. A database without that migration has no plans, and every
account syncs as before. Give an account Pro by hand with the SQL at the end of the migration.

## Saved on this device first
Everything is kept in the browser (`extension/lib/store.js`, in `chrome.storage.local`) and
read from there, so the popup never waits on the network and works offline, with or without
an account. When you are signed in, `sync` in `extension/lib/client.js` pushes what changed here
and pulls the rest; an edit not yet pushed wins over the server's copy. A strip under the header
shows changes still waiting to sync.

- **Signing in** takes this device's data into the account.
- **Signing out** keeps it here. **Sign out and erase this device** (Settings) removes it.
- **Two vaults:** if this device and the account each have a vault with a different master
  password, sync leaves vault items alone and Settings asks which one to keep.
- **Export / Import** (Settings → Data): one JSON file, vault items still encrypted. Import
  merges, and the newer copy of a row wins.

## Notes are plain text, shown formatted
A note is stored as plain text, with `format = 'plain'`: `**bold**`, `_italic_`, `[ ] task`,
`[x] done`, `- bullet`, `1. numbered` (`extension/lib/tasks.js`, `extension/lib/format.js`).
That is what syncs, and what the phone shows, markers and all.

The extension's editor (`extension/lib/editor.js`) shows that text formatted, with no markers
in sight: bold is bold, a task is a checkbox. The text is the only truth. Every keystroke,
deletion, Enter and paste is applied to the text and the page redrawn from it, so what is saved
is always exactly what you see. The markers stay in the page, hidden and uneditable, so the
page reads back as the text. Typing `- `, `1. ` or `[ ] ` at the start of a line makes a list;
typing `**word**` makes it bold.

Notes written by the older editors carry `format = 'html'` or `format = 'markdown'`. Both
apps show them as text, and the first edit saves them back as `plain`. On a database that
has not had `002_plain_text_notes.sql` run yet, the extension saves as `markdown` instead
and shows a message naming the migration.

## Before publishing
- Privacy policy: [PRIVACY.md](PRIVACY.md). Host it at a public URL for the store form.
- Store listing text and the justification for every permission: [docs/STORE_LISTING.md](docs/STORE_LISTING.md).
- Screenshots: still to take, one per audience (see the listing doc).

## Credits
- Passphrase words: the [EFF short word list](https://www.eff.org/dice) by the Electronic
  Frontier Foundation, used under [CC BY 3.0 US](https://creativecommons.org/licenses/by/3.0/us/).
