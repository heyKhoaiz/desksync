// The local store: every row DeskSync has, kept in chrome.storage.local.
//
// This is the source of truth. The popup and the service worker read and write
// here and never wait on the network. Supabase, when the user is signed in, is a
// mirror that lib/client.js syncs with in the background.
//
// One key per table (`local:notes`, …) holding an array of rows, tombstones
// included. Rows have the same shape as in Postgres — client-generated uuid `id`,
// `created_at`, `updated_at`, `deleted_at` — plus a few local-only fields, all
// starting with `_`, which are never sent anywhere:
//
//   _dirty      changed here and not yet pushed
//   _synced     the server has (or had) this row
//   _purge      deleted for good here; the server copy still has to go
//   _syncError  the server refused this row; kept local until it is edited again
//
// Whether a row needs pushing lives on the row itself rather than in a separate
// queue. The popup and the service worker both write, and two contexts appending
// to one shared queue key can lose an entry; a row's own flag is written in the
// same set() as the row.

const LOCAL_PREFIX = 'local:';
const OWNER_KEY = 'cacheOwner';
const DRAFT_KEY = 'pendingDraft';
// The vault's master-password check (salt, iterations, verifier). One per vault,
// so it is a single object rather than a table. `VAULT_CONFLICT_KEY` holds the
// account's copy when it differs from this device's: two vaults with two master
// passwords, which sync will not merge on its own.
const VAULT_META_KEY = LOCAL_PREFIX + 'vault_meta';
const VAULT_CONFLICT_KEY = 'vaultConflict';
const VAULT_WRAP_FIELDS = ['pw_salt', 'pw_wrap_iv', 'pw_wrap_ct', 'rk_salt', 'rk_wrap_iv', 'rk_wrap_ct'];
const SYNC_TABLES = ['notes', 'read_later', 'clips', 'vault_items'];

// Column defaults, mirroring supabase/schema.sql, so a row made here looks the
// same as one that came back from the server.
const ROW_DEFAULTS = {
  notes: { title: '', body: '', format: 'plain', color: 'yellow', tags: [], pinned: false, deleted_at: null },
  read_later: { url: '', title: '', favicon: null, note: '', is_read: false, source: 'extension', tags: [], deleted_at: null },
  clips: { content: '', source_url: null, pinned: false, tags: [], deleted_at: null },
  // Vault tags live inside the encrypted payload, not in a column, so that a
  // plaintext 'banking' label never tells the server what a login is for.
  vault_items: { iv: '', ciphertext: '', deleted_at: null }
};

const nowIso = () => new Date().toISOString();
const isLocalField = (k) => k.startsWith('_');

// The row as the rest of the app sees it, and as the server receives it.
function cleanRow(r) {
  const out = {};
  for (const k of Object.keys(r)) if (!isLocalField(k)) out[k] = r[k];
  return out;
}

const store = {
  // Writes run one at a time, so two edits cannot both read the same array and
  // have the second set() undo the first.
  //
  // Across contexts, not just within one: the popup and the service worker
  // write the same keys (the popup pins a clip while the worker records a
  // copied one, or while its minute alarm marks rows synced), and a queue that
  // lived in one context let the other's write land in between and be lost.
  // Web Locks are shared by every page of the extension's origin, the worker
  // included. Node (the tests) has none, so there it falls back to a queue.
  _chain: Promise.resolve(),
  _locked(fn) {
    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
      return navigator.locks.request('desksync-store', () => fn());
    }
    const p = this._chain.then(fn);
    this._chain = p.catch(() => {});
    return p;
  },

  async _read(table) {
    const key = LOCAL_PREFIX + table;
    const r = await chrome.storage.local.get(key);
    return Array.isArray(r[key]) ? r[key] : [];
  },
  async _write(table, rows) {
    await chrome.storage.local.set({ [LOCAL_PREFIX + table]: rows });
  },

  // Raw rows, local fields and tombstones included. For sync and tests.
  raw(table) { return this._read(table); },

  // Live rows, newest first by `order`.
  async list(table, { order = 'updated_at', limit = Infinity } = {}) {
    const rows = (await this._read(table)).filter((r) => !r.deleted_at && !r._purge);
    rows.sort((a, b) => new Date(b[order] || 0) - new Date(a[order] || 0));
    return rows.slice(0, limit).map(cleanRow);
  },

  // Tombstones, most recently deleted first.
  async listDeleted(table, { limit = Infinity } = {}) {
    const rows = (await this._read(table)).filter((r) => r.deleted_at && !r._purge);
    rows.sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at));
    return rows.slice(0, limit).map(cleanRow);
  },

  // Applies `change(existing)` to one row and marks it for pushing. `existing`
  // is undefined for a new row. Returns the row as stored.
  _change(table, id, change) {
    return this._locked(async () => {
      const rows = await this._read(table);
      const i = rows.findIndex((r) => r.id === id);
      const next = change(i >= 0 ? rows[i] : undefined);
      if (!next) return null;
      const row = { ...next, id, updated_at: nowIso(), _dirty: true };
      delete row._syncError;
      if (i >= 0) rows[i] = row; else rows.unshift(row);
      await this._write(table, rows);
      return cleanRow(row);
    });
  },

  insert(table, row) {
    const id = row.id || crypto.randomUUID();
    return this._change(table, id, (old) => {
      const now = nowIso();
      // Copied, so no two rows share the default tags array.
      return { ...structuredClone(ROW_DEFAULTS[table]), created_at: now, ...(old || {}), ...row };
    });
  },

  // Insert-or-update by id. Only the columns given change, so an upsert of
  // {title, body} cannot reset a note's colour.
  upsert(table, row) {
    if (!row?.id) throw new Error('upsert needs an id');
    return this.insert(table, row);
  },

  update(table, id, patch) {
    return this._change(table, id, (old) => (old ? { ...old, ...patch } : null));
  },

  // Soft delete. `erase` blanks columns that should not outlive the delete.
  remove(table, id, erase = {}) {
    return this._change(table, id, (old) => (old ? { ...old, ...erase, deleted_at: nowIso() } : null));
  },

  restore(table, id) {
    return this._change(table, id, (old) => (old ? { ...old, deleted_at: null } : null));
  },

  // Gone for good. A row the server never had simply disappears; one it has is
  // kept as a `_purge` marker until sync has deleted the server copy.
  purge(table, id) {
    return this._locked(async () => {
      const rows = await this._read(table);
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) return;
      if (rows[i]._synced) rows[i] = { id, _purge: true, _dirty: true, _synced: true, updated_at: nowIso() };
      else rows.splice(i, 1);
      await this._write(table, rows);
    });
  },

  async purgeDeleted(table) {
    for (const r of await this.listDeleted(table)) await this.purge(table, r.id);
  },

  // How many rows are waiting to be pushed.
  async pending() {
    let n = 0;
    for (const t of SYNC_TABLES) n += (await this._read(t)).filter((r) => r._dirty).length;
    return n;
  },

  // The data on this device follows whoever signs in on it. Signing out keeps it;
  // signing in to an account merges it into that account.
  //
  // For the account this device last synced with, nothing needs doing. For any
  // other account, every row is marked as never synced and changed, so the first
  // sync uploads all of it — otherwise rows the old account had would look
  // "purged elsewhere" to the new one and be dropped. A pending server delete
  // belonged to the old account and is forgotten.
  async adopt(uid) {
    const { [OWNER_KEY]: owner } = await chrome.storage.local.get(OWNER_KEY);
    if (owner === uid) return;
    await this._locked(async () => {
      for (const t of SYNC_TABLES) {
        const rows = (await this._read(t)).filter((r) => !r._purge)
          .map(({ _synced, _syncError, user_id, ...r }) => ({ ...r, _dirty: true }));
        await this._write(t, rows);
      }
      const meta = await this.vaultMeta();
      if (meta) await chrome.storage.local.set({ [VAULT_META_KEY]: { ...meta, _dirty: true } });
      await chrome.storage.local.remove(VAULT_CONFLICT_KEY);
      await chrome.storage.local.set({ [OWNER_KEY]: uid });
    });
  },

  // Erases everything DeskSync keeps on this device.
  async clear() {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith(LOCAL_PREFIX) || k.startsWith('cache:'));
    await chrome.storage.local.remove([...keys, 'outbox', OWNER_KEY, DRAFT_KEY, VAULT_CONFLICT_KEY]);
  },

  // ---- the vault's master-password check ----

  async vaultMeta() {
    const { [VAULT_META_KEY]: m } = await chrome.storage.local.get(VAULT_META_KEY);
    return m && m.salt ? cleanRow(m) : null;
  },
  async rawVaultMeta() {
    const { [VAULT_META_KEY]: m } = await chrome.storage.local.get(VAULT_META_KEY);
    return m && m.salt ? m : null;
  },
  // `fromServer` marks it as already synced; otherwise sync uploads it.
  async setVaultMeta(meta, { fromServer = false } = {}) {
    const row = { salt: meta.salt, iterations: meta.iterations, verifier_iv: meta.verifier_iv,
      verifier_ct: meta.verifier_ct, _dirty: !fromServer, _synced: fromServer };
    // The wrapped vault key (lib/crypto.js). A vault made before wrapping has
    // none, and its row is left exactly as before, so it still syncs to a
    // database without migration 005.
    for (const k of VAULT_WRAP_FIELDS) if (meta[k] != null) row[k] = meta[k];
    await chrome.storage.local.set({ [VAULT_META_KEY]: row });
  },
  // Forgets this device's vault: its settings and every item. Sync's
  // resetVault clears the account's copy first.
  async clearVault() {
    await chrome.storage.local.remove([VAULT_META_KEY, VAULT_CONFLICT_KEY]);
    await this.dropVaultItems();
  },
  async vaultConflict() {
    const { [VAULT_CONFLICT_KEY]: c } = await chrome.storage.local.get(VAULT_CONFLICT_KEY);
    return c || null;
  },
  async setVaultConflict(remote) {
    if (remote) await chrome.storage.local.set({ [VAULT_CONFLICT_KEY]: remote });
    else await chrome.storage.local.remove(VAULT_CONFLICT_KEY);
  },
  // Drops every local vault item, for when the account's vault replaces this one.
  async dropVaultItems() {
    await this._locked(() => this._write('vault_items', []));
  },
  // Marks every local vault item for upload, for when this device's vault
  // replaces the account's.
  async redirtyVaultItems() {
    await this._locked(async () => {
      const rows = (await this._read('vault_items')).filter((r) => !r._purge)
        .map(({ _synced, _syncError, ...r }) => ({ ...r, _dirty: true }));
      await this._write('vault_items', rows);
    });
  },

  // ---- export and import ----

  // Every row, tombstones included, as the server would hold it.
  async exportAll() {
    const tables = {};
    for (const t of SYNC_TABLES) tables[t] = (await this._read(t)).filter((r) => !r._purge).map(cleanRow);
    return { app: 'desksync', version: 1, exported_at: nowIso(), vault_meta: await this.vaultMeta(), tables };
  },

  // Merges a file made by exportAll. A row is taken when this device does not
  // have it, or has an older copy; it is then marked for sync like any edit.
  // Vault items only come in when the file's vault has the same master password
  // as this device's (or this device has none): items encrypted under a
  // different key could never be opened here.
  async importAll(data) {
    if (!data || data.app !== 'desksync' || typeof data.tables !== 'object') throw new Error('Not a DeskSync export file');
    const mine = await this.vaultMeta();
    const theirs = data.vault_meta && data.vault_meta.salt ? data.vault_meta : null;
    const sameVault = !mine || !theirs || (mine.salt === theirs.salt && mine.verifier_ct === theirs.verifier_ct);
    if (!mine && theirs) await this.setVaultMeta(theirs);
    const counts = {};
    let skippedVault = 0;
    await this._locked(async () => {
      for (const t of SYNC_TABLES) {
        const incoming = Array.isArray(data.tables[t]) ? data.tables[t] : [];
        if (t === 'vault_items' && !sameVault) { skippedVault = incoming.length; continue; }
        const rows = await this._read(t);
        const byId = new Map(rows.map((r, i) => [r.id, i]));
        let n = 0;
        for (const r of incoming) {
          if (!r || typeof r.id !== 'string') continue;
          const i = byId.get(r.id);
          if (i !== undefined && new Date(rows[i].updated_at || 0) >= new Date(r.updated_at || 0)) continue;
          const { user_id, ...clean } = cleanRow(r);
          const row = { ...structuredClone(ROW_DEFAULTS[t]), ...clean, _dirty: true };
          if (i !== undefined) rows[i] = row; else { byId.set(r.id, rows.length); rows.push(row); }
          n++;
        }
        counts[t] = n;
        await this._write(t, rows);
      }
    });
    return { counts, skippedVault };
  },

  // One-time move from the version where the server was the source of truth:
  // `cache:<table>` held a read-through copy and `outbox` held writes made
  // offline. The copy becomes the local table (it is what the server had, so it
  // is marked synced), and the queued writes are applied on top as local changes
  // so they still reach the server.
  async migrate() {
    const all = await chrome.storage.local.get(null);
    const legacy = Object.keys(all).filter((k) => k.startsWith('cache:'));
    if (!legacy.length && !Array.isArray(all.outbox)) return;
    await this._locked(async () => {
      for (const key of legacy) {
        const table = key.slice('cache:'.length);
        if (!SYNC_TABLES.includes(table)) continue;
        const current = await this._read(table);
        const have = new Set(current.map((r) => r.id));
        const add = (all[key] || []).filter((r) => r?.id && !have.has(r.id)).map((r) => ({ ...r, _synced: true }));
        await this._write(table, [...current, ...add]);
      }
    });
    for (const e of Array.isArray(all.outbox) ? all.outbox : []) {
      if (!SYNC_TABLES.includes(e.table)) continue;
      if (e.op === 'insert' || e.op === 'upsert') await this.insert(e.table, e.payload);
      else if (e.op === 'update') await this.update(e.table, e.rowId, e.payload);
      else if (e.op === 'remove') await this.remove(e.table, e.rowId, e.payload);
    }
    await chrome.storage.local.remove([...legacy, 'outbox']);
  },

  // ---- used by sync ----

  // After a push: the row is on the server now, unless it changed again while
  // the request was in flight, in which case it stays dirty for the next push.
  markPushed(table, id, pushedAt, { error } = {}) {
    return this._locked(async () => {
      const rows = await this._read(table);
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0 || rows[i].updated_at !== pushedAt) return;
      if (rows[i]._purge && !error) { rows.splice(i, 1); }
      else {
        rows[i] = { ...rows[i], _dirty: false };
        if (error) rows[i]._syncError = error; else rows[i]._synced = true;
      }
      await this._write(table, rows);
    });
  },

  // After a pull of the whole table: the server's rows replace ours, except
  // where we have something it has not seen yet. A synced row the server no
  // longer has was purged on another device, so it goes here too.
  mergeRemote(table, remote) {
    return this._locked(async () => {
      const local = await this._read(table);
      const byId = new Map(local.map((r) => [r.id, r]));
      const keepLocal = (r) => r && (r._dirty || r._syncError);
      const seen = new Set();
      const next = [];
      for (const r of remote) {
        seen.add(r.id);
        const l = byId.get(r.id);
        next.push(keepLocal(l) ? l : { ...r, _synced: true });
      }
      for (const l of local) {
        if (seen.has(l.id)) continue;
        if (keepLocal(l) || !l._synced) next.push(l);
      }
      await this._write(table, next);
    });
  }
};
