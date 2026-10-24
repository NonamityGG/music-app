"""Generates launcher icons and splash screens for the app.

Usage: python3 tools/make_icons.py <android res dir> <preview out dir>
"""
import os
import sys
from PIL import Image, ImageDraw

RES = sys.argv[1]
PREVIEW = sys.argv[2] if len(sys.argv) > 2 else None

BG_TOP = (124, 58, 237)     # violet
BG_BOTTOM = (76, 29, 149)   # deep purple
SPLASH_BG = (15, 11, 22)
WHITE = (255, 255, 255, 255)

# bar heights as a fraction of glyph height: a small waveform
BARS = [0.36, 0.68, 1.0, 0.56, 0.82, 0.44]


def gradient(size):
    w, h = size
    img = Image.new("RGBA", size)
    px = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        c = tuple(int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3)) + (255,)
        for x in range(w):
            px[x, y] = c
    return img


def draw_glyph(img, box, color=WHITE):
    """Draws rounded waveform bars inside box=(x0,y0,x1,y1)."""
    x0, y0, x1, y1 = box
    d = ImageDraw.Draw(img)
    n = len(BARS)
    total_w = x1 - x0
    gap_ratio = 0.55
    bar_w = total_w / (n + (n - 1) * gap_ratio)
    gap = bar_w * gap_ratio
    cy = (y0 + y1) / 2
    gh = y1 - y0
    for i, f in enumerate(BARS):
        bx = x0 + i * (bar_w + gap)
        bh = max(bar_w, gh * f)
        d.rounded_rectangle([bx, cy - bh / 2, bx + bar_w, cy + bh / 2], radius=bar_w / 2, fill=color)


def render(size, glyph_frac, rounded=None, scale=4):
    big = size * scale
    img = gradient((big, big))
    g = big * glyph_frac
    off = (big - g) / 2
    draw_glyph(img, (off, off, off + g, off + g))
    if rounded is not None:
        mask = Image.new("L", (big, big), 0)
        md = ImageDraw.Draw(mask)
        if rounded == "circle":
            md.ellipse([0, 0, big - 1, big - 1], fill=255)
        else:
            md.rounded_rectangle([0, 0, big - 1, big - 1], radius=big * rounded, fill=255)
        out = Image.new("RGBA", (big, big), (0, 0, 0, 0))
        out.paste(img, (0, 0), mask)
        img = out
    return img.resize((size, size), Image.LANCZOS)


def foreground(size, scale=4):
    big = size * scale
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    # adaptive icon safe zone is the central 66/108; keep glyph within ~40/108
    g = big * (40 / 108)
    off = (big - g) / 2
    draw_glyph(img, (off, off, off + g, off + g))
    return img.resize((size, size), Image.LANCZOS)


def splash(w, h):
    img = Image.new("RGBA", (w, h), SPLASH_BG + (255,))
    s = int(min(w, h) * 0.22)
    icon = render(s, 0.5, rounded=0.28)
    img.paste(icon, ((w - s) // 2, (h - s) // 2), icon)
    return img.convert("RGB")


dens = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
for name, k in dens.items():
    d = os.path.join(RES, f"mipmap-{name}")
    render(int(48 * k), 0.5, rounded=0.22).save(os.path.join(d, "ic_launcher.png"))
    render(int(48 * k), 0.5, rounded="circle").save(os.path.join(d, "ic_launcher_round.png"))
    foreground(int(108 * k)).save(os.path.join(d, "ic_launcher_foreground.png"))

for folder in os.listdir(RES):
    if folder.startswith("drawable-port-") or folder.startswith("drawable-land-"):
        p = os.path.join(RES, folder, "splash.png")
        w, h = Image.open(p).size
        splash(w, h).save(p)
p = os.path.join(RES, "drawable", "splash.png")
w, h = Image.open(p).size
splash(w, h).save(p)

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    render(512, 0.5, rounded=0.22).save(os.path.join(PREVIEW, "icon.png"))
    print("preview saved")
print("icons done")
