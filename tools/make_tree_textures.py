"""Zeichnet die Karten-Texturen der Bäume (PNG mit Alpha) und verkleinert die Rinde.
python -I tools/make_tree_textures.py   ->  assets/textures/trees/fir.png, leaf.png, bark.jpg

fir.png:  Fichtenast von oben, Ansatz links Mitte, Spitze rechts (u = Astlänge).
leaf.png: runder Laubzweig-Büschel, Mitte = Bildmitte.
Die Flächen sind bewusst dicht gezeichnet: verkleinert (Mipmaps) bleibt die Deckung hoch, die Kronen dünnen in der
Ferne nicht aus. Unter den durchsichtigen Stellen liegt Grün, damit keine dunklen Säume entstehen.
"""
import os, math, random
from PIL import Image, ImageDraw, ImageFilter

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'textures', 'trees')
os.makedirs(D, exist_ok=True)
S = 2048          # Zeichengröße, Ausgabe 512
rnd = random.Random(11)


def finish(col, alpha, name, back):
    """Farbe über Grundton legen (gegen Säume), Alpha getrennt verkleinern."""
    base = Image.new('RGB', col.size, back)
    base.paste(col, mask=alpha)
    # Farbe in die durchsichtigen Bereiche ausbluten lassen
    blur = base.filter(ImageFilter.GaussianBlur(24))
    blur.paste(base, mask=alpha)
    out = blur.resize((512, 512), Image.LANCZOS)
    a = alpha.resize((512, 512), Image.LANCZOS)
    out.putalpha(a)
    out.save(os.path.join(D, name))
    cov = sum(a.histogram()[128:]) / (512 * 512)
    print(name, 'Deckung %.0f %%' % (cov * 100))


def stroke(d, da, x0, y0, x1, y1, w, c):
    d.line((x0, y0, x1, y1), fill=c, width=w)
    da.line((x0, y0, x1, y1), fill=255, width=w)


# ------------------------------------------------------------------ Fichtenast
def fir():
    col = Image.new('RGB', (S, S), (40, 70, 40))
    al = Image.new('L', (S, S), 0)
    d, da = ImageDraw.Draw(col), ImageDraw.Draw(al)
    greens = [(26, 52, 34), (34, 66, 40), (44, 82, 46), (56, 98, 52)]
    fresh = [(78, 124, 62), (96, 140, 70)]

    def needles(x0, y0, ang, length, tipness, dens=11, nl=62):
        """Nadeln entlang eines Zweigs; an der Zweigspitze heller (junger Austrieb)."""
        n = max(2, int(length / dens))
        for i in range(n + 1):
            t = i / n
            px, py = x0 + math.cos(ang) * length * t, y0 + math.sin(ang) * length * t
            ln = nl * (1.0 - 0.45 * t) * (0.8 + rnd.random() * 0.4)
            pal = fresh if (t > 0.72 and rnd.random() < tipness) else greens
            for sg in (-1, 1):
                a = ang + sg * (0.75 + rnd.random() * 0.35)
                stroke(d, da, px, py, px + math.cos(a) * ln, py + math.sin(a) * ln, 9, rnd.choice(pal))
        stroke(d, da, x0, y0, x0 + math.cos(ang) * length, y0 + math.sin(ang) * length, 9, (70, 52, 34))
        ex, ey = x0 + math.cos(ang) * length, y0 + math.sin(ang) * length
        for k in range(5):                                   # Büschel an der Spitze
            a = ang + (k - 2) * 0.3
            stroke(d, da, ex, ey, ex + math.cos(a) * nl * 0.7, ey + math.sin(a) * nl * 0.7, 9, rnd.choice(fresh if rnd.random() < tipness else greens))

    L = S - 90
    cy = S / 2
    # Seitenzweige: Länge folgt einem Blattumriss (am längsten bei 30 % der Astlänge)
    n = 21
    for i in range(n):
        t = (i + 0.5) / n
        x = 30 + t * L * 0.93
        prof = (math.sin(min(1.0, t / 0.3) * math.pi / 2) ** 0.8) * (1.0 - t) ** 0.62
        ln = 150 + prof * 860
        for sg in (-1, 1):
            a = sg * (0.92 - 0.25 * t + (rnd.random() - 0.5) * 0.12)
            l2 = ln * (0.88 + rnd.random() * 0.24)
            # Nebenzweige zuerst (liegen darunter)
            m = max(1, int(l2 / 150))
            for k in range(m):
                tt = (k + 0.6) / (m + 0.3)
                bx, by = x + math.cos(a) * l2 * tt, cy + math.sin(a) * l2 * tt
                for s2 in (-1, 1):
                    needles(bx, by, a + s2 * 0.7, l2 * 0.3 * (1.0 - tt * 0.5), 0.6, 12, 50)
            needles(x, cy, a, l2, 0.8)
    needles(30, cy, 0.0, L, 0.9, 10, 70)
    d.line((0, cy, L * 0.8, cy), fill=(64, 48, 32), width=16)
    da.line((0, cy, L * 0.8, cy), fill=255, width=16)
    finish(col, al, 'fir.png', (40, 72, 42))


# ------------------------------------------------------------------ Laubbüschel
def leaf():
    col = Image.new('RGB', (S, S), (46, 78, 32))
    al = Image.new('L', (S, S), 0)
    d, da = ImageDraw.Draw(col), ImageDraw.Draw(al)
    dark = [(30, 54, 24), (36, 62, 27), (41, 70, 30)]
    mid = [(46, 78, 32), (52, 86, 35), (58, 93, 38)]
    lite = [(64, 100, 40), (72, 108, 44), (80, 116, 48)]

    def one(x, y, ang, ln, c):
        w = ln * (0.36 + rnd.random() * 0.1)
        pts = []
        for k in range(13):                                   # spitz zulaufendes Oval
            t = k / 12
            r = math.sin(t * math.pi) ** 0.8 * w
            pts.append((t * ln, r))
        pts += [(px, -py) for px, py in reversed(pts)]
        ca, sa = math.cos(ang), math.sin(ang)
        poly = [(x + px * ca - py * sa, y + px * sa + py * ca) for px, py in pts]
        d.polygon(poly, fill=c)
        da.polygon(poly, fill=255)
        rib = tuple(min(255, int(v * 1.15)) for v in c)
        d.line((x, y, x + ca * ln * 0.92, y + sa * ln * 0.92), fill=rib, width=5)
        edge = tuple(int(v * 0.78) for v in c)
        d.line(poly[:13], fill=edge, width=4)                 # eine Blattkante abgedunkelt -> Plastizität

    c0 = S / 2
    leaves = []
    for k in range(9):                                        # Zweige vom Mittelpunkt nach außen
        a = k / 9 * math.tau + rnd.random() * 0.4
        ln = S * (0.3 + rnd.random() * 0.07)
        bend = (rnd.random() - 0.5) * 0.5
        px, py = c0, c0
        steps = 14
        for i in range(steps):
            t = i / steps
            aa = a + bend * t
            nx, ny = px + math.cos(aa) * ln / steps, py + math.sin(aa) * ln / steps
            d.line((px, py, nx, ny), fill=(74, 58, 36), width=int(16 - 10 * t))
            da.line((px, py, nx, ny), fill=255, width=int(16 - 10 * t))
            for sg in (-1, 1):
                la = aa + sg * (0.7 + rnd.random() * 0.5)
                leaves.append((nx, ny, la, 150 + rnd.random() * 80, t))
            px, py = nx, ny
        leaves.append((px, py, a + bend, 190, 1.0))
    for i in range(230):                                      # Füllung der Mitte
        a, r = rnd.random() * math.tau, rnd.random() ** 0.7 * S * 0.29
        leaves.append((c0 + math.cos(a) * r, c0 + math.sin(a) * r, rnd.random() * math.tau, 140 + rnd.random() * 80, rnd.random()))
    rnd.shuffle(leaves)
    n = len(leaves)
    for i, (x, y, a, ln, t) in enumerate(leaves):             # zuerst dunkle (unten), zuletzt helle (oben)
        pal = dark if i < n * 0.3 else mid if i < n * 0.72 else lite
        one(x, y, a, ln, rnd.choice(pal))
    finish(col, al, 'leaf.png', (46, 78, 32))


fir()
leaf()
src = os.path.join(D, '..', '..', 'raw', 'fir_sapling', 'textures', 'fir_sapling_branches_diff_1k.jpg')
if os.path.exists(src):
    im = Image.open(src).convert('RGB').resize((256, 256), Image.LANCZOS)
    im = Image.eval(im, lambda p: min(255, int(p * 1.35)))     # Rinde etwas aufhellen (liegt im Kronenschatten)
    im.save(os.path.join(D, 'bark.jpg'), quality=88)
    print('bark.jpg')
