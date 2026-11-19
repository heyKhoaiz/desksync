#!/usr/bin/env bash
# Checks the autofill field-picking in extension/popup.js against a set of login
# form shapes, by running the shipped fillForm() in headless Chrome.
#
#   tests/fillform.test.sh          (or: make test-ext)
#
# Skips, rather than fails, when no Chrome/Chromium is available.
set -u
cd "$(dirname "$0")/.."

CHROME="${CHROME:-}"
if [ -z "$CHROME" ]; then
  for c in "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux64/chrome \
           /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/google-chrome; do
    [ -x "$c" ] && CHROME="$c" && break
  done
fi
if [ -z "$CHROME" ]; then
  echo "autofill form matching"
  echo "  skipped (no Chrome found; set CHROME=/path/to/chrome)"
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

python3 - "$work" <<'PY'
import json, pathlib, sys
work = pathlib.Path(sys.argv[1])
src = pathlib.Path('extension/popup.js').read_text()

# Pull fillForm out of popup.js so the test runs the shipped source, not a copy.
start = src.index('function fillForm(')
depth, i = 0, src.index('{', start)
for j in range(i, len(src)):
    if src[j] == '{': depth += 1
    elif src[j] == '}':
        depth -= 1
        if depth == 0:
            end = j + 1
            break
fill = src[start:end]

# name -> (markup, expected "filled" count, expected foundPassword, expected field=value pairs)
CASES = {
    'classic username + password': (
        '<input name="username" type="text"><input name="password" type="password">',
        2, True, {'username': 'USER', 'password': 'PASS'}),
    'email with autocomplete hints': (
        '<input id="e" type="email" autocomplete="username"><input id="p" type="password" autocomplete="current-password">',
        2, True, {'e': 'USER', 'p': 'PASS'}),
    'password only (second step)': (
        '<input id="p" type="password">', 1, True, {'p': 'PASS'}),
    'search box above the login fields': (
        '<input name="q" type="text" aria-label="Search"><input id="u" type="text" aria-label="Email address"><input id="p" type="password">',
        2, True, {'q': '', 'u': 'USER', 'p': 'PASS'}),
    'hidden form is skipped': (
        '<div style="display:none"><input id="u" type="text" name="user"><input id="p" type="password"></div>',
        0, False, {'u': '', 'p': ''}),
    'disabled password field fills nothing': (
        '<input id="u" type="text" name="user"><input id="p" type="password" disabled>',
        0, False, {'u': '', 'p': ''}),
    'no login form at all': (
        '<input id="t" type="text" name="comment">', 0, False, {'t': ''}),
    'login form below a newsletter box': (
        '<input id="n" type="text" name="newsletter_email"><hr><input id="l" type="text" name="login"><input id="p" type="password">',
        2, True, {'n': '', 'l': 'USER', 'p': 'PASS'}),
}

(work / 'expected.json').write_text(json.dumps(
    {k: {'filled': v[1], 'foundPassword': v[2], 'values': v[3]} for k, v in CASES.items()}))

page = """<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<div id="case"></div><pre id="out"></pre>
<script>
%s
const CASES = %s;
const out = [];
for (const [name, html] of Object.entries(CASES)) {
  const host = document.getElementById('case');
  host.innerHTML = html;
  let r;
  try { r = fillForm('USER', 'PASS'); } catch (e) { r = { error: String(e) }; }
  const values = {};
  for (const i of host.querySelectorAll('input')) values[i.id || i.name] = i.value;
  out.push(JSON.stringify({ name, filled: r.filled, foundPassword: r.foundPassword, values }));
}
document.getElementById('out').textContent = out.join('\\n');
</script></body></html>
""" % (fill, json.dumps({k: v[0] for k, v in CASES.items()}))
(work / 'cases.html').write_text(page)
PY
[ $? -eq 0 ] || { echo "could not build the test page"; exit 1; }

"$CHROME" --headless --disable-gpu --no-sandbox --virtual-time-budget=3000 \
  --dump-dom "file://$work/cases.html" 2>/dev/null \
  | sed -n '/<pre id="out">/,/<\/pre>/p' | sed 's/<[^>]*>//g' > "$work/actual.txt"

python3 - "$work" <<'PY'
import json, pathlib, sys
work = pathlib.Path(sys.argv[1])
expected = json.loads((work / 'expected.json').read_text())
lines = [l for l in (work / 'actual.txt').read_text().splitlines() if l.strip()]
print('autofill form matching')
if not lines:
    print('  FAIL no output from the browser')
    sys.exit(1)
bad = 0
seen = set()
for line in lines:
    got = json.loads(line)
    name = got['name']
    seen.add(name)
    want = expected[name]
    problems = []
    if got.get('filled') != want['filled']:
        problems.append(f"filled {got.get('filled')}, wanted {want['filled']}")
    if got.get('foundPassword') != want['foundPassword']:
        problems.append(f"foundPassword {got.get('foundPassword')}, wanted {want['foundPassword']}")
    for field, value in want['values'].items():
        if got['values'].get(field) != value:
            problems.append(f"{field}={got['values'].get(field)!r}, wanted {value!r}")
    if problems:
        bad += 1
        print(f'  FAIL {name}')
        for p in problems:
            print(f'       {p}')
    else:
        print(f'  ok  {name}')
missing = set(expected) - seen
for name in missing:
    bad += 1
    print(f'  FAIL {name}: no result')
print(f"\n{len(expected) - bad} passed")
sys.exit(1 if bad else 0)
PY
