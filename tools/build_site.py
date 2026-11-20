#!/usr/bin/env python3
"""Builds DeskSync's website into dist/site, ready to host as plain files
(GitHub Pages, Netlify, any static host).

    python3 tools/build_site.py            (or: make site)

- site/*.html, *.css, *.js are copied with {{SUPABASE_URL}}, {{SUPABASE_ANON_KEY}},
  {{SUPPORT_EMAIL}} and {{STORE_URL}} filled in from the environment (make passes .env).
- PRIVACY.md becomes privacy.html, so the policy has one source.
- The store screenshots and the icon are copied in.

A value left empty stays as its {{placeholder}}; the page copes (the install
button says "coming soon", the waitlist says it is not open yet).
"""
import html
import os
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'dist' / 'site'
KEYS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPPORT_EMAIL', 'STORE_URL']


def fill(text):
    for k in KEYS:
        v = os.environ.get(k, '').strip()
        if v and 'YOUR-' not in v:
            text = text.replace('{{%s}}' % k, v)
    return text


def inline(s):
    """Escaped text with **bold**, `code` and [links](url)."""
    s = html.escape(s, quote=False)
    s = re.sub(r'`([^`]+)`', r'<code>\1</code>', s)
    s = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', s)
    s = re.sub(r'\[([^\]]+)\]\(([^)\s]+)\)', r'<a href="\2">\1</a>', s)
    return s


def slug(text):
    return re.sub(r'[^a-z0-9]+', '-', text.lower().replace("'", '')).strip('-')


def markdown(md):
    """The small subset PRIVACY.md uses: headings, paragraphs, bullet lists."""
    out, para, items = [], [], []

    def flush():
        if para:
            out.append('<p>%s</p>' % inline(' '.join(para)))
            para.clear()
        if items:
            out.append('<ul>%s</ul>' % ''.join('<li>%s</li>' % inline(i) for i in items))
            items.clear()

    for line in md.splitlines():
        if not line.strip():
            flush()
        elif line.startswith('#'):
            flush()
            level = len(line) - len(line.lstrip('#'))
            text = line.lstrip('#').strip()
            out.append('<h%d id="%s">%s</h%d>' % (level, slug(text), inline(text), level))
        elif line.startswith('- '):
            if para:
                flush()
            items.append(line[2:].strip())
        elif items and line.startswith('  '):
            items[-1] += ' ' + line.strip()
        else:
            para.append(line.strip())
    flush()
    return '\n'.join(out)


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    for f in (ROOT / 'site').iterdir():
        if f.suffix in ('.html', '.css', '.js'):
            (OUT / f.name).write_text(fill(f.read_text()))
    body = markdown(fill((ROOT / 'PRIVACY.md').read_text()))
    page = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>DeskSync privacy policy</title><link rel="icon" href="logo.svg" type="image/svg+xml"><link rel="icon" href="icon128.png" sizes="128x128"><link rel="stylesheet" href="style.css"></head>
<body><header class="top"><a class="brand" href="./"><img class="logo" src="wordmark.svg" width="113" height="26" alt="DeskSync"></a></header>
<main class="doc">{body}</main>
<footer class="foot"><span>DeskSync</span><a href="./">Home</a></footer></body></html>
'''
    (OUT / 'privacy.html').write_text(page)
    for n in range(1, 6):
        shutil.copy(ROOT / 'docs' / 'store' / f'app-{n}.png', OUT)
    shutil.copy(ROOT / 'extension' / 'icons' / 'icon128.png', OUT)
    shutil.copy(ROOT / 'extension' / 'icons' / 'logo.svg', OUT)
    shutil.copy(ROOT / 'docs' / 'brand' / 'wordmark.svg', OUT)
    # GitHub Pages serves the site on a custom domain named in a CNAME file.
    domain = os.environ.get('SITE_DOMAIN', '').strip()
    if domain:
        (OUT / 'CNAME').write_text(domain + '\n')
    left = sorted({m for f in OUT.glob('*.html') for m in re.findall(r'\{\{(\w+)\}\}', f.read_text())})
    print(f'Built {OUT}')
    if left:
        print('  Not filled in yet (set in .env): ' + ', '.join(left))


if __name__ == '__main__':
    sys.exit(main())
