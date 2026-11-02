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

// ---- Data helpers (soft delete everywhere so other devices pick up deletes) ----
const db = {
  async list(table, { order = 'updated_at', limit = 500 } = {}) {
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
  async remove(table, id) {
    const { error } = await sb.from(table).update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  }
};
