# Chrome Web Store submission

Everything to paste into the developer dashboard, in the order the dashboard asks for it.
Images are in [docs/store/](store/); re-render them with `node docs/store/make-shots.mjs`
after a UI change.

**Before submitting:** put a support email in [PRIVACY.md](../PRIVACY.md) (*Contact*) and host
that page at a public URL; the dashboard needs both.

---

## 1. Store listing tab

**Name** (75 max)
> DeskSync: Notes, Logins & Backup Codes

**Summary / short description** (132 max; it is also `description` in the manifest)
> Keep notes, saved pages, copied text and logins in one private, searchable place. Works offline; sync is optional.

**Category:** Productivity · **Language:** English

**Detailed description**

> DeskSync keeps the things you need while browsing in one private, searchable place: notes you
> write, pages you save, text you copy, and the logins you sign in with.
>
> **One search for all of it.** Press Alt+Shift+D and type. Notes, saved pages, copied text and
> logins come up together. Arrow down, press Enter.
>
> **Notes that look like notes.** Bold, lists and checklists show as they look. Tick a task and the
> list remembers how far along you are. Start a note as a checklist or an email.
>
> **Save in a keystroke.** Alt+Shift+S saves the tab you are on. Alt+Shift+K starts a note from any
> page. Right-click selected text to keep it as a note, with the page it came from.
>
> **Every account, every backup code.** Keep several logins for one site, each with its own name,
> and the backup codes that came with it. DeskSync shows how many codes are left and warns you
> before they run out. Signed out? Press Alt+Shift+L on the sign-in page: one account fills at
> once; with several, you choose.
>
> **Private by design.** Logins and backup codes are encrypted on your device with a master
> password that never leaves it. A copied password is cleared from the clipboard after 30 seconds.
> Clipboard history is off until you turn it on, site by site, and it skips passwords and API keys.
>
> **Today first, your sites one click away.** Everything opens on what needs you today: pinned
> items, unread pages and anything new. Beside it, the sites you open every day, as a row of icons;
> + adds the page you are on.
>
> **Stays out of your way.** Works the moment it is installed, with no account. Keep it in the
> side panel while you read. Search from the address bar by typing "ds". Light and dark themes.
>
> **Free, with Pro coming.** Every feature is free on one computer. Free keeps 20 notes, 20 logins,
> backup codes on 2 logins, 5 site shortcuts, the newest 200 captured clips and 10 templates, with
> no limit on saved pages; the trash keeps items for 30 days. DeskSync Pro, coming soon as a paid
> plan, will add sync across your computers and the Android app. Join the waitlist at
> desksync.org. The vault stays end-to-end encrypted: nobody but you can read it.

**Images**

| Field | File |
|---|---|
| Icon (128×128) | `extension/icons/icon128.png` |
| Screenshot 1 · one search | `docs/store/screenshot-1.png` |
| Screenshot 2 · notes | `docs/store/screenshot-2.png` |
| Screenshot 3 · accounts and backup codes | `docs/store/screenshot-3.png` |
| Screenshot 4 · fill by shortcut | `docs/store/screenshot-4.png` |
| Screenshot 5 · side panel | `docs/store/screenshot-5.png` |
| Small promo tile (440×280) | `docs/store/promo-small.png` |

All sample data in the images is made up. No real logos: the sign-in page in screenshot 4 is a
plain form with no brand marks.

---

## 2. Privacy practices tab

**Single purpose**
> DeskSync is a personal workspace for browsing: it keeps the things you need while on the web
> (notes, saved pages, copied text, logins and your everyday sites) in one private, searchable
> place.

**Permission justifications** (one box per permission)

| Permission | Justification to paste |
|---|---|
| `storage` | Every note, saved page, clip and encrypted login is stored in the browser first, so the extension works offline and with no account. |
| `unlimitedStorage` | Clipboard history and long notes can pass the 10 MB default limit of local storage. |
| `tabs` | To save the current tab to Read later (its title and address), and to show the logins saved for the site in front. |
| `activeTab` | When the user presses Alt+Shift+L, or Fill or Insert in the popup, DeskSync gets access to that one page only, to type the chosen login or text into it. No access to other sites. |
| `scripting` | Injects the form filler, the account chooser and the text insert into the page the user acted on, and the clipboard capture script on sites the user approved. Nothing is injected without a user action or approval. |
| `contextMenus` | "Save page to Read Later", "Save link to Read Later" and "Save selection as a note" in the right-click menu. |
| `alarms` | Background sync when signed in, locking the vault after inactivity, and clearing a copied password from the clipboard after 30 seconds. |
| `clipboardRead` | "Save the clipboard", when the user asks for it, and its preview. |
| `clipboardWrite` | Copy buttons for notes, links, clips, passwords and backup codes. |
| `offscreen` | Clears a copied password or backup code from the clipboard 30 seconds later. The service worker has no clipboard, so a hidden page does this, and only if the clipboard still holds what DeskSync copied. |
| `sidePanel` | Lets the user keep DeskSync open beside the page instead of in the popup. |
| `favicon` | Shows the site icon of each saved page and site shortcut from Chrome's own cache, so nothing is fetched from the site. |
| Optional host access (`*://*/*`) | Never requested at install. Asked for one site at a time, only when the user turns on clipboard capture for that site, or fills or inserts from the side panel (which has no activeTab). |
| `omnibox` keyword "ds" | Search saved notes, pages and clips from the address bar. |

**Remote code:** No, I am not using remote code. The Supabase client is bundled
(`extension/lib/supabase.js`); there is no `eval` and no script loaded from the network.

**Data usage** (tick these; collection only happens when the user signs in to sync)

| Category | Tick | What and why |
|---|---|---|
| Personally identifiable information | ✓ | Email address, to sign in to sync. |
| Authentication information | ✓ | Saved logins and backup codes, end-to-end encrypted on the device before they are synced; the server cannot read them. |
| Website content | ✓ | Notes, clipped text and saved page titles and addresses the user chooses to save, to sync them. |
| Personal communications | | Not collected. |
| Web history | | Not collected. Only pages the user explicitly saves; browsing history is never read. |
| User activity | | Not collected. No analytics, no tracking. |
| Health, financial, location | | Not collected. |

Certify all three:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** the public address of [PRIVACY.md](../PRIVACY.md).

---

## 3. Notes for the reviewer (Distribution tab → test instructions)

> DeskSync works with no account: install it and everything is saved in the browser.
>
> To try the vault:
> 1. Click the DeskSync icon, then Vault on the left, then "Set up your vault". Choose any master
>    password of 10 or more characters.
> 2. "New login": name "Example", website https://example.com, any username and password.
>    Save.
> 3. Open the login, Edit, and paste these backup codes into "Backup codes", then Save:
>    `a1b2c-3d4e5` `f6a7b-8c9d0` `11aa2-bb33c`. The login shows "3 of 3 codes left"; Copy on a code
>    marks it used, with Undo.
> 4. To fill: save a login for a site with a sign-in form, for example website
>    https://github.com with any username and password, then open https://github.com/login and
>    press Alt+Shift+L. The username and password fields are filled. Save a second login for the
>    same site and press Alt+Shift+L again: a chooser lists both by name and username.
>
> Clipboard capture is off by default; Settings → Clipboard turns it on, one site at a time.
> Sync needs an account and is optional; no test account is needed to review the extension.

---

## Checklist before upload

- [ ] In `.env`: `SUPPORT_EMAIL` and `PRIVACY_URL` (and `STORE_URL` once the listing exists)
- [ ] Waitlist table: run `supabase/migrations/003_waitlist.sql` in the Supabase SQL editor
- [ ] desksync.org's DNS points at the VPS (A record `@` → 144.217.95.90, `www` → the same,
      proxy off), then `make publish-site`. The site is at https://desksync.org, the policy at
      https://desksync.org/privacy.html (`PRIVACY_URL`)
- [ ] `make test-ext && make test-ui` pass
- [ ] `node docs/store/make-shots.mjs` re-run after the last UI change
- [ ] `make store-check` passes (manifest limits, files, icons, no remote code, settings filled in)
- [ ] `make zip` and upload `dist/desksync-extension.zip`
- [ ] Version in `extension/manifest.json` raised above the last published one
- [ ] Free's limits in `PLANS` (`extension/lib/client.js`) match the *Free, with Pro coming*
      paragraph above and the site's Free column
