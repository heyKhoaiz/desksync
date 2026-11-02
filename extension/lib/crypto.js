// Vault crypto — the Flutter app must implement exactly the same format:
//   key   = PBKDF2-HMAC-SHA256(masterPassword, salt[16], iterations=600000) → 256-bit
//   cipher= AES-256-GCM, iv = 12 random bytes per encryption, 128-bit tag appended (WebCrypto default)
//   all binary values stored as standard base64
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
