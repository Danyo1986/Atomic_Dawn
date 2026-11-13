"""Programmsymbol: Strahlungszeichen (wie im Schriftzug) in Orange auf dunklem Grund.
Aufruf: python -I tools/make_icon.py  ->  assets/icon.ico (16-256 px) und favicon.ico"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024  # Zeichengröße, wird heruntergerechnet
ORANGE, GLOW, DARK = (255, 138, 28), (255, 190, 80), (16, 18, 24)


def master():
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    r = int(S * 0.2)
    d.rounded_rectangle([0, 0, S - 1, S - 1], r, fill=ORANGE)                        # Akzentrand
    d.rounded_rectangle([S * 0.055, S * 0.055, S * 0.945, S * 0.945], int(r * 0.8), fill=DARK)
    c, R = S / 2, S * 0.36
    # drei Flügel (je 60 Grad, um 120 Grad versetzt), Spitze nach oben
    for k in range(3):
        a0 = -90 - 30 + 120 * k
        d.pieslice([c - R, c - R, c + R, c + R], a0, a0 + 60, fill=ORANGE)
    d.ellipse([c - S * 0.1, c - S * 0.1, c + S * 0.1, c + S * 0.1], fill=DARK)       # Lücke um die Mitte
    d.ellipse([c - S * 0.065, c - S * 0.065, c + S * 0.065, c + S * 0.065], fill=GLOW)
    return im


m = master()
sizes = [16, 24, 32, 48, 64, 128, 256]
os.makedirs(os.path.join(ROOT, 'assets'), exist_ok=True)
imgs = [m.resize((s, s), Image.LANCZOS) for s in sizes]
for p in ('assets/icon.ico', 'favicon.ico'):
    imgs[-1].save(os.path.join(ROOT, p), format='ICO', sizes=[(s, s) for s in sizes], append_images=imgs[:-1])
print('icon.ico + favicon.ico geschrieben')
