// Offline cache and outbox tests for extension/lib/client.js.
//
// Runs the real client.js inside a vm with chrome.storage and supabase stubbed,
// so the queue-and-replay behaviour can be checked without a browser or network.
//   node tests/offline.test.js      (or: make test-ext)
const vm = require('vm');
const fs = require('fs');
const assert = require('assert');

function makeCtx({ online = true, failNet = false } = {}) {
  const store = {};
  const calls = [];
  const chrome = {
    storage: {
      local: {
        async get(k) {
          if (k === null) return { ...store };
          if (Array.isArray(k)) return Object.fromEntries(k.filter((x) => x in store).map((x) => [x, store[x]]));
          return k in store ? { [k]: store[k] } : {};
        },
        async set(o) { Object.assign(store, o); },
        async remove(keys) { for (const k of [].concat(keys)) delete store[k]; }
      }
    }
  };
  // Minimal PostgREST-ish builder. A "network failure" rejects with a TypeError,
  // the way fetch does, which is what isOffline() keys on.
  const settle = (value) => (ctx.__failNet
    ? Promise.reject(new TypeError('Failed to fetch'))
    : Promise.resolve(value));
  function from(table) {
    if (ctx.__override) return ctx.__override(table);
    const b = {
      select() { return b; }, is() { return b; }, not() { return b; },
      order() { return b; }, limit() { return b; },
      eq(_c, v) { b._id = v; return b; },
      insert(row) { calls.push(['insert', table, row]); b._row = row; return b; },
      update(patch) { calls.push(['update', table, b._id, patch]); b._row = patch; return b; },
      delete() { calls.push(['delete', table]); return b; },
      single() { return settle({ data: b._row, error: null }); },
      maybeSingle() { return settle({ data: null, error: null }); },
      then(onOk, onErr) { return settle({ data: ctx.__rows || [], error: null }).then(onOk, onErr); }
    };
    return b;
  }
  const ctx = {
    console, crypto: require('crypto').webcrypto, navigator: { onLine: online },
    chrome,
    DESKSYNC_CONFIG: { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'k' },
    supabase: { createClient: () => ({ from, auth: { getSession: async () => ({ data: { session: null } }) } }) },
    __calls: calls, __store: store, __rows: [], __failNet: failNet, __override: null
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('extension/lib/client.js', 'utf8'), ctx);
  return ctx;
}

const run = async (ctx, code) => vm.runInContext(`(async () => { ${code} })()`, ctx);
let passed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ok  ' + name); passed++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e).split('\n').slice(0, 3).join('\n       ')); process.exitCode = 1; }
}

(async () => {
  console.log('offline cache + outbox');

  await test('insert while offline queues and returns a pending row', async () => {
    const ctx = makeCtx({ online: false, failNet: true });
    const row = await run(ctx, `return db.insert('notes', { title: 'Hi' })`);
    assert.strictEqual(row._pending, true, 'row marked pending');
    assert.ok(row.id, 'row got a client-generated id');
    assert.strictEqual(row.color, 'yellow', 'schema defaults applied locally');
    assert.strictEqual(row.tags.length, 0, 'array default applied');
    const box = await run(ctx, `return outbox.all()`);
    assert.strictEqual(box.length, 1);
    assert.strictEqual(box[0].op, 'insert');
  });

  await test('list while offline returns cache plus queued writes', async () => {
    const ctx = makeCtx({ online: false, failNet: true });
    await run(ctx, `await cache.set('notes', [{ id: 'a', title: 'Cached', updated_at: '2024-01-01T00:00:00Z' }])`);
    await run(ctx, `await db.insert('notes', { title: 'New' })`);
    const rows = await run(ctx, `return db.list('notes')`);
    assert.strictEqual(rows.length, 2, 'cached row + queued insert');
    assert.ok(rows.some((r) => r.title === 'Cached') && rows.some((r) => r.title === 'New'));
  });

  await test('offline edit of an offline row shows the edit', async () => {
    const ctx = makeCtx({ online: false, failNet: true });
    await run(ctx, `await cache.set('notes', [])`);
    const row = await run(ctx, `return db.insert('notes', { title: 'First' })`);
    await run(ctx, `await db.update('notes', ${JSON.stringify(row.id)}, { title: 'Second' })`);
    const rows = await run(ctx, `return db.list('notes')`);
    assert.strictEqual(rows.length, 1, 'still one row, not two');
    assert.strictEqual(rows[0].title, 'Second', 'update applied over the queued insert');
  });

  await test('offline delete hides the row', async () => {
    const ctx = makeCtx({ online: false, failNet: true });
    await run(ctx, `await cache.set('notes', [{ id: 'a', title: 'Gone', updated_at: '2024-01-01T00:00:00Z' }])`);
    await run(ctx, `await db.remove('notes', 'a')`);
    const rows = await run(ctx, `return db.list('notes')`);
    assert.strictEqual(rows.length, 0);
  });

  await test('list with no cache and no network still throws', async () => {
    const ctx = makeCtx({ online: false, failNet: true });
    await assert.rejects(run(ctx, `return db.list('notes')`));
  });

  await test('server errors are not swallowed as offline', async () => {
    const ctx = makeCtx({ online: true });
    ctx.__override = () => ({
      insert: () => ({ select: () => ({ single: async () => ({
        data: null, error: { message: 'new row violates row-level security policy' }
      }) }) })
    });
    let caught = null;
    try { await run(ctx, `return db.insert('notes', { title: 'x' })`); }
    catch (e) { caught = e; }
    assert.ok(caught, 'RLS failure surfaces instead of queueing');
    assert.match(caught.message, /row-level security/);
    const box = await run(ctx, `return outbox.all()`);
    assert.strictEqual(box.length, 0, 'nothing queued for a real server error');
  });

  await test('flush replays queued writes in order, then empties', async () => {
    const ctx = makeCtx({ online: false, failNet: true });
    await run(ctx, `await cache.set('notes', [])`);
    const row = await run(ctx, `return db.insert('notes', { title: 'A' })`);
    await run(ctx, `await db.update('notes', ${JSON.stringify(row.id)}, { pinned: true })`);
    assert.strictEqual((await run(ctx, `return outbox.all()`)).length, 2);
    // Bring the network back up and record what gets replayed.
    ctx.navigator.onLine = true;
    ctx.__failNet = false;
    const seen = [];
    ctx.__override = (t) => ({
      insert: (r) => ({ select: () => ({ single: async () => { seen.push(['insert', t, r.title]); return { data: r, error: null }; } }) }),
      update: (p) => ({ eq: () => ({ select: () => ({ single: async () => { seen.push(['update', t, p]); return { data: p, error: null }; } }) }) })
    });
    const res = await run(ctx, `return outbox.flush()`);
    assert.strictEqual(res.synced, 2);
    assert.strictEqual((await run(ctx, `return outbox.all()`)).length, 0, 'outbox emptied');
    assert.strictEqual(seen.map((s) => s[0]).join(','), 'insert,update', 'replayed oldest first');
  });

  await test('flush drops a write the server rejects, keeping the queue moving', async () => {
    const ctx = makeCtx({ online: false, failNet: true });
    ctx.console = { ...console, error() {} };   // this test expects a rejection; keep the output clean
    await run(ctx, `await db.insert('notes', { title: 'bad' })`);
    await run(ctx, `await db.insert('notes', { title: 'good' })`);
    ctx.navigator.onLine = true;
    ctx.__failNet = false;
    let n = 0;
    ctx.__override = () => ({
      insert: (r) => ({ select: () => ({ single: async () => {
        n++;
        if (n === 1) return { data: null, error: { message: 'violates check constraint' } };
        return { data: r, error: null };
      } }) })
    });
    const res = await run(ctx, `return outbox.flush()`);
    assert.strictEqual(res.synced, 2, 'both entries cleared');
    assert.strictEqual((await run(ctx, `return outbox.all()`)).length, 0);
  });

  await test('flush stops at the first entry that is still offline', async () => {
    const ctx = makeCtx({ online: false, failNet: true });
    await run(ctx, `await db.insert('notes', { title: 'one' })`);
    await run(ctx, `await db.insert('notes', { title: 'two' })`);
    const res = await run(ctx, `return outbox.flush()`);
    assert.strictEqual(res.synced, 0, 'nothing synced while still offline');
    assert.strictEqual((await run(ctx, `return outbox.all()`)).length, 2, 'queue intact');
  });

  await test('cache.claim wipes another account\'s data', async () => {
    const ctx = makeCtx({ online: false, failNet: true });
    await run(ctx, `await cache.set('notes', [{ id: 'a' }]); await cache.claim('user-1');`);
    await run(ctx, `await db.insert('notes', { title: 'mine' })`);
    assert.ok(ctx.__store['cache:notes'], 'cache present for user-1');
    await run(ctx, `await cache.claim('user-2')`);
    assert.strictEqual(ctx.__store['cache:notes'], undefined, 'cached rows cleared');
    assert.strictEqual(ctx.__store.outbox, undefined, 'queued writes cleared');
  });

  await test('cache.claim keeps data for the same account', async () => {
    const ctx = makeCtx({ online: false, failNet: true });
    await run(ctx, `await cache.set('notes', [{ id: 'a' }]); await cache.claim('user-1');`);
    await run(ctx, `await cache.claim('user-1')`);
    assert.ok(ctx.__store['cache:notes'], 'cache kept');
  });

  console.log(`\n${passed} passed`);
})();
