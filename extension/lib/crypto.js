// Vault crypto — the Flutter app must implement exactly the same format:
//   kdf   = PBKDF2-HMAC-SHA256(secret, salt[16], iterations=600000) → 256-bit
//   cipher= AES-256-GCM, iv = 12 random bytes per encryption, 128-bit tag appended (WebCrypto default)
//   all binary values stored as standard base64
//
// The vault key is what every item is encrypted with; it never changes, so a new
// master password re-encrypts nothing. vault_meta holds:
//   salt, verifier_iv/ct   the vault's identity: verifier = AES(vault key, VAULT_VERIFIER)
//   pw_salt, pw_wrap_iv/ct AES(kdf(master password, pw_salt), base64(vault key))
//   rk_salt, rk_wrap_iv/ct AES(kdf(recovery key, rk_salt), base64(vault key)), when one was made
// A vault from before wrapping has no pw_wrap_ct: its vault key is
// kdf(master password, salt). Once a pw wrap exists only it is used, so an old
// master password stops working.
// The unlocked key lives only in chrome.storage.session (memory; cleared when Chrome closes).

const VAULT_VERIFIER = 'desksync-ok';
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = {
  from(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  },
  to(str) {
    const s = atob(str);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
};

const vaultCrypto = {
  randomBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); },

  async deriveKey(password, saltB64, iterations = 600000) {
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: b64.to(saltB64), iterations },
      base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
    );
  },

  async encrypt(key, plaintext) {
    const iv = this.randomBytes(12);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
    return { iv: b64.from(iv), ciphertext: b64.from(ct) };
  },

  async decrypt(key, ivB64, ctB64) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.to(ivB64) }, key, b64.to(ctB64));
    return dec.decode(pt);
  },

  // Keep the unlocked key in session memory so reopening the popup doesn't ask again.
  async storeSessionKey(key) {
    const raw = await crypto.subtle.exportKey('raw', key);
    const lockAt = Date.now() + DESKSYNC_CONFIG.VAULT_AUTOLOCK_MINUTES * 60000;
    await chrome.storage.session.set({ vaultKey: b64.from(raw), vaultLockAt: lockAt });
  },

  async loadSessionKey() {
    const { vaultKey, vaultLockAt } = await chrome.storage.session.get(['vaultKey', 'vaultLockAt']);
    if (!vaultKey || Date.now() > vaultLockAt) { await this.lock(); return null; }
    return crypto.subtle.importKey('raw', b64.to(vaultKey), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  },

  async lock() { await chrome.storage.session.remove(['vaultKey', 'vaultLockAt']); },

  generatePassword(length = 20) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+';
    const out = [];
    const limit = 256 - (256 % chars.length);   // avoid modulo bias
    while (out.length < length) {
      for (const b of this.randomBytes(length * 2)) {
        if (b < limit && out.length < length) out.push(chars[b % chars.length]);
      }
    }
    return out.join('');
  }
};

// ---------------------------------------------------------------------------
// Vault keys: unlocking, the recovery key, and changing the master password.
// Every function takes and returns vault_meta rows (see the format above); none
// of them store anything.
// ---------------------------------------------------------------------------
const WRONG_SECRET = 'wrong-secret';
// Crockford base32: no I, L, O or U, so a written-down key reads back the same.
const RK_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const vaultKeys = {
  WRONG_SECRET,

  async _import(raw) {
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  },
  async _raw(key) { return new Uint8Array(await crypto.subtle.exportKey('raw', key)); },

  async _wrap(vaultKey, secret, iterations) {
    const salt = b64.from(vaultCrypto.randomBytes(16));
    const kek = await vaultCrypto.deriveKey(secret, salt, iterations);
    const { iv, ciphertext } = await vaultCrypto.encrypt(kek, b64.from(await this._raw(vaultKey)));
    return { salt, iv, ct: ciphertext };
  },
  async _unwrap(secret, salt, iv, ct, iterations) {
    const kek = await vaultCrypto.deriveKey(secret, salt, iterations);
    try { return await this._import(b64.to(await vaultCrypto.decrypt(kek, iv, ct))); }
    catch { throw new Error(WRONG_SECRET); }
  },
  async _check(meta, key) {
    try { return (await vaultCrypto.decrypt(key, meta.verifier_iv, meta.verifier_ct)) === VAULT_VERIFIER; }
    catch { return false; }
  },

  // A new vault: a random vault key, wrapped by the master password.
  async create(password, iterations = 600000) {
    const key = await this._import(vaultCrypto.randomBytes(32));
    const v = await vaultCrypto.encrypt(key, VAULT_VERIFIER);
    const meta = { salt: b64.from(vaultCrypto.randomBytes(16)), iterations, verifier_iv: v.iv, verifier_ct: v.ciphertext };
    return { key, meta: await this.setPassword(meta, key, password) };
  },

  // The vault key, or throws Error(WRONG_SECRET).
  async unlock(meta, password) {
    const key = meta.pw_wrap_ct
      ? await this._unwrap(password, meta.pw_salt, meta.pw_wrap_iv, meta.pw_wrap_ct, meta.iterations)
      : await vaultCrypto.deriveKey(password, meta.salt, meta.iterations);
    if (!(await this._check(meta, key))) throw new Error(WRONG_SECRET);
    return key;
  },

  hasRecovery(meta) { return !!meta?.rk_wrap_ct; },

  async unlockWithRecovery(meta, recoveryKey) {
    if (!this.hasRecovery(meta)) throw new Error(WRONG_SECRET);
    const key = await this._unwrap(this.normalize(recoveryKey), meta.rk_salt, meta.rk_wrap_iv, meta.rk_wrap_ct, meta.iterations);
    if (!(await this._check(meta, key))) throw new Error(WRONG_SECRET);
    return key;
  },

  // A copy of meta whose master password is `password`.
  async setPassword(meta, key, password) {
    const w = await this._wrap(key, password, meta.iterations);
    return { ...meta, pw_salt: w.salt, pw_wrap_iv: w.iv, pw_wrap_ct: w.ct };
  },

  // A new recovery key, replacing any earlier one: { meta, recoveryKey }.
  async newRecovery(meta, key) {
    const bytes = vaultCrypto.randomBytes(20);   // 160 bits → 32 characters
    let bits = 0, value = 0, out = '';
    for (const b of bytes) {
      value = ((value << 8) | b) & 0xfff; bits += 8;   // never more than 12 unread bits
      while (bits >= 5) { out += RK_ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
    }
    const recoveryKey = out.match(/.{4}/g).join('-');
    const w = await this._wrap(key, this.normalize(recoveryKey), meta.iterations);
    return { recoveryKey, meta: { ...meta, rk_salt: w.salt, rk_wrap_iv: w.iv, rk_wrap_ct: w.ct } };
  },

  // How the key was typed does not matter: case, spaces, dashes, and the
  // letters Crockford reads as digits.
  normalize(recoveryKey) {
    return String(recoveryKey).toUpperCase().replace(/[^0-9A-Z]/g, '')
      .replace(/O/g, '0').replace(/[IL]/g, '1');
  }
};
