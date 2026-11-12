"""Seitentexturen im Stil der 2D-Vorlagen (Panele, Stahlleisten, Konturen, Warnstreifen).
Basis ist die Mauer-Vorlage (art/crop/wall.jpg = Seitenansicht im Originalstil).
Ausgabe: art/crop/side_<art>.jpg   Aufruf: python -I tools/make_side_textures.py
"""
import os
from PIL import Image, ImageDraw, ImageOps, ImageEnhance, ImageFilter, ImageChops

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'art', 'crop')
wall = Image.open(os.path.join(D, 'wall.jpg')).convert('RGB')
W, H = wall.size


def save(im, name):
    im.save(os.path.join(D, 'side_' + name + '.jpg'), quality=90)
    print(name, im.size)


# Oliv: ein Panel-Abschnitt der Mauer (Pfosten bis Pfosten), nahtlos kachelbar
seg = wall.crop((int(W * 0.04), 0, int(W * 0.37), H))
save(seg.resize((512, 160)), 'olive')

# Stahl: entsättigt, dunkler, leicht bläulich
g = ImageOps.grayscale(seg).convert('RGB')
steel = ImageChops.multiply(g, Image.new('RGB', g.size, (150, 156, 165)))
steel = ImageEnhance.Brightness(steel).enhance(1.25)
save(steel.resize((512, 160)), 'steel')

# Beton (Sockelränder): heller grau
conc = ImageChops.multiply(ImageEnhance.Contrast(g).enhance(0.8), Image.new('RGB', g.size, (205, 200, 192)))
conc = ImageEnhance.Brightness(conc).enhance(1.35)
save(conc.resize((512, 160)), 'concrete')

# Kette: Glieder mit Konturen
t = Image.new('RGB', (512, 128), (48, 50, 53))
d = ImageDraw.Draw(t)
for x in range(0, 512, 64):
    d.rectangle([x + 6, 14, x + 58, 114], fill=(78, 81, 86), outline=(15, 15, 16), width=4)
    d.rectangle([x + 14, 24, x + 50, 40], fill=(98, 101, 106))
    d.ellipse([x + 26, 58, x + 38, 70], fill=(30, 31, 33))
d.rectangle([0, 0, 511, 9], fill=(30, 31, 33)); d.rectangle([0, 118, 511, 127], fill=(30, 31, 33))
d.line([0, 1, 511, 1], fill=(8, 8, 8), width=3); d.line([0, 126, 511, 126], fill=(8, 8, 8), width=3)
save(t.filter(ImageFilter.GaussianBlur(0.6)), 'track')

# Plane: Ausschnitt der LKW-Plane
truck = Image.open(os.path.join(D, 'truck.jpg')).convert('RGB')
tw, th = truck.size
save(truck.crop((int(tw * 0.2), int(th * 0.42), int(tw * 0.8), int(th * 0.62))).resize((512, 256)), 'cloth')

# Warnstreifen
hz = Image.new('RGB', (512, 128), (232, 172, 24))
d = ImageDraw.Draw(hz)
for x in range(-128, 640, 64):
    d.polygon([(x, 128), (x + 32, 128), (x + 160, 0), (x + 128, 0)], fill=(32, 32, 34))
d.rectangle([0, 0, 511, 14], fill=(70, 72, 76)); d.rectangle([0, 113, 511, 127], fill=(70, 72, 76))
for y in (0, 14, 113, 127):
    d.line([0, y, 511, y], fill=(10, 10, 10), width=3)
save(hz, 'hazard')

# Glas: dunkles Blaugrau mit Lichtreflex und Rahmen
gl = Image.new('RGB', (256, 256))
d = ImageDraw.Draw(gl)
for y in range(256):
    k = y / 255
    d.line([0, y, 255, y], fill=(int(70 - 40 * k), int(98 - 50 * k), int(120 - 55 * k)))
d.polygon([(40, 0), (90, 0), (30, 256), (-20, 256)], fill=(130, 160, 180))
gl = gl.filter(ImageFilter.GaussianBlur(4))
d = ImageDraw.Draw(gl)
d.rectangle([0, 0, 255, 255], outline=(60, 62, 66), width=14)
d.rectangle([0, 0, 255, 255], outline=(10, 10, 10), width=4)
save(gl, 'glass')

# Rad (Flanke): Reifen mit Profil, Felge, Radmuttern, Konturen
wh = Image.new('RGB', (256, 256), (40, 42, 44))
d = ImageDraw.Draw(wh)
d.ellipse([4, 4, 252, 252], fill=(38, 40, 42), outline=(8, 8, 8), width=5)
import math
for k in range(24):
    a = k / 24 * 2 * math.pi
    x, y = 128 + math.cos(a) * 112, 128 + math.sin(a) * 112
    d.ellipse([x - 7, y - 7, x + 7, y + 7], fill=(58, 60, 63))
d.ellipse([60, 60, 196, 196], fill=(92, 104, 52), outline=(10, 10, 10), width=4)
d.ellipse([92, 92, 164, 164], fill=(78, 81, 86), outline=(10, 10, 10), width=3)
for k in range(6):
    a = k / 6 * 2 * math.pi
    x, y = 128 + math.cos(a) * 24, 128 + math.sin(a) * 24
    d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=(40, 40, 42))
d.arc([66, 66, 190, 190], 200, 250, fill=(230, 120, 20), width=6)
save(wh, 'wheel')

# Sockel (Draufsicht) im Vorlagenstil: Betonplatten, Stahlrand mit Bolzen, oliv Eckstücke mit Lampen
def pad(w, h, name):
    conc = Image.open(os.path.join(D, 'side_concrete.jpg')).convert('RGB')
    base = Image.new('RGB', (w, h))
    tile = ImageEnhance.Contrast(ImageOps.grayscale(conc.crop((20, 40, 300, 120)).resize((256, 256))).convert('RGB')).enhance(0.5)
    tile = ImageChops.multiply(tile, Image.new('RGB', tile.size, (210, 205, 198)))
    for y in range(0, h, 256):
        for x in range(0, w, 256):
            base.paste(tile, (x, y))
    d = ImageDraw.Draw(base)
    for x in range(0, w, 128):
        d.line([x, 0, x, h], fill=(95, 93, 90), width=2)
    for y in range(0, h, 128):
        d.line([0, y, w, y], fill=(95, 93, 90), width=2)
    R = 34
    d.rectangle([0, 0, w - 1, R], fill=(84, 87, 92)); d.rectangle([0, h - R, w - 1, h - 1], fill=(84, 87, 92))
    d.rectangle([0, 0, R, h - 1], fill=(84, 87, 92)); d.rectangle([w - R, 0, w - 1, h - 1], fill=(84, 87, 92))
    d.rectangle([R, R, w - R, h - R], outline=(20, 20, 22), width=4)
    d.rectangle([0, 0, w - 1, h - 1], outline=(12, 12, 12), width=5)
    for x in range(60, w - 40, 90):
        for y in (R // 2, h - R // 2):
            d.ellipse([x - 4, y - 4, x + 4, y + 4], fill=(45, 46, 48))
    for x in range(160, w - 160, 260):
        for y0 in (6, h - R + 6):
            for k in range(4):
                d.polygon([(x + k * 22, y0 + 22), (x + k * 22 + 10, y0 + 22), (x + k * 22 + 22, y0), (x + k * 22 + 12, y0)], fill=(232, 172, 24))
    for cx, cy in ((0, 0), (w - 70, 0), (0, h - 70), (w - 70, h - 70)):
        d.rectangle([cx, cy, cx + 69, cy + 69], fill=(96, 110, 56), outline=(12, 12, 12), width=4)
        d.rectangle([cx + 26, cy + 26, cx + 43, cy + 43], fill=(255, 140, 20), outline=(12, 12, 12), width=2)
    save(base, name)

pad(1024, 768, 'pad43')

# Kettenband (Lauffläche): 4 Glieder entlang U, Breite entlang V; Stollen, Führungszahn, Bolzen, Konturen
tr = Image.new('RGB', (512, 256), (22, 23, 24))
d = ImageDraw.Draw(tr)
for k in range(4):
    x = k * 128
    d.rectangle([x + 6, 10, x + 121, 245], fill=(66, 69, 73), outline=(10, 10, 10), width=4)
    d.rectangle([x + 20, 18, x + 44, 237], fill=(92, 96, 101), outline=(14, 14, 14), width=3)    # Stollen
    d.rectangle([x + 84, 18, x + 108, 237], fill=(84, 88, 93), outline=(14, 14, 14), width=3)
    d.rectangle([x + 52, 108, x + 76, 148], fill=(110, 114, 120), outline=(12, 12, 12), width=3)  # Führungszahn
    for y in (32, 224):
        d.ellipse([x + 56, y - 8, x + 72, y + 8], fill=(40, 41, 43), outline=(8, 8, 8), width=2)
save(tr.filter(ImageFilter.GaussianBlur(0.5)), 'tread')


# ------------------------------------------------------------------ Oberflächendetail von Poly Haven (CC0)
# Die gezeichnete Panelstruktur bleibt (passt zu den Oberseiten); darüber kommen echte Kratzer, Rost und
# Lackabrieb aus Poly-Haven-Texturen (assets/textures/<id>/diff.jpg, siehe tools/fetch_assets.py).
from PIL import ImageStat
TEX = os.path.join(D, '..', '..', 'assets', 'textures')


def weather(name, ph, detail=0.9, color=0.2, size=(1024, 320), tile=512):
    path = os.path.join(D, 'side_' + name + '.jpg')
    base = Image.open(path).convert('RGB').resize(size, Image.LANCZOS)
    src = Image.open(os.path.join(TEX, ph, 'diff.jpg')).convert('RGB').resize((tile, tile), Image.LANCZOS)
    t = Image.new('RGB', size)
    for x in range(0, size[0], tile):
        t.paste(src, (x, 0))
    g = ImageOps.grayscale(t)
    mean = ImageStat.Stat(g).mean[0]
    # Detail: Helligkeit der echten Oberfläche um den Mittelwert, 128 = neutral
    f = g.point(lambda v: max(0, min(255, round(128 * (1 + detail * (v / mean - 1))))))
    out = ImageChops.multiply(base, Image.merge('RGB', (f, f, f))).point(lambda v: min(255, v * 2))
    # etwas Farbe der echten Oberfläche (Rost, Lackabrieb), auf die Helligkeit der Vorlage gebracht
    k = ImageStat.Stat(ImageOps.grayscale(base)).mean[0] / mean
    out = Image.blend(out, t.point(lambda v: min(255, round(v * k))), color)
    # dunkle Konturen der Vorlage erhalten
    mask = ImageOps.grayscale(base).point(lambda v: min(255, round(v / 0.22)))
    Image.composite(out, base, mask).save(path, quality=90)
    print('wetter', name, ph)


weather('olive', 'green_metal_rust', 1.2, 0.28)
weather('steel', 'metal_plate_02', 0.8, 0.14)
weather('concrete', 'concrete_wall_008', 0.9, 0.12)


# ------------------------------------------------------------------ Texturen der Requisiten (Poly Haven, assets/raw)
import glob
RAW = os.path.join(D, '..', '..', 'assets', 'raw')
for pid in ('Barrel_01', 'wooden_military_crate', 'old_military_crate', 'concrete_road_barrier', 'propane_tank', 'metal_jerrycan_green'):
    src = glob.glob(os.path.join(RAW, pid, 'textures', '*diff*.jpg'))
    if not src:
        print('fehlt', pid); continue
    Image.open(src[0]).convert('RGB').resize((256, 256), Image.LANCZOS).save(os.path.join(D, 'prop_' + pid + '.jpg'), quality=88)
    print('prop', pid)
