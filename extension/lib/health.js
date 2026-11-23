// Password health and two-factor codes for vault logins. Everything here runs
// on the decrypted items in this browser: no password, hash or key leaves it.
//
//   health.strength(pw)            -> { level: 'weak' | 'fair' | 'strong', label }
//   health.reused(items)           -> Map(id -> [ids of other logins with the same password])
//   health.parseOtp(text)          -> { secret, digits, period, algorithm } or null
//   await health.otpCode(key, now) -> { code: '123456', left: seconds until it changes }
//   health.passphrase(words, n)    -> 'maple-orbit-tiny-crane-47'
// Plain functions, so the Node tests can run them too.

const health = (() => {
  // ---------- Strength ----------
  // A rough guess at how hard a password is to guess, from its length and the
  // kinds of characters in it, with the usual shortcuts people take counted
  // against it. It only has to sort weak from fine, not score precisely.
  const COMMON = /^(password|passw0rd|qwerty|letmein|welcome|admin|iloveyou|monkey|dragon|abc123|123456|111111|000000)/i;

  function strength(pw) {
    const s = String(pw || '');
    if (!s) return { level: 'weak', label: 'No password' };
    let pool = 0;
    if (/[a-z]/.test(s)) pool += 26;
    if (/[A-Z]/.test(s)) pool += 26;
    if (/[0-9]/.test(s)) pool += 10;
    if (/[^a-zA-Z0-9]/.test(s)) pool += 33;
    let bits = s.length * Math.log2(pool || 1);
    // Repeats and runs ("aaaa", "1234", "abcd") add almost nothing.
    if (/(.)\1{2,}/.test(s)) bits -= 10;
    if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|qwer|asdf)/i.test(s)) bits -= 10;
    if (COMMON.test(s)) bits = Math.min(bits, 20);
    // One word with a number (a year, a birthday) and maybe a "!" on the end is
    // the first thing a cracker tries: "summer2024", "Dragon99!".
    if (/^[A-Za-z]{3,12}[0-9]{0,4}[^A-Za-z0-9]?$/.test(s)) bits = Math.min(bits, 40);
    if (s.length < 8 || bits < 45) return { level: 'weak', label: 'Weak' };
    if (bits < 80) return { level: 'fair', label: 'Fair' };
    return { level: 'strong', label: 'Strong' };
  }

  // ---------- Reuse ----------
  // Logins sharing a password: one leak opens all of them.
  function reused(items) {
    const by = new Map();
    for (const it of items) {
      if (!it.password) continue;
      if (!by.has(it.password)) by.set(it.password, []);
      by.get(it.password).push(it.id);
    }
    const out = new Map();
    for (const ids of by.values()) {
      if (ids.length < 2) continue;
      for (const id of ids) out.set(id, ids.filter((x) => x !== id));
    }
    return out;
  }

  // ---------- Two-factor codes (TOTP, RFC 6238) ----------
  // Takes what a site shows when you set up an authenticator app: the setup key
  // ("JBSW Y3DP EHPK 3PXP") or the otpauth:// link inside its QR code.
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  function base32(text) {
    const clean = String(text).toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
    if (!clean || /[^A-Z2-7]/.test(clean)) return null;
    let bits = 0, value = 0;
    const out = [];
    for (const ch of clean) {
      value = (value << 5) | B32.indexOf(ch);
      bits += 5;
      if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
    }
    return out.length >= 10 ? new Uint8Array(out) : null;   // 80 bits at least, as RFC 4226 asks
  }

  function parseOtp(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    let secret = t, digits = 6, period = 30, algorithm = 'SHA-1';
    if (/^otpauth:\/\//i.test(t)) {
      let u;
      try { u = new URL(t); } catch { return null; }
      if (u.host.toLowerCase() !== 'totp') return null;   // HOTP counters are not supported
      secret = u.searchParams.get('secret') || '';
      digits = +(u.searchParams.get('digits') || 6);
      period = +(u.searchParams.get('period') || 30);
      algorithm = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' }[(u.searchParams.get('algorithm') || 'SHA1').toUpperCase()] || null;
      if (!algorithm || ![6, 7, 8].includes(digits) || !(period >= 10 && period <= 120)) return null;
    }
    if (!base32(secret)) return null;
    return { secret: secret.toUpperCase().replace(/[\s-]/g, ''), digits, period, algorithm };
  }

  async function otpCode(key, now = Date.now()) {
    const bytes = base32(key.secret);
    const step = Math.floor(now / 1000 / key.period);
    const msg = new ArrayBuffer(8);
    const view = new DataView(msg);
    view.setUint32(0, Math.floor(step / 2 ** 32));
    view.setUint32(4, step >>> 0);
    const k = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: key.algorithm }, false, ['sign']);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, msg));
    const off = mac[mac.length - 1] & 15;
    const bin = ((mac[off] & 127) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
    const code = String(bin % 10 ** key.digits).padStart(key.digits, '0');
    const left = key.period - (Math.floor(now / 1000) % key.period);
    return { code, left };
  }

  // ---------- Passphrases ----------
  // n words picked at random from the list, joined by "-", with a number on the
  // end for the sites that demand a digit. Rejection sampling keeps every word
  // equally likely.
  function pick(n) {
    const limit = 65536 - (65536 % n);
    const buf = new Uint16Array(1);
    do crypto.getRandomValues(buf); while (buf[0] >= limit);
    return buf[0] % n;
  }
  function passphrase(words, count = 5) {
    const out = [];
    for (let i = 0; i < count; i++) out.push(words[pick(words.length)]);
    return out.join('-') + '-' + (10 + pick(90));
  }

  return { strength, reused, parseOtp, otpCode, passphrase };
})();

if (typeof module !== 'undefined') module.exports = health;
