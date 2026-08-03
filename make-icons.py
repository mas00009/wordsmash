#!/usr/bin/env python3
"""Rebuild the Word Smash app icons from wordsmash-logo.png.  python3 make-icons.py

The logo is WIDE (a hexagon badge, ~1.19:1), so it is fitted into the square —
never centre-cropped, which used to slice the ends off the hexagon. The empty
bands that leaves are filled with a brand plate rather than flat black.

Corner/alpha rules differ per icon and are not cosmetic:
  * maskable       — must be full-bleed and opaque; the platform crops it to its
                     own shape (circle, squircle, teardrop...). Content is kept
                     inside the central 80% "safe zone" circle.
  * apple-touch    — must be opaque with square corners; iOS composites any
                     transparency onto black and then applies its own mask, so a
                     pre-rounded icon gets rounded twice and shows dark wedges.
  * any (192/512)  — free to keep rounded corners with transparency.
"""
import os, sys, math
from PIL import Image, ImageDraw

SRC = "wordsmash-logo.png"
if not os.path.exists(SRC):
    sys.exit("%s not found — run this from the project root." % SRC)

logo = Image.open(SRC).convert("RGBA")
LW, LH = logo.size


def plate(size):
    """Near-black tile with the brand's cyan→violet glow, so the bands the wide
    logo leaves read as deliberate rather than empty."""
    img = Image.new("RGB", (size, size), (11, 15, 23))
    px = img.load()
    for y in range(size):
        for x in range(size):
            r, g, b = px[x, y]
            # cyan bloom from upper-left, violet from lower-right
            dc = math.hypot((x - size * 0.30) / (size * 0.85), (y - size * 0.24) / (size * 0.85))
            dv = math.hypot((x - size * 0.74) / (size * 0.90), (y - size * 0.84) / (size * 0.90))
            c = max(0.0, 1.0 - dc) ** 2 * 0.42
            v = max(0.0, 1.0 - dv) ** 2 * 0.50
            px[x, y] = (min(255, int(r + 138 * v)),
                        min(255, int(g + 229 * c + 43 * v)),
                        min(255, int(b + 255 * c + 226 * v)))
    return img.convert("RGBA")


def place(size, target_w):
    """Brand plate with the logo centred at target_w pixels wide."""
    canvas = plate(size)
    w = int(target_w)
    h = max(1, round(w * LH / LW))
    canvas.alpha_composite(logo.resize((w, h), Image.LANCZOS), ((size - w) // 2, (size - h) // 2))
    return canvas


def rounded(img, radius_ratio=0.22):
    size = img.size[0]
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1],
                                           radius=int(size * radius_ratio), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


# "any" icons: rounded, transparency outside the corners is fine here
for size, name in ((512, "icon-512.png"), (192, "icon-192.png")):
    rounded(place(size, size * 0.90)).save(name)
    print("wrote", name)

# iOS masks this itself — hand it a plain opaque square
place(180, 180 * 0.90).convert("RGB").save("apple-touch-icon.png")
print("wrote apple-touch-icon.png")

# Maskable: content must sit inside the 80% safe-zone circle. For a w:h logo the
# half-diagonal is (w/2)*sqrt(1+(h/w)^2), and that has to fit the circle radius.
S = 512
radius = S * 0.40
safe_w = 2 * radius / math.sqrt(1 + (LH / LW) ** 2)
place(S, safe_w).convert("RGB").save("icon-maskable-512.png")
print("wrote icon-maskable-512.png (logo %.0fpx wide, safe-zone limit %.0f)" % (safe_w, safe_w))
