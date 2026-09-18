#!/usr/bin/env python3
"""Generate the toolbar/menu icons as flat PNGs with no external dependencies.

Design: a blue rounded square with a white "upload" glyph (arrow up out of a
tray). Rendered at 8x and box-filtered down so edges stay smooth at 16px.

    python3 scripts/make-icons.py
"""
import struct
import zlib
from pathlib import Path

SIZES = (16, 32, 48, 128)
SS = 8  # supersampling factor
BG = (26, 115, 232)      # Google blue #1a73e8
FG = (255, 255, 255)


def rounded_rect(x, y, s, r):
    """1.0 inside a rounded square of side s with corner radius r, else 0.0."""
    if x < 0 or y < 0 or x >= s or y >= s:
        return 0.0
    cx = min(max(x, r), s - r)
    cy = min(max(y, r), s - r)
    return 1.0 if (x - cx) ** 2 + (y - cy) ** 2 <= r * r else 0.0


def glyph(x, y):
    """White upload glyph in unit coordinates (0..1). Returns 1.0 if painted."""
    # Arrow head: triangle with apex at (0.5, 0.20), base y=0.50, half-width 0.24
    ax, ay, base_y, hw = 0.5, 0.20, 0.50, 0.24
    if ay <= y <= base_y:
        t = (y - ay) / (base_y - ay)
        if abs(x - ax) <= hw * t:
            return 1.0
    # Arrow stem: from y=0.45 to y=0.66, half-width 0.085
    if 0.45 <= y <= 0.66 and abs(x - ax) <= 0.085:
        return 1.0
    # Tray: bottom bar with two short uprights
    if 0.72 <= y <= 0.80 and 0.20 <= x <= 0.80:
        return 1.0
    if 0.62 <= y <= 0.80 and (0.20 <= x <= 0.28 or 0.72 <= x <= 0.80):
        return 1.0
    return 0.0


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
                    a = rounded_rect(x, y, big, radius)
                    if a:
                        g = glyph(x / big, y / big)
                        c = FG if g else BG
                        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; acc[3] += 255
            n = SS * SS
            alpha = acc[3] / n
            if alpha > 0:
                # un-premultiply: colour average over covered samples only
                covered = acc[3] / 255
                r, g, b = (acc[0] / covered, acc[1] / covered, acc[2] / covered)
            else:
                r = g = b = 0
            row += bytes((int(round(r)), int(round(g)), int(round(b)), int(round(alpha))))
        rows.append(bytes(row))
    return rows


def png_chunk(tag, data):
    body = tag + data
    return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)


def write_png(path, size, rows):
    raw = b''.join(b'\x00' + r for r in rows)  # filter type 0 per scanline
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
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
