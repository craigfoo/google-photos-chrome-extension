#!/usr/bin/env python3
"""Generate the toolbar/menu/store icons as flat PNGs with no dependencies.

Design: a rounded square split into the four Google brand colours (blue, red,
yellow, green — the same palette Google Photos uses) with a white upload
arrow over the top. Bold enough to read at 16px, colourful enough to stand
out as a store thumbnail. It deliberately does not reuse the Google Photos
pinwheel itself; the Web Store rejects listings that use Google's logos.

Rendered at 8x and box-filtered down so edges stay smooth.

    python3 scripts/make-icons.py
"""
import struct
import zlib
from pathlib import Path

SIZES = (16, 32, 48, 128)
SS = 8  # supersampling factor
BLUE, RED, YELLOW, GREEN = (66, 133, 244), (234, 67, 53), (251, 188, 4), (52, 168, 83)
WHITE = (255, 255, 255)


def rounded_rect(x, y, s, r):
    """1.0 inside a rounded square of side s with corner radius r, else 0.0."""
    if x < 0 or y < 0 or x >= s or y >= s:
        return 0.0
    cx = min(max(x, r), s - r)
    cy = min(max(y, r), s - r)
    return 1.0 if (x - cx) ** 2 + (y - cy) ** 2 <= r * r else 0.0


def quadrant_colour(x, y):
    """Background colour in unit coordinates: four quadrants, Google order."""
    if y < 0.5:
        return BLUE if x < 0.5 else RED
    return YELLOW if x < 0.5 else GREEN


def arrow(x, y):
    """White upload arrow in unit coordinates. Returns True if painted."""
    ax, apex_y, base_y, half_w = 0.5, 0.17, 0.53, 0.29
    if apex_y <= y <= base_y:
        t = (y - apex_y) / (base_y - apex_y)
        if abs(x - ax) <= half_w * t:
            return True
    if 0.50 <= y <= 0.70 and abs(x - ax) <= 0.105:   # stem
        return True
    if 0.76 <= y <= 0.84 and 0.24 <= x <= 0.76:       # baseline
        return True
    return False


def render(size):
    big = size * SS
    radius = big * 0.22
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(SS):
                for sx in range(SS):
                    x = px * SS + sx + 0.5
                    y = py * SS + sy + 0.5
                    if rounded_rect(x, y, big, radius):
                        u, v = x / big, y / big
                        c = WHITE if arrow(u, v) else quadrant_colour(u, v)
                        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; acc[3] += 255
            n = SS * SS
            alpha = acc[3] / n
            if alpha > 0:
                covered = acc[3] / 255
                r, g, b = acc[0] / covered, acc[1] / covered, acc[2] / covered
            else:
                r = g = b = 0
            row += bytes((int(round(r)), int(round(g)), int(round(b)), int(round(alpha))))
        rows.append(bytes(row))
    return rows


def png_chunk(tag, data):
    body = tag + data
    return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)


def write_png(path, size, rows):
    raw = b''.join(b'\x00' + r for r in rows)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    data = b'\x89PNG\r\n\x1a\n' + png_chunk(b'IHDR', ihdr) + png_chunk(b'IDAT', zlib.compress(raw, 9)) + png_chunk(b'IEND', b'')
    path.write_bytes(data)


def main():
    out = Path(__file__).resolve().parent.parent / 'icons'
    out.mkdir(exist_ok=True)
    for s in SIZES:
        p = out / f'icon{s}.png'
        write_png(p, s, render(s))
        print(f'wrote {p} ({p.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
