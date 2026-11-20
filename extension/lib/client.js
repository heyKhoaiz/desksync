// Shared Supabase client for the popup and the service worker.
// Sessions are kept in chrome.storage.local (service workers have no localStorage),
// so login is shared between the popup and the background.
// Requires: lib/supabase.js, config.js and lib/store.js loaded first.

const chromeStorageAdapter = {
  async getItem(key) {
    const r = await chrome.storage.local.get(key);
    return r[key] ?? null;
  },
  async setItem(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
  async removeItem(key) {
    await chrome.storage.local.remove(key);
  }
};

const sb = supabase.createClient(DESKSYNC_CONFIG.SUPABASE_URL, DESKSYNC_CONFIG.SUPABASE_ANON_KEY, {
  auth: {
    storage: chromeStorageAdapter,
    storageKey: 'desksync-auth',
    persistSession: true,
    autoRefreshToken: true,
    // No lock option: supabase-js 2.118 coordinates refreshes between the
    // popup and the service worker itself, and warns that "lock" is deprecated.
    detectSessionInUrl: false
  }
});

async function currentUser() {
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}

// ---------------------------------------------------------------------------
// Sync: the local store (lib/store.js) is the truth, Supabase a mirror
//
// Every read and write goes to the store and returns at once. When the user is
// signed in, sync pushes rows changed here and then pulls each table whole,
// merging by row: a row we changed and have not pushed yet wins, anything else
// takes the server's copy. Offline is not an error — the changed rows simply
// stay flagged until the next run.
// ---------------------------------------------------------------------------

// A failed fetch means offline; anything the server answered (RLS, constraints,
// a bad request) is a real error and must not be retried forever.
function isOffline(e) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (e instanceof TypeError) return true;                 // "Failed to fetch"
  return /failed to fetch|networkerror|load failed/i.test(e?.message || '');
}

// The database can be behind the code. PostgREST names a column it does not
// have ("Could not find the 'format' column"), and a database without migration
// 002 refuses format 'plain'. Either way the row is adjusted and sent again
// rather than refused, and the user is told which migration to run.
const MISSING_COLUMN = /Could not find the '([^']+)' column/i;
const FORMAT_CHECK = /notes_format_check/i;

const sync = {
  _running: null,
  _soon: null,
  // Set by the popup to show a message; the service worker leaves it alone.
  onWarn: null,
  _warned: new Set(),
  _warn(key, msg) {
    if (this._warned.has(key)) return;
    this._warned.add(key);
    try { this.onWarn?.(msg); } catch { /* the popup may be gone */ }
  },

  pending() { return store.pending(); },

  // Single flight: a second call while one runs gets the same result. And one
  // sync at a time across the popup and the service worker, not just within
  // each: a pull in one could read the server just before the other pushed a
  // new row, then take that row for one deleted elsewhere and drop it.
  run() {
    if (!this._running) {
      const go = () => this._run();
      const locked = typeof navigator !== 'undefined' && navigator.locks?.request
        ? navigator.locks.request('desksync-sync', go) : go();
      this._running = locked.finally(() => { this._running = null; });
    }
    return this._running;
  },

  // After a local write: sync shortly, so a burst of edits is one round trip.
  soon(ms = 800) {
    clearTimeout(this._soon);
    this._soon = setTimeout(() => this.run().catch((e) => console.warn('[DeskSync] sync', e)), ms);
  },

  async _run() {
    const done = async (synced, pulled) => ({ synced, pulled, pending: await store.pending(),
      vaultConflict: !!(await store.vaultConflict()) });
    if (!(await currentUser())) return done(0, false);
    let synced = 0;
    try {
      // The vault's master-password check first: until both sides agree on it,
      // vault items cannot move in either direction.
      const vaultOk = await this._syncVaultMeta();
      const tables = SYNC_TABLES.filter((t) => vaultOk || t !== 'vault_items');
      synced = await this._push(tables);
      for (const t of tables) await store.mergeRemote(t, await this._fetchAll(t));
    } catch (e) {
      if (!isOffline(e)) throw e;
      return done(synced, false);
    }
    return done(synced, true);
  },

  // Returns false while this device and the account have different vaults.
  async _syncVaultMeta() {
    if (await store.vaultConflict()) return false;
    const local = await store.rawVaultMeta();
    const { data: remote, error } = await sb.from('vault_meta').select('*').maybeSingle();
    if (error) throw error;
    if (!local && !remote) return true;
    if (!local) { await store.setVaultMeta(remote, { fromServer: true }); return true; }
    if (!remote) {
      if (local._dirty) {
        const { error: e2 } = await sb.from('vault_meta').upsert(cleanRow(local));
        if (e2) throw e2;
        await store.setVaultMeta(local, { fromServer: true });
      }
      return true;
    }
    if (remote.salt === local.salt && remote.verifier_ct === local.verifier_ct) {
      if (local._dirty) await store.setVaultMeta(local, { fromServer: true });
      return true;
    }
    // A vault on each side, under different master passwords. Merging would leave
    // half the items unopenable, so the user chooses (see resolveVault).
    await store.setVaultConflict(cleanRow(remote));
    this._warn('vault', 'This device and your account each have a vault — choose one in Settings');
    return false;
  },

  // Settles a vault conflict. 'account': the account's vault replaces this
  // device's, whose items are dropped. 'device': this device's replaces the
  // account's, whose items are deleted from the server. Either way one set of
  // items is gone for good; Settings asks twice before calling this.
  async resolveVault(keep) {
    const remote = await store.vaultConflict();
    if (!remote) return;
    if (keep === 'account') {
      await store.setVaultMeta(remote, { fromServer: true });
      await store.dropVaultItems();
    } else if (keep === 'device') {
      const local = await store.rawVaultMeta();
      const { error } = await sb.from('vault_meta').upsert(cleanRow(local));
      if (error) throw error;
      const { error: e2 } = await sb.from('vault_items').delete().not('id', 'is', null);
      if (e2) throw e2;
      await store.setVaultMeta(local, { fromServer: true });
      await store.redirtyVaultItems();
    } else throw new Error('keep must be account or device');
    await store.setVaultConflict(null);
    return this.run();
  },

  async _push(tables = SYNC_TABLES) {
    let n = 0;
    for (const table of tables) {
      for (const r of (await store.raw(table)).filter((x) => x._dirty)) {
        const error = await this._send(table, r);   // throws when offline
        await store.markPushed(table, r.id, r.updated_at, { error });
        n++;
      }
    }
    return n;
  },

  // Returns null on success, or the server's message when it refused the row.
  async _send(table, r) {
    if (r._purge) {
      const { error } = await sb.from(table).delete().eq('id', r.id);
      if (error) { if (isOffline(error)) throw error; return error.message; }
      return null;
    }
    // user_id is the server's to set (auth.uid()), never ours to send: a row
    // that came from another account would otherwise be refused by RLS.
    const { user_id, ...row } = cleanRow(r);
    for (let attempt = 0; attempt < 4; attempt++) {
      const { error } = await sb.from(table).upsert(row);
      if (!error) return null;
      if (isOffline(error)) throw error;
      const msg = error.message || '';
      const column = MISSING_COLUMN.exec(msg)?.[1];
      if (column && column in row) {
        delete row[column];
        this._warn('col:' + column, `Synced, but your database has no '${column}' column yet — run supabase/migrations/001_tags_and_markdown.sql`);
        continue;
      }
      if (row.format === 'plain' && FORMAT_CHECK.test(msg)) {
        row.format = 'markdown';
        this._warn('format', 'Synced, but your database predates plain-text notes — run supabase/migrations/002_plain_text_notes.sql');
        continue;
      }
      console.error('[DeskSync] the server refused a row; it stays on this device', table, r.id, msg);
      return msg;
    }
    return 'could not adjust the row to the database';
  },

  // The whole table, tombstones included, a page at a time.
  async _fetchAll(table) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(table).select('*').order('id').range(from, from + 999);
      if (error) throw error;
      out.push(...(data || []));
      if (!data || data.length < 1000) return out;
    }
  }
};

// ---------------------------------------------------------------------------
// The data API the popup and the service worker use. Every call is local and
// immediate; each write asks sync to follow it up.
// ---------------------------------------------------------------------------
const after = (p) => p.then((v) => { sync.soon(); return v; });

const db = {
  list(table, opts) { return store.list(table, opts); },
  insert(table, row) { return after(store.insert(table, row)); },
  update(table, id, patch) { return after(store.update(table, id, patch)); },
  // Save a row whose id we already know. The editor needs this: a note being
  // typed into is written from the popup, from a draft the popup left behind,
  // and from the service worker replaying that draft — all aiming at one row.
  upsert(table, row) { return after(store.upsert(table, row)); },
  remove(table, id, erase = {}) { return after(store.remove(table, id, erase)); },

  // ---- Trash: the tombstones `remove` leaves behind ----
  listDeleted(table, opts) { return store.listDeleted(table, opts); },
  restore(table, id) { return after(store.restore(table, id)); },
  // Gone for good, here and, once synced, on the server.
  purge(table, id) { return after(store.purge(table, id)); },
  purgeAll(table) { return after(store.purgeDeleted(table)); }
};

// ---------------------------------------------------------------------------
// The draft a popup left behind
//
// A browser action popup is destroyed the moment you click anywhere else, which
// is the ordinary way to leave it: no warning, no unload grace, and any save
// still inside the editor's debounce goes with the window. So the editor keeps
// the note it is working on here as well — one row, overwritten as you type —
// and whoever gets there first writes it into the store: the next popup when it
// opens, or the service worker on its sweep.
//
// It is one entry, not a queue: there is one editor in one popup, and the entry
// is the whole note rather than a change to it, so replaying it twice is the
// same as replaying it once.
// ---------------------------------------------------------------------------
const drafts = {
  async get() {
    const { [DRAFT_KEY]: d } = await chrome.storage.local.get(DRAFT_KEY);
    return d || null;
  },
  async put(entry) {
    await chrome.storage.local.set({ [DRAFT_KEY]: { ...entry, at: new Date().toISOString() } });
  },
  async clear() { await chrome.storage.local.remove(DRAFT_KEY); },

  // Writes the stashed draft, if there is one.
  //
  // `minAgeMs` is for the service worker: a draft touched a moment ago belongs
  // to a popup that is still open and still typing.
  //
  // The entry is re-read before it is dropped, so a draft that changed while the
  // write was in flight stays for the next sweep instead of being thrown away.
  async flush({ minAgeMs = 0 } = {}) {
    const d = await this.get();
    if (!d?.row?.id || !d.table) return { saved: 0 };
    if (minAgeMs && Date.now() - new Date(d.at).getTime() < minAgeMs) return { saved: 0 };
    await db.upsert(d.table, d.row);
    const now = await this.get();
    if (now && now.at === d.at) await this.clear();
    return { saved: 1 };
  }
};
