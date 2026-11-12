"""Erzeugt alle Einheiten- und Gebäudemodelle für Sturmkommando prozedural in Blender.
Aufruf:
  blender -b --factory-startup -P tools/blender_models.py -- <ausgabeordner> [modellname ...]
Konventionen (Blender): +X = vorne, +Z = oben, Ursprung = Mitte am Boden, 1 Einheit = 1 m.
Materialnamen werden im Spiel auf PBR-Texturen gemappt (Paint = Teamfarbe, Concrete, Steel ...).
Knoten mit Namen Turret/Gun/Rotor/... werden im Spiel animiert; Empties (Muzzle, FX_*, Exit, Dock)
markieren Effekt- und Logikpunkte.
"""
import bpy, bmesh, math, os, sys, random
from mathutils import Vector, Matrix, Euler

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.path.dirname(__file__), '..', 'assets', 'models')
ONLY = set(argv[1:])
os.makedirs(OUT, exist_ok=True)

# ------------------------------------------------------------------ Materialien
MATDEF = {
    'Paint':    dict(c=(0.42, 0.42, 0.40), m=0.35, r=0.55),
    'Steel':    dict(c=(0.05, 0.055, 0.06), m=0.85, r=0.42),
    'Rubber':   dict(c=(0.025, 0.025, 0.025), m=0.0, r=0.92),
    'Glass':    dict(c=(0.015, 0.025, 0.035), m=0.3, r=0.06),
    'Concrete': dict(c=(0.48, 0.47, 0.44), m=0.0, r=0.92),
    'Roof':     dict(c=(0.30, 0.32, 0.33), m=0.6, r=0.5),
    'Pad':      dict(c=(0.36, 0.36, 0.35), m=0.0, r=0.9),
    'Light':    dict(c=(1.0, 0.9, 0.7), m=0.0, r=0.3, e=(1.0, 0.85, 0.6)),
    'RedLight': dict(c=(1.0, 0.1, 0.05), m=0.0, r=0.3, e=(1.0, 0.08, 0.03)),
    'Team':     dict(c=(0.8, 0.1, 0.1), m=0.2, r=0.45),
    'White':    dict(c=(0.72, 0.72, 0.70), m=0.2, r=0.45),
    'Hazard':   dict(c=(0.85, 0.6, 0.04), m=0.1, r=0.6),
    'Marking':  dict(c=(0.85, 0.85, 0.80), m=0.0, r=0.75),
    'Ore':      dict(c=(1.0, 0.72, 0.25), m=1.0, r=0.28),
    'Rock':     dict(c=(0.16, 0.14, 0.12), m=0.0, r=0.95),
    'Cloth':    dict(c=(0.42, 0.38, 0.28), m=0.0, r=1.0),
    'Leaves':   dict(c=(0.10, 0.17, 0.05), m=0.0, r=0.85),
    'Needles':  dict(c=(0.04, 0.10, 0.05), m=0.0, r=0.9),
    'Bark':     dict(c=(0.12, 0.09, 0.07), m=0.0, r=0.95),
}
MATS = {}


def material(name):
    if name in MATS:
        return MATS[name]
    d = MATDEF[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*d['c'], 1)
    b.inputs['Metallic'].default_value = d['m']
    b.inputs['Roughness'].default_value = d['r']
    if 'e' in d:
        b.inputs['Emission Color'].default_value = (*d['e'], 1)
        b.inputs['Emission Strength'].default_value = 4.0
    MATS[name] = m
    return m


# ------------------------------------------------------------------ Geometrie-Grundbausteine
def mk(verts, faces, smooth=()):
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in verts]
    for f in faces:
        try:
            bm.faces.new([vs[i] for i in f])
        except ValueError:
            pass
    bm.faces.ensure_lookup_table()
    for i in smooth:
        if i < len(bm.faces):
            bm.faces[i].smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def loft(rings, cap0=True, cap1=True, wrap=False, smooth=False):
    """rings: Liste gleich langer Punktlisten (x,y,z). Seitenflächen + optionale Deckel."""
    n = len(rings[0])
    verts = [p for r in rings for p in r]
    faces, sm = [], []
    R = len(rings) if wrap else len(rings) - 1
    for r in range(R):
        r2 = (r + 1) % len(rings)
        for i in range(n):
            faces.append([r * n + i, r * n + (i + 1) % n, r2 * n + (i + 1) % n, r2 * n + i])
            if smooth:
                sm.append(len(faces) - 1)
    if cap0 and not wrap:
        faces.append(list(range(n))[::-1])
    if cap1 and not wrap:
        last = (len(rings) - 1) * n
        faces.append(list(range(last, last + n)))
    return mk(verts, faces, sm)


def xf(bm, loc=(0, 0, 0), rot=(0, 0, 0), scale=None):
    M = Matrix.Translation(loc) @ Euler(rot).to_matrix().to_4x4()
    if scale:
        M = M @ Matrix.Diagonal((*scale, 1))
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def box(sx, sy, sz, loc=(0, 0, 0), rot=(0, 0, 0)):
    x, y, z = sx / 2, sy / 2, sz / 2
    r0 = [(-x, -y, -z), (x, -y, -z), (x, y, -z), (-x, y, -z)]
    r1 = [(-x, -y, z), (x, -y, z), (x, y, z), (-x, y, z)]
    return xf(loft([r0, r1]), loc, rot)


def circle(r, n, z=0.0, cx=0.0, cy=0.0, sx=1.0, sy=1.0, a0=0.0):
    return [(cx + math.cos(a0 + i / n * math.tau) * r * sx, cy + math.sin(a0 + i / n * math.tau) * r * sy, z) for i in range(n)]


def cyl(r, h, loc=(0, 0, 0), axis='Z', n=16, r2=None, rot=None):
    """Zylinder/Kegelstumpf entlang Achse, zentriert in loc."""
    bm = loft([circle(r, n, -h / 2), circle(r if r2 is None else r2, n, h / 2)], smooth=True)
    R = {'Z': (0, 0, 0), 'X': (0, math.pi / 2, 0), 'Y': (math.pi / 2, 0, 0)}[axis]
    return xf(bm, loc, rot or R)


def prism_xz(profile, y0, y1):
    """Seitenprofil (x,z) entlang Y extrudiert."""
    return loft([[(x, y0, z) for x, z in profile], [(x, y1, z) for x, z in profile]])


def prism_yz(profile, x0, x1):
    return loft([[(x0, y, z) for y, z in profile], [(x1, y, z) for y, z in profile]])


def taper(poly, z0, z1, s=1.0, dx=0.0, dy=0.0, sy=None):
    """Grundriss (x,y) von z0 nach z1, Deckel skaliert um s (um Schwerpunkt)."""
    cx = sum(p[0] for p in poly) / len(poly)
    cy = sum(p[1] for p in poly) / len(poly)
    sy = s if sy is None else sy
    top = [(cx + (x - cx) * s + dx, cy + (y - cy) * sy + dy, z1) for x, y in poly]
    return loft([[(x, y, z0) for x, y in poly], top])


def lathe(profile, n=24, wrap=False, loc=(0, 0, 0), smooth=True):
    """Rotationskörper aus (r,z)-Profil."""
    rings = [circle(max(r, 1e-4), n, z) for r, z in profile]
    bm = loft(rings, cap0=profile[0][0] > 0 and not wrap, cap1=profile[-1][0] > 0 and not wrap, wrap=wrap, smooth=smooth)
    return xf(bm, loc)


def capsule_xz(x0, x1, z, r, n=8):
    pts = []
    for i in range(n + 1):
        a = -math.pi / 2 + i / n * math.pi
        pts.append((x1 + math.cos(a) * r, z + math.sin(a) * r))
    for i in range(n + 1):
        a = math.pi / 2 + i / n * math.pi
        pts.append((x0 + math.cos(a) * r, z + math.sin(a) * r))
    return pts


def rock(r, loc, seed, sx=1, sy=1, sz=0.7, sub=2, smooth=False, jitter=0.35):
    rnd = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
    for v in bm.verts:
        n = v.co.normalized()
        v.co += n * r * (rnd.random() - 0.5) * jitter
    for f in bm.faces:
        f.smooth = smooth
    xf(bm, loc, (rnd.random(), rnd.random(), rnd.random() * 6), (sx, sy, sz))
    return bm


# ------------------------------------------------------------------ Knoten (Mesh-Objekt aus vielen Teilen)
class Node:
    def __init__(self, name, pivot=(0, 0, 0), parent=None, uvscale=3.0):
        self.name, self.pivot, self.parent, self.uvscale = name, Vector(pivot), parent, uvscale
        self.bm = bmesh.new()
        self.mats = []

    def add(self, part, mat, bevel=0.0):
        if bevel > 0:
            edges = [e for e in part.edges if e.is_manifold and e.calc_face_angle(0) > 0.7]
            if edges:
                try:
                    bmesh.ops.bevel(part, geom=edges, offset=bevel, segments=1, affect='EDGES', clamp_overlap=True, profile=0.5)
                except Exception as ex:  # Bevel ist rein kosmetisch
                    print('bevel skip', ex)
        if mat not in self.mats:
            self.mats.append(mat)
        idx = self.mats.index(mat)
        vmap = {v: self.bm.verts.new(v.co) for v in part.verts}
        for f in part.faces:
            try:
                nf = self.bm.faces.new([vmap[v] for v in f.verts])
                nf.material_index = idx
                nf.smooth = f.smooth
            except ValueError:
                pass
        part.free()
        return self

    def build(self):
        bm = self.bm
        bm.normal_update()
        uv = bm.loops.layers.uv.new('UVMap')
        s = self.uvscale
        for f in bm.faces:
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            for l in f.loops:
                c = l.vert.co
                if ax == 0:
                    l[uv].uv = (c.y / s, c.z / s)
                elif ax == 1:
                    l[uv].uv = (c.x / s, c.z / s)
                else:
                    l[uv].uv = (c.x / s, c.y / s)
        bmesh.ops.translate(bm, vec=-self.pivot, verts=bm.verts)
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(material(m))
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        self.obj = ob
        if self.parent:
            ob.parent = self.parent.obj
            ob.location = self.pivot - self.parent.pivot
        else:
            ob.location = self.pivot
        return ob


def empty(name, loc, parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.3
    bpy.context.scene.collection.objects.link(e)
    if parent:
        e.parent = parent.obj
        e.location = Vector(loc) - parent.pivot
    else:
        e.location = loc
    return e


def clear():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me)


def export(name):
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False,
                              export_apply=True, export_yup=True, export_materials='EXPORT',
                              export_cameras=False, export_lights=False)
    print('EXPORT', path)


# ------------------------------------------------------------------ gemeinsame Fahrzeugteile
def wheel(node, x, y, z, r, w, hub=True, n=18):
    node.add(cyl(r, w, (x, y, z), 'Y', n), 'Rubber')
    node.add(cyl(r * 0.92, w * 1.04, (x, y, z), 'Y', n), 'Rubber')
    if hub:
        s = 1 if y > 0 else -1
        node.add(cyl(r * 0.55, 0.06, (x, y + s * w * 0.5, z), 'Y', 12), 'Steel')
        node.add(cyl(r * 0.18, 0.12, (x, y + s * w * 0.55, z), 'Y', 8), 'Steel')
        for k in range(6):
            a = k / 6 * math.tau
            node.add(cyl(0.03, 0.08, (x + math.cos(a) * r * 0.38, y + s * w * 0.52, z + math.sin(a) * r * 0.38), 'Y', 6), 'Steel')


def smoke_launchers(node, x, y, z, side, n=4):
    for k in range(n):
        node.add(cyl(0.065, 0.32, (x - k * 0.17, y, z + 0.04 * k), 'Y', 8, rot=(math.pi / 2 - 0.5 * side, 0, 0.25 * side)), 'Steel')


# ------------------------------------------------------------------ Einheiten
def m_tank():
    root = Node('Hull')
    # Wanne
    root.add(prism_xz([(-3.5, 0.45), (3.3, 0.45), (3.75, 1.1), (-3.6, 1.1)], -1.15, 1.15), 'Paint', 0.03)
    root.add(prism_xz([(-3.65, 1.08), (3.8, 1.08), (2.45, 1.62), (-3.55, 1.68)], -1.78, 1.78), 'Paint', 0.04)
    for s in (-1, 1):
        root.add(prism_xz(capsule_xz(-3.3, 3.35, 0.52, 0.47, 8), s * 1.15, s * 1.72), 'Rubber', 0.02)
        for i in range(7):
            x = -2.65 + i * 0.86
            root.add(cyl(0.38, 0.1, (x, s * 1.66, 0.42), 'Y', 16), 'Steel')
            root.add(cyl(0.16, 0.06, (x, s * 1.73, 0.42), 'Y', 10), 'Steel')
        root.add(cyl(0.44, 0.18, (-3.3, s * 1.66, 0.55), 'Y', 14), 'Steel')
        root.add(cyl(0.38, 0.14, (3.35, s * 1.66, 0.6), 'Y', 14), 'Steel')
        for k in range(5):
            root.add(cyl(0.11, 0.12, (-2.2 + k * 1.1, s * 1.6, 0.97), 'Y', 8), 'Steel')
        # Seitenschürzen mit Segmenten
        for k in range(6):
            root.add(box(1.08, 0.07, 0.58, (-2.35 + k * 1.1, s * 1.82, 0.86)), 'Paint', 0.015)
        root.add(box(0.9, 0.07, 0.5, (3.25, s * 1.82, 0.9), (0, 0, 0)), 'Paint', 0.015)
        # Staukästen Heck
        root.add(box(1.1, 0.45, 0.35, (-2.9, s * 1.5, 1.85)), 'Paint', 0.03)
        root.add(box(0.12, 0.25, 0.14, (3.78, s * 1.45, 1.14)), 'Light')
        root.add(box(0.2, 0.3, 0.2, (3.7, s * 1.45, 1.2)), 'Steel', 0.02)
        root.add(box(0.25, 0.25, 0.12, (-3.6, s * 1.1, 0.75)), 'Steel')
        root.add(box(0.06, 0.18, 0.1, (-3.72, s * 1.55, 1.45)), 'RedLight')
    for s in (-1, 1):
        root.add(box(1.3, 1.0, 0.05, (-2.55, s * 0.6, 1.69)), 'Steel')
        for k in range(6):
            root.add(box(1.2, 0.04, 0.05, (-2.55, s * 0.6 - 0.4 + k * 0.16, 1.72)), 'Steel')
    root.add(box(0.05, 2.2, 0.35, (-3.62, 0, 1.35)), 'Steel')
    root.add(cyl(0.32, 0.07, (2.15, 0.55, 1.73), 'Z', 14, rot=(0, -0.42, 0)), 'Paint')
    root.add(box(0.2, 0.5, 0.1, (2.6, 0.55, 1.6), (0, -0.42, 0)), 'Glass')
    root.add(box(0.3, 0.08, 0.2, (3.85, 0, 0.8)), 'Steel')
    hull = root.build()

    tur = Node('Turret', (-0.25, 0, 1.66), root)
    core = [(1.55, 0.62), (1.35, 1.55), (-1.75, 1.62), (-2.75, 1.3), (-2.75, -1.3), (-1.75, -1.62), (1.35, -1.55), (1.55, -0.62)]
    tur.add(taper(core, 1.66, 2.48, 0.94), 'Paint', 0.035)
    for s in (-1, 1):
        tur.add(taper([(1.35, s * 1.55), (2.35, s * 0.6), (1.55, s * 0.62)][::s], 1.78, 2.42, 0.97), 'Paint', 0.02)
        smoke_launchers(tur, -0.4, s * 1.66, 2.25, s)
        tur.add(box(0.6, 0.03, 0.28, (-1.0, s * 1.63, 2.08)), 'Team')
        tur.add(cyl(0.36, 0.08, (-0.95, s * 0.68, 2.52), 'Z', 16), 'Paint')
        tur.add(box(0.18, 0.12, 0.08, (-0.8, s * 0.95, 2.53)), 'Steel')
    tur.add(box(0.8, 3.0, 0.45, (-3.05, 0, 2.08)), 'Steel', 0.02)
    tur.add(box(0.75, 2.9, 0.3, (-3.05, 0, 2.1)), 'Cloth', 0.05)
    tur.add(box(0.62, 0.95, 0.62, (1.72, 0, 2.06)), 'Paint', 0.04)
    # Sichtgeräte
    tur.add(cyl(0.2, 0.5, (-0.35, -0.85, 2.72), 'Z', 12), 'Steel')
    tur.add(box(0.42, 0.34, 0.24, (-0.35, -0.85, 3.02)), 'Paint', 0.03)
    tur.add(box(0.05, 0.26, 0.16, (-0.13, -0.85, 3.02)), 'Glass')
    tur.add(box(0.55, 0.42, 0.32, (0.95, 0.95, 2.62)), 'Paint', 0.03)
    tur.add(box(0.05, 0.32, 0.2, (1.23, 0.95, 2.62)), 'Glass')
    tur.add(cyl(0.025, 1.1, (-0.5, 0.72, 2.85), 'X', 6), 'Steel')
    tur.add(box(0.35, 0.12, 0.18, (-0.85, 0.72, 2.8)), 'Steel')
    tur.add(cyl(0.012, 2.4, (-2.3, 1.15, 3.6), 'Z', 4), 'Steel')
    tur.add(cyl(0.012, 1.8, (-2.3, -1.15, 3.3), 'Z', 4), 'Steel')
    tur.build()
    gun = Node('Gun', (1.65, 0, 2.06), tur)
    gun.add(cyl(0.095, 5.4, (4.35, 0, 2.06), 'X', 14), 'Paint')
    gun.add(cyl(0.14, 1.9, (2.95, 0, 2.06), 'X', 14), 'Paint')
    gun.add(cyl(0.18, 0.75, (4.4, 0, 2.06), 'X', 16, r2=0.15), 'Paint')
    gun.add(cyl(0.12, 0.2, (6.98, 0, 2.06), 'X', 14), 'Steel')
    gun.add(box(0.1, 0.06, 0.06, (6.9, 0, 2.18)), 'Steel')
    gun.build()
    empty('Muzzle', (7.15, 0, 2.06), gun)


def m_ifv():
    root = Node('Hull')
    prof = [(-3.4, 0.7), (3.0, 0.7), (3.65, 1.3), (2.9, 1.85), (-3.3, 1.98), (-3.5, 1.4)]
    root.add(prism_xz(prof, -1.3, 1.3), 'Paint', 0.04)
    root.add(taper([(-3.3, -1.2), (2.7, -1.2), (2.7, 1.2), (-3.3, 1.2)], 1.85, 2.02, 0.97), 'Paint', 0.03)
    for s in (-1, 1):
        for x in (-2.5, -1.1, 0.95, 2.35):
            wheel(root, x, s * 1.45, 0.62, 0.6, 0.48)
            root.add(box(1.45, 0.42, 0.08, (x, s * 1.42, 1.28)), 'Paint', 0.02)
        root.add(box(5.6, 0.12, 0.35, (-0.1, s * 1.36, 1.45)), 'Paint', 0.03)
        root.add(box(0.8, 0.05, 0.25, (-1.6, s * 1.42, 1.62)), 'Team')
        root.add(box(0.1, 0.25, 0.12, (3.62, s * 1.0, 1.33)), 'Light')
        root.add(box(0.06, 0.2, 0.1, (-3.5, s * 1.0, 1.75)), 'RedLight')
        smoke_launchers(root, -2.0, s * 1.3, 2.05, s, 3)
    root.add(box(0.05, 1.3, 1.0, (-3.45, 0, 1.25)), 'Steel', 0.01)
    root.add(box(0.6, 2.2, 0.06, (3.25, 0, 1.6), (0, -0.85, 0)), 'Paint', 0.02)
    root.add(cyl(0.3, 0.07, (2.2, 0.6, 1.9), 'Z', 12), 'Paint')
    for k in range(3):
        root.add(box(0.06, 0.18, 0.08, (2.65, 0.4 + k * 0.2, 1.92)), 'Glass')
    root.add(box(1.0, 0.9, 0.04, (-2.3, -0.5, 2.03)), 'Steel')
    root.build()
    tur = Node('Turret', (0.2, 0, 2.02), root)
    poly = circle(1.0, 8, 0, 0.2, 0, 1.0, 0.85, math.pi / 8)
    tur.add(taper([(x, y) for x, y, _ in poly], 2.02, 2.55, 0.84), 'Paint', 0.03)
    tur.add(box(0.45, 0.35, 0.28, (-0.35, 0.55, 2.7)), 'Paint', 0.03)
    tur.add(box(0.05, 0.25, 0.16, (-0.12, 0.55, 2.7)), 'Glass')
    tur.add(box(0.6, 0.35, 0.35, (0.0, -0.95, 2.4)), 'Steel', 0.03)
    for k in range(2):
        tur.add(cyl(0.11, 1.1, (0.2, -1.08, 2.3 + k * 0.23), 'X', 10), 'Paint')
    tur.add(cyl(0.012, 1.8, (-0.6, 0.6, 3.4), 'Z', 4), 'Steel')
    tur.build()
    gun = Node('Gun', (0.95, 0, 2.3), tur)
    gun.add(box(0.5, 0.45, 0.4, (1.05, 0, 2.3)), 'Paint', 0.04)
    gun.add(cyl(0.09, 0.9, (1.7, 0, 2.3), 'X', 12), 'Paint')
    gun.add(cyl(0.045, 2.6, (2.6, 0, 2.3), 'X', 10), 'Steel')
    gun.add(cyl(0.07, 0.25, (3.85, 0, 2.3), 'X', 10), 'Steel')
    gun.build()
    empty('Muzzle', (4.0, 0, 2.3), gun)


def truck_cab(node, x0, x1, w, z0, z1, team=True):
    node.add(taper([(x0, -w), (x1, -w), (x1, w), (x0, w)], z0, z1, 0.93, dx=-0.1), 'Paint', 0.06)
    node.add(box(0.06, w * 1.7, (z1 - z0) * 0.42, (x1 + 0.0, 0, z0 + (z1 - z0) * 0.68), (0, -0.25, 0)), 'Glass')
    for s in (-1, 1):
        node.add(box((x1 - x0) * 0.45, 0.05, (z1 - z0) * 0.35, (x1 - (x1 - x0) * 0.32, s * w * 0.98, z0 + (z1 - z0) * 0.7)), 'Glass')
        node.add(box(0.1, 0.3, 0.14, (x1 + 0.03, s * (w - 0.3), z0 + 0.25)), 'Light')
        node.add(box(0.08, 0.06, 0.3, (x1 - 0.05, s * (w + 0.12), z0 + (z1 - z0) * 0.7)), 'Steel')
        if team:
            node.add(box(0.5, 0.03, 0.2, (x0 + 0.5, s * w * 1.0, z0 + 0.35)), 'Team')
    node.add(box(0.2, w * 2.1, 0.3, (x1 + 0.12, 0, z0 - 0.05)), 'Steel', 0.03)
    node.add(box(0.05, w * 1.3, 0.35, (x1 + 0.02, 0, z0 + 0.35)), 'Steel')


def m_artillery():
    root = Node('Hull')
    root.add(box(7.2, 1.1, 0.4, (-0.3, 0, 1.0)), 'Steel', 0.02)
    truck_cab(root, 2.1, 3.7, 1.25, 1.05, 2.85)
    for s in (-1, 1):
        for x in (2.85, -1.05, -2.35):
            wheel(root, x, s * 1.12, 0.58, 0.58, 0.45)
        root.add(box(1.4, 0.5, 0.06, (2.85, s * 1.12, 1.25)), 'Paint', 0.02)
        root.add(box(2.8, 0.5, 0.06, (-1.7, s * 1.12, 1.25)), 'Paint', 0.02)
        root.add(box(1.0, 0.35, 0.45, (0.7, s * 1.05, 1.15)), 'Steel', 0.03)
        root.add(cyl(0.2, 0.9, (0.0, s * 1.0, 1.0), 'X', 12), 'Steel')
        root.add(box(0.06, 0.2, 0.1, (-3.92, s * 0.9, 1.15)), 'RedLight')
        root.add(cyl(0.12, 0.9, (-3.6, s * 1.15, 0.4), 'Z', 8), 'Steel')
    root.add(cyl(0.07, 1.2, (1.9, 0.9, 3.1), 'Z', 8), 'Steel')
    root.build()
    tur = Node('Turret', (-1.2, 0, 1.2), root)
    tur.add(box(2.4, 2.2, 0.3, (-1.2, 0, 1.35)), 'Steel', 0.03)
    tur.add(box(0.5, 1.6, 0.6, (-2.5, 0, 1.6)), 'Steel', 0.03)
    tur.build()
    gun = Node('Gun', (-2.6, 0, 1.6), tur)
    gun.add(box(4.3, 2.15, 1.05, (-0.45, 0, 2.15)), 'Paint', 0.05)
    gun.add(box(4.0, 2.2, 0.08, (-0.45, 0, 2.7)), 'Steel')
    for r in range(2):
        for c in range(3):
            y, z = (c - 1) * 0.68, 1.88 + r * 0.52
            gun.add(cyl(0.24, 0.06, (1.72, y, z), 'X', 14), 'Steel')
            gun.add(cyl(0.16, 0.08, (1.74, y, z), 'X', 12), 'Rubber')
    gun.add(box(0.3, 0.04, 0.4, (-1.2, 1.09, 2.15)), 'Team')
    gun.add(box(0.3, 0.04, 0.4, (-1.2, -1.09, 2.15)), 'Team')
    gun.build()
    empty('Muzzle', (1.9, 0, 2.15), gun)


def m_harvester():
    root = Node('Hull')
    root.add(box(8.0, 2.0, 0.6, (-0.3, 0, 1.15)), 'Steel', 0.03)
    for s in (-1, 1):
        for x in (2.3, -1.4, -2.9):
            wheel(root, x, s * 1.55, 0.8, 0.8, 0.65, n=20)
            root.add(box(1.9, 0.75, 0.08, (x, s * 1.55, 1.68)), 'Paint', 0.02)
        root.add(box(0.06, 0.2, 0.1, (-4.32, s * 1.1, 1.4)), 'RedLight')
        root.add(cyl(0.05, 2.6, (2.3, s * 0.95, 2.0), 'Z', 6), 'Steel')
    # Kabine links vorne
    root.add(box(1.6, 1.3, 1.6, (2.6, 1.05, 2.45)), 'Paint', 0.06)
    root.add(box(0.06, 1.1, 0.7, (3.41, 1.05, 2.75)), 'Glass')
    root.add(box(1.2, 0.05, 0.6, (2.6, 1.71, 2.75)), 'Glass')
    root.add(box(0.06, 1.0, 0.12, (3.42, 1.05, 3.3)), 'Light')
    root.add(cyl(0.12, 0.2, (2.6, 1.05, 3.35), 'Z', 10), 'Hazard')
    root.add(cyl(0.11, 0.22, (2.6, 1.05, 3.35), 'Z', 10), 'Light')
    root.add(box(1.6, 1.4, 1.1, (2.6, -0.95, 2.0)), 'Steel', 0.05)
    root.add(cyl(0.12, 1.8, (2.0, -1.4, 2.9), 'Z', 8), 'Steel')
    # Mulde
    hop = [(-4.2, -1.75), (1.6, -1.75), (1.6, 1.75), (-4.2, 1.75)]
    root.add(taper(hop, 1.45, 3.6, 1.08, sy=1.06), 'Paint', 0.05)
    for k in range(4):
        root.add(box(0.12, 3.9, 0.12, (-3.6 + k * 1.6, 0, 3.0)), 'Steel')
        root.add(box(0.12, 0.08, 1.9, (-3.6 + k * 1.6, 1.88, 2.55)), 'Steel')
        root.add(box(0.12, 0.08, 1.9, (-3.6 + k * 1.6, -1.88, 2.55)), 'Steel')
    root.add(box(2.4, 0.04, 0.6, (-1.3, 1.92, 2.3)), 'Team')
    root.add(box(2.4, 0.04, 0.6, (-1.3, -1.92, 2.3)), 'Team')
    root.add(box(0.6, 1.4, 1.0, (3.7, 0, 1.0), (0, 0.35, 0)), 'Steel', 0.03)
    for s in (-1, 1):
        root.add(box(1.5, 0.12, 0.2, (3.9, s * 1.5, 1.0)), 'Steel')
    root.build()
    load = Node('Load', (0, 0, 3.2), root)
    for k in range(9):
        load.add(rock(0.75, (-3.4 + (k % 3) * 1.9, ((k // 3) - 1) * 1.1, 3.15), k, 1.3, 1.0, 0.45, 1), 'Ore')
    load.build()
    drum = Node('Drum', (4.6, 0, 0.75), root)
    drum.add(cyl(0.55, 3.2, (4.6, 0, 0.75), 'Y', 16), 'Steel')
    for k in range(10):
        a = k / 10 * math.tau
        drum.add(box(0.12, 3.1, 0.12, (4.6 + math.cos(a) * 0.58, 0, 0.75 + math.sin(a) * 0.58), (0, -a, 0)), 'Hazard')
    drum.add(cyl(0.6, 0.08, (4.6, 1.62, 0.75), 'Y', 16), 'Paint')
    drum.add(cyl(0.6, 0.08, (4.6, -1.62, 0.75), 'Y', 16), 'Paint')
    drum.build()
    empty('FX_dust', (4.9, 0, 0.3), root)


def m_mcv():
    root = Node('Hull')
    root.add(box(10.0, 1.3, 0.5, (-0.4, 0, 1.15)), 'Steel', 0.02)
    truck_cab(root, 3.3, 5.0, 1.45, 1.2, 3.3)
    for s in (-1, 1):
        for x in (4.0, 2.4, -2.6, -4.0):
            wheel(root, x, s * 1.35, 0.68, 0.68, 0.52)
            root.add(box(1.45, 0.6, 0.06, (x, s * 1.35, 1.48)), 'Paint', 0.02)
        root.add(box(0.06, 0.2, 0.1, (-5.42, s * 1.2, 1.45)), 'RedLight')
    root.add(box(7.6, 3.0, 2.3, (-1.4, 0, 2.6)), 'Paint', 0.07)
    root.add(box(7.0, 3.04, 0.18, (-1.4, 0, 2.2)), 'Steel')
    for s in (-1, 1):
        root.add(box(3.0, 0.03, 0.9, (-1.4, s * 1.52, 2.9)), 'Team')
        for k in range(5):
            root.add(box(0.08, 0.05, 2.1, (-4.8 + k * 1.7, s * 1.52, 2.6)), 'Steel')
    root.add(box(2.0, 2.0, 0.9, (-2.8, 0, 4.2)), 'Concrete', 0.05)
    root.add(box(1.6, 1.4, 0.5, (0.6, 0.4, 4.0)), 'Steel', 0.05)
    root.add(cyl(0.5, 0.2, (0.6, -0.9, 3.85), 'Z', 14), 'Steel')
    root.add(box(5.5, 0.35, 0.35, (-0.6, -0.9, 4.1), (0, -0.04, 0)), 'Hazard', 0.02)
    root.add(cyl(0.6, 0.12, (-4.4, 0.9, 4.0), 'Z', 16, r2=0.4), 'White')
    root.add(cyl(0.02, 2.0, (-4.9, -1.2, 4.7), 'Z', 4), 'Steel')
    root.add(cyl(0.1, 0.12, (-1.0, 1.1, 3.82), 'Z', 8), 'Light')
    root.build()


def m_heli():
    root = Node('Body')
    # Rumpf als Querschnitts-Loft (x, halbe Breite, halbe Höhe, Mitte z)
    secs = [(3.6, 0.12, 0.15, 1.6), (3.2, 0.35, 0.4, 1.55), (2.2, 0.55, 0.7, 1.75), (0.5, 0.65, 0.85, 1.85),
            (-1.2, 0.6, 0.85, 1.9), (-2.2, 0.38, 0.5, 2.0), (-3.6, 0.2, 0.25, 2.15), (-6.2, 0.14, 0.18, 2.3), (-6.8, 0.1, 0.12, 2.32)]
    rings = []
    for x, w, h, zc in secs:
        rings.append([(x, math.cos(a) * w, zc + math.sin(a) * h) for a in [i / 14 * math.tau for i in range(14)]])
    bm = loft(rings, smooth=True)
    root.add(bm, 'Paint')
    # Cockpit-Haube (Tandem)
    cr = []
    for x, w, h in [(3.1, 0.15, 0.1), (2.6, 0.42, 0.45), (1.5, 0.48, 0.55), (0.6, 0.45, 0.62), (-0.4, 0.38, 0.4), (-0.8, 0.2, 0.1)]:
        cr.append([(x, math.cos(a) * w, 2.05 + math.sin(a) * h) for a in [i / 12 * math.pi for i in range(13)]])
    root.add(loft(cr, smooth=True), 'Glass')
    for x in (1.9, 0.4):
        root.add(box(0.06, 0.95, 0.06, (x, 0, 2.55)), 'Paint')
    # Triebwerke, Stummelflügel, Waffen
    for s in (-1, 1):
        root.add(cyl(0.38, 2.4, (-1.0, s * 0.82, 2.55), 'X', 14, r2=0.3), 'Paint')
        root.add(cyl(0.3, 0.1, (0.22, s * 0.82, 2.55), 'X', 14), 'Steel')
        root.add(cyl(0.22, 0.4, (-2.3, s * 0.95, 2.6), 'X', 10, r2=0.18), 'Steel')
        root.add(box(0.9, 1.5, 0.12, (-0.4, s * 1.25, 1.9), (s * -0.1, 0, 0)), 'Paint', 0.03)
        root.add(cyl(0.22, 1.5, (-0.3, s * 1.95, 1.62), 'X', 12), 'Paint')
        root.add(cyl(0.18, 0.04, (0.46, s * 1.95, 1.62), 'X', 12), 'Rubber')
        for k in range(2):
            root.add(cyl(0.06, 1.6, (-0.3, s * (1.35 + k * 0.17), 1.68), 'X', 8), 'Steel')
            root.add(cyl(0.06, 0.2, (0.55, s * (1.35 + k * 0.17), 1.68), 'X', 8, r2=0.01), 'White')
        root.add(box(0.05, 0.35, 0.3, (-0.5, s * 0.66, 1.75)), 'Team')
        # Fahrwerk
        root.add(cyl(0.04, 0.8, (1.6, s * 0.75, 0.75), 'Z', 6, rot=(s * 0.4, 0, 0)), 'Steel')
        root.add(cyl(0.28, 0.16, (1.6, s * 0.9, 0.3), 'Y', 12), 'Rubber')
    root.add(cyl(0.18, 0.22, (3.35, 0, 1.15), 'Z', 12), 'Steel')
    root.add(cyl(0.035, 1.0, (3.8, 0, 1.05), 'X', 6), 'Steel')
    root.add(cyl(0.15, 0.25, (3.55, 0, 1.75), 'X', 10), 'Glass')
    root.add(cyl(0.1, 0.18, (-6.4, 0, 1.9), 'Y', 10), 'Rubber')
    # Leitwerk
    root.add(taper([(-6.9, -0.06), (-6.0, -0.06), (-6.0, 0.06), (-6.9, 0.06)], 2.2, 3.6, 1.0, dx=-0.55), 'Paint', 0.02)
    root.add(box(0.6, 2.2, 0.06, (-5.6, 0, 2.3)), 'Paint', 0.02)
    root.add(cyl(0.18, 0.7, (-1.0, 0, 2.95), 'Z', 12), 'Steel')
    root.add(cyl(0.012, 0.6, (-2.6, 0, 2.85), 'Z', 4), 'Steel')
    root.add(box(0.06, 0.06, 0.06, (-6.9, 0, 3.6)), 'RedLight')
    root.build()
    rot = Node('Rotor', (-1.0, 0, 3.35), root)
    rot.add(cyl(0.25, 0.3, (-1.0, 0, 3.35), 'Z', 12), 'Steel')
    rot.add(cyl(0.32, 0.2, (-1.0, 0, 3.6), 'Z', 12), 'Steel')
    for k in range(4):
        a = k / 4 * math.tau + math.pi / 4
        bmb = box(6.6, 0.42, 0.05, (3.5, 0, 0), (0.06, 0, 0))
        xf(bmb, (-1.0, 0, 3.36), (0, 0, a))
        rot.add(bmb, 'Steel')
    rot.build()
    tr = Node('TailRotor', (-6.95, 0.22, 3.25), root)
    tr.add(cyl(0.08, 0.2, (-6.95, 0.22, 3.25), 'Y', 8), 'Steel')
    for k in range(4):
        a = k / 4 * math.tau
        bmb = box(0.16, 0.03, 1.1, (0, 0, 0.55))
        xf(bmb, (-6.95, 0.3, 3.25), (0, a, 0))
        tr.add(bmb, 'Steel')
    tr.build()
    empty('Muzzle', (0.6, 1.95, 1.62), root)


# ------------------------------------------------------------------ Gebäude
def pad(node, sx, sy, hazard=True):
    node.add(box(sx, sy, 0.3, (0, 0, 0.15)), 'Pad', 0.06)
    if hazard:
        for s in (-1, 1):
            node.add(box(sx - 0.4, 0.18, 0.02, (0, s * (sy / 2 - 0.3), 0.31)), 'Hazard')
            node.add(box(0.18, sy - 0.4, 0.02, (s * (sx / 2 - 0.3), 0, 0.31)), 'Hazard')


def windows(node, x0, x1, y, z, h, n, axis='x'):
    for k in range(n):
        t = x0 + (k + 0.5) * (x1 - x0) / n
        w = (x1 - x0) / n * 0.7
        if axis == 'x':
            node.add(box(w, 0.08, h, (t, y, z)), 'Glass')
        else:
            node.add(box(0.08, w, h, (y, t, z)), 'Glass')


def lamp(node, x, y, z, red=False):
    node.add(cyl(0.05, z, (x, y, z / 2), 'Z', 6), 'Steel')
    node.add(box(0.35, 0.2, 0.12, (x, y, z)), 'Steel')
    node.add(box(0.3, 0.16, 0.03, (x, y, z - 0.07)), 'RedLight' if red else 'Light')


def m_hq():
    root = Node('Base', uvscale=4.0)
    pad(root, 15.6, 15.6)
    root.add(taper([(-6.5, -5.5), (3.5, -5.5), (3.5, 4.5), (-6.5, 4.5)], 0.3, 5.0, 0.95), 'Concrete', 0.08)
    root.add(box(10.2, 10.2, 0.25, (-1.5, -0.5, 5.05)), 'Concrete', 0.05)
    root.add(taper([(-4.5, -3.5), (1.5, -3.5), (1.5, 2.5), (-4.5, 2.5)], 5.1, 7.6, 0.9), 'Concrete', 0.06)
    root.add(box(5.6, 5.6, 0.2, (-1.5, -0.5, 7.65)), 'Roof', 0.03)
    windows(root, -6.0, 3.0, -5.42, 3.6, 0.8, 7)
    windows(root, -6.0, 3.0, 4.42, 3.6, 0.8, 7)
    windows(root, -5.0, 4.0, 3.42, 3.6, 0.8, 7, 'y')
    root.add(box(0.12, 4.6, 0.7, (1.12, -0.5, 6.6)), 'Glass')
    root.add(box(0.12, 4.6, 0.7, (-4.12, -0.5, 6.6)), 'Glass')
    # Tor + Zufahrt
    root.add(box(0.15, 4.0, 3.2, (3.45, -0.5, 1.9)), 'Steel', 0.02)
    for k in range(8):
        root.add(box(0.05, 3.9, 0.06, (3.55, -0.5, 0.5 + k * 0.4)), 'Steel')
    root.add(box(3.5, 4.4, 0.06, (5.5, -0.5, 0.33)), 'Hazard')
    for s in (-1, 1):
        root.add(box(0.06, 2.6, 1.6, (3.55, s * 3.6 - 0.5, 3.6)), 'Team')
        lamp(root, 7.2, s * 7.2, 4.0)
    # Kran
    root.add(box(0.7, 0.7, 11.0, (5.5, 5.5, 5.8)), 'Hazard', 0.03)
    for k in range(10):
        root.add(box(0.75, 0.75, 0.08, (5.5, 5.5, 1.0 + k * 1.05)), 'Steel')
    root.build()
    crane = Node('Crane', (5.5, 5.5, 11.3), root)
    crane.add(box(1.0, 1.0, 0.8, (5.5, 5.5, 11.6)), 'Steel', 0.04)
    crane.add(box(1.2, 1.0, 0.9, (5.6, 5.5, 12.3)), 'Glass', 0.03)
    crane.add(box(12.0, 0.5, 0.5, (2.0, 5.5, 13.0)), 'Hazard', 0.02)
    crane.add(box(2.0, 1.2, 1.2, (8.4, 5.5, 12.6)), 'Concrete', 0.05)
    crane.add(cyl(0.03, 6.0, (-2.8, 5.5, 9.9), 'Z', 4), 'Steel')
    crane.add(box(0.4, 0.4, 0.4, (-2.8, 5.5, 6.9)), 'Hazard')
    crane.add(box(0.1, 0.1, 0.1, (-3.9, 5.5, 13.3)), 'RedLight')
    crane.build()
    top = Node('Antenna', (-1.5, -0.5, 7.75), root)
    top.add(cyl(0.12, 2.5, (-1.5, -0.5, 9.0), 'Z', 8), 'Steel')
    top.add(lathe([(0.0, 10.0), (0.6, 10.05), (1.2, 10.25), (1.5, 10.45), (1.45, 10.5), (0.0, 10.15)], 20), 'White')
    top.add(box(0.15, 0.15, 0.15, (-1.5, -0.5, 10.4)), 'RedLight')
    top.build()
    empty('Exit', (8.5, -0.5, 0), root)


def cooling_tower(node, x, y):
    prof = [(2.7, 0.3), (2.1, 3.0), (1.65, 5.6), (1.9, 8.3), (1.75, 8.3), (1.5, 5.6), (1.95, 3.0), (2.5, 0.3)]
    node.add(lathe(prof, 28, wrap=True, loc=(x, y, 0)), 'Concrete')
    node.add(lathe([(1.5, 7.7), (0.0, 7.7)], 20, loc=(x, y, 0)), 'Rock')
    for k in range(10):
        a = k / 10 * math.tau
        node.add(box(0.3, 0.3, 0.9, (x + math.cos(a) * 2.6, y + math.sin(a) * 2.6, 0.6), (0, 0, a)), 'Concrete')


def m_power():
    root = Node('Base', uvscale=4.0)
    pad(root, 11.6, 11.6)
    cooling_tower(root, -2.6, -2.6)
    cooling_tower(root, -2.6, 2.7)
    root.add(box(4.2, 9.0, 4.0, (3.1, 0, 2.3)), 'Concrete', 0.06)
    root.add(prism_yz([(-4.6, 4.3), (4.6, 4.3), (0, 5.5)], 0.9, 5.3), 'Roof', 0.02)
    windows(root, -4.0, 4.0, 5.22, 3.2, 0.7, 6, 'y')
    root.add(cyl(0.45, 13.0, (4.4, 4.0, 6.5), 'Z', 14, r2=0.35), 'Concrete')
    for k in range(3):
        root.add(cyl(0.48, 0.5, (4.4, 4.0, 10.0 + k * 1.2), 'Z', 14), 'Team' if k % 2 == 0 else 'White')
    root.add(box(0.15, 0.15, 0.15, (4.4, 4.0, 13.1)), 'RedLight')
    for s in (-1, 1):
        root.add(cyl(0.3, 4.5, (0.4, s * 2.6, 1.6), 'X', 12), 'Steel')
        root.add(box(1.2, 1.4, 1.6, (2.5, s * 5.0, 1.1)), 'Steel', 0.04)
        for k in range(3):
            root.add(cyl(0.08, 0.6, (2.1 + k * 0.4, s * 5.0, 2.2), 'Z', 8), 'White')
    root.add(box(0.06, 3.0, 1.2, (5.22, -2.0, 3.0)), 'Team')
    root.build()
    empty('FX_steam', (-2.6, -2.6, 8.2), root)
    empty('FX_steam', (-2.6, 2.7, 8.2), root)


def m_refinery():
    root = Node('Base', uvscale=4.0)
    pad(root, 15.6, 11.6)
    for i, (x, y) in enumerate([(-5.2, 3.0), (-1.4, 3.0), (2.4, 3.0)]):
        prof = [(1.7, 0.3), (1.7, 5.5), (1.45, 6.2), (0.8, 6.6), (0.0, 6.7)]
        root.add(lathe(prof, 24, loc=(x, y, 0)), 'White')
        root.add(cyl(1.75, 0.3, (x, y, 2.6), 'Z', 24), 'Steel')
        root.add(cyl(1.75, 0.3, (x, y, 4.6), 'Z', 24), 'Team' if i == 1 else 'Steel')
        root.add(cyl(0.18, 4.0, (x, y - 1.9, 2.3), 'Z', 8), 'Steel')
    root.add(cyl(0.25, 9.0, (0.0, 1.0, 5.0), 'X', 10), 'Steel')
    root.add(box(6.0, 4.4, 4.2, (3.8, -2.9, 2.4)), 'Concrete', 0.06)
    root.add(box(6.2, 4.6, 0.2, (3.8, -2.9, 4.55)), 'Roof', 0.02)
    windows(root, 1.2, 6.4, -5.12, 3.0, 0.7, 5)
    root.add(cyl(0.35, 10.0, (6.6, 3.8, 5.0), 'Z', 12), 'Steel')
    root.add(cyl(0.45, 0.6, (6.6, 3.8, 10.0), 'Z', 12), 'Steel')
    # Entladestation
    root.add(box(5.0, 4.4, 0.06, (-4.5, -2.9, 0.33)), 'Hazard')
    root.add(box(2.6, 4.0, 2.6, (-1.2, -2.9, 1.6), (0, 0, 0)), 'Steel', 0.05)
    root.add(taper([(-2.4, -4.6), (-0.1, -4.6), (-0.1, -1.2), (-2.4, -1.2)], 2.9, 4.2, 1.15), 'Paint', 0.04)
    root.add(box(5.0, 0.8, 0.4, (-1.5, -2.9, 5.0), (0, -0.45, 0)), 'Steel', 0.02)
    lamp(root, -7.2, -5.2, 4.0)
    lamp(root, -7.2, -0.6, 4.0)
    root.build()
    empty('Dock', (-4.6, -2.9, 0), root)
    empty('FX_smoke', (6.6, 3.8, 10.4), root)


def m_barracks():
    root = Node('Base', uvscale=4.0)
    pad(root, 11.6, 11.6, hazard=False)
    root.add(box(9.0, 5.0, 3.2, (-0.6, 1.8, 1.9)), 'Concrete', 0.07)
    root.add(box(9.3, 5.3, 0.25, (-0.6, 1.8, 3.6)), 'Roof', 0.03)
    root.add(box(3.6, 3.0, 2.6, (-3.3, -2.0, 1.6)), 'Concrete', 0.06)
    root.add(box(3.8, 3.2, 0.22, (-3.3, -2.0, 3.0)), 'Roof', 0.03)
    windows(root, -4.8, 3.6, -0.72, 2.3, 0.9, 6)
    windows(root, -4.8, 3.6, 4.32, 2.3, 0.9, 6)
    root.add(box(0.1, 1.6, 2.4, (3.92, 1.8, 1.5)), 'Steel', 0.02)
    root.add(box(0.06, 1.6, 0.6, (3.94, 1.8, 3.0)), 'Team')
    for k in range(4):
        root.add(cyl(0.3, 0.5, (-3.0 + k * 2.2, 1.8, 3.95), 'Z', 10), 'Steel')
    # Sandsäcke
    rnd = random.Random(3)
    for k in range(14):
        a = k / 13 * math.pi * 0.9 - 0.3
        x, y = 2.6 + math.cos(a) * 2.6, -2.6 + math.sin(-a) * 2.0
        for l in range(2):
            root.add(xf(rock(0.35, (0, 0, 0), k * 7 + l, 1.6, 0.9, 0.55, 1), (x, y, 0.45 + l * 0.35), (0, 0, a + rnd.random() * 0.2)), 'Cloth')
    root.add(cyl(0.06, 8.0, (-5.2, -4.8, 4.3), 'Z', 8), 'Steel')
    root.add(box(1.6, 0.04, 1.0, (-4.38, -4.8, 7.6)), 'Team')
    lamp(root, 5.2, 5.2, 3.6)
    root.build()
    empty('Exit', (4.5, -3.5, 0), root)


def m_factory():
    root = Node('Base', uvscale=4.0)
    pad(root, 15.6, 15.6)
    semi = [(math.cos(a) * 5.2, 0.3 + math.sin(a) * 6.0) for a in [i / 16 * math.pi for i in range(17)]]
    root.add(prism_yz(semi, -5.8, 4.2), 'Roof', 0.0)
    for k in range(6):
        x = -5.6 + k * 1.95
        rib = [(math.cos(a) * 5.3, 0.3 + math.sin(a) * 6.1) for a in [i / 16 * math.pi for i in range(17)]]
        inner = [(math.cos(a) * 5.15, 0.3 + math.sin(a) * 5.95) for a in [i / 16 * math.pi for i in range(17)]]
        root.add(prism_yz(rib + inner[::-1], x - 0.08, x + 0.08), 'Steel')
    root.add(prism_yz(semi, -5.9, -5.7), 'Concrete', 0.03)
    root.add(prism_yz(semi, 4.1, 4.3), 'Concrete', 0.03)
    root.add(box(0.2, 7.2, 5.0, (4.35, 0, 2.8)), 'Steel', 0.02)
    for k in range(10):
        root.add(box(0.06, 7.0, 0.08, (4.48, 0, 0.6 + k * 0.48)), 'Steel')
    root.add(box(0.1, 7.6, 0.4, (4.5, 0, 5.5)), 'Hazard')
    root.add(box(3.4, 7.6, 0.06, (6.0, 0, 0.33)), 'Hazard')
    root.add(box(0.08, 3.0, 0.9, (4.32, -0.0, 6.2)), 'Team')
    root.add(box(4.0, 3.2, 4.4, (-2.0, 6.5, 2.5)), 'Concrete', 0.06)
    root.add(box(4.2, 3.4, 0.2, (-2.0, 6.5, 4.75)), 'Roof', 0.02)
    windows(root, -3.8, -0.2, 8.12, 3.0, 1.0, 3)
    for k in range(3):
        root.add(cyl(0.45, 1.2, (-4.5 + k * 3.0, -2.5, 6.4), 'Z', 12), 'Steel')
        root.add(cyl(0.55, 0.1, (-4.5 + k * 3.0, -2.5, 7.05), 'Z', 12), 'Steel')
    root.add(cyl(0.35, 3.0, (-6.6, -6.6, 1.8), 'Z', 12), 'Steel')
    lamp(root, 7.2, 4.6, 4.0)
    lamp(root, 7.2, -4.6, 4.0)
    root.build()
    empty('Exit', (8.6, 0, 0), root)
    empty('FX_smoke', (-1.5, -2.5, 7.2), root)


def m_radar():
    root = Node('Base', uvscale=4.0)
    pad(root, 7.6, 7.6)
    root.add(box(3.2, 2.6, 2.5, (-1.8, -1.9, 1.55)), 'Concrete', 0.06)
    root.add(box(3.4, 2.8, 0.2, (-1.8, -1.9, 2.9)), 'Roof', 0.02)
    windows(root, -3.0, -0.6, -3.22, 1.9, 0.6, 3)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p0 = Vector((1.0 + sx * 1.4, 1.0 + sy * 1.4, 0.3))
            p1 = Vector((1.0 + sx * 0.5, 1.0 + sy * 0.5, 7.0))
            d = p1 - p0
            leg = cyl(0.09, d.length, (0, 0, 0), 'Z', 6)
            rotq = Vector((0, 0, 1)).rotation_difference(d.normalized())
            bmesh.ops.transform(leg, matrix=Matrix.Translation((p0 + p1) / 2) @ rotq.to_matrix().to_4x4(), verts=leg.verts)
            root.add(leg, 'Steel')
    for k in range(4):
        z = 1.5 + k * 1.5
        w = 2.8 - (z / 7.0) * 1.8
        root.add(box(w * 2 * 0.5 + 0.2, 0.08, 0.08, (1.0, 1.0 - w / 2, z)), 'Steel')
        root.add(box(w * 2 * 0.5 + 0.2, 0.08, 0.08, (1.0, 1.0 + w / 2, z)), 'Steel')
        root.add(box(0.08, w + 0.2, 0.08, (1.0 - w / 2, 1.0, z)), 'Steel')
        root.add(box(0.08, w + 0.2, 0.08, (1.0 + w / 2, 1.0, z)), 'Steel')
    root.add(box(1.4, 1.4, 0.2, (1.0, 1.0, 7.05)), 'Steel')
    root.add(box(0.06, 1.6, 0.6, (-0.18, -1.9, 2.0)), 'Team')
    root.build()
    dish = Node('Dish', (1.0, 1.0, 7.2), root)
    dish.add(cyl(0.25, 0.6, (1.0, 1.0, 7.45), 'Z', 10), 'Steel')
    d = lathe([(0.0, 0.0), (0.8, 0.08), (1.6, 0.35), (2.2, 0.75), (2.15, 0.8), (1.55, 0.42), (0.75, 0.15), (0.0, 0.07)], 24)
    xf(d, (1.3, 1.0, 8.2), (0, -1.25, 0))
    dish.add(d, 'White')
    dish.add(cyl(0.04, 1.6, (2.0, 1.0, 8.4), 'X', 6, rot=(0, math.pi / 2 - 0.3, 0)), 'Steel')
    dish.add(box(0.15, 0.15, 0.15, (1.0, 1.0, 7.85)), 'RedLight')
    dish.build()


def m_turret():
    root = Node('Base', uvscale=3.0)
    poly = [(x, y) for x, y, _ in circle(1.85, 8, 0, a0=math.pi / 8)]
    root.add(taper(poly, 0.0, 1.5, 0.82), 'Concrete', 0.06)
    root.add(box(0.06, 1.0, 0.25, (1.62, 0, 0.9)), 'Team')
    root.add(box(0.06, 1.0, 0.25, (-1.62, 0, 0.9)), 'Team')
    root.build()
    tur = Node('Turret', (0, 0, 1.5), root)
    tur.add(lathe([(1.25, 1.5), (1.2, 2.2), (0.95, 2.6), (0.0, 2.68)], 16), 'Paint', 0.0)
    tur.add(box(1.0, 1.2, 0.8, (0.9, 0, 2.05)), 'Paint', 0.05)
    tur.add(box(0.4, 0.3, 0.25, (-0.3, 0.5, 2.75)), 'Paint', 0.03)
    tur.add(box(0.05, 0.2, 0.14, (-0.08, 0.5, 2.75)), 'Glass')
    tur.build()
    gun = Node('Gun', (1.2, 0, 2.05), tur)
    for s in (-1, 1):
        gun.add(cyl(0.08, 3.0, (2.7, s * 0.28, 2.05), 'X', 12), 'Steel')
        gun.add(cyl(0.12, 0.9, (1.8, s * 0.28, 2.05), 'X', 12), 'Paint')
        gun.add(cyl(0.11, 0.25, (4.1, s * 0.28, 2.05), 'X', 12), 'Steel')
    gun.build()
    empty('Muzzle', (4.3, 0, 2.05), gun)


def m_helipad():
    root = Node('Base', uvscale=4.0)
    pad(root, 11.6, 11.6, hazard=False)
    root.add(cyl(4.6, 0.04, (0, 0, 0.32), 'Z', 40), 'Pad')
    ring = lathe([(4.3, 0.33), (4.5, 0.33), (4.5, 0.35), (4.3, 0.35)], 40, wrap=True)
    root.add(ring, 'Marking')
    root.add(box(0.5, 2.8, 0.03, (-0.9, 0, 0.35)), 'Marking')
    root.add(box(0.5, 2.8, 0.03, (0.9, 0, 0.35)), 'Marking')
    root.add(box(1.3, 0.5, 0.03, (0, 0, 0.35)), 'Marking')
    for k in range(12):
        a = k / 12 * math.tau
        root.add(cyl(0.1, 0.15, (math.cos(a) * 5.3, math.sin(a) * 5.3, 0.37), 'Z', 8), 'Light' if k % 2 else 'RedLight')
    root.add(box(2.4, 2.0, 2.4, (4.4, -4.4, 1.5)), 'Concrete', 0.05)
    root.add(box(2.0, 0.06, 0.6, (4.4, -3.38, 2.0)), 'Glass')
    root.add(box(0.06, 1.2, 0.5, (3.18, -4.4, 2.2)), 'Team')
    root.add(cyl(0.05, 4.0, (-5.2, 5.2, 2.3), 'Z', 6), 'Steel')
    root.add(cyl(0.25, 1.1, (-4.65, 5.2, 4.1), 'X', 10, r2=0.1), 'Hazard')
    root.build()
    empty('Exit', (0, 0, 0), root)


def m_ore(variant):
    """Blaue Kristallgruppe (passend zum Erzsammler der Vorlagen) auf flachem Gesteinssockel."""
    root = Node('Ore', uvscale=2.0)
    rnd = random.Random(variant * 17 + 1)
    for k in range(2 + variant // 2):
        a = rnd.random() * math.tau
        d = rnd.random() * 0.9
        root.add(rock(0.35 + rnd.random() * 0.3, (math.cos(a) * d, math.sin(a) * d, 0.0), variant * 50 + k, 1.4, 1.4, 0.35, 1), 'Rock')
    for k in range(7 + variant * 3):
        a = rnd.random() * math.tau
        d = rnd.random() ** 0.7 * 1.5
        h = 0.7 + rnd.random() * 1.3 * (1.2 - d / 1.5)
        r = 0.16 + rnd.random() * 0.16
        c = loft([circle(r, 6, 0), circle(r * 1.05, 6, h * 0.75), circle(0.01, 6, h)], cap1=False)
        tilt = 0.25 + d * 0.25
        xf(c, (math.cos(a) * d, math.sin(a) * d, -0.05), (math.sin(a) * tilt, -math.cos(a) * tilt * 0 + (rnd.random() - 0.5) * 0.3, rnd.random() * 6))
        root.add(c, 'Ore')
    root.build()


def m_pine(variant):
    rnd = random.Random(variant * 31 + 5)
    root = Node('Tree', uvscale=2.0)
    H = 9.0 + variant * 1.5
    root.add(cyl(0.28, H, (0, 0, H / 2), 'Z', 8, r2=0.06), 'Bark')
    layers = 7 + variant
    for k in range(layers):
        t = k / (layers - 1)
        z = 1.8 + t * (H - 2.2)
        r = (1.0 - t) * 2.8 + 0.5
        n = 14
        star = []
        for i in range(n):
            a = i / n * math.tau + rnd.random() * 0.2
            rr = r * (1.0 if i % 2 == 0 else 0.72) * (0.85 + rnd.random() * 0.3)
            star.append((math.cos(a) * rr, math.sin(a) * rr, z - 0.35 * rr / 2.8 + rnd.random() * 0.15))
        mid = [(x * 0.55, y * 0.55, pz + 0.55) for x, y, pz in star]
        tip = circle(0.05, n, z + 1.6 - t * 0.4)
        root.add(loft([star, mid, tip], smooth=True), 'Needles')
    root.build()


def m_broadleaf(variant):
    rnd = random.Random(variant * 13 + 2)
    root = Node('Tree', uvscale=2.0)
    H = 4.5 + variant * 0.7
    root.add(cyl(0.32, H, (0, 0, H / 2), 'Z', 8, r2=0.18), 'Bark')
    for k in range(3):
        a = k / 3 * math.tau + rnd.random()
        p1 = Vector((math.cos(a) * 1.6, math.sin(a) * 1.6, H + 1.2))
        p0 = Vector((0, 0, H - 1.0))
        d = p1 - p0
        b = cyl(0.14, d.length, (0, 0, 0), 'Z', 6, r2=0.06)
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        bmesh.ops.transform(b, matrix=Matrix.Translation((p0 + p1) / 2) @ q.to_matrix().to_4x4(), verts=b.verts)
        root.add(b, 'Bark')
    clumps = 5 + variant
    for k in range(clumps):
        a = rnd.random() * math.tau
        d = rnd.random() * 2.0
        z = H + 0.5 + rnd.random() * 2.2 - d * 0.3
        r = 1.3 + rnd.random() * 0.9
        root.add(rock(r, (math.cos(a) * d, math.sin(a) * d, z), variant * 100 + k, 1, 1, 0.8, 2, smooth=True, jitter=0.5), 'Leaves')
    root.build()


MODELS = {
    'pine1': lambda: m_pine(0), 'pine2': lambda: m_pine(1), 'pine3': lambda: m_pine(2),
    'tree1': lambda: m_broadleaf(0), 'tree2': lambda: m_broadleaf(1), 'tree3': lambda: m_broadleaf(2),
    'tank': m_tank, 'ifv': m_ifv, 'artillery': m_artillery, 'harvester': m_harvester, 'mcv': m_mcv,
    'heli': m_heli, 'hq': m_hq, 'power': m_power, 'refinery': m_refinery, 'barracks': m_barracks,
    'factory': m_factory, 'radar': m_radar, 'turret': m_turret, 'helipad': m_helipad,
    'ore1': lambda: m_ore(1), 'ore2': lambda: m_ore(2), 'ore3': lambda: m_ore(3),
}

bpy.ops.wm.read_factory_settings(use_empty=True)
for name, fn in MODELS.items():
    if ONLY and name not in ONLY:
        continue
    clear()
    fn()
    export(name)
print('FERTIG')
