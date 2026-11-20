// Test doubles for the extension's popup UI tests.
//
// Stand in for lib/supabase.js, config.js, lib/client.js and lib/crypto.js so the
// REAL extension/popup.js, extension/popup.html and extension/popup.css can be
// driven without a network, a Supabase project or a packed extension.
//
// Everything here is deliberately simple and synchronous-ish; the point is to
// exercise the UI's own logic, not to re-implement Postgres.
//
// resetFixtures() puts the data back so each test group starts from a known state.

const DESKSYNC_CONFIG = {
  SUPABASE_URL: 'https://demo.supabase.co',
  SUPABASE_ANON_KEY: 'demo',
  CLIP_MAX_LENGTH: 20000
};
const VAULT_VERIFIER = 'desksync-vault-v1';

const iso = (minsAgo) => new Date(Date.now() - minsAgo * 60000).toISOString();

const DATA = {
  notes: [
    { id: 'n1', title: 'Launch checklist', format: 'plain', pinned: true, tags: ['launch', 'chrome'],
      updated_at: iso(12), created_at: iso(400),
      body: 'Before the store listing\n\n[x] Privacy policy — clipboard text is stored in the account, the vault is end-to-end encrypted\n[x] Screenshots at 1280x800\n[ ] Justify the optional host permission\n[ ] Pricing copy\n\nOpen question: do we ship the Android app in the same week, or ship it after?\n\nSee https://example.com/docs' },
    // A note from the markdown editor: converted to text the first time it is opened.
    { id: 'n2', title: 'Supabase RLS gotcha', format: 'markdown', pinned: false, tags: ['supabase'],
      updated_at: iso(60), created_at: iso(600),
      body: 'Wrap `auth.uid()` in a subselect so the planner caches it.\n\n```\nusing ( user_id = (select auth.uid()) )\n```\n\nOn a 40k-row table this took a scan from **1.2s to 30ms**.' },
    // A note from the rich-text editor before that: stored as sanitized HTML.
    { id: 'n3', title: 'Old rich-text note', format: 'html', pinned: false, tags: ['work'],
      updated_at: iso(300), created_at: iso(3000),
      body: '<div>This one was written in the <b>old</b> editor.</div><ul><li>first</li><li>second</li></ul><div><u>underlined</u> and <span style="background-color:#fde047">highlighted</span>.</div>' },
    { id: 'n4', title: 'Grocery', format: 'plain', pinned: false, tags: ['home'],
      updated_at: iso(320), created_at: iso(900),
      body: 'oat milk\ncoffee beans\ntahini' }
  ],
  read_later: [
    { id: 'l1', url: 'https://developer.chrome.com/docs/extensions/mv3/intro/', title: 'Migrate to Manifest V3', favicon: null,
      is_read: false, source: 'extension', note: '', tags: ['chrome', 'launch'], created_at: iso(20), updated_at: iso(20) },
    { id: 'l2', url: 'https://www.joshwcomeau.com/css/interactive-guide-to-grid/', title: 'An Interactive Guide to CSS Grid',
      favicon: null, is_read: false, source: 'extension', note: '', tags: ['reading'], created_at: iso(180), updated_at: iso(180) },
    { id: 'l3', url: 'https://supabase.com/docs/guides/database/postgres/row-level-security', title: 'RLS performance',
      favicon: null, is_read: true, source: 'android', note: '', tags: ['supabase', 'reading'], created_at: iso(1500), updated_at: iso(1500) }
  ],
  clips: [
    { id: 'c1', content: 'npx supabase gen types typescript --project-id abcdefgh > types.ts',
      source_url: 'supabase.com', pinned: true, tags: ['supabase'], created_at: iso(5), updated_at: iso(5) },
    { id: 'c2', content: 'sk-proj-REDACTED-this-is-a-long-token-value-that-keeps-going',
      source_url: 'platform.openai.com', pinned: false, tags: ['work'], created_at: iso(45), updated_at: iso(45) },
    { id: 'c3', content: '14 Rosewood Avenue, Flat 2, Manchester M14 5TP',
      source_url: null, pinned: false, tags: ['home'], created_at: iso(1500), updated_at: iso(1500) }
  ],
  vault_items: [
    { id: 'v1', _plain: { title: 'GitHub', url: 'https://github.com', username: 'khoaiz', password: 'hunter2hunter2', notes: '2FA on', tags: ['work'] }, updated_at: iso(2000) },
    { id: 'v2', _plain: { title: 'Supabase', url: 'https://supabase.com', username: 'khoaiz@example.com', password: 'correct-horse', notes: '', tags: ['work', 'supabase'] }, updated_at: iso(2000) },
    { id: 'v3', _plain: { title: 'Example', url: 'https://example.com', username: 'me@example.com', password: 'swordfish', notes: '', tags: [] }, updated_at: iso(2000) }
  ]
};

const DELETED = {
  notes: [{ id: 'd1', title: 'Old standup notes', body: '', format: 'plain', tags: [], deleted_at: iso(2880) }],
  read_later: [{ id: 'd2', url: 'https://example.com/x', title: 'A tutorial I finished', tags: [], deleted_at: iso(5760) }],
  vault_items: [{ id: 'd3', iv: '', ciphertext: '', deleted_at: iso(15840) }]
};

// chrome.*
const store = { settings: { clipCapture: false }, captureOrigins: [], tagColors: { supabase: '#19bf7a', launch: '#ffd84d' } };
// popup.js also calls store.claim/clear/migrate (lib/store.js). Those are
// non-enumerable here so the chrome.storage mock never sees them as keys.
for (const k of ['adopt', 'clear', 'migrate', 'vaultMeta', 'setVaultMeta', 'vaultConflict', 'exportAll', 'importAll']) {
  Object.defineProperty(store, k, { value: (...a) => localStore[k](...a), enumerable: false });
}
window.chrome = {
  storage: {
    local: {
      async get(k) {
        if (k == null) return { ...store };
        if (Array.isArray(k)) return Object.fromEntries(k.filter((x) => x in store).map((x) => [x, store[x]]));
        return k in store ? { [k]: store[k] } : {};
      },
      async set(o) { Object.assign(store, o); },
      async remove(keys) { for (const k of [].concat(keys)) delete store[k]; }
    },
    onChanged: { addListener() {} }
  },
  tabs: {
    async query() { return [{ id: 1, url: 'https://github.com/login', title: 'Sign in to GitHub', favIconUrl: null }]; },
    create({ url }) { window.__opened = url; console.log('[mock] would open', url); }
  },
  permissions: { async request() { return true; }, async getAll() { return { origins: [] }; }, async remove() { return true; } },
  scripting: { async executeScript() { return [{ result: { filled: 2, foundPassword: true } }]; } }
};

// supabase
const sb = {
  auth: {
    async getSession() { return { data: { session: { user: { id: 'u1', email: 'khoaiz@example.com' } } } }; },
    async signOut() { window.__signedOutCalled = true; },
    async signInWithPassword() { return { data: { session: {} }, error: { message: 'Invalid login credentials' } }; }
  },
  channel() { return { on() { return this; }, subscribe() {} }; },
  from(table) {
    const api = {
      select() { return api; },
      async maybeSingle() { return { data: window.__vaultSetUp === false ? null : { user_id: 'u1' }, error: null }; },
      async single() { return { data: { salt: 'x', iterations: 1, verifier_iv: 'i', verifier_ct: 'c' }, error: null }; },
      async insert() { return { error: null }; }
    };
    return api;
  }
};
// window.__signedOut runs the popup the way a fresh install does: no account.
async function currentUser() { return window.__signedOut ? null : { id: 'u1', email: 'khoaiz@example.com' }; }

// The local store and sync are tested on their own in tests/offline.test.js;
// here `db` below stands in for both, so these only have to exist.
const LOCAL_PREFIX = 'local:';
const SYNC_TABLES = ['notes', 'read_later', 'clips', 'vault_items'];
const VAULT_META = { salt: 'x', iterations: 1, verifier_iv: 'i', verifier_ct: 'c' };
const localStore = {
  async adopt(uid) { window.__adopted = uid; },
  async clear() { window.__erased = true; },
  async migrate() {},
  async vaultMeta() { return window.__vaultSetUp === false ? null : VAULT_META; },
  async setVaultMeta() { window.__vaultSetUp = true; },
  async vaultConflict() { return window.__vaultConflict ? VAULT_META : null; },
  async exportAll() { return { app: 'desksync', version: 1, tables: structuredClone(DATA) }; },
  async importAll() { return { counts: { notes: 1 }, skippedVault: 0 }; }
};
// Plans, as in lib/client.js. The demo is Pro unless window.__plan says 'free'.
const PLANS = {
  free: { name: 'free', sync: false, clips: 200, templates: 10, trashDays: 30 },
  pro: { name: 'pro', sync: true, clips: Infinity, templates: Infinity, trashDays: 365 }
};
const plan = {
  async name() { return window.__plan === 'free' ? 'free' : 'pro'; },
  async limits() { return PLANS[await this.name()]; },
  async refresh() { return this.name(); }
};
const sync = {
  onWarn: null,
  async pending() { return 0; },
  async run() { return { synced: 0, pulled: false, pending: 0, vaultConflict: !!window.__vaultConflict }; },
  soon() {},
  async resolveVault(keep) { window.__resolvedVault = keep; window.__vaultConflict = false; }
};

// The draft stash is real enough to assert against: it is just
// chrome.storage.local, which is mocked above, and the editor's "do not lose the
// note when the popup closes" path runs through it.

const DRAFT_KEY = 'pendingDraft';
const drafts = {
  async get() { return store[DRAFT_KEY] || null; },
  async put(entry) { store[DRAFT_KEY] = { ...entry, at: new Date().toISOString() }; },
  async clear() { delete store[DRAFT_KEY]; },
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

const b64 = { from: (b) => 'b64', to: (s) => new Uint8Array() };

// Vault crypto: the demo master password is "demo".
let sessionKey = null;
const vaultCrypto = {
  async loadSessionKey() { return sessionKey; },
  async storeSessionKey(k) { sessionKey = k; },
  async lock() { sessionKey = null; },
  randomBytes(n) { return new Uint8Array(n); },
  async deriveKey(pw) { return pw === 'demo' ? 'KEY' : 'BAD'; },
  async encrypt(key, text) { return { iv: 'iv', ciphertext: btoa(unescape(encodeURIComponent(text))) }; },
  async decrypt(key, iv, ct) {
    if (key !== 'KEY') throw new Error('bad key');
    if (ct === 'c') return VAULT_VERIFIER;
    return decodeURIComponent(escape(atob(ct)));
  },
  generatePassword() { return 'generated-password'; }
};

// db
const db = {
  async list(table) { return structuredClone(DATA[table].map((r) => (r._plain ? encRow(r) : r))); },
  async insert(table, row) {
    const full = { id: 'new-' + Math.random().toString(36).slice(2, 8), created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), tags: [], ...row };
    // _plain is the test's window into a vault row. The stored row keeps only iv
    // and ciphertext, exactly as the real table does; this is decrypted beside it
    // so assertions can read what was saved.
    if (table === 'vault_items' && row.ciphertext) {
      try { full._plain = JSON.parse(decodeURIComponent(escape(atob(row.ciphertext)))); } catch {}
    }
    DATA[table].unshift(full); return full;
  },
  async upsert(table, row) {
    const existing = DATA[table].find((x) => x.id === row.id);
    if (existing) return this.update(table, row.id, row);
    const full = { created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      tags: [], ...row };
    DATA[table].unshift(full);
    return full;
  },
  async update(table, id, patch) {
    const r = DATA[table].find((x) => x.id === id);
    if (r) { Object.assign(r, patch, { updated_at: new Date().toISOString() });
      if (r._plain && patch.ciphertext) r._plain = JSON.parse(decodeURIComponent(escape(atob(patch.ciphertext)))); }
    return r;
  },
  async remove(table, id, erase = {}) {
    const i = DATA[table].findIndex((x) => x.id === id);
    if (i < 0) return;
    const [r] = DATA[table].splice(i, 1);
    if (!Object.keys(erase).length) (DELETED[table] ||= []).unshift({ ...r, ...erase, deleted_at: new Date().toISOString() });
  },
  async listDeleted(table) { return structuredClone(DELETED[table] || []); },
  async restore(table, id) {
    const i = (DELETED[table] || []).findIndex((x) => x.id === id);
    if (i < 0) return;
    const [r] = DELETED[table].splice(i, 1);
    delete r.deleted_at;
    DATA[table].unshift(r);
  },
  async purge(table, id) { DELETED[table] = (DELETED[table] || []).filter((x) => x.id !== id); },
  async purgeAll(table) { DELETED[table] = []; }
};


function encRow(r) {
  return { id: r.id, updated_at: r.updated_at, iv: 'iv',
    ciphertext: btoa(unescape(encodeURIComponent(JSON.stringify(r._plain)))) };
}

// The demo master password for the stubbed vault.
const TEST_MASTER_PASSWORD = 'demo';

const SEED = JSON.stringify({ DATA, DELETED });

function resetFixtures() {
  const seed = JSON.parse(SEED);
  for (const k of Object.keys(DATA)) DATA[k] = seed.DATA[k];
  for (const k of Object.keys(DELETED)) DELETED[k] = seed.DELETED[k];
  for (const k of Object.keys(store)) delete store[k];
  Object.assign(store, { settings: { clipCapture: false }, captureOrigins: [],
                         tagColors: { supabase: '#19bf7a', launch: '#ffd84d' } });
  sessionKey = null;
}

window.__DATA = DATA;
window.__DELETED = DELETED;
window.__store = store;
window.resetFixtures = resetFixtures;
