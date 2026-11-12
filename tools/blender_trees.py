"""Bäume und Büsche der Karte: Fichten (pine1-3), Laubbäume (tree1-3), Büsche (bush1-3).
blender -b --factory-startup -P tools/blender_trees.py -- <zielordner> [pine1 tree2 ...]
Vorher: python -I tools/make_tree_textures.py  (assets/textures/trees/fir.png, leaf.png, bark.jpg)

Aufbau wie bei Spielbäumen üblich: Stamm und Hauptäste als Rohre mit Rindentextur, die Benadelung/Belaubung als
Karten mit Alpha-Textur (Fichte: ein Ast je Karte, quirlig um den Stamm, nach außen hängend; Laubbaum: Büschelkarten
auf der Kronenschale). Ein dunkler Kern füllt das Kroneninnere, damit man nicht hindurchsieht.
Materialien: Tree_fir, Tree_leaf, Tree_bark (im Spiel: Alpha-Test, beidseitig, Scheitelfarben; siehe assets.js).
Scheitelfarbe (COLOR_0): innen/unten dunkel, außen/oben hell. Normalen der Karten zeigen nach oben/außen -> weiche,
einheitliche Beleuchtung statt harter Kartenkanten. Blender: Z oben; Ursprung am Stammfuß.
"""
import bpy, bmesh, sys, os, math, random
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = argv[0] if argv else os.path.join(HERE, '..', 'assets', 'models')
ONLY = set(argv[1:])
TEX = os.path.join(HERE, '..', 'assets', 'textures', 'trees')
os.makedirs(OUT, exist_ok=True)
MATS = {}
IMG = {'Tree_fir': 'fir.png', 'Tree_leaf': 'leaf.png', 'Tree_bark': 'bark.jpg'}


def material(name):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = bpy.data.images.load(os.path.join(TEX, IMG[name]))
    nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    if name != 'Tree_bark':
        nt.links.new(t.outputs['Alpha'], b.inputs['Alpha'])
    b.inputs['Roughness'].default_value = 0.9
    MATS[name] = m
    return m


class Tree:
    """Sammelt Flächen mit Material, UV, Scheitelfarbe und Wunsch-Normale."""

    def __init__(self):
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.color.new('Color')
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.mats = []
        self.nrm = {}          # Scheitel -> Normale

    def face(self, pts, uvs, cols, mat, nrms=None, tint=(1, 1, 1)):
        if mat not in self.mats:
            self.mats.append(mat)
        vs = [self.bm.verts.new(p) for p in pts]
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return
        f.material_index = self.mats.index(mat)
        f.smooth = True
        for l, t, c in zip(f.loops, uvs, cols):
            l[self.uv].uv = t
            l[self.col] = (c * tint[0], c * tint[1], c * tint[2], 1.0)
        if nrms:
            for v, n in zip(vs, nrms):
                self.nrm[v] = Vector(n).normalized()

    def tube(self, p0, p1, r0, r1, n=6, c=0.9, v0=0.0):
        """Rohr mit Rindentextur zwischen zwei Punkten (ohne Deckel)."""
        p0, p1 = Vector(p0), Vector(p1)
        d = (p1 - p0)
        ln = d.length
        d.normalize()
        u = d.cross(Vector((0.3, 0.9, 0.1))).normalized()
        w = d.cross(u)
        for i in range(n):
            a0, a1 = i / n * math.tau, (i + 1) / n * math.tau
            o0, o1 = u * math.cos(a0) + w * math.sin(a0), u * math.cos(a1) + w * math.sin(a1)
            self.face([p0 + o0 * r0, p0 + o1 * r0, p1 + o1 * r1, p1 + o0 * r1],
                      [(i / n * 2, v0), ((i + 1) / n * 2, v0), ((i + 1) / n * 2, v0 + ln / 2.5), (i / n * 2, v0 + ln / 2.5)],
                      [c] * 4, 'Tree_bark', [o0, o1, o1, o0])

    def build(self, name):
        bm = self.bm
        bm.normal_update()
        me = bpy.data.meshes.new(name)
        order = {v: i for i, v in enumerate(bm.verts)}
        normals = [None] * len(order)
        for v, i in order.items():
            normals[i] = tuple(self.nrm.get(v, v.normal))
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(material(m))
        me.normals_split_custom_set_from_vertices(normals)
        me.color_attributes.active_color = me.color_attributes[0]
        me.color_attributes.render_color_index = 0
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def up_out(p, c, up=0.75):
    """Normale: Mischung aus 'nach oben' und 'von der Kronenmitte weg'."""
    o = Vector(p) - Vector(c)
    if o.length > 1e-6:
        o.normalize()
    return o * (1.0 - up) + Vector((0, 0, up))


# ------------------------------------------------------------------ Fichte
def m_pine(variant):
    rnd = random.Random(variant * 31 + 5)
    T = Tree()
    H = 9.5 + variant * 1.5
    lean = Vector(((rnd.random() - 0.5) * 0.5, (rnd.random() - 0.5) * 0.5, 0))
    axis = lambda z: lean * (z / H) ** 2 + Vector((0, 0, z))
    r_at = lambda z: 0.32 * (1.0 - z / H) + 0.04
    T.tube((0, 0, -0.4), axis(0.6), 0.5, r_at(0.6), 6, 0.8)                      # Wurzelanlauf
    T.tube(axis(0.6), axis(H * 0.55), r_at(0.6), r_at(H * 0.55), 6, 0.75, 0.4)
    T.tube(axis(H * 0.55), axis(H - 0.6), r_at(H * 0.55), 0.04, 5, 0.6, 2.0)
    # dunkler Kern (dichte Stelle der Asttextur), damit die Krone nicht durchsichtig wirkt
    z0, z1 = 2.0, H - 1.6
    for i in range(6):
        a0, a1 = i / 6 * math.tau, (i + 1) / 6 * math.tau
        b0 = axis(z0) + Vector((math.cos(a0), math.sin(a0), 0)) * 1.15
        b1 = axis(z0) + Vector((math.cos(a1), math.sin(a1), 0)) * 1.15
        T.face([b0, b1, axis(z1)], [(0.3, 0.45), (0.36, 0.45), (0.33, 0.55)], [0.3, 0.3, 0.42], 'Tree_fir',
               [up_out(b0, axis(z0), 0.3), up_out(b1, axis(z0), 0.3), (0, 0, 1)])
    # Astquirle: unten lang und hängend, oben kurz und aufstrebend
    z, k = 1.5, 0
    while z < H - 1.1:
        t = (z - 1.5) / (H - 2.6)                      # 0 unten ... 1 oben
        L = (1.0 - t) ** 0.8 * 3.2 + 0.7
        n = 6 if t < 0.55 else 5 if t < 0.8 else 4
        a0 = k * 2.4 + rnd.random() * 0.5
        shade = 0.6 + 0.4 * t                          # untere Äste im Schatten der oberen
        for i in range(n):
            a = a0 + (i + (rnd.random() - 0.5) * 0.3) / n * math.tau
            l = L * (0.82 + rnd.random() * 0.36)
            w = l * 0.36
            d = Vector((math.cos(a), math.sin(a), 0))
            s = Vector((-d.y, d.x, 0))
            roll = (rnd.random() - 0.5) * 0.35
            sv = (s * math.cos(roll) + Vector((0, 0, math.sin(roll)))) * w
            p0 = axis(z) + d * 0.05
            pm = p0 + d * l * 0.5 + Vector((0, 0, l * (0.16 * t - 0.02)))
            p1 = p0 + d * l + Vector((0, 0, l * (0.22 * t - 0.3 * (1.0 - t)) - 0.15))
            c0, cm, c1 = 0.42 * shade, 0.72 * shade, (0.95 + rnd.random() * 0.15) * shade
            nm = [up_out(q, axis(z)) for q in (p0, pm, p1)]
            if l > 1.6:                                 # lange Äste geknickt (hängende Spitze)
                T.face([p0 - sv, pm - sv, pm + sv, p0 + sv], [(0, 0), (0.5, 0), (0.5, 1), (0, 1)], [c0, cm, cm, c0], 'Tree_fir', [nm[0], nm[1], nm[1], nm[0]])
                T.face([pm - sv, p1 - sv, p1 + sv, pm + sv], [(0.5, 0), (1, 0), (1, 1), (0.5, 1)], [cm, c1, c1, cm], 'Tree_fir', [nm[1], nm[2], nm[2], nm[1]])
            else:
                T.face([p0 - sv, p1 - sv, p1 + sv, p0 + sv], [(0, 0), (1, 0), (1, 1), (0, 1)], [c0, c1, c1, c0], 'Tree_fir', [nm[0], nm[2], nm[2], nm[0]])
        z += 0.62 - 0.22 * t
        k += 1
    # Wipfel: zwei gekreuzte stehende Karten
    b, top = axis(H - 1.9), axis(H + 0.5)
    for a in (0.4, 0.4 + math.pi / 2):
        sv = Vector((math.cos(a), math.sin(a), 0)) * 0.75
        T.face([b - sv, top - sv, top + sv, b + sv], [(0.25, 0.08), (1, 0.08), (1, 0.92), (0.25, 0.92)], [0.75, 1.05, 1.05, 0.75], 'Tree_fir',
               [up_out(b - sv, b, 0.5), (0, 0, 1), (0, 0, 1), up_out(b + sv, b, 0.5)])
    return T.build('Tree')


# ------------------------------------------------------------------ Laubkrone aus Büschelkarten
def crown(T, c, rx, rz, n, seed, size=2.5, tint=(1, 1, 1), inner=True):
    rnd = random.Random(seed)
    c = Vector(c)
    if inner:   # dunkler Kern: Ikosaeder mit dichter Stelle der Laubtextur
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
        for f in bm.faces:
            pts = [c + Vector((v.co.x * rx * 0.74, v.co.y * rx * 0.74, v.co.z * rz * 0.74)) for v in f.verts]
            T.face(pts, [(0.46, 0.46), (0.54, 0.46), (0.5, 0.54)], [0.5 + 0.25 * max(0.0, v.co.z) for v in f.verts], 'Tree_leaf',
                   [v.co.copy() for v in f.verts], tint)
        bm.free()
    for i in range(n):
        # gleichmäßig über die Schale verteilt (Fibonacci), unten ausgespart
        zz = 1.0 - (i + 0.5) / n * 1.45
        r = math.sqrt(max(0.0, 1.0 - zz * zz))
        a = i * 2.39996 + rnd.random() * 0.4
        d = Vector((math.cos(a) * r, math.sin(a) * r, zz))
        k = 0.78 + rnd.random() * 0.22
        p = c + Vector((d.x * rx * k, d.y * rx * k, d.z * rz * k))
        nrm = (d * 0.55 + Vector((0, 0, 0.55)) + Vector((rnd.random() - 0.5, rnd.random() - 0.5, 0)) * 0.35).normalized()
        u = nrm.cross(Vector((0, 0, 1)))
        u = u.normalized() if u.length > 0.05 else Vector((1, 0, 0))
        w = nrm.cross(u)
        rot = rnd.random() * math.tau
        u, w = u * math.cos(rot) + w * math.sin(rot), w * math.cos(rot) - u * math.sin(rot)
        h = size * (0.8 + rnd.random() * 0.4) / 2
        pts = [p - u * h - w * h, p + u * h - w * h, p + u * h + w * h, p - u * h + w * h]
        base = 0.62 + 0.42 * (d.z * 0.5 + 0.5) + (rnd.random() - 0.5) * 0.14       # unten dunkel, Kuppe hell
        T.face(pts, [(0, 0), (1, 0), (1, 1), (0, 1)], [base] * 4, 'Tree_leaf', [up_out(q, c, 0.45) for q in pts], tint)


def m_broadleaf(variant):
    rnd = random.Random(variant * 13 + 2)
    T = Tree()
    H = 3.6 + variant * 0.7
    lean = Vector(((rnd.random() - 0.5) * 0.9, (rnd.random() - 0.5) * 0.9, 0))
    top = lean + Vector((0, 0, H))
    T.tube((0, 0, -0.4), lean * 0.05 + Vector((0, 0, 0.55)), 0.62, 0.36, 7, 0.85)
    T.tube(lean * 0.05 + Vector((0, 0, 0.55)), top, 0.36, 0.24, 7, 0.8, 0.4)
    cz = H + 2.1 + variant * 0.15
    cc = top + Vector((0, 0, cz - H))
    arms = []
    for k in range(3 + variant % 2):
        a = k / (3 + variant % 2) * math.tau + rnd.random() * 0.8
        p1 = top + Vector((math.cos(a) * 1.9, math.sin(a) * 1.9, 1.5 + rnd.random() * 0.8))
        T.tube(top - Vector((0, 0, 0.3)), p1, 0.17, 0.06, 5, 0.7, 1.5)
        arms.append(p1)
    T.tube(top, cc, 0.22, 0.07, 5, 0.65, 1.5)
    rx = 2.7 + variant * 0.25
    crown(T, cc, rx, 2.1 + variant * 0.1, 34 + variant * 5, variant * 10 + 1)
    for k, p in enumerate(arms):                                               # Nebenkronen an den Astenden
        o = (p - top)
        crown(T, top + Vector((o.x * 1.35, o.y * 1.35, o.z + 0.2)), 1.5 + rnd.random() * 0.3, 1.2, 9, variant * 10 + 2 + k, 2.1, inner=False)
    return T.build('Tree')


def m_bush(variant):
    """Niedriger Busch aus Büschelkarten (Ursprung 0,3 m unter dem Fuß); etwas gelblicher als die Bäume."""
    rnd = random.Random(variant * 7 + 3)
    T = Tree()
    tint = (0.95, 0.9, 0.62)
    crown(T, (0, 0, 0.75), 1.05 + variant * 0.1, 0.75, 10, variant * 5 + 40, 1.45, tint)
    for k in range(1 + variant % 2):
        a = k * 2.6 + rnd.random()
        crown(T, (math.cos(a) * 0.95, math.sin(a) * 0.95, 0.6), 0.6, 0.5, 5, variant * 5 + 41 + k, 1.1, tint, inner=False)
    return T.build('Bush')


MODELS = {'bush1': lambda: m_bush(0), 'bush2': lambda: m_bush(1), 'bush3': lambda: m_bush(2),
          'pine1': lambda: m_pine(0), 'pine2': lambda: m_pine(1), 'pine3': lambda: m_pine(2),
          'tree1': lambda: m_broadleaf(0), 'tree2': lambda: m_broadleaf(1), 'tree3': lambda: m_broadleaf(2)}

for name, fn in MODELS.items():
    if ONLY and name not in ONLY:
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()
    ob = fn()
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    kw = dict(filepath=os.path.join(OUT, name + '.glb'), export_format='GLB', export_apply=True, export_yup=True,
              export_cameras=False, export_lights=False, export_image_format='AUTO')
    try:
        bpy.ops.export_scene.gltf(**kw, export_vertex_color='ACTIVE', export_active_vertex_color_when_no_material=True)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)
    print('TREE', name, tris, 'Dreiecke')
print('FERTIG')
