"""Fassadentexturen der Stadthäuser (Winterkarte) aus Poly-Haven-Wandflächen + gezeichneten Fenstern, Türen, Toren.
python -I tools/make_city_textures.py   ->  assets/textures/city/<stil>.jpg, trim.jpg, snow.jpg

Aufbau jeder Fassade (1024 x 1024 px = 12 m breit):
  oberes 3/4:  3 Geschosse x 4 Achsen (je 256 px = 3 m)  -> v 0.25 .. 1, wird geschossweise gestapelt
  unteres 1/4: Erdgeschoss, 4 Achsen (Türen, Läden, Tore)  -> v 0 .. 0.25
In u-Richtung kachelt die Textur. trim.jpg: 4 x 4 Farbfelder für Anbauteile, snow.jpg: kachelnder Dachschnee.
"""
import os, random
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(HERE, '..', 'assets', 'textures')
D = os.path.join(TEX, 'city')
os.makedirs(D, exist_ok=True)
B = 256                      # Pixel je Achse (3 m)
rnd = random.Random(5)


def wall(tex, tint=(1, 1, 1), bright=1.0, tile=256):
    """Wandfläche 1024 x 1024 aus einer Poly-Haven-Textur (gekachelt, getönt)."""
    im = Image.open(os.path.join(TEX, tex, 'diff.jpg')).convert('RGB').resize((tile, tile), Image.LANCZOS)
    out = Image.new('RGB', (1024, 1024))
    for y in range(0, 1024, tile):
        for x in range(0, 1024, tile):
            out.paste(im, (x, y))
    r, g, b = out.split()
    f = lambda ch, k: ch.point(lambda p: min(255, int(p * k * bright)))
    return Image.merge('RGB', (f(r, tint[0]), f(g, tint[1]), f(b, tint[2])))


def glass(d, x0, y0, x1, y1, lit=False, kind='blue'):
    """Scheibe: Himmelsspiegelung (oben dunkel, schräger heller Streifen) oder warm erleuchtet."""
    h = max(1, y1 - y0)
    for i in range(h):
        t = i / h
        if lit:
            c = (int(238 - 40 * t), int(196 - 50 * t), int(110 - 30 * t))
        elif kind == 'teal':
            c = (int(52 + 46 * t), int(92 + 52 * t), int(112 + 46 * t))
        else:
            c = (int(34 + 42 * t), int(46 + 50 * t), int(62 + 56 * t))
        d.line((x0, y0 + i, x1, y0 + i), fill=c)
    if not lit:
        w = x1 - x0
        for k in range(int(w * 0.22)):
            xa = x0 + int(w * 0.18) + k
            d.line((xa, y1, min(x1, xa + int(h * 0.45)), y0), fill=(120, 140, 160) if kind != 'teal' else (150, 186, 200), width=1)


def window(d, x, y, w, h, frame=(232, 232, 226), bars=(1, 1), lit=None, kind='blue', sill=True, snow=True, shut=None):
    """Fenster mit Rahmen, Sprossen, Sturzschatten, Fensterbank (mit Schneestreifen), optional Läden."""
    lit = rnd.random() < 0.13 if lit is None else lit
    d.rectangle((x - 3, y - 7, x + w + 3, y - 1), fill=(0, 0, 0, 70))            # Sturz/Schatten oben
    d.rectangle((x, y, x + w, y + h), fill=frame)
    glass(d, x + 6, y + 6, x + w - 6, y + h - 6, lit, kind)
    if not lit and rnd.random() < 0.35:                                          # Vorhang
        cw = int(w * (0.25 + rnd.random() * 0.2))
        d.rectangle((x + 6, y + 6, x + 6 + cw, y + h - 6), fill=(198, 190, 172))
    for i in range(1, bars[0] + 1):
        xx = x + w * i // (bars[0] + 1)
        d.rectangle((xx - 2, y, xx + 2, y + h), fill=frame)
    for i in range(1, bars[1] + 1):
        yy = y + h * i // (bars[1] + 1)
        d.rectangle((x, yy - 2, x + w, yy + 2), fill=frame)
    if shut:
        sw = int(w * 0.42)
        for xa in (x - sw - 2, x + w + 2):
            d.rectangle((xa, y, xa + sw, y + h), fill=shut)
            for yy in range(y + 6, y + h - 4, 9):
                d.line((xa + 4, yy, xa + sw - 4, yy), fill=tuple(int(v * 0.75) for v in shut), width=2)
    if sill:
        d.rectangle((x - 8, y + h, x + w + 8, y + h + 9), fill=(168, 166, 160))
        if snow:
            d.rectangle((x - 8, y + h - 5, x + w + 8, y + h + 1), fill=(240, 244, 248))


def door(d, x, y0, w, h, col=(74, 52, 38), glassy=False):
    y = y0 - h
    d.rectangle((x - 6, y - 6, x + w + 6, y0), fill=(150, 148, 142))
    d.rectangle((x, y, x + w, y0), fill=col)
    if glassy:
        glass(d, x + 8, y + 10, x + w - 8, y0 - 30)
        d.rectangle((x + w // 2 - 2, y, x + w // 2 + 2, y0), fill=(60, 62, 66))
    else:
        d.rectangle((x + 10, y + 12, x + w - 10, y + h // 2 - 6), outline=tuple(int(v * 0.6) for v in col), width=3)
        d.rectangle((x + 10, y + h // 2 + 6, x + w - 10, y0 - 14), outline=tuple(int(v * 0.6) for v in col), width=3)
    d.rectangle((x - 14, y0 - 8, x + w + 14, y0), fill=(236, 240, 244))       # Schnee auf der Stufe


def base_strip(d, col=(92, 90, 88), h=26):
    d.rectangle((0, 1024 - h, 1024, 1024), fill=col)                          # Sockel
    d.rectangle((0, 1024 - h - 5, 1024, 1024 - h), fill=(236, 240, 244))      # angewehter Schnee


def save(im, name):
    im = im.filter(ImageFilter.GaussianBlur(0.4))
    im.save(os.path.join(D, name + '.jpg'), quality=90)
    print(name)


def upper(d, fn):
    """fn(d, x0, y0) je Achse der drei Obergeschosse."""
    for fl in range(3):
        for b in range(4):
            fn(d, b * B, fl * B)


GROUND = 768                 # y der Erdgeschosszeile


# ------------------------------------------------------------------ Wohnhäuser
def residential(name, tex, tint, bright, frame, shut=None, bars=(1, 1), ww=104, wh=142):
    im = wall(tex, tint, bright)
    d = ImageDraw.Draw(im, 'RGBA')
    upper(d, lambda d, x, y: window(d, x + (B - ww) // 2, y + 58, ww, wh, frame, bars, shut=shut))
    for b in range(4):
        x = b * B
        if b == 1:
            door(d, x + 84, 1024 - 26, 88, 196)
            d.rectangle((x + 60, GROUND + 22, x + 196, GROUND + 30), fill=(236, 240, 244))   # Vordach mit Schnee
            d.rectangle((x + 60, GROUND + 30, x + 196, GROUND + 38), fill=(110, 108, 104))
        else:
            window(d, x + (B - ww) // 2, GROUND + 50, ww, wh - 10, frame, bars, shut=shut)
    base_strip(d)
    save(im, name)


# ------------------------------------------------------------------ Plattenbau / Wohnturm
def panel(name, tex, tint, bright, ww=150, wh=124, joints=True, band=None):
    im = wall(tex, tint, bright, 512)
    d = ImageDraw.Draw(im, 'RGBA')
    if band:                                                   # farbige Brüstungsbänder
        for fl in range(3):
            d.rectangle((0, fl * B + 196, 1024, fl * B + 256), fill=band + (150,))
    if joints:
        for x in range(0, 1025, B):
            d.line((x, 0, x, 1024), fill=(40, 40, 42, 150), width=4)
        for y in range(0, 1025, B):
            d.line((0, y, 1024, y), fill=(40, 40, 42, 150), width=4)
    upper(d, lambda d, x, y: window(d, x + (B - ww) // 2, y + 62, ww, wh, (214, 214, 210), (2, 0)))
    for b in range(4):
        x = b * B
        if b == 2:
            door(d, x + 70, 1024 - 26, 116, 190, (60, 64, 70), True)
            d.rectangle((x + 30, GROUND + 18, x + 226, GROUND + 28), fill=(236, 240, 244))
            d.rectangle((x + 30, GROUND + 28, x + 226, GROUND + 40), fill=(96, 96, 98))
        else:
            window(d, x + (B - ww) // 2, GROUND + 66, ww, wh - 20, (214, 214, 210), (2, 0))
    base_strip(d, (84, 84, 86))
    save(im, name)


# ------------------------------------------------------------------ Büro: Glasfassade
def curtain(name):
    im = Image.new('RGB', (1024, 1024), (70, 76, 82))
    d = ImageDraw.Draw(im, 'RGBA')
    for fl in range(4):
        y = fl * B
        for b in range(8):                                     # zwei Scheiben je Achse
            x = b * 128
            lit = rnd.random() < 0.1
            glass(d, x + 5, y + 8, x + 123, y + 176, lit, 'teal')
            d.rectangle((x + 5, y + 182, x + 123, y + 250), fill=(54, 74, 88) if (b + fl) % 5 else (64, 88, 100))   # Brüstungsglas
        d.rectangle((0, y + 250, 1024, y + 256), fill=(196, 200, 204))
        d.rectangle((0, y, 1024, y + 6), fill=(150, 154, 158))
    for b in range(9):
        d.rectangle((b * 128 - 3, 0, b * 128 + 3, 1024), fill=(188, 192, 196))
    # Erdgeschoss: Foyer mit Eingang
    d.rectangle((0, GROUND, 1024, 1024), fill=(60, 64, 70))
    for b in range(4):
        x = b * B
        glass(d, x + 10, GROUND + 34, x + B - 10, 1024 - 30, b == 0, 'teal')
        d.rectangle((x + B // 2 - 3, GROUND + 34, x + B // 2 + 3, 1024 - 30), fill=(188, 192, 196))
    d.rectangle((0, GROUND, 1024, GROUND + 30), fill=(210, 212, 214))
    d.rectangle((B + 40, GROUND + 60, B + 216, 1024 - 30), outline=(230, 232, 234), width=6)
    base_strip(d, (70, 72, 76), 30)
    save(im, name)


# ------------------------------------------------------------------ Büro/Gewerbe: Fensterbänder, Läden
def ribbon(name, tex, tint, bright, shops=True, sign=None):
    im = wall(tex, tint, bright, 512)
    d = ImageDraw.Draw(im, 'RGBA')
    for fl in range(3):
        y = fl * B
        d.rectangle((0, y + 60, 1024, y + 66), fill=(0, 0, 0, 80))
        d.rectangle((0, y + 66, 1024, y + 188), fill=(206, 208, 210))
        for b in range(8):
            glass(d, b * 128 + 6, y + 72, b * 128 + 122, y + 182, rnd.random() < 0.12)
        d.rectangle((0, y + 188, 1024, y + 196), fill=(168, 168, 164))
        d.rectangle((0, y + 184, 1024, y + 189), fill=(240, 244, 248))
    cols = sign or [(176, 44, 40), (38, 98, 60), (40, 76, 140), (214, 150, 40)]
    for b in range(4):
        x = b * B
        if shops:
            glass(d, x + 14, GROUND + 78, x + B - 14, 1024 - 34, rnd.random() < 0.5)
            d.rectangle((x + 14, GROUND + 78, x + B - 14, 1024 - 34), outline=(50, 52, 56), width=5)
            d.rectangle((x + B // 2 - 3, GROUND + 78, x + B // 2 + 3, 1024 - 34), fill=(50, 52, 56))
            c = cols[b % len(cols)]
            d.rectangle((x + 8, GROUND + 22, x + B - 8, GROUND + 68), fill=c)                      # Schild
            for k in range(5):
                d.rectangle((x + 28 + k * 42, GROUND + 36, x + 54 + k * 42, GROUND + 54), fill=(240, 236, 226))
            d.rectangle((x + 8, GROUND + 16, x + B - 8, GROUND + 23), fill=(240, 244, 248))
        else:
            window(d, x + 40, GROUND + 60, 176, 130, (206, 208, 210), (3, 0))
    base_strip(d, (80, 80, 82))
    save(im, name)


# ------------------------------------------------------------------ Industrie
def industrial(name, tex, tint, bright, brick=False):
    im = wall(tex, tint, bright, 256 if brick else 512)
    d = ImageDraw.Draw(im, 'RGBA')
    for fl in range(3):
        for b in range(4):
            x, y = b * B, fl * B
            if brick:                                          # hohe Sprossenfenster
                window(d, x + 52, y + 40, 152, 176, (70, 74, 72), (3, 4), lit=rnd.random() < 0.08, snow=True)
            elif fl == 1 and b % 2 == 0:                       # Lichtband in der Blechwand
                window(d, x + 20, y + 90, 216, 70, (120, 124, 128), (4, 0), sill=False)
    for b in range(4):
        x = b * B
        if b in (0, 2):                                        # Rolltor mit Warnstreifen
            d.rectangle((x + 26, GROUND + 30, x + 230, 1024 - 20), fill=(126, 130, 134))
            for yy in range(GROUND + 36, 1024 - 20, 12):
                d.line((x + 26, yy, x + 230, yy), fill=(90, 94, 98), width=3)
            for k in range(0, 204, 34):
                d.polygon([(x + 26 + k, 1024 - 20), (x + 43 + k, 1024 - 20), (x + 60 + k, 1024 - 44), (x + 43 + k, 1024 - 44)], fill=(226, 180, 40))
            d.rectangle((x + 18, GROUND + 22, x + 238, GROUND + 31), fill=(60, 62, 66))
        elif b == 1:
            door(d, x + 90, 1024 - 20, 76, 170, (58, 76, 96))
            d.rectangle((x + 60, GROUND + 40, x + 196, GROUND + 60), fill=(226, 180, 40))
        else:
            window(d, x + 60, GROUND + 70, 136, 96, (70, 74, 72), (2, 1))
    base_strip(d, (78, 78, 80), 20)
    save(im, name)


residential('res_brick', 'red_brick_03', (1, 0.96, 0.92), 1.0, (236, 234, 226))
residential('res_cream', 'painted_plaster_wall', (1.0, 0.95, 0.82), 1.05, (244, 242, 236), shut=(70, 96, 74))
residential('res_yellow', 'yellow_plaster', (1, 1, 0.9), 1.35, (240, 238, 230), shut=(120, 78, 52), bars=(1, 0))
panel('panel', 'concrete_panels', (1, 1, 1.02), 1.1, band=(92, 128, 150))
panel('tower_res', 'concrete_tile_facade', (1, 0.98, 0.93), 2.3, 164, 130, False, band=(176, 120, 78))
curtain('office_glass')
ribbon('office_band', 'rectangular_facade_tiles', (1, 1, 1.02), 1.7, shops=False)
ribbon('shops', 'painted_plaster_wall', (0.98, 0.98, 1.0), 1.1)
industrial('ind_metal', 'corrugated_iron_02', (0.9, 0.96, 1.05), 1.5)
industrial('ind_brick', 'factory_brick', (1, 1, 1), 1.0, brick=True)
industrial('ind_green', 'corrugated_iron', (0.5, 0.62, 0.52), 1.0)

# ------------------------------------------------------------------ Farbfelder für Anbauteile (4 x 4)
SW = [(206, 206, 202), (64, 66, 70), (150, 154, 158), (46, 70, 92),      # Beton, Dunkelmetall, Hellmetall, Glas
      (132, 62, 48), (176, 44, 40), (38, 98, 60), (74, 52, 38),          # Ziegel, Markise rot, Markise grün, Holz
      (40, 42, 46), (226, 180, 40), (240, 244, 248), (120, 126, 132),    # Asphalt, Gelb, Weiß, Zink
      (160, 60, 50), (60, 84, 130), (110, 112, 108), (20, 20, 22)]       # Autorot, Autoblau, Autograu, Reifen
im = Image.new('RGB', (256, 256))
d = ImageDraw.Draw(im)
for i, c in enumerate(SW):
    d.rectangle(((i % 4) * 64, (i // 4) * 64, (i % 4) * 64 + 63, (i // 4) * 64 + 63), fill=c)
im.save(os.path.join(D, 'trim.jpg'), quality=95)
# Dachschnee: Schnee-Textur, aufgehellt, leicht bläuliche Schatten
sn = Image.open(os.path.join(TEX, 'snow_02', 'diff.jpg')).convert('RGB').resize((512, 512), Image.LANCZOS)
sn = ImageEnhance.Contrast(sn).enhance(0.7)
sn = Image.eval(sn, lambda p: min(255, int(p * 1.12 + 22)))
sn.save(os.path.join(D, 'snow.jpg'), quality=90)
print('trim, snow')
