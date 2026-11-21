#!/usr/bin/env python3
"""DeskSync admin: see who has an account and give Pro by hand.

    make admin            (then open the address it prints)

Runs on this computer only. It needs the project's secret key
(SUPABASE_SERVICE_ROLE_KEY in .env), which can read every account and bypasses
row level security, so it is never put in a web page: the browser talks to this
small server on 127.0.0.1, and the server talks to Supabase.

Guards, because a local server is still reachable from web pages you visit:
- listens on 127.0.0.1 only;
- refuses any Host but 127.0.0.1/localhost (stops DNS rebinding);
- every API call needs the random token printed at start, sent as a header,
  which a page on another site cannot read or send.

Standard library only.
"""
import http.server
import json
import os
import re
import secrets
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get('ADMIN_PORT', '8787'))
TOKEN = secrets.token_urlsafe(24)


def load_env():
    """KEY=VALUE lines from .env; the environment wins. `\\#` is a # (see .env.example)."""
    env = {}
    path = os.path.join(ROOT, '.env')
    if os.path.exists(path):
        for line in open(path, encoding='utf-8'):
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip().strip('"').strip("'").replace('\\#', '#')
    env.update({k: v for k, v in os.environ.items() if k.startswith('SUPABASE_')})
    return env


ENV = load_env()
URL = ENV.get('SUPABASE_URL', '').rstrip('/')
KEY = ENV.get('SUPABASE_SERVICE_ROLE_KEY', '')


def supabase(method, path, body=None, prefer=None):
    headers = {'apikey': KEY, 'Content-Type': 'application/json'}
    # Legacy service_role keys are JWTs and go in Authorization too; the newer
    # sb_secret_ keys are sent as apikey only.
    if KEY.startswith('eyJ'):
        headers['Authorization'] = 'Bearer ' + KEY
    if prefer:
        headers['Prefer'] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(URL + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        msg = e.read().decode(errors='replace')[:300]
        raise RuntimeError(f'Supabase answered {e.code}: {msg}') from None


def list_users():
    users, page = [], 1
    while True:
        res = supabase('GET', f'/auth/v1/admin/users?page={page}&per_page=1000')
        batch = res.get('users', []) if isinstance(res, dict) else []
        users += batch
        if len(batch) < 1000:
            break
        page += 1
    plans = {p['user_id']: p for p in supabase('GET', '/rest/v1/plans?select=*') or []}
    now = datetime.now(timezone.utc)
    out = []
    for u in users:
        p = plans.get(u['id'])
        until = p.get('pro_until') if p else None
        active = bool(p and p['plan'] == 'pro' and (not until or datetime.fromisoformat(until.replace('Z', '+00:00')) > now))
        out.append({
            'id': u['id'], 'email': u.get('email') or '(no email)',
            'created_at': u.get('created_at'), 'last_sign_in_at': u.get('last_sign_in_at'),
            'confirmed': bool(u.get('email_confirmed_at')),
            'plan': 'pro' if active else 'free', 'pro_until': until,
            'expired': bool(p and p['plan'] == 'pro' and not active),
        })
    out.sort(key=lambda x: x['created_at'] or '', reverse=True)
    return out


def waitlist_count():
    try:
        rows = supabase('GET', '/rest/v1/waitlist?select=email')
        return len(rows or [])
    except RuntimeError:
        return None


UUID = re.compile(r'^[0-9a-f-]{36}$')
LENGTHS = {'forever': None, 'month': 31, 'year': 365}


def set_plan(user_id, plan, length):
    if not UUID.match(user_id or ''):
        raise ValueError('bad user id')
    if plan not in ('pro', 'free'):
        raise ValueError('plan must be pro or free')
    if length not in LENGTHS:
        raise ValueError('length must be forever, month or year')
    days = LENGTHS[length]
    until = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat() if plan == 'pro' and days else None
    row = {'user_id': user_id, 'plan': plan, 'pro_until': until, 'updated_at': datetime.now(timezone.utc).isoformat()}
    supabase('POST', '/rest/v1/plans?on_conflict=user_id', [row], prefer='resolution=merge-duplicates,return=minimal')


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quiet: no emails in the terminal scrollback
        pass

    def _host_ok(self):
        host = (self.headers.get('Host') or '').split(':')[0]
        return host in ('127.0.0.1', 'localhost')

    def _send(self, code, body, ctype='application/json'):
        data = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header('Content-Type', ctype + '; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'")
        self.send_header('Referrer-Policy', 'no-referrer')
        self.end_headers()
        self.wfile.write(data)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj))

    def _authed(self):
        return self._host_ok() and secrets.compare_digest(self.headers.get('X-Admin-Token', ''), TOKEN)

    def do_GET(self):
        if not self._host_ok():
            return self._send(403, 'Forbidden', 'text/plain')
        if self.path.split('?')[0] == '/':
            return self._send(200, open(os.path.join(ROOT, 'tools', 'admin.html'), encoding='utf-8').read(), 'text/html')
        if self.path == '/api/users':
            if not self._authed():
                return self._json(401, {'error': 'Open the address printed in the terminal (it carries the token).'})
            try:
                return self._json(200, {'users': list_users(), 'waitlist': waitlist_count()})
            except Exception as e:
                return self._json(502, {'error': str(e)})
        self._send(404, 'Not found', 'text/plain')

    def do_POST(self):
        if self.path != '/api/plan' or not self._authed():
            return self._json(401, {'error': 'not allowed'})
        try:
            n = min(int(self.headers.get('Content-Length', '0')), 10000)
            body = json.loads(self.rfile.read(n) or b'{}')
            set_plan(body.get('user_id'), body.get('plan'), body.get('length', 'forever'))
            return self._json(200, {'ok': True})
        except ValueError as e:
            return self._json(400, {'error': str(e)})
        except Exception as e:
            return self._json(502, {'error': str(e)})


def main():
    if not URL or 'YOUR-PROJECT' in URL:
        sys.exit('SUPABASE_URL is not set in .env')
    if not KEY:
        sys.exit('SUPABASE_SERVICE_ROLE_KEY is not set in .env.\n'
                 'Supabase → Project Settings → API Keys → the secret key (service_role).\n'
                 'Never put it in the extension, the site, or git.')
    server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    print(f'DeskSync admin: http://127.0.0.1:{PORT}/#t={TOKEN}')
    print('Ctrl+C to stop. The token changes every start.')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
