# DeskSync privacy policy

Last updated: 20 November 2026

DeskSync is a browser extension (and an optional Android app) for notes, read-later links,
clipboard history and an encrypted password vault. This page says what it stores, where, and
who can see it.

## Without an account

Everything stays in your browser, in the extension's own storage (`chrome.storage.local`).
Nothing is sent anywhere. Uninstalling the extension, or clearing its data, deletes it; use
Settings → Export to keep a copy.

## With an account (optional)

If you sign in, your notes, read-later links, clips and vault items are copied to a database
run on Supabase, so they can sync to your other browsers and your phone. Each row is tied to
your account and protected by row-level security: only you can read or change your rows.

- **Notes, links and clips** are stored as you wrote or copied them. They are not end-to-end
  encrypted: they are protected by your account, not by a key only you hold.
- **Vault items** (logins and passwords) are encrypted in your browser before they are saved,
  with a key derived from your master password (PBKDF2, 600,000 iterations, then AES-GCM).
  The master password and the key never leave your device. Nobody else, including whoever
  runs the database, can read your vault, and a forgotten master password cannot be recovered.
- **Your email address** is used to sign you in.

Signing out keeps your data on the device. "Sign out and erase this device" removes it from the
browser; your account keeps its copy.

## Clipboard

Clipboard history is **off** by default. When you turn it on, DeskSync records what you copy
only on sites you approve one at a time, and never from password fields. Text that looks like
an API key, token or private key is left out unless you turn that protection off. For each
clip only the site's hostname is kept, not the full address, because full addresses can carry
secrets such as reset tokens.

"Save the clipboard" reads the clipboard once, when you ask.

## Other permissions, and what they are used for

- **Tabs and active tab**: to save the page you are on, show its title and address, and type a
  note or clip into a text box on it when you ask ("Insert").
- **Site access (optional, per site)**: clipboard capture on approved sites, filling a saved
  login on the site it belongs to, and inserting text from the side panel.
- **Side panel**: to show DeskSync beside the page.
- **Favicon**: to show a saved link's site icon from Chrome's own cache. Nothing is fetched from
  the site.
- **Context menus, keyboard shortcuts, address bar keyword ("ds")**: ways to save and search.
- **Alarms**: syncing in the background, and locking the vault after a period of inactivity.

## What DeskSync does not do

- No analytics, tracking, advertising or telemetry.
- No selling or sharing of your data with anyone.
- No reading of pages, history or forms beyond the actions above, each started by you.

## Deleting your data

Without an account: uninstall the extension, or use "Sign out and erase this device".
With an account: delete your items in the app (they are removed from the trash after 30 days,
or at once with "Delete forever"), or contact us to have the account and all its rows deleted.

## Contact

Questions or deletion requests: add the support email address here before publishing.
