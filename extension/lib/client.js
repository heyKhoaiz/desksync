// Shared Supabase client for the popup and the service worker.
// Sessions are kept in chrome.storage.local (service workers have no localStorage),
// so login is shared between the popup and the background.
// Requires: lib/supabase.js and config.js loaded first.

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
    detectSessionInUrl: false
  }
});

async function currentUser() {
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}

// ---------------------------------------------------------------------------
// Offline support
//
// Reads go through a cache in chrome.storage.local, so the popup opens with the
// last known data instead of an error when the network is down. Writes made
// offline go to an outbox and are replayed, in order, once a request succeeds
// again. Rows carry a client-generated uuid, so a row created offline keeps the
// same id after it syncs and later edits to it line up.
// ---------------------------------------------------------------------------

const CACHE_PREFIX = 'cache:';
const OUTBOX_KEY = 'outbox';
const CACHE_OWNER_KEY = 'cacheOwner';

// Column defaults, mirroring supabase/schema.sql. Only needed so a row created
// offline renders the same as one that came back from the server.
const ROW_DEFAULTS = {
  notes: { title: '', body: '', color: 'yellow', tags: [], pinned: false },
  read_later: { url: '', title: '', favicon: null, note: '', is_read: false, source: 'extension' },
  clips: { content: '', source_url: null, pinned: false },
  vault_items: { iv: '', ciphertext: '' }
};

// A failed fetch means offline; anything the server answered (RLS, constraints,
// a bad request) is a real error and must not be queued and retried forever.
function isOffline(e) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (e instanceof TypeError) return true;                 // "Failed to fetch"
  return /failed to fetch|networkerror|load failed/i.test(e?.message || '');
}

const cache = {
  async get(table) {
    const key = CACHE_PREFIX + table;
    const r = await chrome.storage.local.get(key);
    return r[key] ?? null;
  },
  // Best-effort: a full quota must not break a read that already succeeded.
  async set(table, rows) {
    try {
      await chrome.storage.local.set({ [CACHE_PREFIX + table]: rows });
    } catch (e) {
      console.warn('[DeskSync] could not cache', table, e);
    }
  },
  // Called on sign-out and when a different account signs in: cached rows and
  // queued writes belong to one user and must never leak into the next session.
  async clear() {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX));
    await chrome.storage.local.remove([...keys, OUTBOX_KEY, CACHE_OWNER_KEY]);
  },
  async claim(uid) {
    const { [CACHE_OWNER_KEY]: owner } = await chrome.storage.local.get(CACHE_OWNER_KEY);
    if (owner && owner !== uid) await this.clear();
    await chrome.storage.local.set({ [CACHE_OWNER_KEY]: uid });
  }
};

const outbox = {
  async all() {
    const { [OUTBOX_KEY]: box } = await chrome.storage.local.get(OUTBOX_KEY);
    return box || [];
  },
  async count() { return (await this.all()).length; },
  async add(entry) {
    const box = await this.all();
    box.push({ ...entry, at: new Date().toISOString() });
    await chrome.storage.local.set({ [OUTBOX_KEY]: box });
  },
  async drop(n) {
    const box = await this.all();
    await chrome.storage.local.set({ [OUTBOX_KEY]: box.slice(n) });
  },

  // Replays queued writes oldest first. Stops at the first one that fails
  // because we are still offline; drops one the server rejected, since
  // retrying it forever would block everything queued behind it.
  async flush() {
    const box = await this.all();
    if (!box.length) return { synced: 0, pending: 0 };
    let done = 0;
    for (const e of box) {
      try {
        if (e.op === 'insert') await net.insert(e.table, e.payload);
        else if (e.op === 'update') await net.update(e.table, e.rowId, e.payload);
        else if (e.op === 'remove') await net.remove(e.table, e.rowId, e.payload);
        done++;
      } catch (err) {
        if (isOffline(err)) break;
        console.error('[DeskSync] dropping unsendable change', e, err);
        done++;
      }
    }
    await this.drop(done);
    return { synced: done, pending: box.length - done };
  },

  // Re-applies queued writes on top of rows from the cache (or from a fetch that
  // raced the flush), so the popup shows what the user last did, not stale data.
  async overlay(table, rows) {
    const box = (await this.all()).filter((e) => e.table === table);
    if (!box.length) return rows;
    const out = rows.slice();
    const find = (id) => out.findIndex((r) => r.id === id);
    for (const e of box) {
      if (e.op === 'insert') { if (find(e.payload.id) < 0) out.push({ ...e.payload }); }
      else if (e.op === 'update') { const i = find(e.rowId); if (i >= 0) out[i] = { ...out[i], ...e.payload, updated_at: e.at }; }
      else if (e.op === 'remove') { const i = find(e.rowId); if (i >= 0) out.splice(i, 1); }
    }
    return out;
  }
};

// Raw Supabase calls, with no cache or queue behind them.
const net = {
  async list(table, order, limit) {
    const { data, error } = await sb.from(table).select('*')
      .is('deleted_at', null).order(order, { ascending: false }).limit(limit);
    if (error) throw error;
    return data;
  },
  async insert(table, row) {
    const { data, error } = await sb.from(table).insert(row).select().single();
    if (error) throw error;
    return data;
  },
  async update(table, id, patch) {
    const { data, error } = await sb.from(table).update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  async remove(table, id, erase = {}) {
    const { error } = await sb.from(table).update({ ...erase, deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  }
};

const sortRows = (rows, order) => rows.slice().sort((a, b) => new Date(b[order]) - new Date(a[order]));

// ---- Data helpers (soft delete everywhere so other devices pick up deletes) ----
const db = {
  async list(table, { order = 'updated_at', limit = 500 } = {}) {
    try {
      const rows = await net.list(table, order, limit);
      await cache.set(table, rows);
      return sortRows(await outbox.overlay(table, rows), order).slice(0, limit);
    } catch (e) {
      if (!isOffline(e)) throw e;
      const cached = await cache.get(table);
      if (!cached) throw e;
      return sortRows(await outbox.overlay(table, cached), order).slice(0, limit);
    }
  },

  async insert(table, row) {
    const now = new Date().toISOString();
    // The id is generated here, not by Postgres, so a row created offline keeps
    // the same identity once it syncs.
    const full = { ...ROW_DEFAULTS[table], id: crypto.randomUUID(), created_at: now, updated_at: now, ...row };
    try {
      return await net.insert(table, full);
    } catch (e) {
      if (!isOffline(e)) throw e;
      await outbox.add({ op: 'insert', table, payload: full });
      return { ...full, _pending: true };
    }
  },

  async update(table, id, patch) {
    try {
      return await net.update(table, id, patch);
    } catch (e) {
      if (!isOffline(e)) throw e;
      await outbox.add({ op: 'update', table, rowId: id, payload: patch });
      return { id, ...patch, _pending: true };
    }
  },

  // `erase` blanks columns that shouldn't outlive the delete; the row stays as a tombstone for other devices.
  async remove(table, id, erase = {}) {
    try {
      await net.remove(table, id, erase);
    } catch (e) {
      if (!isOffline(e)) throw e;
      await outbox.add({ op: 'remove', table, rowId: id, payload: erase });
    }
  },

  // ---- Trash: the tombstones `remove` leaves behind ----
  // These are not cached or queued: Trash is a rare, destructive screen, and it
  // should act on what the server really holds rather than on a local copy.
  async listDeleted(table, { limit = 200 } = {}) {
    const { data, error } = await sb.from(table).select('*')
      .not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return data;
  },
  async restore(table, id) {
    const { error } = await sb.from(table).update({ deleted_at: null }).eq('id', id);
    if (error) throw error;
  },
  // Hard delete. Unlike `remove` this leaves nothing for other devices to sync, so it is
  // only ever reached from Trash, where the user asked for it a second time.
  async purge(table, id) {
    const { error } = await sb.from(table).delete().eq('id', id);
    if (error) throw error;
  },
  async purgeAll(table) {
    const { error } = await sb.from(table).delete().not('deleted_at', 'is', null);
    if (error) throw error;
  }
};
