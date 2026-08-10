#!/usr/bin/env python3
"""Generate the extension icons.

Draws the icon once at high resolution, then area-averages it down to each
required size (which is where the anti-aliasing comes from). Pure stdlib, so
there is no image library to install before you can regenerate the icons.

    python3 tools/make-icons.py
"""

import os
import struct
import zlib

SUPERSAMPLE = 512
SIZES = (16, 32, 48, 128)
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "extension", "icons")

NAVY = (17, 45, 78)
WHITE = (255, 255, 255)
INK = (17, 45, 78)
ACCENT = (37, 129, 199)


def rounded_rect(x, y, x0, y0, x1, y1, radius):
    """Is (x, y) inside the rounded rectangle?"""
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    for cx, cy in ((x0 + radius, y0 + radius), (x1 - radius, y0 + radius),
                   (x0 + radius, y1 - radius), (x1 - radius, y1 - radius)):
        inside_corner_box = (x < x0 + radius or x > x1 - radius) and (y < y0 + radius or y > y1 - radius)
        if inside_corner_box:
            near = (abs(x - cx) <= radius and abs(y - cy) <= radius)
            if near:
                return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
    return True


# Vertical barcode bars: (start_x, width) in supersample units.
BARS = []
_cursor = 150
for _width in (16, 8, 24, 8, 12, 20, 8, 28, 12, 8, 20, 16, 8, 24):
    BARS.append((_cursor, _width))
    _cursor += _width + 12


def draw_supersampled():
    n = SUPERSAMPLE
    pixels = bytearray(n * n * 3)

    label_box = (96, 118, 416, 300)
    stripe_top, stripe_bottom = 150, 250

    for y in range(n):
        row = y * n * 3
        for x in range(n):
            if rounded_rect(x, y, 20, 20, n - 20, n - 20, 96):
                color = NAVY
            else:
                color = None

            if color is not None and rounded_rect(x, y, label_box[0], label_box[1], label_box[2], label_box[3], 20):
                color = WHITE
                if stripe_top <= y <= stripe_bottom:
                    for start, width in BARS:
                        if start <= x < start + width:
                            color = INK
                            break

            # The "sheet coming out" accent bar below the label.
            if color is not None and rounded_rect(x, y, 150, 330, 362, 372, 20):
                color = ACCENT

            if color is None:
                pixels[row + x * 3:row + x * 3 + 3] = bytes((0, 0, 0))
            else:
                pixels[row + x * 3:row + x * 3 + 3] = bytes(color)

    # Alpha: opaque wherever the rounded square covers.
    alpha = bytearray(n * n)
    for y in range(n):
        for x in range(n):
            alpha[y * n + x] = 255 if rounded_rect(x, y, 20, 20, n - 20, n - 20, 96) else 0

    return pixels, alpha


def resample(pixels, alpha, source_size, target_size):
    """Area-average down to target_size, producing RGBA rows."""
    scale = source_size / target_size
    rows = []

    for ty in range(target_size):
        row = bytearray()
        y0, y1 = int(ty * scale), max(int(ty * scale) + 1, int((ty + 1) * scale))
        for tx in range(target_size):
            x0, x1 = int(tx * scale), max(int(tx * scale) + 1, int((tx + 1) * scale))
            r = g = b = a = count = 0
            for sy in range(y0, y1):
                base = sy * source_size
                for sx in range(x0, x1):
                    index = (base + sx) * 3
                    pixel_alpha = alpha[base + sx]
                    r += pixels[index] * pixel_alpha
                    g += pixels[index + 1] * pixel_alpha
                    b += pixels[index + 2] * pixel_alpha
                    a += pixel_alpha
                    count += 1
            if a:
                row += bytes((round(r / a), round(g / a), round(b / a), round(a / count)))
            else:
                row += bytes((0, 0, 0, 0))
        rows.append(bytes(row))

    return rows


def write_png(path, rows, size):
    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(tag, payload):
        body = tag + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")

    with open(path, "wb") as handle:
        handle.write(png)


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    pixels, alpha = draw_supersampled()

    for size in SIZES:
        rows = resample(pixels, alpha, SUPERSAMPLE, size)
        path = os.path.join(OUTPUT_DIR, "icon%d.png" % size)
        write_png(path, rows, size)
        print("wrote", path)


if __name__ == "__main__":
    main()
