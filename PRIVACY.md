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
  with a vault key (AES-GCM) that is itself encrypted with your master password (PBKDF2,
  600,000 iterations), and, if you make one, with your recovery key. The master password, the
  recovery key and the vault key never leave your device unencrypted. Nobody else, including
  whoever runs the database, can read your vault. A forgotten master password can be replaced
  only with your recovery key; without one, the vault cannot be opened, and can only be reset.
- **Your email address** is used to sign you in.

Signing out keeps your data on the device. "Sign out and erase this device" removes it from the
browser; your account keeps its copy.

## Backup codes and copied passwords

Backup codes you paste into a login are stored with it, encrypted with your master password like
the rest of the vault. Copying a code marks it used; nothing is sent anywhere.

A copied password, backup code or key is taken off your clipboard 30 seconds later, unless you
have copied something else since. To check that, DeskSync keeps a one-way hash of what it copied,
never the text itself, and forgets it once the 30 seconds are up. You can turn this off in Settings.

## Filling logins and importing passwords

Filling a login (Alt+Shift+L, or Fill in DeskSync) gives DeskSync access to the page in front
only, at that moment, to type into its sign-in form. When a site has several saved logins, the
page is shown their names and usernames to choose from; no password reaches the page until you
choose. Other pages are never read.

Importing passwords reads the CSV file you choose inside your browser and encrypts each login
there. The file is not uploaded anywhere. Delete it afterwards: password exports are not encrypted.

## Clipboard

Clipboard history is **off** by default. When you turn it on, DeskSync records what you copy
only on sites you approve one at a time, and never from password fields. Text that looks like
an API key, token or private key is left out unless you turn that protection off. For each
clip only the site's hostname is kept, not the full address, because full addresses can carry
secrets such as reset tokens.

"Save the clipboard" reads the clipboard once, when you ask.

## Other permissions, and what they are used for

- **Tabs and active tab**: to save the page you are on, show its title and address, fill a login
  when you press Alt+Shift+L or Fill, and type a note or clip into a text box on it when you ask
  ("Insert").
- **Site access (optional, per site)**: clipboard capture on approved sites, filling a saved
  login on the site it belongs to, and inserting text from the side panel.
- **Side panel**: to show DeskSync beside the page.
- **Favicon**: to show a saved link's site icon from Chrome's own cache. Nothing is fetched from
  the site.
- **Context menus, keyboard shortcuts, address bar keyword ("ds")**: ways to save and search.
- **Alarms**: syncing in the background, locking the vault after a period of inactivity, and
  clearing a copied password after 30 seconds.
- **Offscreen document**: the background part of an extension has no clipboard, so a hidden page
  clears a copied password, only if the clipboard still holds what DeskSync copied.

## The website's waitlist

If you join the waitlist on DeskSync's website, your email address is stored to tell you when sync
(DeskSync Pro) is available, and for nothing else. It is not shared, and it can be read only by
DeskSync's owner. To be removed, write to the address below.

## What DeskSync does not do

- No analytics, tracking, advertising or telemetry.
- No selling or sharing of your data with anyone.
- No reading of pages, history or forms beyond the actions above, each started by you.

## Deleting your data

Without an account: uninstall the extension, or use "Sign out and erase this device".
With an account: delete your items in the app (they are removed from the trash after 30 days, or a year with Pro,
or at once with "Delete forever"), or contact us to have the account and all its rows deleted.

## Contact

Questions, or a request to delete your account or waitlist entry: {{SUPPORT_EMAIL}}
