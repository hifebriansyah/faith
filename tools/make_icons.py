#!/usr/bin/env python3
"""Draws the Faith logo (logo.svg: the crest with the orange to rose gradient) and writes the PNG and the icons.

    python3 tools/make_icons.py

Needs Pillow (pip3 install pillow). Writes:
  logo.png                      1024x1024, transparent: logo.svg as a PNG, the whole 200x200 drawing
  icons/icon-192.png, icons/icon-512.png      the app icon (transparent; the splash screen colour comes from the manifest)
  icons/icon-maskable-512.png   the logo inside the safe zone on the dark page colour: Android crops it to a circle or squircle
  icons/apple-touch-icon.png    180x180 on the dark page colour (iOS paints transparent icons black)
  icons/favicon.png             48x48 transparent, and favicon.ico (16, 32, 48) for browsers that ask for /favicon.ico
The names stay the same: index.html and manifest.webmanifest point at them. The shapes and colours are in logo.svg: change both together.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
CREST = [(40, 30), (160, 30), (130, 65), (85, 65), (85, 90), (140, 90), (115, 120), (85, 120), (85, 175), (40, 145)]  # viewBox 200
SHADE = [(40, 30), (85, 65), (40, 145)]  # the darker wing, 40% of #9a3412 over the crest
FROM, TO = (0xF9, 0x73, 0x16), (0xE1, 0x1D, 0x48)  # gradient: top left to bottom right of the crest's box
SHADE_RGBA = (0x9A, 0x34, 0x12, round(0.4 * 255))
PAGE = "#111b21"  # the dark page colour behind the maskable and the apple touch icon
BOX = (40, 30, 160, 175)  # the crest's bounding box
SS = 4  # supersampling, for smooth edges


def gradient(w: int, h: int) -> Image.Image:
    """The SVG's gradient (x1,y1 = 0,0 to x2,y2 = 100%,100% of the shape's box): the colour at a point is the average of how far
    right and how far down it is in the box."""
    down = Image.linear_gradient("L")  # 256x256, black at the top, white at the bottom
    across = down.transpose(Image.ROTATE_90)  # black on the left, white on the right
    t = ImageChops.add(across, down, scale=2)  # (across + down) / 2
    t = t.resize((w, h), Image.BILINEAR)
    return Image.composite(Image.new("RGB", (w, h), TO), Image.new("RGB", (w, h), FROM), t)


def draw(size: int, padding: float | None = None, background: str | None = None) -> Image.Image:
    """The logo on a size x size canvas. padding=None draws logo.svg's whole 200x200 as it is; a number centres the crest and leaves
    that share of the size empty on each side."""
    px = size * SS
    if padding is None:
        unit, ox, oy = px / 200, 0.0, 0.0
    else:
        side = (BOX[3] - BOX[1]) / (1 - 2 * padding)  # the crest is taller than wide: its height sets the scale
        unit = px / side
        ox, oy = px / 2 - 100 * unit, px / 2 - 102.5 * unit  # the crest's centre is (100, 102.5)

    def at(points):
        return [(ox + x * unit, oy + y * unit) for x, y in points]

    x0, y0, x1, y1 = (ox + BOX[0] * unit, oy + BOX[1] * unit, ox + BOX[2] * unit, oy + BOX[3] * unit)
    w, h = round(x1 - x0), round(y1 - y0)
    crest = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    mask = Image.new("L", (px, px), 0)
    ImageDraw.Draw(mask).polygon(at(CREST), fill=255)
    fill = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    fill.paste(gradient(w, h), (round(x0), round(y0)))
    crest.paste(fill, (0, 0), mask)
    shade = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    ImageDraw.Draw(shade).polygon(at(SHADE), fill=SHADE_RGBA)
    crest = Image.alpha_composite(crest, shade)
    canvas = Image.new("RGBA", (px, px), background or (0, 0, 0, 0))
    return Image.alpha_composite(canvas, crest).resize((size, size), Image.LANCZOS)


def main() -> None:
    out = ROOT / "icons"
    out.mkdir(exist_ok=True)
    draw(1024).save(ROOT / "logo.png", optimize=True)
    for name, size in (("icon-512.png", 512), ("icon-192.png", 192)):
        draw(size, padding=0.08).save(out / name, optimize=True)
    # inside the maskable safe zone (a circle of 80% of the icon): the crest's corner is 94 units from its centre, so it needs a 0.19 margin or more
    draw(512, padding=0.2, background=PAGE).save(out / "icon-maskable-512.png", optimize=True)
    draw(180, padding=0.1, background=PAGE).save(out / "apple-touch-icon.png", optimize=True)
    draw(48, padding=0.04).save(out / "favicon.png", optimize=True)
    draw(256, padding=0.04).save(ROOT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print("logo.png, icons/ (icon-192, icon-512, icon-maskable-512, apple-touch-icon, favicon.png) and favicon.ico written")


if __name__ == "__main__":
    main()
