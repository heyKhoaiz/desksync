// Tests for the vault key format in extension/lib/crypto.js, with real WebCrypto:
// unlocking, the recovery key, changing the master password, and vaults made
// before keys were wrapped.
//   node tests/vaultkeys.test.js      (or: make test-ext)
const vm = require('vm');
const fs = require('fs');
const assert = require('assert');

const ctx = vm.createContext({ crypto: globalThis.crypto, TextEncoder, TextDecoder, btoa, atob, Uint8Array });
vm.runInContext(fs.readFileSync(`${__dirname}/../extension/lib/crypto.js`, 'utf8')
  + '\nthis.vaultKeys = vaultKeys; this.vaultCrypto = vaultCrypto; this.b64 = b64; this.VAULT_VERIFIER = VAULT_VERIFIER;', ctx);
const { vaultKeys, vaultCrypto, b64, VAULT_VERIFIER } = ctx;

// Few iterations: these test the format, not PBKDF2's cost.
const IT = 1000;
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ok  ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message)); fail++; }
}
const wrong = async (p) => {
  await assert.rejects(p, (e) => e.message === vaultKeys.WRONG_SECRET);
};
const raw = async (k) => Buffer.from(await crypto.subtle.exportKey('raw', k)).toString('hex');

// A vault made by the extension before wrapping existed (popup.js, until now).
async function legacyVault(password) {
  const salt = b64.from(vaultCrypto.randomBytes(16));
  const key = await vaultCrypto.deriveKey(password, salt, IT);
  const v = await vaultCrypto.encrypt(key, VAULT_VERIFIER);
  return { key, meta: { salt, iterations: IT, verifier_iv: v.iv, verifier_ct: v.ciphertext } };
}

(async () => {
  console.log('vault keys: a new vault');
  await test('the master password opens it, and an item stays readable', async () => {
    const { key, meta } = await vaultKeys.create('correct horse', IT);
    const item = await vaultCrypto.encrypt(key, 'secret login');
    const again = await vaultKeys.unlock(meta, 'correct horse');
    assert.strictEqual(await vaultCrypto.decrypt(again, item.iv, item.ciphertext), 'secret login');
  });
  await test('a wrong master password is refused', async () => {
    const { meta } = await vaultKeys.create('correct horse', IT);
    await wrong(vaultKeys.unlock(meta, 'Correct horse'));
  });
  await test('the vault key is random, not made from the password', async () => {
    const a = await vaultKeys.create('same', IT);
    const b = await vaultKeys.create('same', IT);
    assert.notStrictEqual(await raw(a.key), await raw(b.key));
  });
  await test('the stored row holds no key or password in the clear', async () => {
    const { key, meta } = await vaultKeys.create('correct horse', IT);
    const row = JSON.stringify(meta);
    assert.ok(!row.includes('correct horse'));
    assert.ok(!row.includes(b64.from(Buffer.from(await raw(key), 'hex'))));
  });
  await test('it has no recovery key until one is made', async () => {
    const { meta } = await vaultKeys.create('pw', IT);
    assert.strictEqual(vaultKeys.hasRecovery(meta), false);
    await wrong(vaultKeys.unlockWithRecovery(meta, 'AAAA-AAAA'));
  });

  console.log('\nvault keys: the recovery key');
  await test('looks like 8 groups of 4 from the unambiguous alphabet', async () => {
    const { key, meta } = await vaultKeys.create('pw', IT);
    const { recoveryKey } = await vaultKeys.newRecovery(meta, key);
    assert.match(recoveryKey, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/);
  });
  await test('opens the vault to the same key', async () => {
    const { key, meta: m0 } = await vaultKeys.create('pw', IT);
    const { meta, recoveryKey } = await vaultKeys.newRecovery(m0, key);
    assert.strictEqual(await raw(await vaultKeys.unlockWithRecovery(meta, recoveryKey)), await raw(key));
  });
  await test('typed in lower case, with spaces, or O for 0 and I/L for 1', async () => {
    const { key, meta: m0 } = await vaultKeys.create('pw', IT);
    const { meta, recoveryKey } = await vaultKeys.newRecovery(m0, key);
    const sloppy = recoveryKey.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l');
    await vaultKeys.unlockWithRecovery(meta, sloppy);
  });
  await test('a wrong recovery key is refused', async () => {
    const { key, meta: m0 } = await vaultKeys.create('pw', IT);
    const { meta, recoveryKey } = await vaultKeys.newRecovery(m0, key);
    const flipped = (recoveryKey[0] === 'A' ? 'B' : 'A') + recoveryKey.slice(1);
    await wrong(vaultKeys.unlockWithRecovery(meta, flipped));
  });
  await test('a new recovery key retires the old one', async () => {
    const { key, meta: m0 } = await vaultKeys.create('pw', IT);
    const first = await vaultKeys.newRecovery(m0, key);
    const second = await vaultKeys.newRecovery(first.meta, key);
    await wrong(vaultKeys.unlockWithRecovery(second.meta, first.recoveryKey));
    await vaultKeys.unlockWithRecovery(second.meta, second.recoveryKey);
  });
  await test('the master password still works alongside it', async () => {
    const { key, meta: m0 } = await vaultKeys.create('pw', IT);
    const { meta } = await vaultKeys.newRecovery(m0, key);
    await vaultKeys.unlock(meta, 'pw');
  });

  console.log('\nvault keys: changing the master password');
  await test('the new password opens it, the old one no longer does', async () => {
    const { key, meta: m0 } = await vaultKeys.create('old password', IT);
    const meta = await vaultKeys.setPassword(m0, key, 'new password');
    await vaultKeys.unlock(meta, 'new password');
    await wrong(vaultKeys.unlock(meta, 'old password'));
  });
  await test('items need no re-encrypting, and the vault keeps its identity', async () => {
    const { key, meta: m0 } = await vaultKeys.create('old', IT);
    const item = await vaultCrypto.encrypt(key, 'login');
    const meta = await vaultKeys.setPassword(m0, key, 'new');
    assert.strictEqual(meta.salt, m0.salt);
    assert.strictEqual(meta.verifier_ct, m0.verifier_ct);
    assert.strictEqual(await vaultCrypto.decrypt(await vaultKeys.unlock(meta, 'new'), item.iv, item.ciphertext), 'login');
  });
  await test('the recovery key survives a password change', async () => {
    const { key, meta: m0 } = await vaultKeys.create('old', IT);
    const r = await vaultKeys.newRecovery(m0, key);
    const meta = await vaultKeys.setPassword(r.meta, key, 'new');
    await vaultKeys.unlockWithRecovery(meta, r.recoveryKey);
  });
  await test('forgot it: the recovery key, then a new master password', async () => {
    const { key, meta: m0 } = await vaultKeys.create('forgotten', IT);
    const item = await vaultCrypto.encrypt(key, 'login');
    const r = await vaultKeys.newRecovery(m0, key);
    const recovered = await vaultKeys.unlockWithRecovery(r.meta, r.recoveryKey);
    const meta = await vaultKeys.setPassword(r.meta, recovered, 'remembered');
    assert.strictEqual(await vaultCrypto.decrypt(await vaultKeys.unlock(meta, 'remembered'), item.iv, item.ciphertext), 'login');
    await wrong(vaultKeys.unlock(meta, 'forgotten'));
  });

  console.log('\nvault keys: vaults made before wrapping');
  await test('still open with their master password', async () => {
    const { key, meta } = await legacyVault('legacy pw');
    assert.strictEqual(await raw(await vaultKeys.unlock(meta, 'legacy pw')), await raw(key));
    await wrong(vaultKeys.unlock(meta, 'nope'));
  });
  await test('take a recovery key and a new password without re-encrypting', async () => {
    const { key, meta: m0 } = await legacyVault('legacy pw');
    const item = await vaultCrypto.encrypt(key, 'old login');
    const unlocked = await vaultKeys.unlock(m0, 'legacy pw');
    const r = await vaultKeys.newRecovery(m0, unlocked);
    const meta = await vaultKeys.setPassword(r.meta, unlocked, 'fresh pw');
    await wrong(vaultKeys.unlock(meta, 'legacy pw'));
    const k2 = await vaultKeys.unlock(meta, 'fresh pw');
    assert.strictEqual(await vaultCrypto.decrypt(k2, item.iv, item.ciphertext), 'old login');
    const k3 = await vaultKeys.unlockWithRecovery(meta, r.recoveryKey);
    assert.strictEqual(await vaultCrypto.decrypt(k3, item.iv, item.ciphertext), 'old login');
  });
  await test('a legacy vault given only a recovery key keeps its password', async () => {
    const { key, meta: m0 } = await legacyVault('legacy pw');
    const r = await vaultKeys.newRecovery(m0, key);
    await vaultKeys.unlock(r.meta, 'legacy pw');
  });

  console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ''}`);
  process.exit(fail ? 1 : 0);
})();
