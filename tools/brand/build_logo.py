#!/usr/bin/env python3
"""Build DeskSync's logo files from the Inter typeface.

The wordmark is "desksync" in Inter ExtraBold: "desk" in ink, "sync" in
yellow. The last c is the font's own c with the end of its top arm cut off
along a radius and capped with an arrowhead, so it reads as a refresh arrow.
That c on its own is the app icon.

Everything here is turned into outlines, so nothing that uses the logo needs
the font. The output is committed; run this only to change the logo:

    python3 -m venv /tmp/brand && /tmp/brand/bin/pip install fonttools shapely
    /tmp/brand/bin/python tools/brand/build_logo.py path/to/Inter[opsz,wght].ttf

Writes:
    docs/brand/wordmark.svg, wordmark-dark.svg              one line
    docs/brand/wordmark-stacked.svg, wordmark-stacked-dark.svg
    docs/brand/mark.svg                                      the arrow c alone
    extension/icons/logo.svg                                 the app icon
    tools/brand/mark.json   the arrow c's outline, which tools/make_icons.py draws
"""
import json
import math
import sys
from pathlib import Path

from fontTools.pens.basePen import BasePen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]

INK = '#141414'
WHITE = '#ffffff'
YELLOW = '#ffc400'           # a touch deeper than the UI's --accent, so it holds up on light grounds
TRACK = -0.03                # letter spacing, in em
AXES = {'wght': 800, 'opsz': 32}

# The arrow c. Angles are in degrees, y pointing down, clockwise from 3 o'clock.
CUT = 280                    # the top arm is cut off along this radius
ADVANCE = 26                 # how far round the curve the arrow's tip reaches past the cut
BARB = 0.5                   # how far each barb sticks out past the stroke, in stroke widths

# The icon: the arrow c on an ink tile.
TILE_R = 0.23                # corner radius, as a fraction of the side
MARK_SIZE = 0.56             # the c's larger side, as a fraction of the tile


class FlattenPen(BasePen):
    """Collects a glyph's contours as polygons, curves cut into short lines."""
    STEPS = 24

    def __init__(self, glyphset):
        super().__init__(glyphset)
        self.contours, self.cur = [], []

    def _moveTo(self, p):
        self.cur = [p]

    def _lineTo(self, p):
        self.cur.append(p)

    def _curveToOne(self, p1, p2, p3):
        p0 = self.cur[-1]
        for i in range(1, self.STEPS + 1):
            t = i / self.STEPS
            u = 1 - t
            self.cur.append(tuple(u ** 3 * a + 3 * u * u * t * b + 3 * u * t * t * c + t ** 3 * d
                                  for a, b, c, d in zip(p0, p1, p2, p3)))

    def _qCurveToOne(self, p1, p2):
        p0 = self.cur[-1]
        for i in range(1, self.STEPS + 1):
            t = i / self.STEPS
            u = 1 - t
            self.cur.append(tuple(u * u * a + 2 * u * t * b + t * t * c for a, b, c in zip(p0, p1, p2)))

    def _closePath(self):
        if len(self.cur) > 2:
            self.contours.append(self.cur)
        self.cur = []

    _endPath = _closePath


class Font:
    def __init__(self, path):
        f = TTFont(path)
        if 'fvar' in f:
            f = instantiateVariableFont(f, AXES)
        self.upm = f['head'].unitsPerEm
        self.cmap = f.getBestCmap()
        self.glyphs = f.getGlyphSet()
        self.hmtx = f['hmtx']

    def name(self, ch):
        return self.cmap[ord(ch)]

    def advance(self, ch):
        return self.hmtx[self.name(ch)][0]

    def path(self, ch, x, baseline):
        """SVG path data for a letter, its origin at (x, baseline), y down."""
        pen = SVGPathPen(self.glyphs, ntos=lambda v: f'{v:.1f}'.rstrip('0').rstrip('.'))
        self.glyphs[self.name(ch)].draw(TransformPen(pen, (1, 0, 0, -1, x, baseline)))
        return pen.getCommands()

    def polygon(self, ch):
        """The letter as a shapely shape, origin on the baseline, y down."""
        pen = FlattenPen(self.glyphs)
        self.glyphs[self.name(ch)].draw(pen)
        shape = Polygon()
        for c in pen.contours:
            shape = shape.symmetric_difference(Polygon([(x, -y) for x, y in c]).buffer(0))
        return shape


def arrow_c(font):
    """The font's c with its top arm ending in an arrowhead. Origin on the baseline, y down."""
    c = font.polygon('c')
    x0, y0, x1, y1 = c.bounds
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    rx, ry = (x1 - x0) / 2, (y1 - y0) / 2
    big = max(rx, ry)

    def at(r, deg):
        """A point r out from the centre at angle deg, squashed to the c's ellipse."""
        a = math.radians(deg)
        return cx + math.cos(a) * r * rx / big, cy + math.sin(a) * r * ry / big

    far = big * 3
    sector = Polygon([(cx, cy)] + [(cx + far * math.cos(math.radians(a)), cy + far * math.sin(math.radians(a)))
                                   for a in range(CUT, 361, 2)])
    c = c.difference(sector)

    # Where the stroke sits along the cut: its inner and outer edge.
    ray = LineString([at(0, CUT - 0.5), at(far, CUT - 0.5)])
    hit = c.intersection(ray)
    dists = [math.dist((cx, cy), p) for g in getattr(hit, 'geoms', [hit]) for p in g.coords]
    scale = math.dist((cx, cy), at(1, CUT - 0.5))
    rin, rout = min(dists) / scale, max(dists) / scale
    t = rout - rin
    head = Polygon([at(rin - t * BARB, CUT), at(rout + t * BARB, CUT), at((rin + rout) / 2, CUT + ADVANCE)])
    return unary_union([c, head]).simplify(0.4)


def poly_path(shape, dx=0, dy=0, k=1):
    out = []
    for g in getattr(shape, 'geoms', [shape]):
        for ring in [g.exterior, *g.interiors]:
            pts = list(ring.coords)[:-1]
            out.append('M' + ' '.join(f'{(x + dx) * k:.1f},{(y + dy) * k:.1f}' for x, y in pts) + 'Z')
    return ''.join(out)


def layout(font, text, x=0.0):
    """(char, x) for each letter, with the house tracking."""
    out = []
    for ch in text:
        out.append((ch, x))
        x += font.advance(ch) + TRACK * font.upm
    return out


def ink_bounds(font, placed, baseline, c_shape):
    xs, ys = [], []
    for ch, x in placed:
        shape = c_shape if ch == 'C' else font.polygon(ch)
        b = shape.bounds
        xs += [b[0] + x, b[2] + x]
        ys += [b[1] + baseline, b[3] + baseline]
    return min(xs), min(ys), max(xs), max(ys)


def letters(font, placed, baseline, colour, c_shape):
    d = []
    for ch, x in placed:
        d.append(poly_path(c_shape, x, baseline) if ch == 'C' else font.path(ch, x, baseline))
    return f'<path fill="{colour}" d="{"".join(d)}"/>'


def svg(parts, bounds, pad, title):
    x0, y0, x1, y1 = bounds
    w, h = x1 - x0 + 2 * pad, y1 - y0 + 2 * pad
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0 - pad:.0f} {y0 - pad:.0f} {w:.0f} {h:.0f}" '
            f'role="img" aria-label="{title}">\n  ' + '\n  '.join(parts) + '\n</svg>\n')


def wordmark(font, c_shape, desk_colour, stacked=False):
    # 'C' marks the arrow c in the layout.
    if not stacked:
        placed = layout(font, 'desksynC')
        desk, sync = placed[:4], placed[4:]
        b = ink_bounds(font, placed, 0, c_shape)
        parts = [letters(font, desk, 0, desk_colour, c_shape), letters(font, sync, 0, YELLOW, c_shape)]
        return svg(parts, b, font.upm * 0.04, 'DeskSync')
    desk, sync = layout(font, 'desk'), layout(font, 'synC')
    bd = ink_bounds(font, desk, 0, c_shape)
    top_of_sync = ink_bounds(font, sync, 0, c_shape)[1]          # negative: above the baseline
    baseline2 = bd[3] + font.upm * 0.08 - top_of_sync
    bs = ink_bounds(font, sync, baseline2, c_shape)
    b = (min(bd[0], bs[0]), bd[1], max(bd[2], bs[2]), bs[3])
    parts = [letters(font, desk, 0, desk_colour, c_shape), letters(font, sync, baseline2, YELLOW, c_shape)]
    return svg(parts, b, font.upm * 0.04, 'DeskSync')


def mark_fit(c_shape, size=1.0):
    """Scale and offset that centre the arrow c in a size x size square at MARK_SIZE."""
    x0, y0, x1, y1 = c_shape.bounds
    k = MARK_SIZE * size / max(x1 - x0, y1 - y0)
    return k, size / 2 / k - (x0 + x1) / 2, size / 2 / k - (y0 + y1) / 2


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    font = Font(sys.argv[1])
    c = arrow_c(font)

    brand = ROOT / 'docs' / 'brand'
    brand.mkdir(parents=True, exist_ok=True)
    files = {
        brand / 'wordmark.svg': wordmark(font, c, INK),
        brand / 'wordmark-dark.svg': wordmark(font, c, WHITE),
        brand / 'wordmark-stacked.svg': wordmark(font, c, INK, stacked=True),
        brand / 'wordmark-stacked-dark.svg': wordmark(font, c, WHITE, stacked=True),
        brand / 'mark.svg': svg([f'<path fill="{YELLOW}" d="{poly_path(c)}"/>'], c.bounds, font.upm * 0.02, 'DeskSync'),
    }

    S = 128
    k, dx, dy = mark_fit(c, S)
    files[ROOT / 'extension' / 'icons' / 'logo.svg'] = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" role="img" aria-label="DeskSync">\n'
        f'  <rect width="{S}" height="{S}" rx="{TILE_R * S:.2f}" fill="{INK}"/>\n'
        f'  <path fill="{YELLOW}" d="{poly_path(c, dx, dy, k)}"/>\n'
        '</svg>\n')

    # Outline for tools/make_icons.py, centred and scaled to a unit square.
    x0, y0, x1, y1 = c.bounds
    side = max(x1 - x0, y1 - y0)
    rings = [[[round((x - (x0 + x1) / 2) / side, 5), round((y - (y0 + y1) / 2) / side, 5)]
              for x, y in list(r.coords)[:-1]]
             for g in getattr(c, 'geoms', [c]) for r in [g.exterior, *g.interiors]]
    files[ROOT / 'tools' / 'brand' / 'mark.json'] = json.dumps(
        {'about': 'The arrow c, centred on 0,0, its larger side 1. Built by tools/brand/build_logo.py.',
         'ink': INK, 'mark': YELLOW, 'rings': rings}, separators=(',', ':')) + '\n'

    for p, text in files.items():
        p.write_text(text)
        print(f'wrote {p.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
