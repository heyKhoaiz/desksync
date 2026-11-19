#!/usr/bin/env python3
"""Generate the extension's toolbar/store icons.

Draws a dark rounded tile with the pink "sync" glyph from the popup's icon
sprite, so the extension icon matches the UI. Run `make icons` after changing
the palette here.

    python3 tools/make_icons.py extension/icons
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

SIZES = (16, 48, 128)
SS = 8                      # supersampling factor; downsampled with LANCZOS
TILE = (24, 24, 27)         # --ink
GLYPH = (251, 208, 236)     # --pink-strong


def arc_with_head(d, box, start, end, width, colour, head):
    """An arc, with a small triangular arrowhead carrying on past its `end`."""
    d.arc(box, start, end, fill=colour, width=width)
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    r = (box[2] - box[0]) / 2
    a = math.radians(end)
    base = (cx + r * math.cos(a), cy + r * math.sin(a))
    tan = (-math.sin(a), math.cos(a))     # direction of travel along the arc
    rad = (math.cos(a), math.sin(a))      # outward from the centre
    d.polygon([
        (base[0] + tan[0] * head * 1.3, base[1] + tan[1] * head * 1.3),
        (base[0] - rad[0] * head, base[1] - rad[1] * head),
        (base[0] + rad[0] * head, base[1] + rad[1] * head),
    ], fill=colour)


def icon(size):
    n = size * SS
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, n - 1, n - 1], radius=n * 0.23, fill=TILE)

    # At 16px the glyph needs to be thicker, wider and blunter to survive downsampling.
    small = size <= 16
    stroke = n * (0.13 if small else 0.105)
    inset = n * (0.22 if small else 0.24)
    box = [inset, inset, n - inset, n - inset]
    head = stroke * (1.0 if small else 1.05)
    sweep = 165 if small else 170
    arc_with_head(d, box, 120, 120 + sweep, round(stroke), GLYPH, head)
    arc_with_head(d, box, -60, -60 + sweep, round(stroke), GLYPH, head)
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
