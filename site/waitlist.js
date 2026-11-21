// The waitlist form: one email address into the `waitlist` table
// (supabase/migrations/003_waitlist.sql). The public key can add a row and
// nothing else, so this page cannot read who signed up.
(() => {
  const cfg = window.DESKSYNC_SITE || {};
  const form = document.getElementById('waitlist');
  const input = document.getElementById('email');
  const msg = document.getElementById('msg');
  const button = form.querySelector('button');
  const ready = cfg.url && cfg.key && !cfg.url.includes('{{');

  // Until the extension is published there is no store page to link to.
  const install = document.getElementById('install');
  if (!cfg.store || cfg.store.includes('{{')) {
    // The download is the way in until then: the store button steps aside.
    install.style.display = 'none';
    document.getElementById('download').classList.remove('ghost');
  }

  const say = (text, kind = '') => { msg.textContent = text; msg.className = 'msg ' + kind; };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = input.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return say('That does not look like an email address.', 'err');
    if (!ready) return say('The waitlist is not open yet. Please try again soon.', 'err');
    button.disabled = true;
    say('Adding you…');
    try {
      const res = await fetch(`${cfg.url}/rest/v1/waitlist`, {
        method: 'POST',
        headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ email: email.toLowerCase(), source: 'site' })
      });
      // 409: already on the list. Same answer either way, so the form cannot be
      // used to find out whether an address signed up.
      if (res.ok || res.status === 409) {
        form.reset();
        say('You are on the list. We will write once, when Pro opens.', 'ok');
      } else {
        say('That did not go through. Please try again.', 'err');
      }
    } catch {
      say('No connection. Please try again.', 'err');
    } finally {
      button.disabled = false;
    }
  });
})();
