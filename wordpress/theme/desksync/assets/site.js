// The front page: the install button and the waitlist form. The form puts one
// email address into the `waitlist` table (supabase/migrations/003_waitlist.sql).
// The public key can add a row and nothing else, so this page cannot read who signed up.
(() => {
  const cfg = window.DESKSYNC_SITE || {};

  // Until the extension is published there is no store page to link to.
  const links = document.querySelectorAll('.wp-block-button.install a, a.install-link');
  for (const link of links) {
    if (cfg.store) {
      link.href = cfg.store;
      link.rel = 'noopener';
    } else if (link.closest('.top')) {
      link.textContent = 'Join the Pro waitlist';
      link.href = '/#waitlist';
    } else {
      link.closest('.wp-block-button').classList.add('pending');
      link.removeAttribute('href');
      link.setAttribute('aria-disabled', 'true');
      link.textContent = 'Coming soon to the Chrome Web Store';
    }
  }

  const form = document.getElementById('waitlist');
  if (!form) return;
  const input = form.querySelector('input[type=email]');
  const msg = form.querySelector('.msg');
  const button = form.querySelector('button');
  const ready = cfg.url && cfg.key;
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
