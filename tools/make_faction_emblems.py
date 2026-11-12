"""Allianz-Varianten der Gebäudevorlagen: das gezeichnete Emblem (Zahnrad mit Schwertern bzw. Hammer und Schlüssel)
wird ausgeblendet und durch einen Stern in derselben Schablonenfarbe ersetzt. Die Achsenmacht behält die Originale.
Aufruf:  python -I tools/make_faction_emblems.py
Ausgabe: assets/textures/emblems/<bild>_allies.jpg (gleiche Größe wie art/crop/<bild>.jpg; im Spiel ersetzt assets.js
         die Bildtextur von Material 'Art_<bild>' für Spieler der Allianz).
"""
import math, os
from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'art', 'crop')
OUT = os.path.join(HERE, '..', 'assets', 'textures', 'emblems')

# Emblem je Bild: Suchrechteck (Bildpixel der Vorlage), Mittelpunkt und Außenradius des Sterns
EMBLEMS = {
    'factory': {'box': (392, 405, 545, 540), 'c': (468, 470), 'r': 64},
    'yard': {'box': (192, 192, 288, 282), 'c': (240, 237), 'r': 43},
}


def emblem_mask(im, box):
    """Helle, wenig gesättigte Pixel im Suchrechteck = Schablonenfarbe des Emblems."""
    x0, y0, x1, y1 = box
    m = Image.new('L', im.size, 0)
    px, mp = im.load(), m.load()
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b = px[x, y]
            mx, mn = max(r, g, b), min(r, g, b)
            if mx > 112 and (mx - mn) < 0.4 * mx:
                mp[x, y] = 255
    return m.filter(ImageFilter.MaxFilter(11)).filter(ImageFilter.GaussianBlur(1.5)).point(lambda v: 255 if v > 30 else 0)


def inpaint(im, mask, it=90):
    """Füllt die Maske durch wiederholtes Weichzeichnen von außen nach innen (Blechstruktur bleibt außen erhalten)."""
    keep = ImageChops.invert(mask)
    # Startwert: mittlere Farbe des Blechs rings um die Maske (sonst bleibt ein heller Schleier des alten Emblems)
    ring = ImageChops.subtract(mask.filter(ImageFilter.MaxFilter(9)), mask)
    px, rp = im.load(), ring.load()
    acc, n = [0, 0, 0], 0
    for y in range(im.height):
        for x in range(im.width):
            if rp[x, y]:
                acc = [a + c for a, c in zip(acc, px[x, y])]; n += 1
    base = Image.new('RGB', im.size, tuple(int(a / max(n, 1)) for a in acc))
    cur = Image.composite(im, base, keep)
    for k in range(it):
        cur = Image.composite(im, cur.filter(ImageFilter.GaussianBlur(2.5 if k < it // 2 else 1.2)), keep)
    # feines Rauschen wie die gemalte Blechstruktur, damit die Fläche nicht glatt wirkt
    noise = Image.effect_noise(im.size, 7).filter(ImageFilter.GaussianBlur(0.7)).convert('RGB')
    grain = ImageChops.add(cur, noise, 1, -128)
    return Image.composite(grain, cur, mask.filter(ImageFilter.GaussianBlur(2)))


def stencil_color(im, mask):
    px, mp = im.load(), mask.load()
    acc, n = [0, 0, 0], 0
    for y in range(im.height):
        for x in range(im.width):
            if mp[x, y] and sum(px[x, y]) > 540:
                acc = [a + c for a, c in zip(acc, px[x, y])]; n += 1
    return tuple(min(255, int(a / max(n, 1) * 1.07)) for a in acc) if n else (225, 218, 200)


def star(im, c, r, col):
    """Fünfzackiger Stern (Spitze nach Norden), 4-fach überabgetastet, leicht abgenutzt wie die Schablone."""
    S = 4
    W = int(r * 2.6)
    lay = Image.new('L', (W * S, W * S), 0)
    d = ImageDraw.Draw(lay)
    pts = []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5
        rr = (r if i % 2 == 0 else r * 0.4) * S
        pts.append((W * S / 2 + math.cos(a) * rr, W * S / 2 + math.sin(a) * rr))
    d.polygon(pts, fill=255)
    lay = lay.resize((W, W), Image.LANCZOS)
    # Abnutzung: das Blech unter der Farbe schimmert leicht durch
    patch = im.crop((c[0] - W // 2, c[1] - W // 2, c[0] - W // 2 + W, c[1] - W // 2 + W))
    grain = patch.convert('L').filter(ImageFilter.GaussianBlur(0.6))
    lo, hi = grain.getextrema()
    grain = grain.point(lambda v: int(170 + 85 * (v - lo) / max(1, hi - lo)))
    alpha = ImageChops.multiply(lay, grain)
    fill = Image.new('RGB', (W, W), col)
    patch.paste(fill, (0, 0), alpha)
    im.paste(patch, (c[0] - W // 2, c[1] - W // 2))


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, e in EMBLEMS.items():
        im = Image.open(os.path.join(SRC, name + '.jpg')).convert('RGB')
        m = emblem_mask(im, e['box'])
        col = stencil_color(im, m)
        clean = inpaint(im, m)
        star(clean, e['c'], e['r'], col)
        p = os.path.join(OUT, name + '_allies.jpg')
        clean.save(p, quality=92)
        print('OK', p, im.size, 'Farbe', col)


if __name__ == '__main__':
    main()
