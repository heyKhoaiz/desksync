#!/usr/bin/env python3
"""Generate the extension's toolbar/store icons.

The icon is the logo's arrow c (the c of "desksync", its top arm ending in a
refresh arrow) in ink on a white tile with a thin grey edge. The c's outline comes from
tools/brand/mark.json, which tools/brand/build_logo.py writes from the Inter
typeface; this script only needs Pillow. extension/icons/logo.svg is the same
icon as a vector.

    python3 tools/make_icons.py extension/icons
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

SIZES = (16, 48, 128)
SS = 8                      # supersampling factor; downsampled with LANCZOS
TILE_R = 0.23               # corner radius, as a fraction of the side
MARK = json.loads((Path(__file__).parent / 'brand' / 'mark.json').read_text())


def mark_size(size):
    # At 16px the c is drawn bigger, so its arrow and opening survive.
    return 0.70 if size <= 16 else 0.56


# The Chrome Web Store wants the 128px icon drawn at 96x96, with 16px of
# transparent padding a side (developer.chrome.com/docs/webstore/images).
# The toolbar sizes fill their square.
STORE_PAD = {128: 16}


def icon(size):
    pad = STORE_PAD.get(size, 0)
    if pad:
        out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        out.paste(icon(size - 2 * pad), (pad, pad))
        return out
    n = size * SS
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    edge = max(1, round(size * MARK['border_w'])) * SS     # at least one real pixel
    d.rounded_rectangle([0, 0, n - 1, n - 1], radius=n * TILE_R, fill=MARK['border'])
    d.rounded_rectangle([edge, edge, n - 1 - edge, n - 1 - edge], radius=n * TILE_R - edge, fill=MARK['tile'])

    # Even-odd fill: draw each ring into a mask, flipping what's inside.
    k = mark_size(size) * n
    mask = Image.new('1', (n, n), 0)
    for ring in MARK['rings']:
        layer = Image.new('1', (n, n), 0)
        ImageDraw.Draw(layer).polygon([(n / 2 + x * k, n / 2 + y * k) for x, y in ring], fill=1)
        mask = Image.frombytes('1', (n, n), bytes(a ^ b for a, b in zip(mask.tobytes(), layer.tobytes())))
    img.paste(MARK['mark'], (0, 0), mask.convert('L'))
    return img.resize((size, size), Image.LANCZOS)


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else 'extension/icons')
    out.mkdir(parents=True, exist_ok=True)
    for s in SIZES:
        p = out / f'icon{s}.png'
        icon(s).save(p)
        print(f'wrote {p}')


if __name__ == '__main__':
    main()
