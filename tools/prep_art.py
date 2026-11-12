"""Bereitet die 2D-Vorlagen (art/src/*.webp) für die Projektion auf 3D-Modelle vor.
- weißer Hintergrund -> transparent (Flutfüllung vom Rand)
- auf Motiv zuschneiden -> art/crop/<name>.png (max. 1024 px)
- optional Raster-Vorschau zum Ausmessen: python tools/prep_art.py --grid
Aufruf: python -I tools/prep_art.py
"""
import os, sys, json
from collections import deque
from PIL import Image, ImageDraw, ImageFilter, ImageChops

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'art')
SRC, OUT = os.path.join(ROOT, 'src'), os.path.join(ROOT, 'crop')
os.makedirs(OUT, exist_ok=True)


def remove_bg(im, tol=40):
    im = im.convert('RGBA')
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        q.append((x, 0)); q.append((x, h - 1))
    for y in range(h):
        q.append((0, y)); q.append((w - 1, y))
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h:
            continue
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        r, g, b, a = px[x, y]
        if a < 20 or (r > 255 - tol and g > 255 - tol and b > 255 - tol and max(r, g, b) - min(r, g, b) < 25):
            px[x, y] = (r, g, b, 0)
            q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    # Halo glätten: halbtransparente Randpixel
    return im


# Retusche unter beweglichen Teilen (Turm, Rotor, Schüssel): normierte Bildkoordinaten (u,v von oben links)
# ('ell', cu, cv, ru) Ellipse mit Radius ru in Breiteneinheiten; ('rect', u0, v0, u1, v1); ('line', u0, v0, u1, v1, dicke_u)
INPAINT = {
    'tank': [('ell', .5, .6, .35), ('rect', .37, .35, .63, .5), ('rect', .43, 0, .57, .42)],
    'apc': [('ell', .3, .245, .23), ('rect', .36, .02, .46, .2)],
    'artillery': [('rect', .1, .55, .9, .995), ('rect', .4, 0, .6, .6)],
    'turret': [('ell', .5, .58, .31), ('rect', .34, 0, .66, .34)],
    'radar': [('ell', .33, .305, .33)],
    'harvester': [('rect', .29, .48, .71, .8)],
    'heli': [('line', .5, .385, .02, .045, .075), ('line', .5, .385, .98, .045, .075), ('line', .5, .385, .02, .735, .075),
             ('line', .5, .385, .98, .735, .075), ('ell', .5, .385, .09)],
}
FILL = {'tank': (88, 98, 52), 'apc': (92, 99, 62), 'artillery': (98, 106, 60), 'turret': (72, 74, 78), 'radar': (128, 125, 121),
        'harvester': (38, 40, 43), 'heli': (84, 94, 50)}


def bleed(im):
    """Farbe in transparente Bereiche auslaufen lassen (gegen weiße/schwarze Kanten), Ergebnis RGB."""
    a = im.getchannel('A')
    rgb = im.convert('RGB')
    acc = Image.new('RGB', im.size, (0, 0, 0))
    for r in (2, 6, 16, 40, 100):
        pre = Image.composite(rgb, Image.new('RGB', im.size), a)
        num = pre.filter(ImageFilter.BoxBlur(r))
        den = a.filter(ImageFilter.BoxBlur(r))
        # num/den pixelweise
        n, d = num.load(), den.load()
        out = Image.new('RGB', im.size)
        o = out.load()
        for y in range(im.height):
            for x in range(im.width):
                dd = d[x, y]
                if dd > 0:
                    c = n[x, y]
                    o[x, y] = (min(255, c[0] * 255 // dd), min(255, c[1] * 255 // dd), min(255, c[2] * 255 // dd))
        hole = a.point(lambda v: 255 if v < 128 else 0)
        rgb = Image.composite(out, rgb, hole)
        a = Image.composite(den.point(lambda v: 255 if v > 0 else 0), a, hole)
    return rgb


def inpaint(rgb, name):
    w, h = rgb.size
    mask = Image.new('L', rgb.size, 0)
    d = ImageDraw.Draw(mask)
    for sh in INPAINT[name]:
        if sh[0] == 'ell':
            _, cu, cv, ru = sh
            rx, ry = ru * w, ru * w
            d.ellipse([cu * w - rx, cv * h - ry, cu * w + rx, cv * h + ry], fill=255)
        elif sh[0] == 'rect':
            _, u0, v0, u1, v1 = sh
            d.rectangle([u0 * w, v0 * h, u1 * w, v1 * h], fill=255)
        else:
            _, u0, v0, u1, v1, t = sh
            d.line([u0 * w, v0 * h, u1 * w, v1 * h], fill=255, width=int(t * w))
    mask = mask.filter(ImageFilter.GaussianBlur(3))
    base = Image.new('RGB', rgb.size, FILL[name])
    # leichte Struktur aus dem Original (Luminanz, stark weichgezeichnet) erhalten
    tex = rgb.convert('L').filter(ImageFilter.GaussianBlur(1)).point(lambda v: 128 + (v - 128) // 6)
    base = ImageChops.multiply(base, Image.merge('RGB', [tex.point(lambda v: min(255, v * 2))] * 3))
    return Image.composite(base, rgb, mask)


def main():
    meta = {}
    grid = '--grid' in sys.argv
    for f in sorted(os.listdir(SRC)):
        if not f.endswith('.webp'):
            continue
        name = f[:-5]
        im = remove_bg(Image.open(os.path.join(SRC, f)))
        bb = im.getchannel('A').point(lambda a: 255 if a > 30 else 0).getbbox()
        im = im.crop(bb)
        s = 1024 / max(im.size)
        if s < 1:
            im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
        rgb = bleed(im)
        rgb.save(os.path.join(OUT, name + '.jpg'), quality=90)
        if name in INPAINT:
            inpaint(rgb, name).save(os.path.join(OUT, name + '_base.jpg'), quality=90)
        meta[name] = {'w': im.width, 'h': im.height, 'aspect': round(im.width / im.height, 4)}
        if grid:
            g = Image.new('RGBA', im.size, (255, 255, 255, 255))
            g.alpha_composite(im)
            d = ImageDraw.Draw(g)
            for k in range(1, 10):
                x, y = im.width * k / 10, im.height * k / 10
                d.line([(x, 0), (x, im.height)], fill=(255, 0, 255, 160), width=1)
                d.line([(0, y), (im.width, y)], fill=(255, 0, 255, 160), width=1)
                d.text((x + 2, 2), str(k), fill=(255, 0, 255, 255))
                d.text((2, y + 2), str(k), fill=(255, 0, 255, 255))
            os.makedirs(os.path.join(ROOT, 'grid'), exist_ok=True)
            g.convert('RGB').save(os.path.join(ROOT, 'grid', name + '.jpg'), quality=80)
        print(name, meta[name])
    json.dump(meta, open(os.path.join(OUT, 'meta.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
