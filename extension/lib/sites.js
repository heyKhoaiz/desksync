// Which saved logins belong to which page, and reading a password export.
// Shared by the popup (Fill, the list) and the service worker (Alt+Shift+L).
// Pure string work: runs in both and in the Node tests.

const sites = (() => {
  // A page's host, without "www.", or '' when it is not a web address.
  function hostOf(url) {
    try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : 'https://' + url).hostname.replace(/^www\./, ''); }
    catch { return ''; }
  }

  // Does a login saved for `itemUrl` belong on a page at `tabHost`? The page
  // may be the login's site or a subdomain of it (a login for github.com fills
  // on gist.github.com), never the reverse: a login saved for a.example.com
  // is not offered on example.com, or on b.example.com.
  function matches(itemUrl, tabHost) {
    if (!tabHost || !itemUrl) return false;
    const host = hostOf(itemUrl);
    if (!host) return false;
    return host === tabHost || tabHost.endsWith('.' + host);
  }

  // Comma-separated values as Chrome, Edge, Firefox and most password
  // managers export them: a header row, fields that may be quoted, quotes
  // doubled inside quotes, and line breaks allowed inside a quoted field.
  function parseCsv(text) {
    const rows = [];
    let row = [], field = '', quoted = false;
    const s = String(text || '').replace(/^﻿/, '');
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (quoted) {
        if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some((f) => f !== '')) rows.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (row.some((f) => f !== '')) rows.push(row);
    return rows;
  }

  // Logins from an export. Columns are found by their header names, so the
  // order does not matter: Chrome writes name,url,username,password,note;
  // others write title, login_uri, login_username, notes and so on.
  function loginsFromCsv(text) {
    const [head, ...body] = parseCsv(text);
    if (!head) return { logins: [], skipped: 0, error: 'The file is empty' };
    const col = (...names) => head.findIndex((h) => names.includes(h.trim().toLowerCase()));
    const c = {
      title: col('name', 'title'),
      url: col('url', 'login_uri', 'website', 'origin'),
      username: col('username', 'login_username', 'user', 'email', 'login'),
      password: col('password', 'login_password'),
      notes: col('note', 'notes', 'extra')
    };
    if (c.password < 0 || (c.url < 0 && c.title < 0)) {
      return { logins: [], skipped: body.length, error: 'This does not look like a password export (no password and site columns)' };
    }
    const at = (r, i) => (i >= 0 ? (r[i] || '').trim() : '');
    const logins = [];
    let skipped = 0;
    for (const r of body) {
      const login = { title: at(r, c.title) || hostOf(at(r, c.url)), url: at(r, c.url), username: at(r, c.username),
        password: r[c.password] ?? '', notes: at(r, c.notes), tags: [] };
      if (!login.password && !login.username) { skipped++; continue; }
      logins.push(login);
    }
    return { logins, skipped, error: null };
  }

  // The same login already saved: same site, same username.
  const sameLogin = (a, b) => hostOf(a.url) === hostOf(b.url) && (a.username || '') === (b.username || '');

  return { hostOf, matches, parseCsv, loginsFromCsv, sameLogin };
})();

if (typeof module !== 'undefined') module.exports = sites;
