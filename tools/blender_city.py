"""Stadthäuser der Winterkarte: Wohnhäuser, Wohnblöcke, Hochhäuser, Gewerbe, Industrie, dazu Laterne und Auto.
blender -b --factory-startup -P tools/blender_city.py -- <zielordner> [name ...]
Vorher: python -I tools/make_city_textures.py  (assets/textures/city/*.jpg)

Jedes Haus: Wände mit Fassadentextur (4 Achsen x 3 m je Kachel; Erdgeschoss = unteres Viertel, Obergeschosse werden
dreigeschossweise gestapelt), Dachschnee als eigene kachelnde Textur, Anbauteile (Attika, Lüfter, Kamine, Balkone,
Vordächer) über die Farbfelder von trim.jpg. Materialien: City_<stil>, City_snow, City_trim, RedLight.
Blender: +Y = Norden, Z oben, Ursprung = Mitte der Grundfläche am Boden. Grundfläche in Zellen (4 m) steht in FOOT
(muss zu CITY in js/terrain.js passen).
"""
import bpy, bmesh, sys, os, math, random
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = argv[0] if argv else os.path.join(HERE, '..', 'assets', 'models')
ONLY = set(argv[1:])
TEX = os.path.join(HERE, '..', 'assets', 'textures', 'city')
os.makedirs(OUT, exist_ok=True)
MATS = {}
FH = 3.0                    # Geschosshöhe
SWATCH = {'concrete': 0, 'dark': 1, 'metal': 2, 'glass': 3, 'brick': 4, 'red': 5, 'green': 6, 'wood': 7,
          'asphalt': 8, 'yellow': 9, 'white': 10, 'zinc': 11, 'car_red': 12, 'car_blue': 13, 'car_grey': 14, 'tyre': 15}


def material(name):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    if name.startswith('City_'):
        nt = m.node_tree
        b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = bpy.data.images.load(os.path.join(TEX, name[5:] + '.jpg'))
        nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
        b.inputs['Roughness'].default_value = 0.85
    MATS[name] = m
    return m


class House:
    def __init__(self, style):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.mats = []
        self.style = 'City_' + style

    def face(self, pts, uvs, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        try:
            f = self.bm.faces.new([self.bm.verts.new(p) for p in pts])
        except ValueError:
            return
        f.material_index = self.mats.index(mat)
        for l, t in zip(f.loops, uvs):
            l[self.uv].uv = t

    # ---- Farbfeld-Teile
    def sw(self, name):
        i = SWATCH[name]
        return ((i % 4 + 0.5) / 4, 1 - (i // 4 + 0.5) / 4)

    def quad(self, pts, name):
        if name == 'snow':
            self.face(pts, [(p[0] / 7.0 + p[2] * 0.13, p[1] / 7.0 + p[2] * 0.11) for p in pts], 'City_snow')
        else:
            self.face(pts, [self.sw(name)] * len(pts), 'City_trim')

    def box(self, x0, y0, x1, y1, z0, z1, side='concrete', top='snow', bottom=False):
        a, b, c, d = (x0, y0), (x1, y0), (x1, y1), (x0, y1)
        for p, q in ((a, b), (b, c), (c, d), (d, a)):
            self.quad([(p[0], p[1], z0), (q[0], q[1], z0), (q[0], q[1], z1), (p[0], p[1], z1)], side)
        self.quad([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], top)
        if bottom:
            self.quad([(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)], side)

    def cyl(self, x, y, r, z0, z1, n=10, side='metal', top='snow', r1=None):
        r1 = r if r1 is None else r1
        ring = lambda rr, z: [(x + math.cos(i / n * math.tau) * rr, y + math.sin(i / n * math.tau) * rr, z) for i in range(n)]
        a, b = ring(r, z0), ring(r1, z1)
        for i in range(n):
            j = (i + 1) % n
            self.quad([a[i], a[j], b[j], b[i]], side)
        self.quad(b, top)

    # ---- Wände mit Fassade
    def walls(self, x0, y0, x1, y1, floors, z0=0.0, fh=FH, sides='SENW', ground=True):
        """Vier Wände; Achsen werden auf ganze Zahl gestreckt. Gibt die Traufhöhe zurück."""
        corners = {'S': ((x0, y0), (x1, y0)), 'E': ((x1, y0), (x1, y1)), 'N': ((x1, y1), (x0, y1)), 'W': ((x0, y1), (x0, y0))}
        for s in sides:
            (ax, ay), (bx, by) = corners[s]
            ln = math.hypot(bx - ax, by - ay)
            bays = max(1, round(ln / 3.0))
            u1 = bays / 4.0
            off = (hash(s) % 4) / 4.0                       # jede Seite beginnt an einer anderen Achse
            z = z0
            fl = 0
            if ground:
                self.face([(ax, ay, z), (bx, by, z), (bx, by, z + fh), (ax, ay, z + fh)], [(off, 0), (off + u1, 0), (off + u1, 0.25), (off, 0.25)], self.style)
                z += fh
                fl = 1
            while fl < floors:
                n = min(3, floors - fl)
                v1 = 0.25 + 0.25 * n
                self.face([(ax, ay, z), (bx, by, z), (bx, by, z + fh * n), (ax, ay, z + fh * n)], [(off, 0.25), (off + u1, 0.25), (off + u1, v1), (off, v1)], self.style)
                z += fh * n
                fl += n
                off += 0.25
        return z0 + floors * fh

    # ---- Dächer
    def hip(self, x0, y0, x1, y1, z, pitch=0.42, over=0.45):
        """Walmdach mit Schnee; Dachüberstand, dunkle Traufkante."""
        x0, y0, x1, y1 = x0 - over, y0 - over, x1 + over, y1 + over
        w, d = x1 - x0, y1 - y0
        h = min(w, d) / 2 * pitch * 2
        if w >= d:
            r0, r1 = (x0 + d / 2, (y0 + y1) / 2, z + h), (x1 - d / 2, (y0 + y1) / 2, z + h)
            self.quad([(x0, y0, z), (x1, y0, z), r1, r0], 'snow')
            self.quad([(x1, y1, z), (x0, y1, z), r0, r1], 'snow')
            self.quad([(x1, y0, z), (x1, y1, z), r1], 'snow')
            self.quad([(x0, y1, z), (x0, y0, z), r0], 'snow')
        else:
            r0, r1 = ((x0 + x1) / 2, y0 + w / 2, z + h), ((x0 + x1) / 2, y1 - w / 2, z + h)
            self.quad([(x1, y0, z), (x1, y1, z), r1, r0], 'snow')
            self.quad([(x0, y1, z), (x0, y0, z), r0, r1], 'snow')
            self.quad([(x0, y0, z), (x1, y0, z), r0], 'snow')
            self.quad([(x1, y1, z), (x0, y1, z), r1], 'snow')
        self.box(x0, y0, x1, y1, z - 0.22, z, 'dark', 'dark', True)        # Traufe
        return z + h

    def flat(self, x0, y0, x1, y1, z, par=0.7, t=0.35):
        """Flachdach: Attika ringsum, Schneedecke innen."""
        self.box(x0, y0, x1, y0 + t, z, z + par, 'concrete')
        self.box(x0, y1 - t, x1, y1, z, z + par, 'concrete')
        self.box(x0, y0 + t, x0 + t, y1 - t, z, z + par, 'concrete')
        self.box(x1 - t, y0 + t, x1, y1 - t, z, z + par, 'concrete')
        self.quad([(x0 + t, y0 + t, z + 0.3), (x1 - t, y0 + t, z + 0.3), (x1 - t, y1 - t, z + 0.3), (x0 + t, y1 - t, z + 0.3)], 'snow')
        return z + par

    def chimney(self, x, y, z0, z1, s=0.45):
        self.box(x - s, y - s, x + s, y + s, z0, z1, 'brick', 'dark')
        self.box(x - s - 0.08, y - s - 0.08, x + s + 0.08, y + s + 0.08, z1, z1 + 0.12, 'concrete', 'snow')

    def build(self, name):
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(material(m))
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def roof_units(H, x0, y0, x1, y1, z, seed, n=3):
    """Lüftungsgeräte und Treppenhauskopf auf dem Flachdach."""
    rnd = random.Random(seed)
    for k in range(n):
        w, d, h = 1.4 + rnd.random() * 1.6, 1.2 + rnd.random() * 1.2, 0.9 + rnd.random() * 0.8
        x = x0 + 1.5 + rnd.random() * max(0.1, x1 - x0 - 3 - w)
        y = y0 + 1.5 + rnd.random() * max(0.1, y1 - y0 - 3 - d)
        H.box(x, y, x + w, y + d, z + 0.3, z + 0.3 + h, 'metal')
        if rnd.random() < 0.5:
            H.cyl(x + w / 2, y + d / 2, 0.35, z + 0.3 + h, z + 0.5 + h, 8, 'dark', 'dark')


# ------------------------------------------------------------------ Wohnhäuser
def house(style, w, d, floors, seed, garage=False):
    rnd = random.Random(seed)
    H = House(style)
    x0, y0, x1, y1 = -w / 2, -d / 2, w / 2, d / 2
    z = H.walls(x0, y0, x1, y1, floors)
    top = H.hip(x0, y0, x1, y1, z)
    H.chimney(x0 + w * (0.25 + rnd.random() * 0.15), 0.6, z + 0.6, top + 0.7)
    if floors > 2:
        H.chimney(x1 - w * 0.25, -0.4, z + 0.6, top + 0.5)
    if garage:   # Garage als Anbau mit Schneedach
        H.box(x1, y0 + 0.5, x1 + 3.2, y0 + 6.0, 0, 2.6, 'concrete')
        H.quad([(x1 + 0.3, y0 + 0.48, 0.1), (x1 + 2.9, y0 + 0.48, 0.1), (x1 + 2.9, y0 + 0.48, 2.2), (x1 + 0.3, y0 + 0.48, 2.2)], 'zinc')
    H.box(-1.2, y0 - 1.0, 1.2, y0, 0, 0.3, 'concrete')                       # Eingangsstufe
    return H.build('House')


def rowhouse(seed):
    H = House('res_brick')
    w, d = 22.0, 9.0
    x0, y0, x1, y1 = -w / 2, -d / 2, w / 2, d / 2
    z = H.walls(x0, y0, x1, y1, 3)
    top = H.hip(x0, y0, x1, y1, z, 0.5)
    for k in range(4):
        H.chimney(x0 + 2.8 + k * 5.5, 0.5, z + 0.8, top + 0.6)
    for k in range(4):                                                        # Gauben
        x = x0 + 2.75 + k * 5.5
        H.box(x - 0.9, y0 + 0.2, x + 0.9, y0 + 2.2, z, z + 1.5, 'white')
    return H.build('House')


# ------------------------------------------------------------------ Wohnblock / Wohnturm
def apartment(seed):
    H = House('panel')
    w, d, fl = 26.0, 11.0, 6
    x0, y0, x1, y1 = -w / 2, -d / 2, w / 2, d / 2
    z = H.walls(x0, y0, x1, y1, fl)
    z = H.flat(x0, y0, x1, y1, z)
    roof_units(H, x0, y0, x1, y1, z - 0.7, seed, 2)
    for xs in (-6.5, 6.5):                                                    # Treppenhausköpfe
        H.box(xs - 1.8, 0.5, xs + 1.8, 4.0, z - 0.4, z + 2.0, 'concrete')
    for f in range(1, fl):                                                    # Balkone an der Südseite
        for k in range(4):
            x = x0 + 2.0 + k * 6.5
            H.box(x, y0 - 1.3, x + 3.0, y0, f * FH - 0.15, f * FH + 0.95, 'zinc', 'snow', True)
    for xs in (-6.5, 6.5):
        H.box(xs - 2.0, y0 - 1.6, xs + 2.0, y0, 2.7, 2.95, 'concrete', 'snow', True)   # Vordach
    return H.build('House')


def apartment2(seed):
    H = House('res_cream')
    w, d, fl = 18.0, 11.5, 5
    x0, y0, x1, y1 = -w / 2, -d / 2, w / 2, d / 2
    z = H.walls(x0, y0, x1, y1, fl)
    top = H.hip(x0, y0, x1, y1, z, 0.34)
    H.chimney(-4, 0.5, z + 0.5, top + 0.6)
    H.chimney(4, 0.5, z + 0.5, top + 0.6)
    for f in range(1, fl):
        for x in (-6.0, 3.0):
            H.box(x, y0 - 1.2, x + 3.0, y0, f * FH - 0.15, f * FH + 0.95, 'dark', 'snow', True)
    return H.build('House')


def tower_res(seed):
    H = House('tower_res')
    w, d, fl = 15.0, 15.0, 11
    x0, y0, x1, y1 = -w / 2, -d / 2, w / 2, d / 2
    z = H.walls(x0, y0, x1, y1, fl)
    z = H.flat(x0, y0, x1, y1, z)
    H.box(-3.0, -2.5, 3.0, 2.5, z - 0.4, z + 2.6, 'concrete')                # Aufzugskopf
    H.cyl(4.5, 4.0, 1.1, z - 0.4, z + 1.8, 10, 'zinc')                       # Wassertank
    roof_units(H, x0, y0, x1, y1, z - 0.7, seed, 2)
    H.cyl(-2.0, 0, 0.06, z + 2.6, z + 7.0, 5, 'dark', 'dark')                 # Antenne
    for f in range(1, fl):                                                    # Loggien an zwei Ecken
        for sx in (-1, 1):
            xa = x0 - 0.2 if sx < 0 else x1 - 2.8
            H.box(xa, y0 - 1.1, xa + 3.0, y0, f * FH - 0.15, f * FH + 0.9, 'concrete', 'snow', True)
    return H.build('House')


def tower_office(seed):
    H = House('office_glass')
    w, d, fl, fh = 15.0, 15.0, 12, 3.2
    x0, y0, x1, y1 = -w / 2, -d / 2, w / 2, d / 2
    z = H.walls(x0, y0, x1, y1, fl, fh=fh)
    H.box(x0 - 0.25, y0 - 0.25, x1 + 0.25, y1 + 0.25, z, z + 0.9, 'metal')   # Kranz
    z += 0.9
    H.box(x0 + 2.5, y0 + 2.5, x1 - 2.5, y1 - 2.5, z, z + 2.4, 'dark')        # Technikgeschoss
    H.cyl(0, 0, 0.12, z + 2.4, z + 9.0, 6, 'dark', 'dark')
    H.box(-0.2, -0.2, 0.2, 0.2, z + 9.0, z + 9.4, 'dark', 'dark')
    H.face([(-0.25, -0.25, z + 9.4), (0.25, -0.25, z + 9.4), (0.25, 0.25, z + 9.4), (-0.25, 0.25, z + 9.4)], [(0, 0)] * 4, 'RedLight')
    for s in (-1, 1):
        H.face([(s * 0.26, -0.25, z + 9.0), (s * 0.26, 0.25, z + 9.0), (s * 0.26, 0.25, z + 9.4), (s * 0.26, -0.25, z + 9.4)], [(0, 0)] * 4, 'RedLight')
        H.face([(-0.25, s * 0.26, z + 9.0), (0.25, s * 0.26, z + 9.0), (0.25, s * 0.26, z + 9.4), (-0.25, s * 0.26, z + 9.4)], [(0, 0)] * 4, 'RedLight')
    H.box(-4.0, y0 - 2.2, 4.0, y0, 3.3, 3.6, 'metal', 'snow', True)          # Vordach am Eingang
    return H.build('House')


# ------------------------------------------------------------------ Gewerbe
def office(seed):
    H = House('office_band')
    w, d, fl = 22.0, 13.0, 5
    x0, y0, x1, y1 = -w / 2, -d / 2, w / 2, d / 2
    z = H.walls(x0, y0, x1, y1, fl)
    z = H.flat(x0, y0, x1, y1, z)
    roof_units(H, x0, y0, x1, y1, z - 0.7, seed, 4)
    H.box(-2.2, 1.0, 2.2, 5.0, z - 0.4, z + 2.2, 'concrete')
    H.box(-3.0, y0 - 1.8, 3.0, y0, 2.8, 3.05, 'metal', 'snow', True)
    return H.build('House')


def market(seed):
    """Flacher Supermarkt mit Ladenfront, Schildkasten und Lüftern."""
    H = House('shops')
    w, d = 26.0, 14.0
    x0, y0, x1, y1 = -w / 2, -d / 2, w / 2, d / 2
    z = H.walls(x0, y0, x1, y1, 1, fh=4.2)
    z = H.flat(x0, y0, x1, y1, z, 0.9)
    roof_units(H, x0, y0, x1, y1, z - 0.9, seed, 5)
    H.box(-6.0, y0 - 0.5, 6.0, y0 + 0.3, 4.2, 6.0, 'red', 'snow', True)      # Schildkasten über dem Eingang
    H.box(-5.0, y0 - 0.56, 5.0, y0 - 0.5, 4.7, 5.5, 'white', 'white', True)
    H.box(x0, y0 - 2.4, x1, y0, 3.5, 3.75, 'metal', 'snow', True)            # Vordach über die ganze Front
    return H.build('House')


def shops_row(seed):
    H = House('shops')
    w, d = 18.0, 9.0
    x0, y0, x1, y1 = -w / 2, -d / 2, w / 2, d / 2
    z = H.walls(x0, y0, x1, y1, 2)
    H.hip(x0, y0, x1, y1, z, 0.3)
    for k, c in enumerate(('red', 'green', 'red')):                           # Markisen
        x = x0 + 1.0 + k * 6.0
        H.quad([(x, y0 - 1.5, 2.5), (x + 4.5, y0 - 1.5, 2.5), (x + 4.5, y0, 3.0), (x, y0, 3.0)], c)
        H.quad([(x, y0 - 1.52, 2.5), (x + 4.5, y0 - 1.52, 2.5), (x + 4.5, y0 - 0.9, 2.72), (x, y0 - 0.9, 2.72)], 'snow')
    return H.build('House')


# ------------------------------------------------------------------ Industrie
def factory(seed):
    """Backsteinfabrik mit Sheddach, Schornstein und Anbau."""
    H = House('ind_brick')
    w, d = 24.0, 15.0
    x0, y0, x1, y1 = -w / 2 - 1.0, -d / 2 + 1.0, w / 2 - 1.0, d / 2 + 1.0
    z = H.walls(x0, y0, x1, y1, 3)
    n = 4
    tw = (x1 - x0) / n
    for k in range(n):                                                        # Sheddach: Schneeschräge + Glasband nach Osten
        xa, xb = x0 + k * tw, x0 + (k + 1) * tw
        H.quad([(xa, y0, z), (xb, y0, z + 2.4), (xb, y1, z + 2.4), (xa, y1, z)], 'snow')
        H.quad([(xb, y0, z), (xb, y1, z), (xb, y1, z + 2.4), (xb, y0, z + 2.4)], 'glass')
        H.quad([(xa, y0, z), (xb, y0, z), (xb, y0, z + 2.4)], 'brick')
        H.quad([(xb, y1, z), (xa, y1, z), (xb, y1, z + 2.4)], 'brick')
    cx, cy = x1 + 0.2, y1 - 2.5                                               # Schornstein
    H.cyl(cx, cy, 1.25, 0, 20.0, 12, 'brick', 'dark', 0.8)
    H.cyl(cx, cy, 0.9, 20.0, 20.5, 12, 'concrete', 'dark', 0.9)
    H.box(x0 + 2.0, y0 - 4.0, x0 + 10.0, y0, 0, 4.0, 'brick')                 # Pförtner/Anbau
    return H.build('House')


def hall(seed):
    """Blechhalle mit flachem Satteldach und Lüfterhauben."""
    H = House('ind_metal')
    w, d = 22.0, 14.0
    x0, y0, x1, y1 = -w / 2, -d / 2, w / 2, d / 2
    z = H.walls(x0, y0, x1, y1, 2, fh=3.4)
    r = z + 1.8
    H.quad([(x0, y0, z), (x1, y0, z), (x1, 0, r), (x0, 0, r)], 'snow')
    H.quad([(x1, y1, z), (x0, y1, z), (x0, 0, r), (x1, 0, r)], 'snow')
    H.quad([(x1, y0, z), (x1, y1, z), (x1, 0, r)], 'zinc')
    H.quad([(x0, y1, z), (x0, y0, z), (x0, 0, r)], 'zinc')
    for k in range(3):
        H.cyl(x0 + 4.0 + k * 7.0, 0, 0.6, r - 0.2, r + 0.7, 8, 'metal')
    H.box(x1 - 6.0, y0 - 3.0, x1 - 1.0, y0, 0, 1.1, 'concrete')               # Laderampe
    return H.build('House')


def warehouse(seed):
    """Lagerhaus mit Tonnendach und zwei Silos."""
    H = House('ind_green')
    w, d = 15.0, 13.0
    x0, y0, x1, y1 = -11.0, -d / 2, -11.0 + w, d / 2
    z = H.walls(x0, y0, x1, y1, 2, fh=3.2)
    prof = [(0.0, 0.0), (0.2, 1.5), (0.5, 2.1), (0.8, 1.5), (1.0, 0.0)]
    for (ta, ha), (tb, hb) in zip(prof, prof[1:]):
        ya, yb = y0 + (y1 - y0) * ta, y0 + (y1 - y0) * tb
        H.quad([(x0, ya, z + ha), (x1, ya, z + ha), (x1, yb, z + hb), (x0, yb, z + hb)], 'snow')
    for xx, nx in ((x0, -1), (x1, 1)):
        pts = [(xx, y0 + (y1 - y0) * t, z + h) for t, h in prof]
        H.quad(pts if nx > 0 else pts[::-1], 'zinc')
    for k in range(2):                                                        # Silos
        sx = 7.0
        sy = -3.2 + k * 6.4
        H.cyl(sx, sy, 2.6, 0, 10.0, 14, 'zinc', 'snow')
        H.cyl(sx, sy, 2.6, 10.0, 11.2, 14, 'snow', 'snow', 0.5)
    H.box(5.0, -0.4, 9.0, 0.4, 10.6, 10.9, 'dark', 'snow', True)              # Laufsteg
    return H.build('House')


# ------------------------------------------------------------------ Straßenmöbel
def lamp():
    H = House('trim')
    H.cyl(0, 0, 0.09, 0, 6.2, 6, 'dark', 'dark')
    H.box(-0.08, -1.5, 0.08, 0.1, 6.1, 6.25, 'dark', 'dark', True)
    H.box(-0.2, -1.75, 0.2, -1.2, 6.0, 6.14, 'dark', 'snow')
    H.face([(-0.16, -1.2, 5.99), (0.16, -1.2, 5.99), (0.16, -1.72, 5.99), (-0.16, -1.72, 5.99)], [(0, 0)] * 4, 'Light')
    return H.build('Lamp')


def car(col='car_red'):
    """Geparktes Auto mit Schneehaube."""
    H = House('trim')
    H.box(-2.1, -0.85, 2.1, 0.85, 0.35, 0.95, col, col, True)                # Karosserie
    H.box(-1.0, -0.78, 1.2, 0.78, 0.95, 1.5, 'glass', 'snow')                 # Kabine mit Schneehaube
    H.quad([(-2.05, -0.8, 0.96), (-1.0, -0.8, 0.96), (-1.0, 0.8, 0.96), (-2.05, 0.8, 0.96)], 'snow')
    H.quad([(1.2, -0.8, 0.96), (2.05, -0.8, 0.96), (2.05, 0.8, 0.96), (1.2, 0.8, 0.96)], 'snow')
    for x in (-1.35, 1.35):
        for y in (-0.87, 0.87):
            H.box(x - 0.36, y - 0.1, x + 0.36, y + 0.1, 0.0, 0.7, 'tyre', 'tyre')
    return H.build('Car')


MODELS = {
    'c_house1': lambda: house('res_brick', 10.0, 9.0, 2, 1), 'c_house2': lambda: house('res_cream', 9.0, 8.0, 2, 2, True),
    'c_house3': lambda: house('res_yellow', 10.5, 9.0, 3, 3), 'c_rowhouse': lambda: rowhouse(4),
    'c_apartment': lambda: apartment(5), 'c_apartment2': lambda: apartment2(6),
    'c_tower_res': lambda: tower_res(7), 'c_tower_office': lambda: tower_office(8),
    'c_office': lambda: office(9), 'c_market': lambda: market(10), 'c_shops': lambda: shops_row(11),
    'c_factory': lambda: factory(12), 'c_hall': lambda: hall(13), 'c_warehouse': lambda: warehouse(14),
    'c_lamp': lamp, 'c_car1': lambda: car('car_red'), 'c_car2': lambda: car('car_blue'), 'c_car3': lambda: car('car_grey'),
}

for name, fn in MODELS.items():
    if ONLY and name not in ONLY:
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()
    ob = fn()
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name + '.glb'), export_format='GLB', export_apply=True, export_yup=True,
                              export_cameras=False, export_lights=False, export_image_format='JPEG', export_jpeg_quality=88)
    print('CITY', name, tris, 'Dreiecke')
print('FERTIG')
