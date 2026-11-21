// Local store and sync tests for extension/lib/store.js and extension/lib/client.js.
//
// Runs the real files inside a vm with chrome.storage and Supabase stubbed. The
// Supabase stub keeps a little server of its own per table, so a test can check
// both what is on this device and what reached the server.
//   node tests/offline.test.js      (or: make test-ext)
const vm = require('vm');
const fs = require('fs');
const assert = require('assert');

function makeCtx({ signedIn = true } = {}) {
  const local = {};
  const chrome = {
    storage: {
      local: {
        async get(k) {
          if (k === null) return structuredClone(local);
          if (Array.isArray(k)) return structuredClone(Object.fromEntries(k.filter((x) => x in local).map((x) => [x, local[x]])));
          return k in local ? structuredClone({ [k]: local[k] }) : {};
        },
        async set(o) { Object.assign(local, structuredClone(o)); },
        async remove(keys) { for (const k of [].concat(keys)) delete local[k]; }
      }
    }
  };

  const server = { notes: [], read_later: [], clips: [], vault_items: [], vault_meta: null };
  const calls = [];
  // A failed fetch comes back from supabase-js as an error, not a throw.
  const answer = (value) => Promise.resolve(ctx.__offline
    ? { data: null, error: { message: 'TypeError: Failed to fetch' } }
    : value);

  function from(table) {
    // ctx.__plan: 'pro' (default), 'free', or 'none' for a database without migration 004.
    if (table === 'plans') {
      return { select() { return { maybeSingle() {
        calls.push(['select', 'plans']);
        if (ctx.__plan === 'none') return answer({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.plans' in the schema cache" } });
        return answer({ data: ctx.__plan === 'free' ? null : { plan: 'pro', pro_until: ctx.__proUntil || null }, error: null });
      } }; } };
    }
    if (table === 'vault_meta') {
      return {
        select() { return { maybeSingle() { return answer({ data: structuredClone(server.vault_meta), error: null }); } }; },
        upsert(row) {
          calls.push(['upsert', table, row]);
          // ctx.__no005: a database without migration 005's wrap columns.
          if (ctx.__no005 && !ctx.__offline && Object.keys(row).some((k) => /^(pw|rk)_/.test(k))) {
            return Promise.resolve({ data: null, error: { code: 'PGRST204', message: "Could not find the 'pw_salt' column of 'vault_meta' in the schema cache" } });
          }
          if (!ctx.__offline) server.vault_meta = { ...row, user_id: 'u1' };
          return answer({ data: null, error: null });
        },
        delete() { return { not() {
          calls.push(['delete-all', table]);
          if (!ctx.__offline) server.vault_meta = null;
          return answer({ data: null, error: null });
        } }; }
      };
    }
    return {
      upsert(row) {
        calls.push(['upsert', table, row]);
        const refuse = ctx.__refuse?.(table, row);
        if (refuse && !ctx.__offline) return Promise.resolve({ data: null, error: { message: refuse } });
        if (!ctx.__offline) {
          const i = server[table].findIndex((r) => r.id === row.id);
          // The server's trigger stamps its own updated_at, like the real one.
          const stored = { ...(i >= 0 ? server[table][i] : {}), ...row, updated_at: new Date(Date.now() + 1000).toISOString() };
          if (i >= 0) server[table][i] = stored; else server[table].push(stored);
        }
        return answer({ data: null, error: null });
      },
      delete() {
        return {
          eq(_c, id) {
            calls.push(['delete', table, id]);
            if (!ctx.__offline) server[table] = server[table].filter((r) => r.id !== id);
            return answer({ data: null, error: null });
          },
          not() {
            calls.push(['delete-all', table]);
            if (!ctx.__offline) server[table] = [];
            return answer({ data: null, error: null });
          }
        };
      },
      select() {
        const q = { order() { return q; }, range(a, b) {
          calls.push(['select', table]);
          return answer({ data: structuredClone(server[table].slice(a, b + 1)), error: null });
        } };
        return q;
      }
    };
  }

  const ctx = {
    console: { ...console, error() {}, warn() {} }, setTimeout, clearTimeout,
    crypto: require('crypto').webcrypto, structuredClone, navigator: { onLine: true },
    chrome,
    DESKSYNC_CONFIG: { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'k' },
    supabase: { createClient: () => ({ from, auth: {
      getSession: async () => ({ data: { session: ctx.__user ? { user: ctx.__user } : null } })
    } }) },
    __local: local, __server: server, __calls: calls, __offline: false,
    __user: signedIn ? { id: 'u1' } : null, __refuse: null, __plan: 'pro', __proUntil: null
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('extension/lib/store.js', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync('extension/lib/client.js', 'utf8'), ctx);
  // Writes ask sync to run "soon"; in tests sync runs only when a test says so.
  vm.runInContext('sync.soon = () => {}', ctx);
  return ctx;
}

const run = async (ctx, code) => vm.runInContext(`(async () => { ${code} })()`, ctx);
const raw = (ctx, table) => run(ctx, `return store.raw('${table}')`);
let passed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ok  ' + name); passed++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e).split('\n').slice(0, 3).join('\n       ')); process.exitCode = 1; }
}

(async () => {
  console.log('local store');

  await test('an insert is saved on this device with the schema defaults', async () => {
    const ctx = makeCtx({ signedIn: false });
    const row = await run(ctx, `return db.insert('notes', { title: 'Hi' })`);
    assert.ok(row.id, 'a client-generated id');
    assert.strictEqual(row.color, 'yellow');
    assert.strictEqual(row.format, 'plain');
    assert.strictEqual(row.tags.length, 0);
    const rows = await run(ctx, `return db.list('notes')`);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].title, 'Hi');
  });

  await test('rows come back without the local bookkeeping fields', async () => {
    const ctx = makeCtx({ signedIn: false });
    await run(ctx, `await db.insert('notes', { title: 'x' })`);
    const [row] = await run(ctx, `return db.list('notes')`);
    assert.ok(!Object.keys(row).some((k) => k.startsWith('_')), Object.keys(row).join(','));
  });

  await test('an upsert of an existing row edits it and keeps the other columns', async () => {
    const ctx = makeCtx({ signedIn: false });
    await run(ctx, `await db.upsert('notes', { id: 'n1', title: 'Old', color: 'mint' })`);
    await run(ctx, `await db.upsert('notes', { id: 'n1', title: 'New' })`);
    const rows = await run(ctx, `return db.list('notes')`);
    assert.strictEqual(rows.length, 1, 'still one row');
    assert.strictEqual(rows[0].title, 'New');
    assert.strictEqual(rows[0].color, 'mint', 'colour not reset');
  });

  await test('update of a row that does not exist does nothing', async () => {
    const ctx = makeCtx({ signedIn: false });
    const r = await run(ctx, `return db.update('notes', 'nope', { title: 'x' })`);
    assert.strictEqual(r, null);
    assert.strictEqual((await raw(ctx, 'notes')).length, 0);
  });

  await test('two quick writes both land', async () => {
    const ctx = makeCtx({ signedIn: false });
    await run(ctx, `await Promise.all([db.insert('clips', { content: 'a' }), db.insert('clips', { content: 'b' })])`);
    assert.strictEqual((await run(ctx, `return db.list('clips')`)).length, 2);
  });

  await test('delete moves a row to the trash, restore brings it back', async () => {
    const ctx = makeCtx({ signedIn: false });
    await run(ctx, `await db.insert('notes', { id: 'a', title: 'Gone' })`);
    await run(ctx, `await db.remove('notes', 'a')`);
    assert.strictEqual((await run(ctx, `return db.list('notes')`)).length, 0, 'hidden from the list');
    const trash = await run(ctx, `return db.listDeleted('notes')`);
    assert.strictEqual(trash.length, 1);
    assert.ok(trash[0].deleted_at);
    await run(ctx, `await db.restore('notes', 'a')`);
    assert.strictEqual((await run(ctx, `return db.list('notes')`)).length, 1, 'back in the list');
  });

  await test('delete can blank columns that should not outlive it', async () => {
    const ctx = makeCtx({ signedIn: false });
    await run(ctx, `await db.insert('clips', { id: 'c', content: 'secret' })`);
    await run(ctx, `await db.remove('clips', 'c', { content: '' })`);
    const [t] = await run(ctx, `return db.listDeleted('clips')`);
    assert.strictEqual(t.content, '');
  });

  await test('purging a row the server never had removes it outright', async () => {
    const ctx = makeCtx({ signedIn: false });
    await run(ctx, `await db.insert('notes', { id: 'a' }); await db.remove('notes', 'a'); await db.purge('notes', 'a')`);
    assert.strictEqual((await raw(ctx, 'notes')).length, 0);
  });

  await test('purgeAll empties the trash and leaves live rows alone', async () => {
    const ctx = makeCtx({ signedIn: false });
    await run(ctx, `await db.insert('notes', { id: 'a' }); await db.insert('notes', { id: 'b' }); await db.remove('notes', 'a')`);
    await run(ctx, `await db.purgeAll('notes')`);
    assert.strictEqual((await run(ctx, `return db.listDeleted('notes')`)).length, 0);
    assert.strictEqual((await run(ctx, `return db.list('notes')`)).length, 1);
  });

  await test('list sorts newest first and honours the limit', async () => {
    const ctx = makeCtx({ signedIn: false });
    await run(ctx, `
      await db.insert('clips', { id: 'old', created_at: '2024-01-01T00:00:00Z' });
      await db.insert('clips', { id: 'new', created_at: '2025-01-01T00:00:00Z' });
      await db.insert('clips', { id: 'mid', created_at: '2024-06-01T00:00:00Z' });`);
    const rows = await run(ctx, `return db.list('clips', { order: 'created_at', limit: 2 })`);
    assert.deepStrictEqual(rows.map((r) => r.id), ['new', 'mid']);
  });

  console.log('\nsync');

  await test('signed out, nothing goes to the network', async () => {
    const ctx = makeCtx({ signedIn: false });
    await run(ctx, `await db.insert('notes', { title: 'local only' })`);
    const res = await run(ctx, `return sync.run()`);
    assert.strictEqual(ctx.__calls.length, 0);
    assert.strictEqual(res.pending, 1, 'still waiting to sync');
  });

  await test('signed in, changed rows are pushed and no longer pending', async () => {
    const ctx = makeCtx();
    await run(ctx, `await db.insert('notes', { id: 'n1', title: 'Hi' })`);
    assert.strictEqual(await run(ctx, `return sync.pending()`), 1);
    const res = await run(ctx, `return sync.run()`);
    assert.strictEqual(res.synced, 1);
    assert.strictEqual(res.pending, 0);
    assert.strictEqual(ctx.__server.notes[0].title, 'Hi');
    assert.ok(!Object.keys(ctx.__server.notes[0]).some((k) => k.startsWith('_')), 'no local fields sent');
  });

  await test('rows made elsewhere are pulled in, tombstones included', async () => {
    const ctx = makeCtx();
    ctx.__server.notes.push({ id: 'r1', title: 'From the phone', updated_at: '2025-01-01T00:00:00Z', deleted_at: null });
    ctx.__server.notes.push({ id: 'r2', title: 'Deleted there', updated_at: '2025-01-01T00:00:00Z', deleted_at: '2025-01-02T00:00:00Z' });
    await run(ctx, `await sync.run()`);
    assert.deepStrictEqual((await run(ctx, `return db.list('notes')`)).map((r) => r.id), ['r1']);
    assert.deepStrictEqual((await run(ctx, `return db.listDeleted('notes')`)).map((r) => r.id), ['r2']);
  });

  await test('offline, a sync changes nothing and does not throw', async () => {
    const ctx = makeCtx();
    await run(ctx, `await db.insert('notes', { title: 'later' })`);
    ctx.__offline = true;
    const res = await run(ctx, `return sync.run()`);
    assert.strictEqual(res.pulled, false);
    assert.strictEqual(res.pending, 1, 'kept for the next run');
    ctx.__offline = false;
    assert.strictEqual((await run(ctx, `return sync.run()`)).pending, 0, 'and pushed once back online');
  });

  await test('an unpushed local edit wins over the server copy', async () => {
    const ctx = makeCtx();
    await run(ctx, `await db.insert('notes', { id: 'n1', title: 'v1' }); await sync.run();`);
    ctx.__offline = true;
    await run(ctx, `await db.update('notes', 'n1', { title: 'mine' })`);
    ctx.__server.notes[0].title = 'theirs';
    await run(ctx, `await store.mergeRemote('notes', ${JSON.stringify(ctx.__server.notes)})`);
    assert.strictEqual((await run(ctx, `return db.list('notes')`))[0].title, 'mine');
  });

  await test('a row nobody changed here takes the server copy', async () => {
    const ctx = makeCtx();
    await run(ctx, `await db.insert('notes', { id: 'n1', title: 'v1' }); await sync.run();`);
    ctx.__server.notes[0].title = 'edited on the phone';
    await run(ctx, `await sync.run()`);
    assert.strictEqual((await run(ctx, `return db.list('notes')`))[0].title, 'edited on the phone');
  });

  await test('a synced row the server no longer has was purged elsewhere, and goes', async () => {
    const ctx = makeCtx();
    await run(ctx, `await db.insert('notes', { id: 'n1' }); await sync.run();`);
    ctx.__server.notes = [];
    await run(ctx, `await sync.run()`);
    assert.strictEqual((await raw(ctx, 'notes')).length, 0);
  });

  await test('purging a synced row deletes the server copy too', async () => {
    const ctx = makeCtx();
    await run(ctx, `await db.insert('notes', { id: 'n1' }); await sync.run();`);
    await run(ctx, `await db.remove('notes', 'n1'); await db.purge('notes', 'n1');`);
    assert.strictEqual((await run(ctx, `return db.listDeleted('notes')`)).length, 0, 'gone from the trash at once');
    await run(ctx, `await sync.run()`);
    assert.strictEqual(ctx.__server.notes.length, 0, 'and from the server');
    assert.strictEqual((await raw(ctx, 'notes')).length, 0, 'and the marker is cleared');
  });

  await test('an edit made while a push is in flight is pushed next time', async () => {
    const ctx = makeCtx();
    await run(ctx, `await db.insert('notes', { id: 'n1', title: 'v1' })`);
    const [before] = await raw(ctx, 'notes');
    await new Promise((r) => setTimeout(r, 5));
    await run(ctx, `await db.update('notes', 'n1', { title: 'v2' })`);
    await run(ctx, `await store.markPushed('notes', 'n1', ${JSON.stringify(before.updated_at)})`);
    assert.strictEqual(await run(ctx, `return sync.pending()`), 1, 'still dirty');
  });

  await test('a column the database lacks is dropped, and the user is told', async () => {
    const ctx = makeCtx();
    const warnings = [];
    ctx.__warn = (m) => warnings.push(m);
    await run(ctx, `sync.onWarn = __warn`);
    ctx.__refuse = (t, row) => ('format' in row ? "Could not find the 'format' column of 'notes' in the schema cache" : null);
    await run(ctx, `await db.insert('notes', { id: 'n1', body: 'must survive' }); await sync.run();`);
    assert.strictEqual(ctx.__server.notes[0].body, 'must survive');
    assert.ok(!('format' in ctx.__server.notes[0]));
    assert.match(warnings.join(), /001_tags_and_markdown/);
  });

  await test('a database without migration 002 gets markdown, this device keeps plain', async () => {
    const ctx = makeCtx();
    const warnings = [];
    ctx.__warn = (m) => warnings.push(m);
    await run(ctx, `sync.onWarn = __warn`);
    ctx.__refuse = (t, row) => (row.format === 'plain' ? 'new row for relation "notes" violates check constraint "notes_format_check"' : null);
    await run(ctx, `await db.insert('notes', { id: 'n1', body: 'line one\\nline two' }); await sync.run();`);
    assert.strictEqual(ctx.__server.notes[0].format, 'markdown');
    assert.strictEqual(ctx.__server.notes[0].body, 'line one\nline two');
    assert.match(warnings.join(), /002_plain_text_notes/);
  });

  await test('a row the server refuses stays on this device and stops retrying', async () => {
    const ctx = makeCtx();
    ctx.__refuse = () => 'new row violates row-level security policy';
    await run(ctx, `await db.insert('notes', { id: 'n1', title: 'kept' }); await sync.run();`);
    assert.strictEqual(await run(ctx, `return sync.pending()`), 0, 'not retried forever');
    assert.strictEqual((await run(ctx, `return db.list('notes')`))[0].title, 'kept', 'not lost to the pull either');
    const [r] = await raw(ctx, 'notes');
    assert.match(r._syncError, /row-level security/);
  });

  console.log('\naccounts');

  await test('signing in takes this device\'s data into the account', async () => {
    const ctx = makeCtx();
    await run(ctx, `await db.insert('notes', { id: 'n1', title: 'written signed out' })`);
    await run(ctx, `await store.adopt('u1'); await sync.run();`);
    assert.strictEqual(ctx.__server.notes[0]?.title, 'written signed out');
  });

  await test('a different account gets everything here, even rows the last one had', async () => {
    const ctx = makeCtx();
    await run(ctx, `await store.adopt('user-a'); await db.insert('notes', { id: 'n1', title: 'from A' }); await sync.run();`);
    // Signed out of A, signed in to B: B's server starts empty.
    ctx.__server.notes = [];
    ctx.__user = { id: 'user-b' };
    await run(ctx, `await store.adopt('user-b'); await sync.run();`);
    assert.strictEqual((await run(ctx, `return db.list('notes')`)).length, 1, 'not dropped as "purged elsewhere"');
    assert.strictEqual(ctx.__server.notes[0]?.title, 'from A', 'uploaded to B');
  });

  await test('the same account signing back in does not upload everything again', async () => {
    const ctx = makeCtx();
    await run(ctx, `await store.adopt('u1'); await db.insert('notes', { id: 'n1' }); await sync.run();`);
    await run(ctx, `await store.adopt('u1')`);
    assert.strictEqual(await run(ctx, `return sync.pending()`), 0);
  });

  await test('user_id is never sent: the server sets it', async () => {
    const ctx = makeCtx();
    ctx.__server.notes.push({ id: 'n1', user_id: 'someone-else', title: 'x', updated_at: '2025-01-01T00:00:00Z' });
    await run(ctx, `await sync.run(); await db.update('notes', 'n1', { title: 'y' }); await sync.run();`);
    const pushed = ctx.__calls.filter((c) => c[0] === 'upsert' && c[1] === 'notes');
    assert.ok(pushed.length && pushed.every((c) => !('user_id' in c[2])));
  });

  await test('erasing this device removes everything', async () => {
    const ctx = makeCtx();
    await run(ctx, `await db.insert('notes', {}); await store.setVaultMeta({ salt: 's', iterations: 1, verifier_iv: 'i', verifier_ct: 'c' }); await store.clear();`);
    assert.strictEqual((await raw(ctx, 'notes')).length, 0);
    assert.strictEqual(await run(ctx, `return store.vaultMeta()`), null);
  });

  console.log('\nvault');
  const META = (salt) => ({ salt, iterations: 1, verifier_iv: 'i-' + salt, verifier_ct: 'c-' + salt });

  await test('a vault set up here reaches the account', async () => {
    const ctx = makeCtx();
    await run(ctx, `await store.setVaultMeta(${JSON.stringify(META('mine'))}); await db.insert('vault_items', { id: 'v1', iv: 'a', ciphertext: 'b' }); await sync.run();`);
    assert.strictEqual(ctx.__server.vault_meta?.salt, 'mine');
    assert.strictEqual(ctx.__server.vault_items.length, 1);
  });

  await test('the account\'s vault comes down to a device that has none', async () => {
    const ctx = makeCtx();
    ctx.__server.vault_meta = { ...META('theirs'), user_id: 'u1' };
    ctx.__server.vault_items.push({ id: 'v1', iv: 'a', ciphertext: 'b', updated_at: '2025-01-01T00:00:00Z' });
    await run(ctx, `await sync.run()`);
    assert.strictEqual((await run(ctx, `return store.vaultMeta()`)).salt, 'theirs');
    assert.strictEqual((await run(ctx, `return db.list('vault_items')`)).length, 1);
  });

  await test('two different vaults are not merged; vault items stand still', async () => {
    const ctx = makeCtx();
    ctx.__server.vault_meta = { ...META('theirs'), user_id: 'u1' };
    ctx.__server.vault_items.push({ id: 'v-theirs', iv: 'a', ciphertext: 'b', updated_at: '2025-01-01T00:00:00Z' });
    await run(ctx, `await store.setVaultMeta(${JSON.stringify(META('mine'))}); await db.insert('vault_items', { id: 'v-mine' });`);
    const res = await run(ctx, `return sync.run()`);
    assert.strictEqual(res.vaultConflict, true);
    assert.deepStrictEqual(ctx.__server.vault_items.map((r) => r.id), ['v-theirs'], 'nothing pushed');
    assert.deepStrictEqual((await run(ctx, `return db.list('vault_items')`)).map((r) => r.id), ['v-mine'], 'nothing pulled');
  });

  await test('keeping the account\'s vault replaces this device\'s', async () => {
    const ctx = makeCtx();
    ctx.__server.vault_meta = { ...META('theirs'), user_id: 'u1' };
    ctx.__server.vault_items.push({ id: 'v-theirs', iv: 'a', ciphertext: 'b', updated_at: '2025-01-01T00:00:00Z' });
    await run(ctx, `await store.setVaultMeta(${JSON.stringify(META('mine'))}); await db.insert('vault_items', { id: 'v-mine' }); await sync.run();`);
    await run(ctx, `await sync.resolveVault('account')`);
    assert.strictEqual((await run(ctx, `return store.vaultMeta()`)).salt, 'theirs');
    assert.deepStrictEqual((await run(ctx, `return db.list('vault_items')`)).map((r) => r.id), ['v-theirs']);
    assert.strictEqual(await run(ctx, `return store.vaultConflict()`), null);
  });

  await test('keeping this device\'s vault replaces the account\'s', async () => {
    const ctx = makeCtx();
    ctx.__server.vault_meta = { ...META('theirs'), user_id: 'u1' };
    ctx.__server.vault_items.push({ id: 'v-theirs', iv: 'a', ciphertext: 'b', updated_at: '2025-01-01T00:00:00Z' });
    await run(ctx, `await store.setVaultMeta(${JSON.stringify(META('mine'))}); await db.insert('vault_items', { id: 'v-mine' }); await sync.run();`);
    await run(ctx, `await sync.resolveVault('device')`);
    assert.strictEqual(ctx.__server.vault_meta.salt, 'mine');
    assert.deepStrictEqual(ctx.__server.vault_items.map((r) => r.id), ['v-mine']);
    assert.deepStrictEqual((await run(ctx, `return db.list('vault_items')`)).map((r) => r.id), ['v-mine']);
  });

  // The wrapped vault key (lib/crypto.js): same vault, new master password.
  const WRAP = (tag) => ({ pw_salt: 'ps-' + tag, pw_wrap_iv: 'pi-' + tag, pw_wrap_ct: 'pc-' + tag });

  await test('a vault from before wrapping uploads with no wrap columns', async () => {
    const ctx = makeCtx();
    await run(ctx, `await store.setVaultMeta(${JSON.stringify(META('mine'))}); await sync.run();`);
    const sent = ctx.__calls.find((c) => c[0] === 'upsert' && c[1] === 'vault_meta')[2];
    assert.ok(!('pw_wrap_ct' in sent) && !('rk_wrap_ct' in sent), JSON.stringify(sent));
  });

  await test('a master password changed here reaches the account', async () => {
    const ctx = makeCtx();
    await run(ctx, `await store.setVaultMeta(${JSON.stringify(META('mine'))}); await sync.run();`);
    await run(ctx, `await store.setVaultMeta(${JSON.stringify({ ...META('mine'), ...WRAP('new') })}); await sync.run();`);
    assert.strictEqual(ctx.__server.vault_meta.pw_wrap_ct, 'pc-new');
    assert.strictEqual(await run(ctx, `return store.vaultConflict()`), null, 'not taken for another vault');
    assert.strictEqual((await run(ctx, `return store.rawVaultMeta()`))._dirty, false);
  });

  await test('a master password changed elsewhere comes down', async () => {
    const ctx = makeCtx();
    await run(ctx, `await store.setVaultMeta(${JSON.stringify({ ...META('mine'), ...WRAP('old') })}); await sync.run();`);
    ctx.__server.vault_meta = { ...ctx.__server.vault_meta, ...WRAP('other'), rk_salt: 'rs', rk_wrap_iv: 'ri', rk_wrap_ct: 'rc' };
    await run(ctx, `await sync.run()`);
    const m = await run(ctx, `return store.vaultMeta()`);
    assert.strictEqual(m.pw_wrap_ct, 'pc-other');
    assert.strictEqual(m.rk_wrap_ct, 'rc');
  });

  await test('a recovery key made here offline does not undo a password changed elsewhere', async () => {
    const ctx = makeCtx();
    await run(ctx, `await store.setVaultMeta(${JSON.stringify({ ...META('mine'), ...WRAP('old') })}); await sync.run();`);
    // Elsewhere: a new master password reaches the account.
    ctx.__server.vault_meta = { ...ctx.__server.vault_meta, ...WRAP('elsewhere') };
    // Here, before syncing: a recovery key, on top of the old password wrap.
    await run(ctx, `const m = await store.vaultMeta(); await store.setVaultMeta({ ...m, rk_salt: 'rs', rk_wrap_iv: 'ri', rk_wrap_ct: 'rc' });`);
    await run(ctx, `await sync.run()`);
    assert.strictEqual(ctx.__server.vault_meta.pw_wrap_ct, 'pc-elsewhere', 'the newer password stays');
    assert.strictEqual(ctx.__server.vault_meta.rk_wrap_ct, 'rc', 'the recovery key goes up');
    const m = await run(ctx, `return store.vaultMeta()`);
    assert.strictEqual(m.pw_wrap_ct, 'pc-elsewhere');
    assert.strictEqual(m.rk_wrap_ct, 'rc');
  });

  await test('a password changed here still beats an unchanged one on the server', async () => {
    const ctx = makeCtx();
    await run(ctx, `await store.setVaultMeta(${JSON.stringify({ ...META('mine'), ...WRAP('old') })}); await sync.run();`);
    await run(ctx, `const m = await store.vaultMeta(); await store.setVaultMeta({ ...m, ...${JSON.stringify(WRAP('mine'))} }); await sync.run();`);
    assert.strictEqual(ctx.__server.vault_meta.pw_wrap_ct, 'pc-mine');
  });

  await test('a vault reset on another device is cleared here too', async () => {
    const ctx = makeCtx();
    await run(ctx, `await store.setVaultMeta(${JSON.stringify(META('mine'))}); await db.insert('vault_items', { id: 'v1', iv: 'a', ciphertext: 'b' }); await sync.run();`);
    await run(ctx, `await db.insert('vault_items', { id: 'v2', iv: 'c', ciphertext: 'd' })`);   // edited offline, old key
    ctx.__server.vault_meta = null;
    ctx.__server.vault_items = [];
    await run(ctx, `await sync.run()`);
    assert.strictEqual(await run(ctx, `return store.vaultMeta()`), null);
    assert.strictEqual((await run(ctx, `return db.list('vault_items')`)).length, 0);
    assert.strictEqual(ctx.__server.vault_items.length, 0, 'no old-key item uploaded');
  });

  await test('without migration 005, vault changes wait and everything else syncs', async () => {
    const ctx = makeCtx();
    ctx.__no005 = true;
    await run(ctx, `await store.setVaultMeta(${JSON.stringify({ ...META('mine'), ...WRAP('new') })}); await db.insert('notes', { id: 'n1' }); await sync.run();`);
    assert.strictEqual(ctx.__server.notes.length, 1, 'notes still sync');
    assert.strictEqual(ctx.__server.vault_meta, null);
    assert.strictEqual((await run(ctx, `return store.rawVaultMeta()`))._dirty, true, 'kept to send later');
  });

  await test('resetting the vault clears it on the server, then here', async () => {
    const ctx = makeCtx();
    await run(ctx, `await store.setVaultMeta(${JSON.stringify(META('mine'))}); await db.insert('vault_items', { id: 'v1', iv: 'a', ciphertext: 'b' }); await sync.run();`);
    await run(ctx, `await sync.resetVault()`);
    assert.strictEqual(ctx.__server.vault_meta, null);
    assert.strictEqual(ctx.__server.vault_items.length, 0);
    assert.strictEqual(await run(ctx, `return store.vaultMeta()`), null);
    assert.strictEqual((await run(ctx, `return db.list('vault_items')`)).length, 0);
  });

  await test('offline, resetting the vault changes nothing anywhere', async () => {
    const ctx = makeCtx();
    await run(ctx, `await store.setVaultMeta(${JSON.stringify(META('mine'))}); await db.insert('vault_items', { id: 'v1', iv: 'a', ciphertext: 'b' }); await sync.run();`);
    ctx.__offline = true;
    await assert.rejects(run(ctx, `await sync.resetVault()`));
    ctx.__offline = false;
    assert.strictEqual(ctx.__server.vault_items.length, 1);
    assert.strictEqual((await run(ctx, `return store.vaultMeta()`)).salt, 'mine');
  });

  await test('signed out, resetting the vault clears this device only', async () => {
    const ctx = makeCtx({ signedIn: false });
    await run(ctx, `await store.setVaultMeta(${JSON.stringify(META('mine'))}); await db.insert('vault_items', { id: 'v1' }); await sync.resetVault();`);
    assert.strictEqual(await run(ctx, `return store.vaultMeta()`), null);
    assert.ok(!ctx.__calls.some((c) => c[0] === 'delete-all'));
  });

  console.log('\nplans');

  await test('a Free account does not sync, and keeps everything here', async () => {
    const ctx = makeCtx();
    ctx.__plan = 'free';
    await run(ctx, `await db.insert('notes', { id: 'n1', title: 'Mine' })`);
    const res = await run(ctx, `return sync.run()`);
    assert.strictEqual(res.needsPro, true);
    assert.strictEqual(res.synced, 0);
    assert.deepStrictEqual(ctx.__calls.map((c) => c[1]), ['plans'], 'only the plan is asked for');
    assert.strictEqual(ctx.__server.notes.length, 0);
    assert.strictEqual((await run(ctx, `return db.list('notes')`))[0].title, 'Mine');
    assert.strictEqual((await run(ctx, `return plan.limits()`)).clips, 200);
  });

  await test('Pro syncs and has no limits', async () => {
    const ctx = makeCtx();
    await run(ctx, `await db.insert('notes', { id: 'n1' })`);
    const res = await run(ctx, `return sync.run()`);
    assert.strictEqual(res.synced, 1);
    const l = await run(ctx, `return plan.limits()`);
    assert.strictEqual(l.templates, Infinity);
    assert.strictEqual(l.trashDays, 365);
  });

  await test('Pro that has ended is Free again', async () => {
    const ctx = makeCtx();
    ctx.__proUntil = '2020-01-01T00:00:00Z';
    const res = await run(ctx, `return sync.run()`);
    assert.strictEqual(res.needsPro, true);
    assert.strictEqual(await run(ctx, `return plan.name()`), 'free');
  });

  await test('a database without migration 004 syncs as before', async () => {
    const ctx = makeCtx();
    ctx.__plan = 'none';
    await run(ctx, `await db.insert('notes', { id: 'n1' })`);
    assert.strictEqual((await run(ctx, `return sync.run()`)).synced, 1);
  });

  await test('offline, the last plan stands', async () => {
    const ctx = makeCtx();
    await run(ctx, `await sync.run()`);
    ctx.__offline = true;
    assert.strictEqual(await run(ctx, `return plan.refresh()`), 'pro');
  });

  await test('signed out is Free', async () => {
    const ctx = makeCtx({ signedIn: false });
    assert.strictEqual(await run(ctx, `return plan.refresh()`), 'free');
  });

  console.log('\nexport and import');

  await test('an export holds every row, tombstones and the vault check included', async () => {
    const ctx = makeCtx({ signedIn: false });
    await run(ctx, `await db.insert('notes', { id: 'a' }); await db.insert('notes', { id: 'b' }); await db.remove('notes', 'b');
      await store.setVaultMeta(${JSON.stringify(META('mine'))});`);
    const data = await run(ctx, `return store.exportAll()`);
    assert.strictEqual(data.app, 'desksync');
    assert.strictEqual(data.tables.notes.length, 2);
    assert.strictEqual(data.vault_meta.salt, 'mine');
    assert.ok(!JSON.stringify(data).includes('"_dirty"'), 'no local bookkeeping in the file');
  });

  await test('import merges: new rows come in, newer copies win, older ones do not', async () => {
    const ctx = makeCtx({ signedIn: false });
    await run(ctx, `await db.insert('notes', { id: 'kept', title: 'mine, newer' })`);
    const file = { app: 'desksync', version: 1, tables: { notes: [
      { id: 'kept', title: 'theirs, older', updated_at: '2000-01-01T00:00:00Z' },
      { id: 'new', title: 'only in the file', updated_at: '2000-01-01T00:00:00Z' }
    ] } };
    const res = await run(ctx, `return store.importAll(${JSON.stringify(file)})`);
    assert.strictEqual(res.counts.notes, 1);
    const titles = (await run(ctx, `return db.list('notes')`)).map((r) => r.title).sort();
    assert.deepStrictEqual(titles, ['mine, newer', 'only in the file']);
  });

  await test('import skips vault items locked under a different master password', async () => {
    const ctx = makeCtx({ signedIn: false });
    await run(ctx, `await store.setVaultMeta(${JSON.stringify(META('mine'))})`);
    const file = { app: 'desksync', version: 1, vault_meta: META('theirs'),
      tables: { vault_items: [{ id: 'v1', iv: 'a', ciphertext: 'b', updated_at: '2025-01-01T00:00:00Z' }] } };
    const res = await run(ctx, `return store.importAll(${JSON.stringify(file)})`);
    assert.strictEqual(res.skippedVault, 1);
    assert.strictEqual((await run(ctx, `return db.list('vault_items')`)).length, 0);
  });

  await test('a file that is not a DeskSync export is refused', async () => {
    const ctx = makeCtx({ signedIn: false });
    await assert.rejects(run(ctx, `return store.importAll({ hello: 'world' })`), /Not a DeskSync export/);
  });

  console.log('\nupgrades');

  await test('the old cache and outbox move into the store', async () => {
    const ctx = makeCtx();
    ctx.__local['cache:notes'] = [{ id: 'a', title: 'Cached', updated_at: '2024-01-01T00:00:00Z' }];
    ctx.__local.outbox = [
      { op: 'insert', table: 'notes', payload: { id: 'b', title: 'Typed offline' } },
      { op: 'update', table: 'notes', rowId: 'a', payload: { title: 'Edited offline' } }
    ];
    await run(ctx, `await store.migrate()`);
    const rows = await run(ctx, `return db.list('notes')`);
    assert.deepStrictEqual(rows.map((r) => r.title).sort(), ['Edited offline', 'Typed offline']);
    assert.strictEqual(await run(ctx, `return sync.pending()`), 2, 'both offline writes still go to the server');
    assert.ok(!('cache:notes' in ctx.__local) && !('outbox' in ctx.__local), 'old keys removed');
  });

  console.log('\ndrafts');

  await test('a draft is written once and then dropped', async () => {
    const ctx = makeCtx();
    await run(ctx, `await drafts.put({ table: 'notes', row: { id: 'n1', title: 'Left behind' } })`);
    assert.strictEqual((await run(ctx, `return drafts.flush()`)).saved, 1);
    assert.strictEqual((await run(ctx, `return db.list('notes')`))[0].title, 'Left behind');
    assert.strictEqual((await run(ctx, `return drafts.flush()`)).saved, 0, 'and not written again');
  });

  await test('a draft a popup is still typing into is left alone', async () => {
    const ctx = makeCtx();
    await run(ctx, `await drafts.put({ table: 'notes', row: { id: 'n1', title: 'Still typing' } })`);
    assert.strictEqual((await run(ctx, `return drafts.flush({ minAgeMs: 60000 })`)).saved, 0);
    assert.ok(await run(ctx, `return drafts.get()`), 'still there for the next sweep');
  });

  await test('signing out drops the draft with everything else', async () => {
    const ctx = makeCtx();
    await run(ctx, `await drafts.put({ table: 'notes', row: { id: 'n1' } }); await db.insert('notes', {}); await store.clear();`);
    assert.strictEqual(await run(ctx, `return drafts.get()`), null);
    assert.strictEqual((await raw(ctx, 'notes')).length, 0);
  });

  console.log(`\n${passed} passed`);
})();
