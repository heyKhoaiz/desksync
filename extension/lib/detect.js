// What a piece of copied text looks like: a secret, a bit of code, or neither.
//
// Shared by the popup (masking a secret clip, setting code in monospace), the
// service worker (not recording a secret copied on an approved site) and the
// Node tests. No DOM and no chrome.* here, so it loads in all three.
//
// Both checks lean towards "no". A secret shown masked by mistake is one click
// to reveal; an ordinary clip hidden behind dots for no reason makes the list
// useless. Code set in monospace by mistake costs nothing either way, but prose
// in monospace reads badly, so that one also needs real evidence.

const detect = (() => {
  // Formats with a known prefix. Each one is a real credential format, not a
  // guess, which is why these alone are enough to call something a secret.
  const KNOWN = [
    /\bAKIA[0-9A-Z]{16}\b/,                                  // AWS access key id
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,                         // GitHub tokens
    /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,                       // GitHub fine-grained
    /\bglpat-[A-Za-z0-9_-]{20,}\b/,                           // GitLab
    /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{20,}/,     // OpenAI, Anthropic and friends
    /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/,               // Stripe secret / restricted
    /\bxox[abposr]-[A-Za-z0-9-]{10,}/,                        // Slack
    /\bAIza[0-9A-Za-z_-]{35}\b/,                              // Google API key
    /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/,           // SendGrid
    /\bnpm_[A-Za-z0-9]{36}\b/,                                // npm
    /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, // a JWT (Supabase keys are these)
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,                     // PEM private key
    /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s@/]+@/  // URL with a password in it
  ];

  // KEY=value and "key": "value" where the name says what it is.
  const ASSIGNED = /\b[A-Za-z0-9_]*(?:secret|token|api[_-]?key|passw(?:or)?d|private[_-]?key|access[_-]?key)[A-Za-z0-9_]*["']?\s*[:=]\s*["']?[^\s"']{8,}/i;

  // Shannon entropy in bits per character.
  function entropy(s) {
    const counts = {};
    for (const ch of s) counts[ch] = (counts[ch] || 0) + 1;
    let h = 0;
    for (const n of Object.values(counts)) { const p = n / s.length; h -= p * Math.log2(p); }
    return h;
  }

  // One unbroken run of random-looking characters, with no format we know. Long,
  // mixed case and digits, and high entropy, all at once: a word, a path, a URL,
  // a hash someone is comparing or a UUID fails at least one of these.
  function looksRandom(s) {
    if (s.length < 32 || s.length > 512 || /\s/.test(s)) return false;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || s.includes('/') || s.includes('@')) return false;
    if (/^[0-9a-f-]+$/i.test(s)) return false;           // hex digests and UUIDs
    if (!/[a-z]/.test(s) || !/[A-Z]/.test(s) || !/[0-9]/.test(s)) return false;
    return entropy(s) >= 4.2;
  }

  function isSecret(text) {
    const s = String(text || '').trim();
    if (!s || s.length > 20000) return false;
    if (KNOWN.some((re) => re.test(s))) return true;
    // Assignments only count in a short snippet: a whole .env pasted as one clip
    // is a secret, a README that mentions "token: <your token here>" is not.
    if (s.length < 400 && ASSIGNED.test(s) && !/<[^>]+>|your[_ -]|xxx|\.\.\./i.test(s)) return true;
    return looksRandom(s);
  }

  // Enough of a secret to recognise which one it is, and nothing you could use.
  function mask(text) {
    const s = String(text || '').trim();
    if (s.length <= 12) return '•'.repeat(8);
    return s.slice(0, 4) + '••••••••' + s.slice(-4);
  }

  const SHELL = /^\s*(?:\$\s+|>\s+)?(?:npx|npm|pnpm|yarn|bun|node|deno|git|gh|curl|wget|docker|kubectl|helm|sudo|apt(?:-get)?|brew|pip3?|python3?|uv|cargo|go|make|cd|ls|cat|grep|rg|ssh|scp|export|chmod|chown|mkdir|rm|mv|cp|supabase|vercel|wp|composer|php|flutter|dart|terraform|aws|gcloud|az)\b/;
  const CODE_LINE = /(?:[;{}]\s*$|^\s*(?:const|let|var|function|def|class|import|export|return|if|for|while|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\b|=>|::|\)\s*\{|<\/?[a-z][a-z0-9-]*[\s>])/;

  // Code, a command or a query: something you would want in monospace with its
  // spaces kept.
  function isCode(text) {
    const s = String(text || '').trim();
    if (!s) return false;
    const lines = s.split('\n');
    if (lines.length === 1) {
      if (SHELL.test(s)) return true;
      // One line of prose has spaces between words and ends like a sentence.
      return CODE_LINE.test(s) && !/[.!?]["')]?$/.test(s);
    }
    const codeish = lines.filter((l) => CODE_LINE.test(l) || SHELL.test(l) || /^( {2,}|\t)\S/.test(l)).length;
    return codeish / lines.length >= 0.4;
  }

  return { isSecret, isCode, mask, entropy };
})();

if (typeof module !== 'undefined') module.exports = detect;
