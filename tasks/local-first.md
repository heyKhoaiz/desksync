# Plan: local-first DeskSync, account optional

## Goal

DeskSync works the moment it is installed, with no sign-in. Notes, read later,
clipboard, vault and trash are all saved in the browser. An account becomes an
optional extra that syncs this local data to Supabase (other Chrome profiles, the
phone). It is never a requirement.

## Where things stand

- `popup.js` `boot()` shows the sign-in form and stops when there is no user.
  Nothing works signed out.
- `background.js` checks `currentUser()` before Save tab, Save selection, clipboard
  capture and the outbox alarm. Signed out, each one shows a red `!` badge and saves
  nothing.
- `lib/client.js` treats Supabase as the source of truth. `cache:*` in
  `chrome.storage.local` is only a read-through copy, and `outbox` only queues
  writes while offline.
- The vault's master-password metadata (`vault_meta`) only exists on the server.
- Trash (`listDeleted`, `restore`, `purge`) goes straight to Supabase and has no
  local path.
- Sign-out runs `cache.clear()`, which deletes everything local.

## Architecture decisions

- **The local store is the source of truth; Supabase is a mirror.** Every read and
  write goes to local storage first. Sync, when signed in, runs in the background
  and the UI never waits on it.
- **Keep the `db` API.** `db.list/insert/update/upsert/remove/restore/purge` keep
  their signatures, so `popup.js` and `background.js` barely change. Only
  `lib/client.js` gets rewritten underneath.
- **Same row shape locally and remotely.** Client-generated uuid `id`,
  `created_at`, `updated_at`, `deleted_at` tombstones. That is already the case,
  and it is what makes the later merge simple.
- **Storage: `chrome.storage.local` plus the `unlimitedStorage` permission.** The
  service worker can already reach it, and the code already uses it. Without that
  permission the quota is 10 MB, which a large clipboard history would fill.
  IndexedDB is only worth it if we later need queries or attachments.
- **Conflict rule for sync: last write wins per row, by `updated_at`.** A deleted
  row is a tombstone carried with its `deleted_at`. This is simple and predictable,
  and enough for one person on a few devices.

## Status (2026-11-20): all four phases done

Open questions were taken with the recommended answers: the phone stays
account-only; sign-out keeps this device's data, with a separate "Sign out and
erase this device"; each Chrome profile has its own data until it signs in.

## Task list

### Phase 1 — local store (no behaviour change yet) — DONE 2026-11-20

Shipped with a working push/pull sync rather than none, so a signed-in user
loses nothing between phases. Sign-in is still required until Phase 2.

#### 1. `lib/store.js`: local tables
One key per table (`local:notes`, …) holding every row, tombstones included.
Functions: `all(table)`, `put(table, row)` (stamps `updated_at`), `patch`,
`tombstone`, `restore`, `purge`, `purgeDeleted`. Every change is also added to a
`changes` log (the outbox, renamed) for sync to send later.
- [ ] Rows survive closing the popup and restarting Chrome
- [ ] Unit tests in Node with a fake `chrome.storage`
**Files:** `extension/lib/store.js` (new), `tests/store.test.js` (new) · **Scope:** M

#### 2. `db` reads and writes go through the store
Rewrite `db` in `lib/client.js` on top of `store`. Trash is served from local
tombstones. `cache:*` and `cache.claim` go away.
- [ ] All existing UI tests pass with the network stubbed out entirely
**Files:** `extension/lib/client.js`, `tests/ui/fixtures.js` · **Scope:** M

#### 3. `unlimitedStorage` permission
**Files:** `extension/manifest.json` · **Scope:** XS

### Phase 2 — no sign-in required

#### 4. Open straight into the app
`boot()` no longer gates on `currentUser()`. The `#auth` section moves into
Settings as "Sign in to sync (optional)". The rail and Settings show "Saved on this
device" when signed out.
- [ ] Fresh install → popup opens on Everything, empty, ready to type
- [ ] No Supabase request is made while signed out
**Files:** `extension/popup.js`, `extension/popup.html`, `extension/popup.css` · **Scope:** M

#### 5. Background actions work signed out
Remove the `currentUser()` checks from Save tab, Save selection, clipboard capture
and the draft replay. The outbox alarm only syncs when signed in.
Also fix: Save selection stores `escapeHtml(text)`, but notes are now plain text,
so `&` would show as `&amp;`. Store the raw selection with `format: 'plain'`.
**Files:** `extension/background.js` · **Scope:** S

#### 6. Local vault
`vault_meta` (salt, iterations, verifier) is kept locally like any other table.
Setup and unlock read it from the store. The encryption itself does not change.
- [ ] Set up, lock and unlock the vault with no account
**Files:** `extension/popup.js` · **Scope:** S

**Checkpoint:** the whole extension works offline, with no account and no `.env`.
`make test` is green.

### Phase 3 — optional sync

#### 7. Sync engine (`lib/sync.js`)
- **Push:** send the `changes` log to Supabase as upserts by `id`.
- **Pull:** fetch rows with `updated_at > lastPulledAt` (tombstones included) and
  merge them into the store, last write wins.
- Runs on sign-in, on the alarm, on popup open, and on realtime events. Offline is
  a no-op, not an error.
- [ ] Two profiles signed into one account converge after a sync
- [ ] Editing the same note on both sides keeps the newer one
**Files:** `extension/lib/sync.js` (new), `extension/background.js` · **Scope:** L

#### 8. First sign-in merges, sign-out keeps
- **On sign-in:** local rows are uploaded and remote rows downloaded. Nothing is
  overwritten blindly.
- **Vault:** if both sides already have a vault with different master passwords,
  ask which one to keep. Never merge two keys silently.
- **On sign-out:** local data stays on this device (see question 2).
**Files:** `extension/lib/sync.js`, `extension/popup.js` · **Scope:** M

### Phase 4 — not losing data without a cloud

#### 9. Export and import
Settings → "Export everything" saves one JSON file. Vault rows stay encrypted in it.
"Import" merges a file back, last write wins. Without an account this is the only
backup: uninstalling the extension deletes `chrome.storage.local`.
**Files:** `extension/popup.js` · **Scope:** S

## Open questions — answer before Phase 3

1. **The phone app.** Should it also work without an account (its own local data,
   no sync), or stay account-only as the sync companion?
   *Recommendation:* stay account-only for now. Local-first on the phone is a
   separate project.
2. **Sign-out.** Keep this device's data (*recommended*: it was the user's before it
   was ever synced), or wipe it as today?
3. **Each Chrome profile is separate without an account.** The original pitch, "one
   account for every Chrome profile", only holds once you sign in. Is that fine?

## Risks

- Uninstalling the extension or clearing site data deletes everything that was
  never synced. Settings needs to say so plainly, and Export (task 9) is the
  mitigation.
- Last write wins can drop an edit made offline on two devices at the same time.
  This is acceptable for one person; per-field merging is not worth the complexity.
- The remaining UI tests that assume a signed-in boot need a signed-out variant.
