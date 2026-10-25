"""Icons of Резонанс for PC (same mark as the phone app): icon.ico for the app and
installer, tray.ico for the notification area, icon.png as the source.

Usage: python3 make_icon.py   (writes next to itself)
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
TOP, BOTTOM = (124, 58, 237), (76, 29, 149)
BARS = [0.36, 0.68, 1.0, 0.56, 0.82, 0.44]


def icon(size, glyph=0.5, radius=0.22, scale=4):
    big = size * scale
    img = Image.new("RGBA", (big, big))
    px = img.load()
    for y in range(big):
        t = y / max(1, big - 1)
        c = tuple(int(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3)) + (255,)
        for x in range(big):
            px[x, y] = c
    d = ImageDraw.Draw(img)
    g = big * glyph
    x0 = (big - g) / 2
    n = len(BARS)
    bw = g / (n + (n - 1) * 0.55)
    cy = big / 2
    for i, f in enumerate(BARS):
        bx = x0 + i * bw * 1.55
        bh = max(bw, g * f)
        d.rounded_rectangle([bx, cy - bh / 2, bx + bw, cy + bh / 2], radius=bw / 2, fill=(255, 255, 255, 255))
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, big - 1, big - 1], radius=big * radius, fill=255)
    out = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out.resize((size, size), Image.LANCZOS)


big = icon(512)
big.save(os.path.join(HERE, "icon.png"))
sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
icon(256).save(os.path.join(HERE, "icon.ico"), sizes=[(s, s) for s in sizes])
# the tray icon is tiny: a bolder glyph reads better there
icon(64, glyph=0.62, radius=0.26).save(os.path.join(HERE, "tray.ico"), sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (48, 48), (64, 64)])
icon(32, glyph=0.62, radius=0.26).save(os.path.join(HERE, "tray.png"))
print("icons written")
