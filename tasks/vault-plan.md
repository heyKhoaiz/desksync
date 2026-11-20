# Plan: the vault, for people with many accounts

## Goal

Sign back in to any of many accounts (several per site) in one keystroke, keep
each account's backup codes beside it and know how many are left, and publish
the whole of DeskSync as **one** Chrome Web Store extension.

**Single purpose (for the store form):** DeskSync keeps the things you need
while browsing (notes, saved pages, copied text and logins) in one private,
searchable place.

## Decisions

- **One extension.** The vault is one section of DeskSync, with the same
  search, look and storage. Its code lives in its own files so it could be
  split out later without a rewrite.
- **Fill by shortcut, not by a script on every page.** `Alt+Shift+L` (and the
  Fill button) use `activeTab`: access to the page in front, only when asked.
  No access to every site. An in-field icon is a later, opt-in step.
- **Backup codes are marked used, not deleted.** Copying a code moves it to a
  collapsed "Used" list, with Undo. The count of codes left is always shown.
- **Secrets leave the clipboard after 30 seconds.** A copied password or code
  is cleared, unless something else was copied since.
- **No server change.** Codes live inside each item's encrypted payload.

## Phase 1: backup codes and clipboard clearing — DONE 2026-11-20

1. `lib/codes.js`: read a pasted block of codes (one per line, Google's
   "1234 5678", "abcd-efgh", numbered lists, several per line), with tests.
2. Vault editor: a "Backup codes" box. Pasting a block adds the codes;
   existing ones keep their used state.
3. Vault item: "7 of 10 codes left", the unused codes hidden until shown,
   Copy on each. Copy marks the code used and offers Undo. "Used (3)" is
   collapsed, each with Restore. A warning at 2 or fewer.
4. List row: "7 codes left" under the account.
5. Clipboard clearing for passwords and codes: the service worker clears the
   clipboard 30 s later through an offscreen document, only if it still holds
   what was copied.

**Done when:** a pasted Google or GitHub code block becomes codes, copying one
marks it used and Undo brings it back, the count is right everywhere, and a
copied password is gone from the clipboard 30 s later.

## Phase 2: fill by shortcut, many accounts per site — DONE 2026-11-20

1. `Alt+Shift+L`: fill the page in front. One saved account fills at once;
   several show a small chooser on the page (labels, usernames, no
   passwords).
2. Accounts are told apart by their name ("Brand A Instagram") and username, shown in the chooser and the list. (A separate label field was not needed.)
3. On a site with saved accounts, DeskSync lists them first.
4. Import from Chrome's password export (CSV).

## Phase 3: store submission — DONE 2026-11-20 (support email and hosting left to you)

1. Listing text built on the single-purpose sentence; screenshots including
   the locked vault.
2. Permission justifications, one line each, naming the feature.
3. Data disclosure: authentication information, encrypted on the device,
   never sold or shared (Limited Use). Privacy policy section on codes and
   clipboard clearing.
4. Reviewer note with a test account and a sample vault.

## Later

- Optional in-field icon on login forms (needs access to every site).
- 2FA codes (TOTP), optional and labelled as weakening two-factor.
- Sharing a client's logins with a teammate (paid).
