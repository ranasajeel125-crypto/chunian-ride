#!/usr/bin/env python3
"""Chunian Ride logo mark: green rounded square + white CAR pictogram.
User order 2026-11-06: the logo must show a vehicle (car), not just the
rickshaw mark. Same green brand colour (#0b6e2f).
Outputs: public/logo.png (512), public/favicon.png (64), and Android
mipmap launcher icons (mdpi 48, hdpi 72, xhdpi 96, xxhdpi 144, xxxhdpi 192).
Pictogram only (no text) so it reads at favicon / app-icon size.
"""
from PIL import Image, ImageDraw

GREEN = (11, 110, 47, 255)      # #0b6e2f — app header green
WHITE = (255, 255, 255, 255)

def draw_mark(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size / 512.0  # scale factor

    # Rounded-square background
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(112 * s), fill=GREEN)

    # --- Car pictogram (white), drawn on a 512 grid, scaled ---
    # Lower body
    d.rounded_rectangle([int(84 * s), int(268 * s), int(428 * s), int(352 * s)],
                        radius=int(26 * s), fill=WHITE)
    # Cabin (trapezoid)
    d.polygon([(int(168 * s), int(272 * s)), (int(198 * s), int(192 * s)),
               (int(322 * s), int(192 * s)), (int(352 * s), int(272 * s))], fill=WHITE)
    # Windows (green cut-outs inside the cabin)
    d.polygon([(int(214 * s), int(256 * s)), (int(232 * s), int(208 * s)),
               (int(282 * s), int(208 * s)), (int(282 * s), int(256 * s))], fill=GREEN)
    d.polygon([(int(294 * s), int(208 * s)), (int(312 * s), int(208 * s)),
               (int(328 * s), int(256 * s)), (int(294 * s), int(256 * s))], fill=GREEN)
    # Wheels: two rings + hubs
    for cx in (172, 340):
        c = int(cx * s)
        r = int(44 * s)
        w = int(22 * s)
        cy = int(390 * s)
        d.ellipse([c - r, cy - r, c + r, cy + r], outline=WHITE, width=w)
        hr = int(9 * s)
        d.ellipse([c - hr, cy - hr, c + hr, cy + hr], fill=WHITE)
    # Road line under the wheels
    d.line([(int(80 * s), int(440 * s)), (int(432 * s), int(440 * s))],
           fill=WHITE, width=int(14 * s))
    return img

if __name__ == "__main__":
    import os
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    pub = os.path.join(base, "public")
    # Website logo + favicon
    draw_mark(512).save(os.path.join(pub, "logo.png"))
    draw_mark(64).save(os.path.join(pub, "favicon.png"))
    # Android launcher icons
    res = os.path.join(base, "..", "chunian-ride-apk", "app", "src", "main", "res")
    for dens, px in [("mipmap-mdpi", 48), ("mipmap-hdpi", 72),
                     ("mipmap-xhdpi", 96), ("mipmap-xxhdpi", 144),
                     ("mipmap-xxxhdpi", 192)]:
        os.makedirs(os.path.join(res, dens), exist_ok=True)
        draw_mark(px).save(os.path.join(res, dens, "ic_launcher.png"))
    print("logo.png, favicon.png + 5 mipmap icons written")
