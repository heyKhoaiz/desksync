#!/usr/bin/env python3
"""Readies the WordPress theme for desksync.org (wordpress/theme/desksync) and zips it.

    python3 tools/build_wp_theme.py        (or: make wp-theme)

- PRIVACY.md becomes patterns/privacy.php, so the policy keeps one source. The
  contact address comes from Settings -> DeskSync on the site, not from here.
- The store screenshots and the icon are copied into assets/img.
- dist/desksync-theme.zip is what gets uploaded (Appearance -> Themes -> Upload).
"""
import json
import re
import shutil
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_site import inline, slug  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
THEME = ROOT / 'wordpress' / 'theme' / 'desksync'
ZIP = ROOT / 'dist' / 'desksync-theme.zip'
EMAIL = '{{SUPPORT_EMAIL}}'
EMAIL_PHP = ("<?php $e = desksync_opt( 'support_email' ); if ( $e ) { printf( '<a href=\"mailto:%1$s\">%1$s</a>', "
             "esc_html( $e ) ); } else { echo 'the contact address on this site'; } ?>")


def text(s):
    """Inline markdown as the block editor saves it (<strong>, not <b>)."""
    s = inline(s).replace('<b>', '<strong>').replace('</b>', '</strong>')
    return s.replace(EMAIL, EMAIL_PHP)


def blocks(md):
    out, para, items = [], [], []

    def flush():
        if para:
            out.append('<!-- wp:paragraph -->\n<p>%s</p>\n<!-- /wp:paragraph -->' % text(' '.join(para)))
            para.clear()
        if items:
            lis = '\n\n'.join('<!-- wp:list-item -->\n<li>%s</li>\n<!-- /wp:list-item -->' % text(i) for i in items)
            out.append('<!-- wp:list -->\n<ul class="wp-block-list">%s</ul>\n<!-- /wp:list -->' % lis)
            items.clear()

    for line in md.splitlines():
        if not line.strip():
            flush()
        elif line.startswith('#'):
            flush()
            level = len(line) - len(line.lstrip('#'))
            title = line.lstrip('#').strip()
            attrs = {'anchor': slug(title)}
            if level != 2:
                attrs = {'level': level, **attrs}
            out.append('<!-- wp:heading %s -->\n<h%d class="wp-block-heading" id="%s">%s</h%d>\n<!-- /wp:heading -->'
                       % (json.dumps(attrs), level, slug(title), text(title), level))
        elif line.startswith('- '):
            if para:
                flush()
            items.append(line[2:].strip())
        elif items and line.startswith('  '):
            items[-1] += ' ' + line.strip()
        else:
            para.append(line.strip())
    flush()
    return '\n\n'.join(out)


def main():
    pattern = ('<?php\n/**\n * Title: Privacy policy\n * Slug: desksync/privacy\n * Categories: desksync\n'
               ' * Inserter: no\n *\n * Made from PRIVACY.md by tools/build_wp_theme.py. Edit PRIVACY.md, not this file.\n */\n?>\n')
    (THEME / 'patterns' / 'privacy.php').write_text(pattern + blocks((ROOT / 'PRIVACY.md').read_text()) + '\n')

    img = THEME / 'assets' / 'img'
    img.mkdir(parents=True, exist_ok=True)
    for n in range(1, 6):
        shutil.copy(ROOT / 'docs' / 'store' / f'app-{n}.png', img)
    shutil.copy(ROOT / 'extension' / 'icons' / 'icon128.png', img)
    shutil.copy(ROOT / 'extension' / 'icons' / 'logo.svg', img)
    shutil.copy(ROOT / 'docs' / 'brand' / 'wordmark.svg', img)

    ZIP.parent.mkdir(exist_ok=True)
    ZIP.unlink(missing_ok=True)
    with zipfile.ZipFile(ZIP, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in sorted(THEME.rglob('*')):
            if f.is_file():
                z.write(f, Path('desksync') / f.relative_to(THEME))
    print(f'Theme ready: {THEME}\nZip: {ZIP}')


if __name__ == '__main__':
    sys.exit(main())
