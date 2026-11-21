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
    tools/brand/mark.json   the icon mark's outline, which tools/make_icons.py draws

The icon mark is the arrow c with a crescent ")" round its right side, so the
pair reads as a D. The wordmark and docs/brand/mark.svg keep the plain c.
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

# The icon: the mark in ink on a white tile, lifted off the toolbar by a soft
# shadow (tools/make_icons.py draws the PNGs the same way).
TILE_R = 0.23                # corner radius, as a fraction of the side
MARK_SIZE = 0.62             # the icon mark's larger side, as a fraction of the tile

# The crescent, as multiples of the c's half-width, round the centre of its bowl.
ARC_IN, ARC_OUT = 1.23, 1.62  # inner and outer radius at its thickest
ARC_FROM, ARC_TO = -46, 62    # degrees, y down, clockwise from 3 o'clock; the top end clears the arrow
ARC_TAPER = 0.55              # how much it thins towards its ends (0 = even band)
SOFTEN = 0.045                # corner rounding over the whole mark, in the same units


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


def icon_mark(font, c):
    """The arrow c plus a crescent on its right, every corner softened."""
    x0, y0, x1, y1 = font.polygon('c').bounds
    cx, cy, rx = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2
    outer, inner, steps = [], [], 120
    for i in range(steps + 1):
        a = math.radians(ARC_FROM + (ARC_TO - ARC_FROM) * i / steps)
        f = 1 - ARC_TAPER * abs(2 * i / steps - 1) ** 2
        mid, half = (ARC_IN + ARC_OUT) / 2 * rx, (ARC_OUT - ARC_IN) / 2 * rx * f
        outer.append((cx + (mid + half) * math.cos(a), cy + (mid + half) * math.sin(a)))
        inner.append((cx + (mid - half) * math.cos(a), cy + (mid - half) * math.sin(a)))
    shape = unary_union([c, Polygon(outer + inner[::-1])])
    r = SOFTEN * rx      # open then close: rounds the outside corners, then the inside ones
    return shape.buffer(-r).buffer(2 * r).buffer(-r).simplify(0.4)


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
    mark = icon_mark(font, c)
    k, dx, dy = mark_fit(mark, S)
    # Same look as tools/make_icons.py: a white-to-grey tile on a soft drop
    # shadow, inset 6% a side to leave the shadow room, and the c shaded from a
    # softer black to ink.
    pad = S * 0.06
    t = S - 2 * pad
    files[ROOT / 'extension' / 'icons' / 'logo.svg'] = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" role="img" aria-label="DeskSync">\n'
        '  <defs>\n'
        '    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#f0f0ee"/></linearGradient>\n'
        '    <linearGradient id="ink" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3a3a"/><stop offset="1" stop-color="#141414"/></linearGradient>\n'
        f'    <filter id="lift" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="{t * 0.025:.2f}" stdDeviation="{t * 0.035:.2f}" flood-opacity=".28"/>'
        f'<feDropShadow dx="0" dy="0" stdDeviation="{t * 0.006:.2f}" flood-opacity=".18"/></filter>\n'
        '  </defs>\n'
        f'  <rect x="{pad:g}" y="{pad:g}" width="{t:g}" height="{t:g}" rx="{TILE_R * t:.2f}" fill="url(#tile)" filter="url(#lift)"/>\n'
        f'  <path fill="url(#ink)" transform="translate({pad:g} {pad:g}) scale({t / S:g})" d="{poly_path(mark, dx, dy, k)}"/>\n'
        '</svg>\n')

    # Outline for tools/make_icons.py, centred and scaled to a unit square.
    x0, y0, x1, y1 = mark.bounds
    side = max(x1 - x0, y1 - y0)
    rings = [[[round((x - (x0 + x1) / 2) / side, 5), round((y - (y0 + y1) / 2) / side, 5)]
              for x, y in list(r.coords)[:-1]]
             for g in getattr(mark, 'geoms', [mark]) for r in [g.exterior, *g.interiors]]
    files[ROOT / 'tools' / 'brand' / 'mark.json'] = json.dumps(
        {'about': 'The icon mark (arrow c and crescent), centred on 0,0, its larger side 1. Built by tools/brand/build_logo.py.',
         'rings': rings}, separators=(',', ':')) + '\n'

    for p, text in files.items():
        p.write_text(text)
        print(f'wrote {p.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
