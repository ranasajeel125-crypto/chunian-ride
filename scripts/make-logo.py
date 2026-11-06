#!/usr/bin/env python3
"""Chunian Ride logo mark: green rounded square + white rickshaw pictogram.
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

    # --- Rickshaw pictogram (white), drawn on a 512 grid, scaled ---
    # Canopy dome: upper arc
    d.arc([int(118 * s), int(96 * s), int(394 * s), int(330 * s)],
          start=180, end=360, fill=WHITE, width=int(30 * s))
    # Canopy supports (front + back posts)
    d.line([(int(132 * s), int(212 * s)), (int(132 * s), int(268 * s))],
           fill=WHITE, width=int(24 * s))
    d.line([(int(380 * s), int(212 * s)), (int(380 * s), int(268 * s))],
           fill=WHITE, width=int(24 * s))
    # Passenger body (rounded rect)
    d.rounded_rectangle([int(118 * s), int(262 * s), int(394 * s), int(352 * s)],
                        radius=int(22 * s), fill=WHITE)
    # Driver handle bar (front, right side)
    d.line([(int(394 * s), int(300 * s)), (int(438 * s), int(272 * s))],
           fill=WHITE, width=int(22 * s))
    d.line([(int(438 * s), int(272 * s)), (int(452 * s), int(300 * s))],
           fill=WHITE, width=int(18 * s))
    # Wheels: two rings + hubs
    for cx in (186, 330):
        c = int(cx * s)
        r = int(42 * s)
        w = int(22 * s)
        cy = int(392 * s)
        d.ellipse([c - r, cy - r, c + r, cy + r], outline=WHITE, width=w)
        hr = int(9 * s)
        d.ellipse([c - hr, cy - hr, c + hr, cy + hr], fill=WHITE)
    # Road line under the wheels
    d.line([(int(84 * s), int(448 * s)), (int(428 * s), int(448 * s))],
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
