"""Verteidigungstürme nach den Konzeptbildern des Nutzers: Teslaturm und Prismaturm.
Aufruf:
  blender -b --factory-startup -P tools/blender_towers.py -- <ausgabeordner> [tesla prism]
Konventionen: +Z oben, Ursprung Mitte unten, Vorderseite (Tor) nach Blender -Y (= Spiel Süden), Grundfläche 2x2 Zellen (8 m).
Materialnamen werden im Spiel ersetzt (assets.js getMaterial): Steel, Alloy (helles Stahlblech, Teslaturm), White, Team (Teamfarbe), Rubber, Hazard, RedLight,
Coil (rotes Kupfer), Plasma (leuchtend blau), Crystal (Prisma). Leerobjekt 'Muzzle' = Austrittspunkt von Blitz bzw. Strahl.
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(HERE, '..', 'assets', 'models')
ONLY = set(argv[1:])
SCALE = 0.85

COLORS = {   # nur für die Vorschau in Blender; im Spiel ersetzt
    'Steel': (0.32, 0.33, 0.34, 0.8, 0.45), 'Alloy': (0.55, 0.57, 0.6, 0.6, 0.4), 'White': (0.7, 0.7, 0.68, 0.2, 0.6), 'Team': (0.7, 0.08, 0.06, 0.2, 0.45),
    'Rubber': (0.03, 0.03, 0.03, 0.0, 0.9), 'Hazard': (0.8, 0.5, 0.02, 0.1, 0.6), 'RedLight': (1.0, 0.1, 0.05, 0.0, 0.3),
    'Coil': (0.45, 0.05, 0.03, 0.6, 0.35), 'Plasma': (0.4, 0.6, 1.0, 0.0, 0.2), 'Crystal': (0.75, 0.88, 1.0, 0.1, 0.05),
}


def material(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bs = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    r, g, b, met, rough = COLORS[name]
    bs.inputs['Base Color'].default_value = (r, g, b, 1)
    bs.inputs['Metallic'].default_value = met
    bs.inputs['Roughness'].default_value = rough
    return m


class Mesh:
    """Sammelt alle Teile eines Modells in einem bmesh, Materialindex je Fläche."""

    def __init__(self):
        self.bm = bmesh.new()
        self.mats = []

    def add(self, verts, faces, mat, smooth=False):
        if mat not in self.mats:
            self.mats.append(mat)
        mi = self.mats.index(mat)
        vs = [self.bm.verts.new(v) for v in verts]
        for f in faces:
            try:
                face = self.bm.faces.new([vs[i] for i in f])
            except ValueError:
                continue
            face.material_index = mi
            face.smooth = smooth

    # ---------------------------------------------------------------- Grundkörper
    def loft(self, rings, mat, smooth=False, caps=True):
        n = len(rings[0])
        verts = [tuple(p) for r in rings for p in r]
        faces = []
        for k in range(len(rings) - 1):
            for i in range(n):
                j = (i + 1) % n
                faces.append([k * n + i, k * n + j, (k + 1) * n + j, (k + 1) * n + i])
        if caps:
            faces.append(list(range(n))[::-1])
            faces.append(list(range((len(rings) - 1) * n, len(rings) * n)))
        self.add(verts, faces, mat, smooth)

    def box(self, c, s, mat, rz=0.0, ry=0.0):
        hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2
        R = Matrix.Rotation(rz, 3, 'Z') @ Matrix.Rotation(ry, 3, 'Y')
        pts = [Vector((x, y, z)) for z in (-hz, hz) for (x, y) in ((-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy))]
        pts = [tuple(R @ p + Vector(c)) for p in pts]
        self.loft([pts[:4], pts[4:]], mat)

    def frustum(self, z0, z1, p0, p1, mat, cx=0.0, cy=0.0):
        """Prisma zwischen zwei Grundrissen gleicher Punktzahl (Listen von (x, y))."""
        self.loft([[(cx + x, cy + y, z0) for x, y in p0], [(cx + x, cy + y, z1) for x, y in p1]], mat)

    def cyl(self, p0, p1, r0, mat, r1=None, seg=16, smooth=True, caps=True):
        r1 = r0 if r1 is None else r1
        a, b = Vector(p0), Vector(p1)
        ax = (b - a).normalized()
        u = ax.orthogonal().normalized()
        v = ax.cross(u)
        rings = []
        for c, r in ((a, r0), (b, r1)):
            rings.append([tuple(c + (u * math.cos(t) + v * math.sin(t)) * r) for t in (i / seg * 2 * math.pi for i in range(seg))])
        self.loft(rings, mat, smooth, caps)

    def beam(self, p0, p1, w, mat, d=None):
        """Vierkantstab von p0 nach p1 (Breite w, Tiefe d)."""
        d = w if d is None else d
        a, b = Vector(p0), Vector(p1)
        ax = (b - a).normalized()
        up = Vector((0, 0, 1)) if abs(ax.z) < 0.95 else Vector((1, 0, 0))
        u = ax.cross(up).normalized()
        v = ax.cross(u).normalized()
        sq = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
        self.loft([[tuple(c + u * (x * w / 2) + v * (y * d / 2)) for x, y in sq] for c in (a, b)], mat)

    def torus(self, z, R, r, mat, seg=28, seg2=10, cx=0.0, cy=0.0):
        rings = []
        for i in range(seg):
            t = i / seg * 2 * math.pi
            rings.append([(cx + (R + r * math.cos(p)) * math.cos(t), cy + (R + r * math.cos(p)) * math.sin(t), z + r * math.sin(p))
                          for p in (j / seg2 * 2 * math.pi for j in range(seg2))])
        rings.append(rings[0])
        n = seg2
        verts = [p for rg in rings[:-1] for p in rg]
        faces = []
        for k in range(seg):
            k2 = (k + 1) % seg
            for i in range(n):
                j = (i + 1) % n
                faces.append([k * n + i, k * n + j, k2 * n + j, k2 * n + i])
        self.add(verts, faces, mat, True)

    def sphere(self, c, r, mat, seg=16, rings=10):
        pts = []
        for k in range(1, rings):
            ph = math.pi * k / rings
            pts.append([(c[0] + r * math.sin(ph) * math.cos(t), c[1] + r * math.sin(ph) * math.sin(t), c[2] + r * math.cos(ph))
                        for t in (i / seg * 2 * math.pi for i in range(seg))])
        self.loft(pts[::-1], mat, True, caps=False)
        n = seg
        top = len(pts) * n
        bot = top + 1
        verts = [p for rg in pts[::-1] for p in rg] + [(c[0], c[1], c[2] + r), (c[0], c[1], c[2] - r)]
        faces = [[(len(pts) - 1) * n + i, (len(pts) - 1) * n + (i + 1) % n, top] for i in range(n)]
        faces += [[(i + 1) % n, i, bot] for i in range(n)]
        self.add(verts, faces, mat, True)

    # ---------------------------------------------------------------- Abschluss
    def finish(self, name, empties):
        bm = self.bm
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bm.normal_update()
        uv = bm.loops.layers.uv.new('UVMap')
        for f in bm.faces:   # Würfelprojektion, 3 m je Texturkachel
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            for l in f.loops:
                p = l.vert.co
                if ax == 2:
                    l[uv].uv = (p.x / 3, p.y / 3)
                elif ax == 1:
                    l[uv].uv = (p.x / 3, p.z / 3)
                else:
                    l[uv].uv = (p.y / 3, p.z / 3)
        bmesh.ops.scale(bm, vec=(SCALE, SCALE, SCALE), verts=bm.verts)
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(material(m))
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        for en, pos in empties.items():
            e = bpy.data.objects.new(en, None)
            e.location = Vector(pos) * SCALE
            bpy.context.scene.collection.objects.link(e)
        print(name, 'Dreiecke', sum(len(p.vertices) - 2 for p in me.polygons))


def octo(h, c=0.32):
    """Quadrat mit gefasten Ecken (halbe Kantenlänge h, Fase c*h)."""
    k = h * (1 - c)
    return [(-k, -h), (k, -h), (h, -k), (h, k), (k, h), (-k, h), (-h, k), (-h, -k)]


def square(hx, hy):
    return [(-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy)]


# ====================================================================== Teslaturm
def m_tesla():
    M = Mesh()
    M.box((0, 0, 0.2), (7.4, 7.4, 0.4), 'Alloy')
    M.frustum(0.4, 3.2, octo(3.3), octo(2.55), 'Alloy')
    # Eckstreben in Teamfarbe
    for sx in (-1, 1):
        for sy in (-1, 1):
            M.frustum(0.4, 2.1, square(0.6, 0.6), square(0.38, 0.38), 'Team', cx=sx * 2.75, cy=sy * 2.75)
            M.box((sx * 2.75, sy * 2.75, 2.15), (0.8, 0.8, 0.12), 'Alloy')
    # Vorderseite: Panzerplatte, Emblem, Lüftung, Leuchten, Warnstreifen
    M.box((0, -2.95, 1.85), (2.7, 0.35, 2.3), 'Alloy')
    M.box((0, -3.15, 2.45), (0.85, 0.06, 0.85), 'Team', ry=math.pi / 4)
    M.box((0, -3.16, 1.05), (1.5, 0.08, 0.95), 'Rubber')
    for x in (-0.45, 0, 0.45):
        M.box((x, -3.18, 1.7), (0.26, 0.08, 0.16), 'RedLight')
    for sx in (-1, 1):
        M.box((sx * 1.75, -3.28, 0.62), (1.1, 0.1, 0.36), 'Hazard')
        M.box((sx * 1.95, -2.8, 1.6), (0.5, 0.25, 2.0), 'Team')
    # Rückseite: drei Kabelrohre, Seiten: Lüftungsgitter
    for x in (-0.55, 0, 0.55):
        M.cyl((x, 3.05, 0.4), (x, 2.55, 3.2), 0.18, 'Coil', seg=10)
    for sx in (-1, 1):
        M.box((sx * 3.0, 0, 1.4), (0.08, 1.6, 1.0), 'Rubber')
    # Plattform mit Geländer und Warnleuchten
    M.box((0, 0, 3.35), (5.7, 5.7, 0.3), 'Alloy')
    h = 2.7
    for z in (3.65, 3.95):
        for s in (-1, 1):
            M.beam((-h, s * h, z), (h, s * h, z), 0.07, 'Team')
            M.beam((s * h, -h, z), (s * h, h, z), 0.07, 'Team')
    for i in range(5):
        t = -h + i * h / 2
        for s in (-1, 1):
            M.cyl((t, s * h, 3.5), (t, s * h, 4.0), 0.04, 'Team', seg=6)
            M.cyl((s * h, t, 3.5), (s * h, t, 4.0), 0.04, 'Team', seg=6)
    for sx in (-1, 1):
        for sy in (-1, 1):
            M.cyl((sx * 2.45, sy * 2.45, 3.5), (sx * 2.45, sy * 2.45, 3.85), 0.16, 'Alloy', seg=10)
            M.cyl((sx * 2.45, sy * 2.45, 3.85), (sx * 2.45, sy * 2.45, 4.25), 0.13, 'RedLight', seg=10)
    # Gittermast: vier Beine, Querriegel, Andreaskreuze
    b0, b1, z0, z1, zm = 2.0, 1.05, 3.5, 9.0, 6.2
    leg = lambda sx, sy, z: (sx * (b0 + (b1 - b0) * (z - z0) / (z1 - z0)), sy * (b0 + (b1 - b0) * (z - z0) / (z1 - z0)), z)
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    for sx, sy in corners:
        M.beam(leg(sx, sy, z0), leg(sx, sy, z1), 0.3, 'Alloy')
    for i in range(4):
        (ax_, ay_), (bx_, by_) = corners[i], corners[(i + 1) % 4]
        for z in (zm, z1 - 0.1):
            M.beam(leg(ax_, ay_, z), leg(bx_, by_, z), 0.2, 'Alloy')
        for za, zb in ((z0 + 0.2, zm), (zm, z1 - 0.1)):
            M.beam(leg(ax_, ay_, za), leg(bx_, by_, zb), 0.14, 'Alloy')
            M.beam(leg(bx_, by_, za), leg(ax_, ay_, zb), 0.14, 'Alloy')
    # Spulenkern mit Stahlbändern, seitliche Schläuche
    M.cyl((0, 0, 3.5), (0, 0, 11.7), 0.55, 'Coil', seg=16)
    for i in range(10):
        z = 3.9 + i * 0.55
        M.cyl((0, 0, z), (0, 0, z + 0.12), 0.63, 'Alloy', seg=16)
    for sx in (-1, 1):
        M.cyl((sx * 2.2, 0.3, 3.5), (sx * 1.35, 0.3, 7.6), 0.16, 'Rubber', seg=8)
        M.cyl((sx * 2.2, 0.3, 3.5), (sx * 2.2, 0.3, 3.0), 0.2, 'Alloy', seg=8)
    # Kopf: Grundplatte, drei Ringe mit leuchtenden Plasmaringen, Mast und Kugel
    M.cyl((0, 0, 8.9), (0, 0, 9.25), 1.6, 'Alloy', seg=20)
    for z, R in ((9.65, 2.05), (10.5, 1.92), (11.3, 1.7)):
        M.torus(z, R, 0.36, 'Alloy')
        M.torus(z + 0.43, R - 0.25, 0.09, 'Plasma', seg=24, seg2=6)
    for i in range(6):   # Stützen zwischen den Ringen
        t = i / 6 * 2 * math.pi
        M.beam((math.cos(t) * 0.5, math.sin(t) * 0.5, 9.25), (math.cos(t) * 1.65, math.sin(t) * 1.65, 11.3), 0.12, 'Alloy')
    M.cyl((0, 0, 11.6), (0, 0, 12.2), 0.24, 'Alloy', seg=10)
    M.sphere((0, 0, 12.75), 0.72, 'Alloy')
    M.finish('Tesla', {'Muzzle': (0, 0, 12.75)})


# ====================================================================== Prismaturm
def m_prism():
    M = Mesh()
    M.box((0, 0, 0.2), (7.4, 7.4, 0.4), 'White')
    M.frustum(0.4, 2.6, octo(3.2, 0.22), octo(2.45, 0.22), 'White')
    # Eckblöcke in Teamfarbe mit Leuchtstreifen, Lüftungsgitter
    for sx in (-1, 1):
        for sy in (-1, 1):
            M.frustum(0.4, 1.95, square(0.8, 0.8), square(0.6, 0.6), 'Team', cx=sx * 2.75, cy=sy * 2.75)
            M.box((sx * 2.75, sy * 2.75 - 0.0, 1.95), (1.0, 1.0, 0.18), 'White')
            M.box((sx * 2.75, sy * 3.42, 1.3), (0.8, 0.06, 0.12), 'Plasma')
            M.box((sx * 2.75, sy * 3.5, 0.65), (0.9, 0.06, 0.3), 'Hazard')
        M.box((sx * 3.2, 0, 1.3), (0.08, 1.8, 1.1), 'Rubber')
    # Vorderseite: Treppe mit Warnstreifen, Leuchtfenster
    for i in range(4):
        M.box((0, -3.25 + i * 0.28, 0.5 + i * 0.22), (1.5, 0.3, 0.22), 'Steel')
    for sx in (-1, 1):
        M.box((sx * 0.95, -2.85, 1.0), (0.3, 1.1, 1.2), 'Hazard')
    M.box((0, -2.55, 2.15), (1.3, 0.12, 0.42), 'Plasma')
    # Schaft (verjüngt), blaue Flossen an den Kanten, Leuchtröhre vorn
    z0, z1 = 2.6, 10.0
    M.frustum(z0, z1, octo(1.75, 0.2), octo(1.05, 0.2), 'White')
    for sx in (-1, 1):
        for sy in (-1, 1):
            M.beam((sx * 1.95, sy * 1.25, z0), (sx * 1.2, sy * 0.75, z1 - 0.6), 0.55, 'Team', 0.3)
    yf = lambda z: -(1.75 - (z - z0) / (z1 - z0) * 0.7) - 0.12
    M.beam((0, yf(3.2) + 0.05, 3.2), (0, yf(9.4) + 0.05, 9.4), 0.7, 'Steel', 0.18)
    M.cyl((0, yf(3.4), 3.4), (0, yf(6.0), 6.0), 0.17, 'Plasma', seg=10)
    M.cyl((0, yf(6.4), 6.4), (0, yf(9.1), 9.1), 0.17, 'Plasma', seg=10)
    M.cyl((0, yf(6.2) - 0.05, 6.0), (0, yf(6.2) - 0.05, 6.4), 0.24, 'Steel', seg=10)
    # Rohrleitung an der Westseite
    M.cyl((-1.9, -0.4, 2.6), (-1.35, -0.3, 7.0), 0.13, 'Steel', seg=8)
    # Kopf mit blauen Schrägplatten
    M.frustum(z1, 10.9, octo(1.15, 0.2), octo(1.75, 0.2), 'White')
    M.frustum(10.9, 11.25, octo(1.75, 0.2), octo(1.6, 0.2), 'Steel')
    for t in range(4):
        a = t * math.pi / 2
        c, s = math.cos(a), math.sin(a)
        M.box((c * 1.55, s * 1.55, 10.45), (0.35 if abs(c) > 0.5 else 1.8, 0.35 if abs(s) > 0.5 else 1.8, 0.85), 'Team')
    # Klauen um den Kristall (unten weiß, Spitzen in Teamfarbe), innen Leuchtstreifen
    for t in range(4):
        a = math.pi / 4 + t * math.pi / 2
        c, s = math.cos(a), math.sin(a)
        p0, p1, p2 = (c * 0.75, s * 0.75, 11.2), (c * 1.65, s * 1.65, 12.4), (c * 1.35, s * 1.35, 13.4)
        M.beam(p0, p1, 0.42, 'White', 0.32)
        M.beam(p1, p2, 0.42, 'Team', 0.34)
        M.beam((c * 0.95, s * 0.95, 11.5), (c * 1.42, s * 1.42, 12.35), 0.1, 'Plasma')
    M.cyl((0, 0, 11.25), (0, 0, 11.6), 0.55, 'Steel', seg=12)
    # Kristall: langgezogener Doppelkegel, sechseckig
    rings = []
    for z, r in ((11.55, 0.1), (12.3, 0.62), (12.75, 0.66), (14.4, 0.04)):
        rings.append([(r * math.cos(i / 6 * 2 * math.pi), r * math.sin(i / 6 * 2 * math.pi), z) for i in range(6)])
    M.loft(rings, 'Crystal')
    # Antennen an den vorderen und hinteren Ecken
    for sx in (-1, 1):
        for sy in (-1, 1):
            M.cyl((sx * 3.25, sy * 2.2, 0.4), (sx * 3.25, sy * 2.2, 3.4), 0.05, 'Steel', seg=6)
            M.cyl((sx * 3.25, sy * 2.2, 1.9), (sx * 3.25, sy * 2.2, 2.2), 0.11, 'Hazard', seg=8)
            M.sphere((sx * 3.25, sy * 2.2, 3.45), 0.11, 'Plasma', seg=8, rings=5)
    M.finish('Prism', {'Muzzle': (0, 0, 12.9)})


MODELS = {'tesla': m_tesla, 'prism': m_prism}

for name, fn in MODELS.items():
    if ONLY and name not in ONLY:
        continue
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me)
    fn()
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False, export_apply=True, export_yup=True,
                              export_materials='EXPORT', export_cameras=False, export_lights=False)
    print('EXPORT', path)
