"""
Draws Envo Phone's app icons and splash image from the logo's own shapes (the four signal bars of
components/Logo.tsx), so no design tool is needed: shapes are signed distances, edges anti-aliased.

    python3 scripts/make-icons.py      # writes assets/images/*.png
"""
import math
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'images')

# The bars in the logo's 24-unit box: x, top, bottom (stroke 2, round caps).
BARS = [(7, 9.5, 14.5), (10.3, 7, 17), (13.7, 9, 15), (17, 11, 13)]
INK = (0x0B, 0x0D, 0x12)
NAVY = (0x14, 0x30, 0x6F)
BAR_TOP = (0x7A, 0xA3, 0xFF)
BAR_BOTTOM = (0x3B, 0x6D, 0xF6)


def write_png(name, size, pixel):
    """pixel(x, y) -> (r, g, b, a) with 0-255 channels."""
    rows = []
    for y in range(size):
        row = bytearray(b'\x00')
        for x in range(size):
            row.extend(bytes(max(0, min(255, int(round(c)))) for c in pixel(x + 0.5, y + 0.5)))
        rows.append(bytes(row))
    raw = zlib.compress(b''.join(rows), 9)

    def chunk(kind, data):
        body = kind + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)

    with open(os.path.join(OUT, name), 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)))
        f.write(chunk(b'IDAT', raw))
        f.write(chunk(b'IEND', b''))
    print('wrote', name)


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(len(a)))


def over(top, alpha, under):
    """Paints colour `top` at coverage `alpha` over an RGBA pixel."""
    r, g, b, a = under
    out_a = alpha + a / 255 * (1 - alpha)
    if out_a <= 0:
        return (0, 0, 0, 0)
    blend = [(top[i] * alpha + (r, g, b)[i] * a / 255 * (1 - alpha)) / out_a for i in range(3)]
    return (*blend, out_a * 255)


def bars(size, span, colour=None):
    """
    The bars drawn `span` pixels wide (the logo's 24-unit box), centred. Returns a function giving
    (colour, coverage) at a point; the colour runs light to brand blue down each bar.
    """
    unit = span / 24
    left = (size - span) / 2
    radius = unit * 1.0

    def at(x, y):
        best = 0.0
        for bx, top, bottom in BARS:
            cx = left + bx * unit
            y1, y2 = left + top * unit, left + bottom * unit
            dy = max(y1 - y, 0, y - y2)
            d = math.hypot(x - cx, dy) - radius
            best = max(best, min(1.0, max(0.0, 0.5 - d)))
        if best == 0:
            return None, 0.0
        if colour:
            return colour, best
        t = (y - (left + 7 * unit)) / (10 * unit)
        return mix(BAR_TOP, BAR_BOTTOM, min(1, max(0, t))), best

    return at


def backdrop(size):
    """Ink with the welcome screen's navy glow at the top."""

    def at(y):
        t = y / size
        return mix(NAVY, INK, min(1, t / 0.8)) if t < 0.8 else INK

    return at


def full_icon(size):
    """iOS and store icon: square, opaque, bars at the logo's proportions."""
    bg, mark = backdrop(size), bars(size, size * 0.78)

    def px(x, y):
        under = (*bg(y), 255)
        colour, cover = mark(x, y)
        return over(colour, cover, under) if cover else under

    return px


def layer(size, span, colour=None):
    """Transparent with only the bars: Android's adaptive foreground, monochrome and the splash."""
    mark = bars(size, span, colour)

    def px(x, y):
        colour_, cover = mark(x, y)
        return (*colour_, cover * 255) if cover else (0, 0, 0, 0)

    return px


def favicon(size):
    """The logo tile itself: rounded ink square with the bars."""
    mark, r = bars(size, size * 0.66), size * 0.28

    def px(x, y):
        qx, qy = abs(x - size / 2) - (size / 2 - r), abs(y - size / 2) - (size / 2 - r)
        d = math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - r
        tile = min(1.0, max(0.0, 0.5 - d))
        if not tile:
            return (0, 0, 0, 0)
        under = (*INK, tile * 255)
        colour, cover = mark(x, y)
        return over(colour, cover * tile, under) if cover else under

    return px


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    write_png('icon.png', 1024, full_icon(1024))
    # Adaptive icons show the middle 72 of 108 units, so the bars are drawn 2/3 as big on the layer.
    write_png('android-icon-foreground.png', 1024, layer(1024, 1024 * 0.78 * 72 / 108))
    write_png('android-icon-background.png', 1024, lambda x, y: (*backdrop(1024)(y), 255))
    write_png('android-icon-monochrome.png', 1024, layer(1024, 1024 * 0.78 * 72 / 108, (255, 255, 255)))
    write_png('splash-icon.png', 512, layer(512, 512 * 0.9))
    write_png('favicon.png', 48, favicon(48))
