// Code that runs inside a web page, injected by DeskSync: filling a login
// form, and the small account chooser for a site with several saved logins.
//
// Each function is passed to chrome.scripting.executeScript, which runs it in
// the extension's isolated world on the page: it can reach the page's DOM but
// shares nothing else with the page's own scripts. So each must stand alone,
// with no reference to anything outside its own body.
//
// Loaded by the popup (Fill) and by the service worker (Alt+Shift+L).

// Fills the visible login form: the password field, and the username field
// before it. On the first step of a two-step sign-in (Google, Microsoft, X:
// the username now, the password on the next page) it fills the username
// alone, but only into a field marked as a login username, never an ordinary
// email box such as a newsletter signup.
function fillForm(username, password) {
  const shown = (el) => el.getClientRects().length > 0 && !el.disabled && !el.readOnly;
  const setValue = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const inputs = [...document.querySelectorAll('input')].filter(shown);
  const pw = inputs.find((i) => i.type === 'password');
  // A password field on screen but switched off is a form that is not ready
  // (or locked), not the first step of a sign-in: nothing is filled there.
  const pwOnScreen = [...document.querySelectorAll('input[type=password]')].some((i) => i.getClientRects().length > 0);
  if (!pw && !pwOnScreen) {
    const userField = inputs.find((i) => /^(text|email|tel)$/.test(i.type) &&
      (i.autocomplete === 'username' || /user|login|account|identifier/i.test(`${i.name} ${i.id}`)));
    if (userField && username) {
      setValue(userField, username);
      userField.focus();
      return { filled: 1, foundPassword: false, usernameOnly: true };
    }
    return { filled: 0, foundPassword: false };
  }
  if (!pw) return { filled: 0, foundPassword: false };
  const before = inputs.slice(0, inputs.indexOf(pw)).filter((i) => /^(text|email|tel)$/.test(i.type));
  const named = before.filter((i) =>
    /user|email|login|account/i.test(`${i.name} ${i.id} ${i.autocomplete} ${i.getAttribute('aria-label') || ''}`));
  const user = named[named.length - 1] || before[before.length - 1];
  let filled = 0;
  if (user && username) { setValue(user, username); filled++; }
  if (password) { setValue(pw, password); filled++; pw.focus(); }
  return { filled, foundPassword: true };
}

// A short note at the top right of the page ("No saved login for x.com"),
// gone after a few seconds. Inside a closed shadow root, so the page's styles
// cannot reach it and its scripts cannot read it.
function pageNotice(text) {
  document.getElementById('desksync-notice')?.remove();
  const host = document.createElement('div');
  host.id = 'desksync-notice';
  host.style.cssText = 'all:initial;position:fixed;top:16px;right:16px;z-index:2147483647';
  const root = host.attachShadow({ mode: 'closed' });
  const box = document.createElement('div');
  box.textContent = text;
  box.style.cssText = 'font:500 13px/1.4 system-ui,sans-serif;background:#141414;color:#f2f2ef;' +
    'padding:10px 14px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);max-width:320px';
  root.append(box);
  document.documentElement.append(host);
  setTimeout(() => host.remove(), 3500);
}

// The account chooser for a site with several saved logins: names and
// usernames only. The page never sees a password: choosing one sends its id
// back to the service worker, which checks the choice against what it offered
// and only then fills that one login. Esc, a click outside or 20 seconds
// close it.
function pageChooser(accounts, token) {
  document.getElementById('desksync-chooser')?.remove();
  const host = document.createElement('div');
  host.id = 'desksync-chooser';
  host.style.cssText = 'all:initial;position:fixed;top:16px;right:16px;z-index:2147483647';
  const root = host.attachShadow({ mode: 'closed' });
  const css = document.createElement('style');
  css.textContent = `
    .card { font: 13px/1.4 system-ui, sans-serif; background: #fff; color: #141414; width: 280px;
      border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.28); padding: 8px; }
    .head { display: flex; align-items: center; justify-content: space-between; padding: 4px 6px 8px;
      font-size: 12px; font-weight: 600; color: #70706b; }
    .x { all: unset; cursor: pointer; padding: 0 6px; border-radius: 6px; font-size: 16px; color: #70706b; }
    .x:hover { background: #f0f0ec; }
    button.acc { all: unset; box-sizing: border-box; display: flex; flex-direction: column; width: 100%;
      padding: 8px 10px; border-radius: 8px; cursor: pointer; }
    button.acc:hover, button.acc:focus-visible { background: #f0f0ec; outline: none; }
    .t { font-weight: 600; } .u { font-size: 12px; color: #70706b; }
    @media (prefers-color-scheme: dark) {
      .card { background: #1d1d1b; color: #f2f2ef; } button.acc:hover, button.acc:focus-visible, .x:hover { background: #2c2c28; }
      .head, .u, .x { color: #9aa0a6; } }`;
  const card = document.createElement('div');
  card.className = 'card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Choose an account to fill');
  const head = document.createElement('div');
  head.className = 'head';
  head.textContent = 'DeskSync: fill which account?';
  const x = document.createElement('button');
  x.className = 'x';
  x.textContent = '×';
  x.setAttribute('aria-label', 'Close');
  head.append(x);
  card.append(head);
  const close = () => { host.remove(); document.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onOut, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const onOut = (e) => { if (!host.contains(e.target)) close(); };
  x.addEventListener('click', close);
  for (const a of accounts) {
    const b = document.createElement('button');
    b.className = 'acc';
    const t = document.createElement('span'); t.className = 't'; t.textContent = a.title;
    const u = document.createElement('span'); u.className = 'u'; u.textContent = a.username || 'no username';
    b.append(t, u);
    b.addEventListener('click', () => { close(); chrome.runtime.sendMessage({ type: 'fill-choice', id: a.id, token }); });
    card.append(b);
  }
  root.append(css, card);
  document.documentElement.append(host);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('mousedown', onOut, true);
  setTimeout(close, 20000);
  root.querySelector('button.acc')?.focus();
  return { shown: accounts.length };
}

if (typeof module !== 'undefined') module.exports = { fillForm, pageNotice, pageChooser };
