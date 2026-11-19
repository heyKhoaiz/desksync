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
  CLIP_HISTORY_LIMIT: 200,
  CLIP_MAX_LENGTH: 20000
};
const VAULT_VERIFIER = 'desksync-vault-v1';
const OUTBOX_KEY = 'outbox';

const iso = (minsAgo) => new Date(Date.now() - minsAgo * 60000).toISOString();

const DATA = {
  notes: [
    { id: 'n1', title: 'Launch checklist', format: 'markdown', pinned: true, tags: ['launch', 'chrome'],
      updated_at: iso(12), created_at: iso(400),
      body: '## Before the store listing\n\n- [x] Privacy policy — clipboard text is stored in the account, the vault is **end-to-end encrypted**\n- [x] Screenshots at `1280x800`\n- [ ] Justify the optional host permission\n- [ ] Pricing copy\n\n## Open question\n\n> Do we ship the Android app in the same week?\n\nSee [the architecture notes](https://example.com/docs).' },
    { id: 'n2', title: 'Supabase RLS gotcha', format: 'markdown', pinned: false, tags: ['supabase'],
      updated_at: iso(60), created_at: iso(600),
      body: 'Wrap `auth.uid()` in a subselect so the planner caches it.\n\n```\nusing ( user_id = (select auth.uid()) )\n```\n\nOn a 40k-row table this took a scan from **1.2s to 30ms**.' },
    // A note from before the markdown editor: stored as sanitized HTML.
    { id: 'n3', title: 'Old rich-text note', format: 'html', pinned: false, tags: ['work'],
      updated_at: iso(300), created_at: iso(3000),
      body: '<div>This one was written in the <b>old</b> editor.</div><ul><li>first</li><li>second</li></ul><div><u>underlined</u> and <span style="background-color:#fde047">highlighted</span>.</div>' },
    { id: 'n4', title: 'Grocery', format: 'markdown', pinned: false, tags: ['home'],
      updated_at: iso(320), created_at: iso(900),
      body: '- [x] oat milk\n- [ ] coffee beans\n- [ ] tahini' }
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
  notes: [{ id: 'd1', title: 'Old standup notes', body: '', format: 'markdown', tags: [], deleted_at: iso(2880) }],
  read_later: [{ id: 'd2', url: 'https://example.com/x', title: 'A tutorial I finished', tags: [], deleted_at: iso(5760) }],
  vault_items: [{ id: 'd3', iv: '', ciphertext: '', deleted_at: iso(15840) }]
};

// chrome.*
const store = { settings: { clipCapture: false }, captureOrigins: [], tagColors: { supabase: '#19bf7a', launch: '#ffd84d' } };
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
    async signOut() {}
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
async function currentUser() { return { id: 'u1', email: 'khoaiz@example.com' }; }

const cache = { async claim() {}, async clear() {} };
const outbox = { async count() { return 0; }, async flush() { return { synced: 0, pending: 0 }; } };

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
    rejectUnknown(table, row);
    const full = { id: 'new-' + Math.random().toString(36).slice(2, 8), created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), tags: [], ...row };
    DATA[table].unshift(full); return full;
  },
  async update(table, id, patch) {
    rejectUnknown(table, patch);
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

// Simulates a database that has not had migration 001 applied, the way
// PostgREST reports it. Toggle from the console: window.__missing = [].
window.__missing = [];   // set to ['format'] to simulate an un-migrated database
function rejectUnknown(table, row) {
  for (const col of window.__missing || []) {
    if (col in row) throw new Error(`Could not find the '${col}' column of '${table}' in the schema cache`);
  }
}

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
  window.__missing = [];
}

window.__DATA = DATA;
window.__DELETED = DELETED;
window.__store = store;
window.resetFixtures = resetFixtures;
