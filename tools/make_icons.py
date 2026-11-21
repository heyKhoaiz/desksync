#!/usr/bin/env python3
"""Generate the extension's toolbar/store icons.

The icon is the logo's arrow c (the c of "desksync", its top arm ending in a
refresh arrow) with a crescent ")" round its right side, so the pair reads as
a D, in ink on a white tile. The tile is lifted off the toolbar by a soft drop
shadow and runs from white to a faint grey; the mark runs from a softer black
to ink. At 16px there is no room for a shadow, so the tile gets a grey edge
instead. The mark's outline comes from tools/brand/mark.json, which tools/brand/build_logo.py writes from the Inter
typeface; this script only needs Pillow. extension/icons/logo.svg is the same
icon as a vector.

    python3 tools/make_icons.py extension/icons [mobile/android/app/src/main/res]
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

SIZES = (16, 48, 128)
SS = 8                      # supersampling factor; downsampled with LANCZOS
TILE_R = 0.23               # corner radius, as a fraction of the side
MARK = json.loads((Path(__file__).parent / 'brand' / 'mark.json').read_text())


def mark_size(size):
    # At 16px the mark is drawn bigger, so the arrow and the gap to the crescent survive.
    return 0.73 if size <= 16 else 0.62


# Tile and mark gradients, top to bottom.
TILE_TOP, TILE_BOTTOM = (255, 255, 255), (240, 240, 238)
MARK_TOP, MARK_BOTTOM = (58, 58, 58), (20, 20, 20)
EDGE_16 = (205, 205, 205)   # the 16px tile's edge, in place of the shadow


def inset(size):
    """Room left round the tile for its shadow, in px."""
    return {16: 0, 48: 2}.get(size, round(size * 0.06))


# The Chrome Web Store wants the 128px icon drawn at 96x96, with 16px of
# transparent padding a side (developer.chrome.com/docs/webstore/images).
# Ours is a 112px canvas (a 98px tile plus its shadow) in 8px of padding:
# the artwork stays near 96px and the shadow falls in the padding.
STORE_PAD = {128: 8}


def vgrad(n, top, bottom):
    g = Image.new('RGBA', (1, n))
    for y in range(n):
        t = y / (n - 1)
        g.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)) + (255,))
    return g.resize((n, n))


def mark_mask(n, size):
    # Even-odd fill: XOR each ring into the mask.
    k = mark_size(size) * n
    mask = Image.new('1', (n, n), 0)
    for ring in MARK['rings']:
        layer = Image.new('1', (n, n), 0)
        ImageDraw.Draw(layer).polygon([(n / 2 + x * k, n / 2 + y * k) for x, y in ring], fill=1)
        mask = ImageChops.logical_xor(mask, layer)
    return mask.convert('L')


def icon(size):
    pad = STORE_PAD.get(size, 0)
    if pad:
        out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        inner = icon(size - 2 * pad)
        out.alpha_composite(inner, (pad, pad))
        return out
    N = size * SS
    t = size - 2 * inset(size)
    n, o = t * SS, inset(size) * SS
    img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    shape = Image.new('L', (n, n), 0)
    ImageDraw.Draw(shape).rounded_rectangle([0, 0, n - 1, n - 1], radius=n * TILE_R, fill=255)
    black = Image.new('RGBA', (N, N), (0, 0, 0, 255))
    if o:
        # A soft drop shadow below, and a tight contact shadow all round.
        for dy, blur, alpha in ((round(n * 0.025), n * 0.035, 0.28), (0, n * 0.006, 0.18)):
            sh = Image.new('L', (N, N), 0)
            sh.paste(shape, (o, o + dy))
            img.paste(black, (0, 0), sh.filter(ImageFilter.GaussianBlur(blur)).point(lambda v, a=alpha: v * a))
    else:
        img.paste(Image.new('RGBA', (n, n), EDGE_16 + (255,)), (0, 0), shape)
        e = SS
        shape = Image.new('L', (n, n), 0)
        ImageDraw.Draw(shape).rounded_rectangle([e, e, n - 1 - e, n - 1 - e], radius=n * TILE_R - e, fill=255)
    img.paste(vgrad(n, TILE_TOP, TILE_BOTTOM), (o, o), shape)
    img.paste(vgrad(n, MARK_TOP, MARK_BOTTOM), (o, o), mark_mask(n, size))
    return img.resize((size, size), Image.LANCZOS)


# The Android app's launcher icon, one per screen density.
ANDROID = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else 'extension/icons')
    out.mkdir(parents=True, exist_ok=True)
    for s in SIZES:
        p = out / f'icon{s}.png'
        icon(s).save(p)
        print(f'wrote {p}')
    if len(sys.argv) > 2:       # the Android app's res/ folder
        for density, s in ANDROID.items():
            p = Path(sys.argv[2]) / f'mipmap-{density}' / 'ic_launcher.png'
            icon(s).save(p)
            print(f'wrote {p}')


if __name__ == '__main__':
    main()
