# Chrome Web Store listing

Copy for the store form, the justification for each permission, and the screenshot list.

## Name

DeskSync – Notes, Read Later, Clipboard & Vault

## Short description (132 characters max)

Notes, read-later links, clipboard history and a password vault in one search. Works offline, no account needed.

## Detailed description

One place for the things you would otherwise lose in a tab.

Press Alt+Shift+D and type. A single search covers your notes, the pages you saved to read later,
your clipboard history and your password vault. Arrow down, press Enter, done.

**Capture in a keystroke**
- Alt+Shift+S saves the tab you are on to Read later
- Alt+Shift+K starts a note from any page
- Alt+Shift+V saves what you just copied
- Right-click selected text to save it as a note, with the page it came from

**Find it again**
- One search over everything, including the full text of notes and your comments on saved links
- Tags you can filter by, rename and colour
- Today: pinned items, unread links and anything from the last day
- Type "ds" in the address bar to search without opening anything

**For developers**
- Commands and code clips are shown in monospace
- API keys and tokens are masked in the list and kept out of search, and move to the encrypted
  vault in one click
- Captured clipboard skips anything that looks like a secret

**For marketers and writers**
- Save a quote with its source address
- Add a note to every saved link: why it matters, what to do with it
- Insert a saved reply or snippet into the text box you are typing in (Shift+Enter)
- Copy a tagged collection out as a list for a brief or a doc

**Stays out of your way**
- Works the moment it is installed. No account, nothing leaves your browser
- Keep it open in the side panel while you work
- An unread count on the icon
- Light and dark themes

**Optional sync**
Sign in to keep your Chrome profiles and the Android app in step. The vault is end-to-end
encrypted with a master password that never leaves your device.

## Category

Productivity

## Single purpose (for the review form)

Save, find and reuse your own notes, links, copied text and logins from one search in the browser.

## Permission justifications

| Permission | Why |
|---|---|
| `storage`, `unlimitedStorage` | Everything is stored in the browser first. Clipboard history can pass the 10 MB default quota. |
| `tabs` | Read the current tab's title and address to save it to Read later, and to know which saved login belongs to the page. |
| `activeTab` | Type a note or clip into the focused text box on the current page when the user picks "Insert" from the popup. |
| `contextMenus` | "Save page / link to Read Later" and "Save selection as a note". |
| `alarms` | Background sync, and locking the vault after inactivity. |
| `clipboardRead` | "Save the clipboard", when the user asks, and the preview of what will be saved. |
| `clipboardWrite` | Copy a note, clip, link or password when the user clicks Copy. |
| `scripting` | Fill a saved login, insert text into the page, and capture copies on sites the user approved. Every injection follows a user action or an approval for that site. |
| `sidePanel` | Show DeskSync beside the page. |
| `favicon` | Show each saved link's site icon from Chrome's cache instead of fetching it. |
| Optional host access (`*://*/*`) | Requested per site, only when the user approves clipboard capture on that site, fills a login there, or inserts text from the side panel. Never requested at install. |
| `omnibox` keyword "ds" | Search saved items from the address bar. |

Remote code: none. The Supabase client is bundled (`lib/supabase.js`).

Data use: see [PRIVACY.md](../PRIVACY.md). No data is sold, used for advertising or shared.

## Screenshots (1280×800, five)

Take these with sample data, never real notes or keys.

1. **Search everything**: the popup with a query typed and results from all four types.
2. **Developer**: the Clipboard filter with a command in monospace and a masked API key selected,
   showing the "To vault" button.
3. **Marketer**: a saved link with a note filled in, and the #launch tag filter active.
4. **Daily**: the Today view, with the unread count visible on the toolbar icon.
5. **Side panel**: DeskSync docked beside an article, with a note being written.

## Promo tile (440×280)

The search field with "launch" typed and three mixed results under it, on the brand grey.
