"""3D-Modelle aus den 2D-Vorlagen (art/crop/*.jpg) – Bildprojektion von oben auf modellierte Körper.
Aufruf:
  blender -b --factory-startup -P tools/blender_art_models.py -- <ausgabeordner> [modell ...]
Konventionen wie blender_models.py: +X = vorne (Fahrzeuge), +Z oben, Ursprung Mitte unten.
Gebäude: Bild oben = Blender +Y (= Spiel -Z, Norden); Ausgang/Tor im Bild unten (Blender -Y).
Flächen mit Normal.z > 0.35 bekommen das Bildmaterial 'Art_<bild>' (UV = Projektion von oben),
übrige Flächen ein Seitenmaterial (Olive, Steel, Concrete, Rubber, ...), das im Spiel texturiert wird.
"""
import bpy, bmesh, math, os, sys, json, random
from mathutils import Vector, Matrix, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, '..', 'art', 'crop')
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(HERE, '..', 'assets', 'models')
ONLY = set(argv[1:])
META = json.load(open(os.path.join(ART, 'meta.json')))

SIDE = {
    'Olive': (0.10, 0.13, 0.045, 0.2, 0.7), 'Steel': (0.05, 0.055, 0.06, 0.8, 0.45), 'Concrete': (0.42, 0.41, 0.39, 0.0, 0.9),
    'Rubber': (0.025, 0.025, 0.025, 0.0, 0.92), 'Glass': (0.02, 0.04, 0.06, 0.3, 0.08), 'Cloth': (0.12, 0.14, 0.06, 0.0, 1.0),
    'Hazard': (0.8, 0.5, 0.02, 0.1, 0.6), 'Team': (0.8, 0.1, 0.1, 0.2, 0.45), 'Ore': (0.1, 0.45, 1.0, 0.2, 0.15),
    'Light': (1.0, 0.6, 0.2, 0.0, 0.3), 'RedLight': (1.0, 0.1, 0.05, 0.0, 0.3),
}
MATS = {}


# Seitenmaterial -> Seitentextur im Vorlagenstil (tools/make_side_textures.py): (Bild, Bildseitenverhältnis)
SIDE_TEX = {'Olive': ('side_olive', 3.2), 'Steel': ('side_steel', 3.2), 'Concrete': ('side_concrete', 3.2),
            'Rubber': ('side_track', 4.0), 'Cloth': ('side_cloth', 2.0), 'Hazard': ('side_hazard', 4.0), 'Glass': ('side_glass', 1.0), 'Wheel': ('side_track', 4.0)}


def mat_side(name):
    if name in SIDE_TEX:
        return mat_art(SIDE_TEX[name][0])
    if name in MATS:
        return MATS[name]
    r, g, b, met, rough = SIDE[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bs = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bs.inputs['Base Color'].default_value = (r, g, b, 1)
    bs.inputs['Metallic'].default_value = met
    bs.inputs['Roughness'].default_value = rough
    MATS[name] = m
    return m


def mat_art(img):
    key = 'Art_' + img
    if key in MATS:
        return MATS[key]
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    nt = m.node_tree
    bs = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(os.path.join(ART, img + '.jpg'), check_existing=True)
    tex.interpolation = 'Linear'
    nt.links.new(tex.outputs['Color'], bs.inputs['Base Color'])
    bs.inputs['Roughness'].default_value = 0.7
    bs.inputs['Metallic'].default_value = 0.15
    MATS[key] = m
    return m


# ------------------------------------------------------------------ Geometrie
def mkbm(verts, faces):
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in verts]
    for f in faces:
        try:
            bm.faces.new([vs[i] for i in f])
        except ValueError:
            pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def prism(poly, z0, z1, inset=0.0, smooth=False):
    """Grundriss (x,y) -> Körper; Deckfläche um 'inset' Meter zum Schwerpunkt geschrumpft (Schräge)."""
    n = len(poly)
    cx = sum(p[0] for p in poly) / n
    cy = sum(p[1] for p in poly) / n
    top = []
    for x, y in poly:
        dx, dy = x - cx, y - cy
        l = math.hypot(dx, dy) or 1
        k = max(0.05, (l - inset) / l)
        top.append((cx + dx * k, cy + dy * k))
    verts = [(x, y, z0) for x, y in poly] + [(x, y, z1) for x, y in top]
    faces = [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    faces.append(list(range(n))[::-1])
    faces.append(list(range(n, 2 * n)))
    bm = mkbm(verts, faces)
    if smooth:
        for f in bm.faces:
            if abs(f.normal.z) < 0.9:
                f.smooth = True
    return bm


def rect_inset_poly(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def circle_poly(cx, cy, r, n=24, a0=0.0):
    return [(cx + math.cos(a0 + i / n * math.tau) * r, cy + math.sin(a0 + i / n * math.tau) * r) for i in range(n)]


def frustum(cx, cy, r0, r1, z0, z1, n=24):
    verts = [(cx + math.cos(i / n * math.tau) * r0, cy + math.sin(i / n * math.tau) * r0, z0) for i in range(n)] + \
            [(cx + math.cos(i / n * math.tau) * r1, cy + math.sin(i / n * math.tau) * r1, z1) for i in range(n)]
    faces = [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)] + [list(range(n))[::-1], list(range(n, 2 * n))]
    bm = mkbm(verts, faces)
    for f in bm.faces:
        if abs(f.normal.z) < 0.9:
            f.smooth = True
    return bm


def tube(p0, p1, r, n=12):
    """Zylinder zwischen zwei 3D-Punkten."""
    a, b = Vector(p0), Vector(p1)
    d = b - a
    bm = frustum(0, 0, r, r, 0, d.length, n)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bmesh.ops.transform(bm, matrix=Matrix.Translation(a) @ q.to_matrix().to_4x4(), verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def arch(x0, x1, y0, y1, z0, h, n=12):
    """Halbtonne (Hangar): Querschnitt in X, entlang Y extrudiert."""
    cx, rx = (x0 + x1) / 2, (x1 - x0) / 2
    prof = [(cx + math.cos(math.pi - i / n * math.pi) * rx, z0 + math.sin(math.pi - i / n * math.pi) * h) for i in range(n + 1)]
    m = len(prof)
    verts = [(x, y0, z) for x, z in prof] + [(x, y1, z) for x, z in prof]
    faces = [[i, i + 1, m + i + 1, m + i] for i in range(m - 1)] + [list(range(m))[::-1], list(range(m, 2 * m))]
    bm = mkbm(verts, faces)
    for f in bm.faces:
        if abs(f.normal.y) < 0.9:
            f.smooth = True
    return bm


# ------------------------------------------------------------------ Modell mit Bildprojektion
class Model:
    def __init__(self, img, size, pivot=(0.5, 0.5), kind='unit'):
        """size: Länge (Einheit, Bildhöhe in m entlang X) bzw. (Breite, Tiefe) für Gebäude."""
        self.img, self.kind = img, kind
        asp = META[img]['aspect']
        if kind == 'unit':
            self.L = size
            self.W = size * asp
        else:
            self.W, self.D = size if isinstance(size, tuple) else (size, size / asp)
        self.uc, self.vc = pivot

    def P(self, u, v):
        if self.kind == 'unit':
            return ((self.vc - v) * self.L, (self.uc - u) * self.W)
        return ((u - self.uc) * self.W, (self.vc - v) * self.D)

    def UV(self, x, y):
        if self.kind == 'unit':
            v = self.vc - x / self.L
            u = self.uc - y / self.W
        else:
            u = self.uc + x / self.W
            v = self.vc - y / self.D
        return (u, 1 - v)

    def rect(self, u0, v0, u1, v1):
        pts = [self.P(u0, v0), self.P(u1, v0), self.P(u1, v1), self.P(u0, v1)]
        return pts

    def poly(self, uvs):
        return [self.P(u, v) for u, v in uvs]


class Node:
    def __init__(self, model, name, pivot=(0, 0, 0), parent=None, img=None):
        self.m, self.name, self.pivot, self.parent = model, name, Vector(pivot), parent
        self.img = img or model.img
        self.bm = bmesh.new()
        self.mats = []
        self.fdata = []  # pro Fläche: (art?)

    def add(self, part, side='Olive', top=True, img=None, uvfn=None, keepuv=False, allfaces=False):
        art = mat_art(img or self.img) if (top and not keepuv) else None
        sm = mat_side(side)
        wm = mat_art('side_wheel') if side == 'Wheel' else None
        if wm and wm not in self.mats:
            self.mats.append(wm)
        for mt in (art, sm):
            if mt and mt not in self.mats:
                self.mats.append(mt)
        vmap = {v: self.bm.verts.new(v.co) for v in part.verts}
        part.normal_update()
        puv = part.loops.layers.uv.active if keepuv else None
        km = mat_art(img) if keepuv else None
        if km and km not in self.mats:
            self.mats.append(km)
        xs = [v.co.x for v in part.verts]; ys = [v.co.y for v in part.verts]; zs = [v.co.z for v in part.verts]
        box = (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs))
        for f in part.faces:
            try:
                nf = self.bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                continue
            if keepuv and (f.smooth or allfaces):  # Kettenband/Requisiten: vorgegebene UVs übernehmen
                nf.material_index = self.mats.index(km)
                nf.smooth = f.smooth if allfaces else True
                self.fdata.append((nf, 'keep', [tuple(l[puv].uv) for l in f.loops], img, side, None))
                continue
            is_art = art is not None and (f.normal.z > 0.35 if uvfn is None else uvfn(f) is not None)
            nf.material_index = self.mats.index(art if is_art else wm if (wm and abs(f.normal.y) > 0.8) else sm)
            nf.smooth = f.smooth
            self.fdata.append((nf, is_art, uvfn, img or self.img, side, box))
        part.free()
        return self

    def build(self):
        bm = self.bm
        bm.normal_update()
        uv = bm.loops.layers.uv.new('UVMap')
        for f, is_art, uvfn, img, side, box in self.fdata:
            if not f.is_valid:
                continue
            if is_art == 'keep':
                for l, t in zip(f.loops, uvfn):
                    l[uv].uv = t
                continue
            if is_art:
                for l in f.loops:
                    c = l.vert.co
                    l[uv].uv = uvfn(f)(c) if uvfn else self.m.UV(c.x, c.y)
                continue
            asp = SIDE_TEX.get(side, (None, 3.2))[1]
            n = f.normal
            x0, x1, y0, y1, z0, z1 = box
            if side == 'Wheel' and abs(n.y) > 0.8:  # Radflanke: Felgenbild
                cx, cz, r = (x0 + x1) / 2, (z0 + z1) / 2, max(x1 - x0, z1 - z0) / 2
                for l in f.loops:
                    l[uv].uv = (0.5 + (l.vert.co.x - cx) / (2 * r), 0.5 + (l.vert.co.z - cz) / (2 * r))
                continue
            if abs(n.z) > 0.8:  # Deckel/Boden ohne Bild: planar
                for l in f.loops:
                    l[uv].uv = (l.vert.co.x / 3.0, l.vert.co.y / 3.0)
                continue
            h = max(z1 - z0, 0.05)
            band = h / max(1, round(h / 3.2))          # hohe Bauteile: Panelreihen ca. 3 m
            tile = band * asp
            dx, dy = x1 - x0, y1 - y0
            vertical_cyl = f.smooth and abs(dx - dy) < 0.3 * max(dx, dy, 1e-3) and h > 0.4 * max(dx, dy)
            if vertical_cyl:
                cx, cy, r = (x0 + x1) / 2, (y0 + y1) / 2, max(dx, dy) / 2
                angs = [math.atan2(l.vert.co.y - cy, l.vert.co.x - cx) for l in f.loops]
                a0 = angs[0]
                angs = [a + (2 * math.pi if a - a0 < -math.pi else -2 * math.pi if a - a0 > math.pi else 0) for a in angs]
                for l, a in zip(f.loops, angs):
                    l[uv].uv = (a * r / tile, (l.vert.co.z - z0) / band)
            else:
                t = Vector((-n.y, n.x)).normalized() if Vector((n.x, n.y)).length > 1e-4 else Vector((1, 0))
                for l in f.loops:
                    c = l.vert.co
                    l[uv].uv = ((c.x * t.x + c.y * t.y) / tile, (c.z - z0) / band)
        bmesh.ops.translate(bm, vec=-self.pivot, verts=bm.verts)
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(m)
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
    bpy.context.scene.collection.objects.link(e)
    if parent:
        e.parent = parent.obj
        e.location = Vector(loc) - parent.pivot
    else:
        e.location = loc
    return e


# ------------------------------------------------------------------ Detailteile (3D-Anbauten, Seitenmaterial)
def box(cx, cy, sx, sy, z0, z1, inset=0.0):
    return prism(rect_inset_poly(cx - sx / 2, cy - sy / 2, cx + sx / 2, cy + sy / 2), z0, z1, inset)


def lamp(N, p, d, r=0.13, mat='Light'):
    """Scheinwerfer an Punkt p, leuchtet in Richtung d (Einheitsvektor)."""
    p, d = Vector(p), Vector(d).normalized()
    N.add(tube(p - d * 0.14, p, r * 1.3, 8), 'Steel', top=False)
    N.add(tube(p, p + d * 0.05, r, 8), mat, top=False)


def beacon(N, x, y, z, r=0.13):
    N.add(frustum(x, y, r * 1.2, r * 1.2, z, z + 0.08, 8), 'Steel', top=False)
    N.add(frustum(x, y, r, r * 0.7, z + 0.08, z + 0.3, 8), 'RedLight', top=False)


def antenna(N, x, y, z, h=2.2):
    N.add(frustum(x, y, 0.07, 0.07, z, z + 0.15, 6), 'Steel', top=False)
    N.add(tube((x, y, z + 0.1), (x, y, z + h), 0.022, 4), 'Rubber', top=False)


def smoke_launchers(N, x, y, z, s, fwd=1, n=3):
    """Nebelwurfbecher: n Rohre an Turmseite s (+1 links/-1 rechts), schräg nach vorn/außen/oben."""
    for k in range(n):
        a = Vector((x - fwd * k * 0.2, y, z))
        N.add(tube(a, a + Vector((0.22 * fwd, 0.16 * s, 0.17)), 0.065, 6), 'Steel', top=False)


def muzzle_brake(N, base, tip, r):
    """Mündungsbremse + Rauchabsauger auf einem Rohr entlang X (base -> tip)."""
    a, b = Vector(base), Vector(tip)
    d = (b - a).normalized()
    N.add(tube(b - d * 0.55, b, r * 1.55, 8), 'Steel', top=False)
    m = a + (b - a) * 0.45
    N.add(tube(m - d * 0.45, m + d * 0.45, r * 1.4, 10), 'Olive', top=False)


def railing(N, x0, y0, x1, y1, z, h=0.85, skip=None):
    """Geländer um ein Dach (Pfosten + Handlauf). skip: Seite ('n','s','e','w') auslassen."""
    t = 0.05
    edges = {'s': ((x0, y0), (x1, y0)), 'e': ((x1, y0), (x1, y1)), 'n': ((x1, y1), (x0, y1)), 'w': ((x0, y1), (x0, y0))}
    for k, (a, b) in edges.items():
        if skip and k in skip:
            continue
        L = math.dist(a, b)
        n = max(1, round(L / 1.6))
        for i in range(n + 1):
            p = (a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n)
            N.add(box(p[0], p[1], t, t, z, z + h), 'Steel', top=False)
        cx, cy = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        sx, sy = (abs(b[0] - a[0]) + t, t) if abs(b[1] - a[1]) < 1e-6 else (t, abs(b[1] - a[1]) + t)
        for zz in (z + h, z + h * 0.5):
            N.add(box(cx, cy, sx, sy, zz - t, zz), 'Steel', top=False)


def vent(N, x, y, z, r=0.5, h=0.6):
    N.add(frustum(x, y, r, r, z, z + h, 12), 'Steel', top=False)
    N.add(frustum(x, y, r * 1.2, r * 0.3, z + h + 0.12, z + h + 0.35, 12), 'Steel', top=False)
    N.add(frustum(x, y, r * 0.18, r * 0.18, z + h, z + h + 0.15, 6), 'Steel', top=False)


def ac_unit(N, x, y, z, sx=1.4, sy=1.0, h=0.65):
    N.add(box(x, y, sx, sy, z, z + h, 0.04), 'Steel', top=False)
    N.add(frustum(x, y, min(sx, sy) * 0.36, min(sx, sy) * 0.36, z + h - 0.02, z + h + 0.03, 12), 'Rubber', top=False)


def team_band(N, poly_rect, z, h=0.22, grow=0.06):
    """Teamfarbener Streifen rund um einen Block (x0, y0, x1, y1) knapp unter der Dachkante."""
    x0, y0, x1, y1 = poly_rect
    N.add(prism(rect_inset_poly(x0 - grow, y0 - grow, x1 + grow, y1 + grow), z - h, z, 0.0), 'Team', top=False)


def flag(N, x, y, z, h=5.0):
    N.add(tube((x, y, z), (x, y, z + h), 0.06, 6), 'Steel', top=False)
    N.add(box(x + 0.75, y, 1.4, 0.05, z + h - 0.95, z + h - 0.1), 'Team', top=False)
    beacon(N, x, y, z + h, 0.08)


def door(N, x, y, w, h, z=0.35, face=-1, light=True):
    """Tor in einer Wand mit Normal (0, face): Stahlrahmen, Rolltor, Warnstreifen, Lampe darüber."""
    s = face
    N.add(box(x, y + s * 0.06, w + 0.5, 0.14, z, z + h + 0.35), 'Steel', top=False)
    N.add(box(x, y + s * 0.13, w, 0.06, z, z + h), 'Rubber', top=False)
    for k in range(int(h / 0.45)):
        zz = z + 0.2 + k * 0.45
        N.add(box(x, y + s * 0.17, w - 0.1, 0.03, zz, zz + 0.12), 'Steel', top=False)
    N.add(box(x, y + s * 0.15, w + 0.5, 0.05, z + h + 0.05, z + h + 0.3), 'Hazard', top=False)
    if light:
        lamp(N, (x, y + s * 0.2, z + h + 0.6), (0, s, -0.6), 0.14)


def bbox(M, u0, v0, u1, v1):
    pts = M.rect(u0, v0, u1, v1)
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def clear():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me)


def export(name):
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False, export_apply=True,
                              export_yup=True, export_materials='EXPORT', export_image_format='JPEG',
                              export_jpeg_quality=88, export_cameras=False, export_lights=False)
    print('EXPORT', path)


# ------------------------------------------------------------------ Formkörper (Loft)
def loft(secs, smooth=False, caps=True):
    """Körper aus Querschnitten (Listen gleich vieler 3D-Punkte), z. B. Wannen, Türme, Rümpfe."""
    n = len(secs[0])
    verts = [tuple(p) for s in secs for p in s]
    faces = []
    for k in range(len(secs) - 1):
        for i in range(n):
            j = (i + 1) % n
            faces.append([k * n + i, k * n + j, (k + 1) * n + j, (k + 1) * n + i])
    nq = len(faces)
    if caps:
        faces.append(list(range(n))[::-1])
        if caps != 'first':
            faces.append(list(range((len(secs) - 1) * n, len(secs) * n)))
    bm = mkbm(verts, faces)
    if smooth:
        bm.faces.ensure_lookup_table()
        for f in bm.faces:
            if len(f.verts) == 4:
                f.smooth = True
    return bm


def hsec(x, wb, zb, wm, zm, wt, zt, cy=0.0):
    """Panzer-Querschnitt bei x: unten schmal (wb), breiteste Stelle (wm, zm), Deck (wt, zt)."""
    return [(x, cy - wb, zb), (x, cy + wb, zb), (x, cy + wm, zm), (x, cy + wt, zt), (x, cy - wt, zt), (x, cy - wm, zm)]


def ring(x, cy, cz, ry, rz, n=14, pw=2.0):
    """Superellipse in der YZ-Ebene (pw=2 Ellipse, größer = kantiger) für Rümpfe."""
    pts = []
    for i in range(n):
        a = i / n * math.tau
        c, s = math.cos(a), math.sin(a)
        pts.append((x, cy + ry * math.copysign(abs(c) ** (2 / pw), c), cz + rz * math.copysign(abs(s) ** (2 / pw), s)))
    return pts


def body(rows, n=14):
    """Rumpf aus Zeilen (x, ry, rz, cz, pw)."""
    return loft([ring(x, 0, cz, ry, rz, n, pw) for x, ry, rz, cz, pw in rows], smooth=True)


def pod(x0, x1, y, z, r, nose=0.5, n=10):
    """Behälter/Rakete entlang X mit Spitze vorn."""
    return loft([ring(x0, y, z, r * 0.8, r * 0.8, n), ring(x0 + 0.1, y, z, r, r, n), ring(x1 - nose, y, z, r, r, n),
                 ring(x1 - nose * 0.4, y, z, r * 0.7, r * 0.7, n), ring(x1, y, z, r * 0.12, r * 0.12, n)], smooth=True)


def plate_xz(poly, y0, y1):
    """Platte: Polygon in der XZ-Ebene [(x, z)], zwischen y0 und y1 (y kann je Punkt eine Funktion von z sein)."""
    f0 = y0 if callable(y0) else (lambda z: y0)
    f1 = y1 if callable(y1) else (lambda z: y1)
    return loft([[(x, f0(z), z) for x, z in poly], [(x, f1(z), z) for x, z in poly]])


def afv_hull(N, rx, fx, ti, wm, wt, z_tub=0.4, z_sp=1.15, z_m=1.3, z_t=1.55, glacis=1.7, z_nose=1.14, mat='Olive'):
    """Panzerwanne: Unterwanne zwischen den Ketten (Bug/Heck angeschrägt) + Oberwanne mit Bugplatte."""
    N.add(loft([hsec(rx, ti, z_tub + 0.45, ti, z_sp - 0.1, ti, z_sp + 0.05),
                hsec(rx + 0.7, ti, z_tub, ti, z_sp - 0.2, ti, z_sp + 0.05),
                hsec(fx - glacis * 0.8, ti, z_tub, ti, z_sp - 0.2, ti, z_sp + 0.05),
                hsec(fx - 0.05, ti, z_sp - 0.22, ti, z_sp - 0.1, ti, z_sp + 0.05)]), 'Steel', top=False)
    N.add(loft([hsec(rx - 0.05, wm - 0.03, z_sp, wm, z_m, wt - 0.04, z_t - 0.07),
                hsec(rx + 0.9, wm - 0.03, z_sp, wm, z_m, wt, z_t),
                hsec(fx - glacis, wm - 0.03, z_sp, wm, z_m, wt, z_t),
                hsec(fx + 0.1, wm - 0.06, z_sp - 0.16, wm - 0.04, z_sp - 0.07, wt - 0.06, z_nose)]), mat)


def skirts(N, rx, fx, y, z0=0.6, z1=1.2, n=5):
    """Seitenschürzen (einzelne Platten) außen vor den Ketten."""
    L = (fx - rx) / n
    for sg in (1, -1):
        for k in range(n):
            N.add(box(rx + L * (k + 0.5), sg * y, L - 0.07, 0.06, z0, z1), 'Olive', top=False)


# ------------------------------------------------------------------ Ketten
TREAD_TILE = 1.36  # Meter Kettenband pro Texturkachel (4 Glieder) - im Spiel für die Laufanimation


def _hull2d(pts):
    pts = sorted(set(pts))
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 1e-9:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 1e-9:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def track_geo(x0, x1, zb, zt):
    """Laufwerk: Antriebs-/Leitrad hochgesetzt an den Enden, Laufrollen am Boden. -> (re, rw, Kreise)"""
    h = zt - zb
    re, rw = 0.3 * h, 0.27 * h
    cs = [(x0 + re, zt - re, re), (x1 - re, zt - re, re), (x0 + 0.5 * h + rw, zb + rw, rw), (x1 - 0.5 * h - rw, zb + rw, rw)]
    return re, rw, cs


def track_loop(x0, x1, y0, y1, zb, zt, n_arc=10):
    """Kettenschleife um Antriebsrad, Leitrad und Laufrollen (Seitenprofil = konvexe Hülle), entlang Y extrudiert.
    Lauffläche: UV u = Umfangsposition / TREAD_TILE (Laufanimation), v = Breite."""
    re, rw, cs = track_geo(x0, x1, zb, zt)
    pts = []
    for cx, cz, r in cs:
        for i in range(28):
            a = i / 28 * math.tau
            pts.append((round(cx + math.cos(a) * r, 5), round(cz + math.sin(a) * r, 5)))
    prof = _hull2d(pts)
    n = len(prof)
    L = [0.0]
    for i in range(1, n):
        L.append(L[-1] + math.dist(prof[i - 1], prof[i]))
    per = L[-1] + math.dist(prof[-1], prof[0])
    bm = bmesh.new()
    vs = [bm.verts.new((x, y0, z)) for x, z in prof] + [bm.verts.new((x, y1, z)) for x, z in prof]
    uvl = bm.loops.layers.uv.new('UVMap')
    for i in range(n):
        j = (i + 1) % n
        f = bm.faces.new([vs[i], vs[j], vs[n + j], vs[n + i]])
        s0, s1 = L[i], (L[j] if j else per)
        for l, (sv, vv) in zip(f.loops, ((s0, 0), (s1, 0), (s1, 1), (s0, 1))):
            l[uvl].uv = (sv / TREAD_TILE, vv)
        f.smooth = True
    bm.faces.new(vs[:n][::-1])
    bm.faces.new(vs[n:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def add_tracks(M, hull, u_pairs, v0, v1, zb, zt, wheels=5):
    """Zwei Ketten (TrackL/TrackR) als eigene Knoten unter 'hull': Antriebsrad, Leitrad, Laufrollen, Stützrollen."""
    for (u0, u1), name in zip(u_pairs, ('TrackL', 'TrackR')):
        a, b = M.P(u0, v1), M.P(u1, v0)
        x0, x1 = min(a[0], b[0]), max(a[0], b[0])
        y0, y1 = min(a[1], b[1]), max(a[1], b[1])
        node = Node(M, name, hull.pivot, hull, img='side_tread')
        node.add(track_loop(x0, x1, y0, y1, zb, zt), 'Rubber', img='side_tread', keepuv=True)
        re, rw, cs = track_geo(x0, x1, zb, zt)
        outer, sg = (y1, 1) if (y0 + y1) / 2 > 0 else (y0, -1)
        ya, yb = outer - 0.03 * sg, outer + 0.06 * sg
        for cx, cz, r in cs[:2]:   # Antriebs- und Leitrad
            node.add(tube((cx, ya, cz), (cx, yb, cz), r * 0.86, 16), 'Wheel', top=False)
            node.add(tube((cx, yb, cz), (cx, yb + 0.05 * sg, cz), r * 0.3, 8), 'Steel', top=False)
        xa, xb = cs[2][0], cs[3][0]
        for k in range(wheels):    # Laufrollen
            x = xa + (xb - xa) * k / max(1, wheels - 1)
            node.add(tube((x, ya, zb + rw), (x, yb, zb + rw), rw * 0.9, 16), 'Wheel', top=False)
            node.add(tube((x, yb, zb + rw), (x, yb + 0.05 * sg, zb + rw), rw * 0.3, 8), 'Steel', top=False)
        rr = 0.085 * (zt - zb)
        for k in range(3):         # Stützrollen unter dem oberen Kettenlauf
            x = xa + (xb - xa) * (k + 0.5) / 3
            node.add(tube((x, ya, zt - rr - 0.05), (x, yb - 0.02 * sg, zt - rr - 0.05), rr, 8), 'Steel', top=False)
        node.build()


def barrel(N, p0, p1, r, mat='Olive', sleeve=True):
    """Kanonenrohr: dickes Wurzelstück, schlankes Rohr, optional Rauchabsauger; Rohr zeigt p0 -> p1."""
    a, b = Vector(p0), Vector(p1)
    d = b - a
    N.add(tube(a, a + d * 0.22, r * 1.3, 12), mat)
    N.add(tube(a + d * 0.2, b, r, 12), mat)
    if sleeve:
        m = a + d * 0.5
        N.add(tube(m - d.normalized() * 0.45, m + d.normalized() * 0.45, r * 1.45, 12), mat, top=False)


# ------------------------------------------------------------------ Einheiten
def m_tank():
    M = Model('tank', 11.0, (0.5, 0.64))
    W = M.W
    hull = Node(M, 'Hull', img='tank_base')
    fx, rx = M.P(0.5, 0.28)[0], M.P(0.5, 0.99)[0]
    afv_hull(hull, rx, fx, 0.325 * W, 0.36 * W, 0.335 * W, 0.4, 1.15, 1.3, 1.58, 1.9, 1.16)
    skirts(hull, rx + 0.5, fx - 0.5, 0.5 * W + 0.02, 0.62, 1.22, 6)
    for sg in (1, -1):   # Kettenabdeckungen vorn/hinten
        hull.add(box(fx - 0.45, sg * 0.42 * W, 1.1, 0.16 * W, 1.17, 1.23), 'Olive', top=False)
        hull.add(box(rx + 0.45, sg * 0.42 * W, 1.0, 0.16 * W, 1.17, 1.23), 'Olive', top=False)
    for u in (0.24, 0.76):
        lamp(hull, (fx - 0.55, M.P(u, 0)[1], 1.42), (1, 0, -0.1), 0.12)
    hull.add(box(rx + 0.75, 0, 0.9, 0.42 * W, 1.52, 1.62), 'Steel', top=False)      # Lüftergitter Heck
    for u in (0.3, 0.7):
        hull.add(tube((rx + 0.05, M.P(u, 0)[1], 1.25), (rx - 0.2, M.P(u, 0)[1], 1.25), 0.12, 8), 'Steel', top=False)  # Auspuff
    for u in (0.36, 0.64):   # Schlepphaken
        hull.add(box(fx + 0.12, M.P(u, 0)[1], 0.16, 0.14, 0.95, 1.1), 'Steel', top=False)
    hull.add(tube((rx - 0.12, -0.9, 1.4), (rx - 0.12, 0.9, 1.4), 0.09, 8), 'Olive', top=False)   # Abschleppseil/Balken Heck
    hull.build()
    add_tracks(M, hull, [(0.0, 0.17), (0.83, 1.0)], 0.3, 0.99, 0.0, 1.15, 6)
    tp = M.P(0.5, 0.6)
    R = 0.35 * W
    tur = Node(M, 'Turret', (tp[0], tp[1], 1.55), hull)
    X = tp[0]
    tur.add(loft([hsec(X - 1.15 * R, 0.52 * R, 1.72, 0.6 * R, 1.98, 0.5 * R, 2.3),      # Turmheck (Munitionsbunker)
                  hsec(X - 0.55 * R, 0.8 * R, 1.56, 0.96 * R, 1.95, 0.78 * R, 2.45),
                  hsec(X + 0.35 * R, 0.8 * R, 1.56, 0.96 * R, 1.92, 0.74 * R, 2.45),
                  hsec(X + 1.0 * R, 0.42 * R, 1.6, 0.52 * R, 1.86, 0.36 * R, 2.22),     # Keilpanzerung
                  hsec(X + 1.36 * R, 0.24 * R, 1.72, 0.28 * R, 1.9, 0.2 * R, 2.1)]), 'Olive')
    c = M.P(0.645, 0.575)
    tur.add(frustum(c[0], c[1], 0.42, 0.36, 2.4, 2.65, 16), 'Steel')                   # Kommandantenkuppel
    tur.add(box(c[0] + 0.5, c[1], 0.3, 0.2, 2.66, 2.86), 'Steel', top=False)            # Fla-MG
    tur.add(tube((c[0] + 0.5, c[1], 2.8), (c[0] + 1.5, c[1], 2.84), 0.04, 6), 'Rubber', top=False)
    l = M.P(0.37, 0.62)
    tur.add(frustum(l[0], l[1], 0.34, 0.3, 2.42, 2.52, 12), 'Steel')                   # Ladeschützenluke
    for sg in (1, -1):
        smoke_launchers(tur, X + R * 0.5, tp[1] + sg * R * 0.78, 2.1, sg, n=4)
    for k in range(3):   # Staukorb (Gitter) am Turmheck
        tur.add(box(X - 1.32 * R, tp[1], 0.3, R * 1.05, 1.85 + k * 0.17, 1.89 + k * 0.17), 'Steel', top=False)
    for sy in (-0.5, 0, 0.5):
        tur.add(box(X - 1.45 * R, tp[1] + sy * R, 0.05, 0.05, 1.82, 2.25), 'Steel', top=False)
    antenna(tur, X - R * 0.9, tp[1] - R * 0.4, 2.3, 2.6)
    antenna(tur, X - R * 0.9, tp[1] + R * 0.4, 2.3, 1.6)
    tur.add(box(X + R * 0.3, tp[1] - R * 0.42, 0.4, 0.3, 2.42, 2.74, 0.03), 'Steel', top=False)  # Zielgerät
    tur.add(box(X + R * 0.3 + 0.2, tp[1] - R * 0.42, 0.04, 0.24, 2.48, 2.68), 'Glass', top=False)
    tur.build()
    gp = M.P(0.5, 0.43)
    gun = Node(M, 'Gun', (gp[0], 0, 1.98), tur)
    tip = M.P(0.5, 0.0)
    gun.add(box(gp[0] + 0.55, 0, 0.6, 0.7, 1.7, 2.26, 0.08), 'Olive', top=False)        # Blende
    barrel(gun, (gp[0] + 0.7, 0, 1.98), (tip[0], 0, 1.98), 0.15)
    gun.add(tube((tip[0] - 0.5, 0, 1.98), (tip[0], 0, 1.98), 0.23, 10), 'Steel', top=False)  # Mündungsbremse
    gun.add(tube((tip[0], 0, 1.98), (tip[0] + 0.02, 0, 1.98), 0.11, 10), 'Rubber', top=False)
    gun.build()
    empty('Muzzle', (tip[0] + 0.2, tip[1], 1.98), gun)


def m_ifv():
    M = Model('apc', 8.2, (0.5, 0.5))
    W = M.W
    hull = Node(M, 'Hull', img='apc_base')
    fx, rx = M.P(0.5, 0.0)[0], M.P(0.5, 1.0)[0]
    afv_hull(hull, rx + 0.1, fx - 0.1, 0.4 * W, 0.44 * W, 0.37 * W, 0.35, 1.0, 1.25, 1.9, 1.35, 1.12)
    skirts(hull, rx + 0.45, fx - 0.6, 0.5 * W + 0.02, 0.55, 1.05, 5)
    for u in (0.2, 0.8):
        lamp(hull, (fx - 0.55, M.P(u, 0)[1], 1.5), (1, 0, -0.1), 0.11)
    hull.add(box(rx + 0.03, 0, 0.12, 0.42 * W, 0.6, 1.7, 0.02), 'Steel', top=False)   # Heckrampe
    hull.add(box(rx - 0.04, 0.1 * W, 0.05, 0.14 * W, 1.1, 1.5), 'Olive', top=False)   # Tür in der Rampe
    for u in (0.27, 0.73):
        lamp(hull, (rx + 0.02, M.P(u, 0)[1], 1.6), (-1, 0, 0), 0.07, 'RedLight')
    for k in range(3):   # Winkelspiegel
        hull.add(box(M.P(0.5, 0.55 + k * 0.12)[0], M.P(0.74, 0)[1], 0.22, 0.16, 1.88, 2.02), 'Glass', top=False)
    antenna(hull, rx + 0.6, M.P(0.8, 0)[1], 1.88, 2.4)
    antenna(hull, rx + 0.6, M.P(0.2, 0)[1], 1.88, 1.6)
    hull.add(box(M.P(0.5, 0.7)[0], M.P(0.27, 0)[1], 1.4, 0.45, 1.88, 2.08, 0.04), 'Olive', top=False)   # Staukasten
    hull.add(box(fx - 0.75, 0, 0.1, 0.5 * W, 1.3, 1.62, 0.02), 'Steel', top=False)     # Schwallbrett am Bug
    hull.build()
    add_tracks(M, hull, [(0.0, 0.085), (0.915, 1.0)], 0.03, 0.97, 0.0, 1.0, 6)
    tp = M.P(0.3, 0.245)
    R = 0.21 * W
    X, Y = tp
    tur = Node(M, 'Turret', (X, Y, 1.9), hull)
    tur.add(loft([hsec(X - 1.1 * R, 0.6 * R, 1.95, 0.7 * R, 2.15, 0.55 * R, 2.42, Y),
                  hsec(X - 0.4 * R, 0.85 * R, 1.88, 0.98 * R, 2.15, 0.8 * R, 2.52, Y),
                  hsec(X + 0.5 * R, 0.8 * R, 1.88, 0.92 * R, 2.12, 0.72 * R, 2.52, Y),
                  hsec(X + 1.15 * R, 0.4 * R, 1.95, 0.46 * R, 2.12, 0.34 * R, 2.36, Y)]), 'Olive')
    for sg in (1, -1):
        smoke_launchers(tur, X + R * 0.2, Y + sg * R * 0.85, 2.25, sg, n=3)
    tur.add(box(X - 0.1 * R, Y + 1.12 * R, 0.95, 0.3, 2.12, 2.48, 0.03), 'Olive', top=False)   # Lenkflugkörper-Starter
    for dz in (2.22, 2.38):
        tur.add(tube((X - 0.1 * R + 0.47, Y + 1.12 * R, dz), (X - 0.1 * R + 0.5, Y + 1.12 * R, dz), 0.06, 8), 'Rubber', top=False)
    tur.add(box(X + R * 0.1, Y - R * 0.5, 0.35, 0.3, 2.5, 2.78, 0.03), 'Steel', top=False)     # Optik
    tur.add(box(X + R * 0.1 + 0.18, Y - R * 0.5, 0.04, 0.22, 2.56, 2.72), 'Glass', top=False)
    tur.build()
    gp, tip = M.P(0.405, 0.17), M.P(0.405, 0.03)
    gy = Y   # Kanone mittig im Turm
    gun = Node(M, 'Gun', (gp[0], gy, 2.22), tur)
    gun.add(box(gp[0] + 0.2, gy, 0.45, 0.42, 2.04, 2.4, 0.05), 'Olive', top=False)
    gun.add(tube((gp[0] + 0.3, gy, 2.22), (tip[0], gy, 2.22), 0.065, 8), 'Steel', top=False)
    gun.add(tube((gp[0] + 0.3, gy, 2.22), (gp[0] + 0.9, gy, 2.22), 0.1, 8), 'Olive', top=False)
    gun.add(tube((tip[0] - 0.3, gy, 2.22), (tip[0], gy, 2.22), 0.1, 8), 'Steel', top=False)
    gun.build()
    empty('Muzzle', (tip[0] + 0.1, gy, 2.22), gun)


def m_artillery():
    M = Model('artillery', 12.5, (0.5, 0.71))
    W = M.W
    hull = Node(M, 'Hull', img='artillery_base')
    fx, rx = M.P(0.5, 0.42)[0], M.P(0.5, 0.995)[0]
    afv_hull(hull, rx, fx, 0.385 * W, 0.41 * W, 0.37 * W, 0.35, 1.05, 1.2, 1.45, 1.5, 1.1)
    skirts(hull, rx + 0.5, fx - 0.5, 0.5 * W + 0.02, 0.58, 1.1, 5)
    for u in (0.2, 0.8):
        lamp(hull, (fx - 0.45, M.P(u, 0)[1], 1.33), (1, 0, -0.1), 0.11)
    for sg in (1, -1):   # Erdsporne am Heck
        hull.add(box(rx - 0.15, sg * 0.25 * W, 0.3, 0.5, 0.45, 1.25, 0.03), 'Steel', top=False)
    # Rohrzurrung (Marschstütze) auf dem Bug
    hull.add(tube((fx - 0.7, -0.35, 1.35), (fx - 0.5, 0, 2.2), 0.05, 6), 'Steel', top=False)
    hull.add(tube((fx - 0.7, 0.35, 1.35), (fx - 0.5, 0, 2.2), 0.05, 6), 'Steel', top=False)
    hull.build()
    add_tracks(M, hull, [(0.0, 0.1), (0.9, 1.0)], 0.44, 0.99, 0.0, 1.05, 6)
    tp = M.P(0.5, 0.76)
    tur = Node(M, 'Turret', (tp[0], tp[1], 1.45), hull)
    xs = lambda v: M.P(0.5, v)[0]
    tur.add(loft([hsec(xs(0.975), 0.35 * W, 1.55, 0.385 * W, 2.2, 0.29 * W, 2.78),
                  hsec(xs(0.9), 0.36 * W, 1.5, 0.385 * W, 2.2, 0.31 * W, 2.9),
                  hsec(xs(0.63), 0.36 * W, 1.5, 0.385 * W, 2.2, 0.3 * W, 2.9),
                  hsec(xs(0.57), 0.3 * W, 1.52, 0.33 * W, 2.15, 0.22 * W, 2.62),
                  hsec(xs(0.5), 0.15 * W, 1.78, 0.18 * W, 2.15, 0.13 * W, 2.5)]), 'Olive')
    rr = xs(0.975)
    for sg, u in ((1, 0.12), (-1, 0.88)):
        smoke_launchers(tur, xs(0.62), M.P(u, 0)[1] - sg * 0.35, 2.55, sg, n=4)
    antenna(tur, rr + 0.4, M.P(0.25, 0)[1], 2.8, 2.6)
    tur.add(box(rr - 0.06, tp[1], 0.12, 0.45 * W, 1.75, 2.6, 0.02), 'Steel', top=False)   # Munitionsluke
    for sg in (1, -1):   # Staukästen an den Turmseiten
        tur.add(box(xs(0.82), sg * 0.4 * W, 1.6, 0.14, 1.75, 2.15, 0.02), 'Olive', top=False)
    cu = M.P(0.3, 0.8)
    tur.add(frustum(cu[0], cu[1], 0.35, 0.3, 2.88, 3.12, 12), 'Steel', top=False)        # Kuppel
    mg = M.P(0.7, 0.75)
    tur.add(box(mg[0], mg[1], 0.3, 0.18, 2.9, 3.08), 'Steel', top=False)
    tur.add(tube((mg[0], mg[1], 3.02), (mg[0] + 0.9, mg[1], 3.04), 0.04, 6), 'Rubber', top=False)  # MG
    tur.build()
    gp, tip = M.P(0.5, 0.6), M.P(0.5, 0.0)
    gun = Node(M, 'Gun', (gp[0], gp[1], 2.2), tur)
    g0 = xs(0.51)
    gun.add(box(g0 + 0.1, 0, 0.6, 0.8, 1.86, 2.5, 0.08), 'Olive', top=False)             # Blende
    barrel(gun, (g0 + 0.2, 0, 2.2), (tip[0], 0, 2.2), 0.15)
    for k in range(2):   # Schlitz-Mündungsbremse
        gun.add(tube((tip[0] - 0.75 + k * 0.4, 0, 2.2), (tip[0] - 0.47 + k * 0.4, 0, 2.2), 0.26, 10), 'Steel', top=False)
    gun.add(tube((tip[0], 0, 2.2), (tip[0] + 0.02, 0, 2.2), 0.1, 10), 'Rubber', top=False)
    gun.build()
    empty('Muzzle', (tip[0] + 0.2, tip[1], 2.2), gun)


def m_mcv():
    M = Model('truck', 10.5, (0.5, 0.5))
    W = M.W
    hull = Node(M, 'Hull')
    xs = lambda v: M.P(0.5, v)[0]
    for v in (0.13, 0.36, 0.62, 0.77):   # 8x8
        for u, s in ((0.07, 1), (0.93, -1)):
            p = M.P(u, v)
            hull.add(tube((p[0], p[1] - 0.3 * s, 0.62), (p[0], p[1] + 0.3 * s, 0.62), 0.62, 18), 'Wheel', top=False)
            hull.add(tube((p[0], p[1] + 0.3 * s, 0.62), (p[0], p[1] + 0.36 * s, 0.62), 0.2, 8), 'Steel', top=False)
            hull.add(box(p[0], p[1], 1.5, 0.66, 1.3, 1.36), 'Steel', top=False)   # Kotflügel
    hull.add(prism(M.rect(0.16, 0.06, 0.84, 0.98), 0.45, 1.05, 0.0), 'Steel')
    for sg in (1, -1):   # Tank und Staukasten am Rahmen
        hull.add(tube((xs(0.49) - 0.6, sg * 0.36 * W, 0.8), (xs(0.49) + 0.6, sg * 0.36 * W, 0.8), 0.3, 10), 'Steel', top=False)
    # Fahrerhaus: Haube, schräge Frontscheibe, Dach
    hull.add(loft([hsec(xs(0.0), 0.40 * W, 0.75, 0.42 * W, 1.2, 0.38 * W, 1.6),
                   hsec(xs(0.03), 0.42 * W, 0.7, 0.44 * W, 1.3, 0.40 * W, 1.9),
                   hsec(xs(0.17), 0.42 * W, 0.7, 0.44 * W, 1.9, 0.40 * W, 2.0),
                   hsec(xs(0.195), 0.42 * W, 0.7, 0.44 * W, 1.95, 0.40 * W, 2.05),
                   hsec(xs(0.27), 0.42 * W, 0.7, 0.44 * W, 1.95, 0.36 * W, 3.0),
                   hsec(xs(0.31), 0.42 * W, 0.7, 0.44 * W, 1.95, 0.36 * W, 3.0)]), 'Olive')
    for sg in (1, -1):   # Seitenfenster, Trittstufen
        hull.add(box(xs(0.255), sg * 0.405 * W, 0.75, 0.1, 2.15, 2.8), 'Glass', top=False)
        hull.add(box(xs(0.22), sg * 0.46 * W, 0.7, 0.2, 0.75, 0.82), 'Steel', top=False)
    # Plane: gewölbtes Verdeck über Spriegeln
    w = 0.41 * W
    sec = lambda x, k=1.0: [(x, -w * k, 1.05), (x, w * k, 1.05), (x, w * k, 2.55), (x, w * 0.62 * k, 2.98), (x, 0, 3.12), (x, -w * 0.62 * k, 2.98), (x, -w * k, 2.55)]
    hull.add(loft([sec(xs(0.305), 0.97), sec(xs(0.32)), sec(xs(0.875)), sec(xs(0.89), 0.97)]), 'Cloth')
    hull.add(prism(M.rect(0.11, 0.88, 0.89, 1.0), 0.7, 1.7, 0.05), 'Olive')
    for u in (0.0, 0.92):
        hull.add(prism(M.rect(u, 0.12, u + 0.08, 0.17), 1.95, 2.35, 0.0), 'Steel')
    fx = xs(0.0)
    for u in (0.18, 0.82):
        lamp(hull, (fx + 0.02, M.P(u, 0)[1], 1.1), (1, 0, -0.1), 0.15)
    hull.add(box(fx + 0.06, 0, 0.25, 0.86 * W, 0.5, 0.85, 0.03), 'Steel', top=False)   # Stoßstange
    hull.add(box(fx + 0.01, 0, 0.06, 0.4 * W, 1.0, 1.5), 'Rubber', top=False)          # Kühlergrill
    for u in (0.3, 0.7):
        beacon(hull, xs(0.29), M.P(u, 0)[1], 3.0 - 0.02, 0.12)
    antenna(hull, xs(0.3), M.P(0.85, 0)[1], 2.95, 2.0)
    hull.add(tube((xs(0.315), 0.39 * W, 1.1), (xs(0.315), 0.39 * W, 3.3), 0.09, 8), 'Steel', top=False)   # Auspuffrohr
    for u in (0.3, 0.7):
        lamp(hull, (xs(1.0) - 0.02, M.P(u, 0)[1], 1.2), (-1, 0, 0), 0.09, 'RedLight')
    hull.build()


def m_harvester():
    M = Model('harvester', 9.5, (0.5, 0.52))
    W = M.W
    xs = lambda v: M.P(0.5, v)[0]
    hull = Node(M, 'Hull', img='harvester_base')
    # Schaufel: gekrümmtes Profil, Seitenwangen, Zähne
    xb, xf = xs(0.2), xs(0.0)
    prof = [(xb + 0.1, 0.25), (xf - 0.2, 0.2), (xf - 0.2, 0.33), (xb + 0.75, 0.45), (xb + 0.45, 0.8), (xb + 0.4, 1.45), (xb + 0.12, 1.5), (xb + 0.05, 0.6)]
    hw = 0.5 * W
    hull.add(loft([[(x, -hw, z) for x, z in prof], [(x, hw, z) for x, z in prof]]), 'Steel')
    side = [(xb + 0.05, 0.25), (xf - 0.2, 0.2), (xf - 0.2, 0.36), (xb + 0.4, 1.5), (xb + 0.05, 1.5)]
    for sg in (1, -1):
        hull.add(plate_xz(side, sg * hw, sg * (hw - 0.12)), 'Steel', top=False)
    for k in range(7):
        y = -hw + (k + 0.5) * W / 7
        hull.add(loft([[(xf - 0.3, y - 0.16, 0.18), (xf - 0.3, y + 0.16, 0.18), (xf - 0.3, y + 0.16, 0.36), (xf - 0.3, y - 0.16, 0.36)],
                       [(xf + 0.12, y - 0.07, 0.16), (xf + 0.12, y + 0.07, 0.16), (xf + 0.12, y + 0.07, 0.22), (xf + 0.12, y - 0.07, 0.22)]]), 'Steel', top=False)
    for u in (0.3, 0.7):   # Hubarme mit Hydraulikzylindern
        y = M.P(u, 0)[1]
        hull.add(tube((xs(0.34), y, 1.75), (xb + 0.15, y, 1.1), 0.16, 8), 'Olive', top=False)
        hull.add(tube((xs(0.3), y, 1.95), (xb + 0.3, y, 1.45), 0.07, 8), 'Steel', top=False)
    # Rumpf mit abgeschrägtem Bug und Heck
    rx, bx = xs(1.0), xs(0.19)
    hull.add(loft([hsec(rx, 0.27 * W, 0.75, 0.32 * W, 1.4, 0.29 * W, 1.78),
                   hsec(rx + 0.8, 0.28 * W, 0.4, 0.32 * W, 1.4, 0.3 * W, 1.9),
                   hsec(bx - 0.7, 0.28 * W, 0.4, 0.32 * W, 1.4, 0.3 * W, 1.9),
                   hsec(bx, 0.27 * W, 0.65, 0.3 * W, 1.2, 0.27 * W, 1.6)]), 'Olive')
    # Kabine mit schräger Frontscheibe
    c0, c1 = xs(0.44), xs(0.2)
    hull.add(loft([hsec(c0, 0.16 * W, 1.9, 0.16 * W, 2.5, 0.135 * W, 3.2),
                   hsec(c1 - 1.0, 0.16 * W, 1.9, 0.16 * W, 2.5, 0.135 * W, 3.2),
                   hsec(c1 - 0.15, 0.16 * W, 1.9, 0.155 * W, 2.3, 0.125 * W, 2.5),
                   hsec(c1, 0.15 * W, 1.9, 0.15 * W, 2.1, 0.12 * W, 2.2)]), 'Olive')
    for sg in (1, -1):
        hull.add(box((c0 + c1 - 1.0) / 2, sg * 0.15 * W, c1 - 1.0 - c0 - 0.3, 0.08, 2.58, 3.05), 'Glass', top=False)
    hull.add(box(c0 - 0.02, 0, 0.06, 0.2 * W, 2.55, 3.05), 'Glass', top=False)
    for u0, u1 in ((0.24, 0.3), (0.7, 0.76)):
        hull.add(prism(M.rect(u0, 0.46, u1, 0.82), 1.9, 2.7, 0.06), 'Olive')
    for u in (0.4, 0.6):
        lamp(hull, (c1 - 1.0, M.P(u, 0)[1], 3.28), (1, 0, -0.3), 0.11)
    beacon(hull, xs(0.38), 0, 3.2, 0.14)
    for u in (0.24, 0.76):
        lamp(hull, (bx + 0.02, M.P(u, 0)[1], 1.35), (1, 0, -0.2), 0.12)
    ex = xs(0.9)
    for u in (0.24, 0.76):   # Auspuff-Schornsteine
        y = M.P(u, 0)[1]
        hull.add(tube((ex, y, 1.9), (ex, y, 3.6), 0.11, 8), 'Steel', top=False)
        hull.add(tube((ex, y, 3.6), (ex - 0.05, y, 3.75), 0.14, 8), 'Rubber', top=False)
    hull.add(box(rx - 0.02, 0, 0.1, 0.4 * W, 0.9, 1.6, 0.02), 'Steel', top=False)        # Entladeklappe
    for u in (0.32, 0.68):
        lamp(hull, (rx - 0.03, M.P(u, 0)[1], 1.68), (-1, 0, 0), 0.08, 'RedLight')
    hull.build()
    add_tracks(M, hull, [(0.03, 0.2), (0.8, 0.97)], 0.33, 0.9, 0.0, 1.35, 5)
    # Ladung: Kristalle (Originalbild) + 3D-Spitzen
    lp = M.P(0.5, 0.64)
    load = Node(M, 'Load', (lp[0], lp[1], 2.0), hull, img='harvester')
    load.add(prism(M.rect(0.3, 0.49, 0.7, 0.79), 1.9, 2.55, 0.05), 'Ore')
    rnd = random.Random(4)
    for k in range(14):
        u, v = 0.33 + rnd.random() * 0.34, 0.52 + rnd.random() * 0.25
        p = M.P(u, v)
        h = 0.5 + rnd.random() * 0.6
        load.add(frustum(p[0], p[1], 0.22, 0.02, 2.4, 2.4 + h, 5), 'Ore', top=False)
    load.build()


def m_heli():
    M = Model('heli', 13.0, (0.5, 0.385))
    W = M.W
    xs = lambda v: M.P(0.5, v)[0]
    B = Node(M, 'Body', img='heli_base')
    # Rumpf: Nase, Kabine, Triebwerksbereich, Heckausleger
    B.add(body([(xs(0.0), 0.12, 0.14, 1.45, 2), (xs(0.03), 0.5, 0.42, 1.5, 2), (xs(0.075), 0.85, 0.72, 1.62, 2.3),
                (xs(0.15), 1.1, 0.95, 1.8, 2.5), (xs(0.25), 1.25, 1.0, 1.85, 2.8), (xs(0.4), 1.3, 1.0, 1.85, 3.0),
                (xs(0.54), 1.2, 0.9, 1.9, 2.6), (xs(0.62), 0.7, 0.6, 2.05, 2), (xs(0.73), 0.36, 0.34, 2.15, 2),
                (xs(0.97), 0.2, 0.22, 2.25, 2)], 16), 'Olive')
    # Kanzel (Glas)
    B.add(body([(xs(0.045), 0.3, 0.25, 1.78, 2), (xs(0.08), 0.74, 0.6, 1.97, 2.2), (xs(0.14), 0.92, 0.8, 2.17, 2.4),
                (xs(0.2), 0.94, 0.8, 2.22, 2.4), (xs(0.25), 0.6, 0.5, 2.32, 2)], 14), 'Glass')
    for sg in (1, -1):   # Triebwerksgondeln mit Einlauf und Abgasrohr
        y = sg * 1.0
        B.add(loft([ring(xs(0.57), y, 2.45, 0.3, 0.3, 10), ring(xs(0.54), y, 2.5, 0.42, 0.42, 10), ring(xs(0.36), y, 2.5, 0.44, 0.44, 10),
                    ring(xs(0.33), y, 2.5, 0.36, 0.36, 10)], smooth=True), 'Olive')
        B.add(tube((xs(0.33) + 0.01, y, 2.5), (xs(0.33) + 0.04, y, 2.5), 0.3, 10), 'Rubber', top=False)
        B.add(tube((xs(0.57), y + sg * 0.05, 2.45), (xs(0.6), y + sg * 0.25, 2.5), 0.24, 8), 'Steel', top=False)
    # Stummelflügel mit Raketenbehältern und Lenkflugkörpern
    B.add(prism(M.rect(0.24, 0.37, 0.76, 0.45), 1.56, 1.72, 0.04), 'Olive')
    for u in (0.265, 0.735):
        y = M.P(u, 0)[1]
        B.add(loft([ring(xs(0.5), y, 1.28, 0.25, 0.25, 10), ring(xs(0.49), y, 1.28, 0.31, 0.31, 10), ring(xs(0.35), y, 1.28, 0.31, 0.31, 10),
                    ring(xs(0.33), y, 1.28, 0.24, 0.24, 10)], smooth=True), 'Steel')
        B.add(tube((xs(0.33), y, 1.28), (xs(0.33) + 0.03, y, 1.28), 0.2, 10), 'Rubber', top=False)
        B.add(box(xs(0.415), y, 0.5, 0.1, 1.5, 1.6), 'Steel', top=False)
    for u in (0.35, 0.65):
        y = M.P(u, 0)[1]
        for dy in (-0.14, 0.14):
            B.add(pod(xs(0.47), xs(0.34), y + dy, 1.4, 0.075, 0.3, 6), 'Steel', top=False)
        B.add(box(xs(0.41), y, 0.6, 0.4, 1.47, 1.57), 'Steel', top=False)
    # Leitwerk
    fin = [(xs(0.89), 2.15), (xs(0.985), 2.2), (xs(1.0) - 0.15, 3.75), (xs(0.965), 3.75)]
    B.add(plate_xz(fin, -0.07, 0.07), 'Olive', top=False)
    B.add(prism(M.rect(0.29, 0.785, 0.71, 0.83), 2.2, 2.3, 0.03), 'Olive')
    for u in (0.29, 0.71):
        B.add(box(xs(0.807), M.P(u, 0)[1], 0.6, 0.06, 2.0, 2.55), 'Olive', top=False)   # Endscheiben
    # Fahrwerk
    for sg in (1, -1):
        B.add(tube((xs(0.36), sg * 1.3, 0.36), (xs(0.36), sg * 1.55, 0.36), 0.36, 14), 'Wheel', top=False)
        B.add(tube((xs(0.36), sg * 1.35, 0.4), (xs(0.37), sg * 0.9, 1.25), 0.07, 6), 'Steel', top=False)
        B.add(tube((xs(0.36), sg * 1.35, 0.4), (xs(0.44), sg * 0.8, 1.1), 0.05, 6), 'Steel', top=False)
    B.add(tube((xs(0.9), -0.1, 0.24), (xs(0.9), 0.1, 0.24), 0.24, 12), 'Wheel', top=False)
    B.add(tube((xs(0.9), 0, 0.3), (xs(0.87), 0, 2.05), 0.05, 6), 'Steel', top=False)
    # Bugkanone, Sensorturm
    B.add(frustum(xs(0.07), 0, 0.26, 0.2, 0.72, 1.0, 10), 'Steel', top=False)
    B.add(tube((xs(0.07), 0, 0.8), (xs(0.0) + 0.2, 0, 0.74), 0.06, 8), 'Rubber', top=False)
    B.add(frustum(xs(0.015), 0, 0.2, 0.2, 1.05, 1.3, 8), 'Steel', top=False)
    B.add(box(xs(0.015) + 0.2, 0, 0.04, 0.2, 1.1, 1.26), 'Glass', top=False)
    beacon(B, xs(0.6), 0, 2.62, 0.09)
    B.build()
    hp = M.P(0.5, 0.385)
    rot = Node(M, 'Rotor', (hp[0], hp[1], 3.3), B, img='heli')
    rot.add(frustum(hp[0], hp[1], 0.42, 0.26, 2.8, 3.24, 12), 'Steel', top=False)     # Mast
    rot.add(frustum(hp[0], hp[1], 0.5, 0.42, 3.22, 3.42, 12), 'Steel')                # Rotorkopf
    rot.add(frustum(hp[0], hp[1], 0.25, 0.1, 3.42, 3.6, 10), 'Steel', top=False)
    for tu, tv in ((0.02, 0.045), (0.98, 0.045), (0.02, 0.735), (0.98, 0.735)):
        a, b = Vector(hp), Vector(M.P(tu, tv))
        d = (b - a).normalized()
        n = Vector((-d.y, d.x)) * 0.3
        pts = [a + n, b + n, b - n, a - n]
        rot.add(prism([(p.x, p.y) for p in pts], 3.29, 3.35, 0.0), 'Steel')
    rot.build()
    tx, ty, tz = xs(0.975), -0.2, 3.15
    tr = Node(M, 'TailRotor', (tx, ty, tz), B)
    for k in range(2):
        a = k * math.pi / 2
        bm = prism(rect_inset_poly(-0.1, -0.03, 0.1, 0.03), -0.95, 0.95, 0)
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'X') @ Matrix.Rotation(a, 3, 'Y'), verts=bm.verts)
        bmesh.ops.translate(bm, vec=(tx, ty, tz), verts=bm.verts)
        tr.add(bm, 'Steel', top=False)
    tr.add(tube((tx, ty + 0.12, tz), (tx, ty - 0.08, tz), 0.12, 8), 'Steel', top=False)
    tr.build()
    empty('Muzzle', (M.P(0.26, 0.33)[0] + 0.3, M.P(0.26, 0.33)[1], 1.3), B)


def m_jet():
    M = Model('jet', 17.0, (0.5, 0.55))
    W = M.W
    xs = lambda v: M.P(0.5, v)[0]
    B = Node(M, 'Body')
    # Rumpf: Radom, Cockpitsektion, Lufteinläufe, Triebwerkssektion
    B.add(body([(xs(0.0), 0.06, 0.06, 1.55, 2), (xs(0.05), 0.28, 0.26, 1.56, 2), (xs(0.1), 0.45, 0.42, 1.6, 2),
                (xs(0.16), 0.72, 0.6, 1.66, 2.2), (xs(0.3), 1.05, 0.78, 1.72, 2.5), (xs(0.37), 1.5, 0.76, 1.7, 3.2),
                (xs(0.45), 1.62, 0.74, 1.68, 3.6), (xs(0.7), 1.62, 0.7, 1.65, 3.6), (xs(0.93), 1.45, 0.6, 1.6, 3.0)], 18), 'Olive')
    # Kanzelhaube
    B.add(body([(xs(0.125), 0.2, 0.15, 2.02, 2), (xs(0.17), 0.45, 0.42, 2.2, 2), (xs(0.235), 0.5, 0.5, 2.3, 2),
                (xs(0.295), 0.42, 0.4, 2.3, 2), (xs(0.335), 0.2, 0.15, 2.3, 2)], 12), 'Glass')
    # Tragflächen und Höhenleitwerk (dünn)
    B.add(prism(M.poly([(0.42, 0.33), (0.0, 0.71), (0.0, 0.77), (0.42, 0.74)]), 1.55, 1.7, 0.05), 'Olive')
    B.add(prism(M.poly([(0.58, 0.33), (1.0, 0.71), (1.0, 0.77), (0.58, 0.74)]), 1.55, 1.7, 0.05), 'Olive')
    B.add(prism(M.poly([(0.42, 0.7), (0.2, 0.96), (0.31, 0.985), (0.42, 0.9)]), 1.52, 1.63, 0.04), 'Olive')
    B.add(prism(M.poly([(0.58, 0.7), (0.8, 0.96), (0.69, 0.985), (0.58, 0.9)]), 1.52, 1.63, 0.04), 'Olive')
    for sg in (1, -1):
        # Seitenleitwerke, nach außen geneigt
        fin = [(xs(0.685), 2.1), (xs(0.9), 2.1), (xs(0.94), 4.3), (xs(0.86), 4.3)]
        yb = lambda z, s=sg: s * (1.2 + (z - 2.1) * 0.27)
        B.add(plate_xz(fin, lambda z: yb(z) - 0.05, lambda z: yb(z) + 0.05), 'Olive', top=False)
        # Lufteinlauf unter der Flügelwurzel
        B.add(loft([hsec(xs(0.44), 0.3, 0.92, 0.36, 1.2, 0.36, 1.5, sg * 1.2), hsec(xs(0.345), 0.3, 0.95, 0.36, 1.2, 0.36, 1.5, sg * 1.2)]), 'Olive', top=False)
        B.add(box(xs(0.345) + 0.02, sg * 1.2, 0.05, 0.58, 1.0, 1.46), 'Rubber', top=False)
        # Schubdüse
        y = sg * 0.84
        B.add(loft([ring(xs(0.9), y, 1.56, 0.6, 0.58, 14), ring(xs(0.955), y, 1.56, 0.56, 0.56, 14), ring(xs(0.985), y, 1.56, 0.5, 0.5, 14),
                    ring(xs(1.0), y, 1.56, 0.4, 0.4, 14)], smooth=True), 'Steel')
        B.add(tube((xs(1.0) + 0.06, y, 1.56), (xs(1.0) - 0.01, y, 1.56), 0.34, 12), 'Rubber', top=False)
        # Lenkflugkörper unter den Flächen und an den Flügelspitzen
        B.add(pod(xs(0.72), xs(0.56), sg * 3.0, 1.38, 0.1, 0.4, 6), 'Steel', top=False)
        B.add(box(xs(0.64), sg * 3.0, 1.2, 0.08, 1.45, 1.56), 'Steel', top=False)
        B.add(pod(xs(0.76), xs(0.63), sg * 4.7, 1.4, 0.09, 0.35, 6), 'Steel', top=False)
        B.add(box(xs(0.7), sg * 4.7, 1.0, 0.08, 1.46, 1.56), 'Steel', top=False)
        B.add(pod(xs(0.78), xs(0.68), sg * (0.5 * W + 0.05), 1.62, 0.08, 0.3, 6), 'Steel', top=False)
    B.add(tube((xs(0.0), 0, 1.55), (xs(0.0) + 0.6, 0, 1.55), 0.02, 4), 'Steel', top=False)   # Staurohr
    B.add(box(xs(0.5), 0, 2.6, 0.5, 2.3, 2.42, 0.1), 'Olive', top=False)                      # Rückenwulst
    B.build()
    G = Node(M, 'Gear', (0, 0, 0), B)
    for x, y, r in ((xs(0.2), 0.0, 0.27), (xs(0.63), 1.55, 0.33), (xs(0.63), -1.55, 0.33)):
        G.add(tube((x, y - 0.1, r), (x, y + 0.1, r), r, 12), 'Wheel', top=False)
        G.add(tube((x, y, r), (x + 0.15, y * 0.8, 1.2), 0.06, 6), 'Steel', top=False)
        G.add(box(x + 0.1, y * 0.9, 0.5, 0.05, 0.75, 1.15), 'Olive', top=False)   # Fahrwerksklappe
    G.build()
    empty('Muzzle', (xs(0.0), 0, 1.5), B)
    e = M.P(0.5, 1.0)
    empty('FX_afterburner', (e[0], e[1], 1.5), B)


def m_flak():
    """Flugabwehrpanzer auf dem Fahrgestell des Kampfpanzers: Kastenturm, zwei außenliegende Maschinenkanonen,
    Suchradar (dreht, Knoten 'Dish') und Folgeradar an der Turmfront."""
    M = Model('tank', 11.0, (0.5, 0.64))
    W = M.W
    hull = Node(M, 'Hull', img='tank_base')
    fx, rx = M.P(0.5, 0.28)[0], M.P(0.5, 0.99)[0]
    afv_hull(hull, rx, fx, 0.325 * W, 0.36 * W, 0.335 * W, 0.4, 1.15, 1.3, 1.58, 1.9, 1.16)
    skirts(hull, rx + 0.5, fx - 0.5, 0.5 * W + 0.02, 0.62, 1.22, 6)
    for sg in (1, -1):
        hull.add(box(fx - 0.45, sg * 0.42 * W, 1.1, 0.16 * W, 1.17, 1.23), 'Olive', top=False)
        hull.add(box(rx + 0.45, sg * 0.42 * W, 1.0, 0.16 * W, 1.17, 1.23), 'Olive', top=False)
    for u in (0.24, 0.76):
        lamp(hull, (fx - 0.55, M.P(u, 0)[1], 1.42), (1, 0, -0.1), 0.12)
    hull.add(box(rx + 0.75, 0, 0.9, 0.42 * W, 1.52, 1.62), 'Steel', top=False)
    for u in (0.3, 0.7):
        hull.add(tube((rx + 0.05, M.P(u, 0)[1], 1.25), (rx - 0.2, M.P(u, 0)[1], 1.25), 0.12, 8), 'Steel', top=False)
    hull.add(box(rx + 1.6, 0, 1.0, 1.6, 1.58, 1.95, 0.06), 'Olive', top=False)       # Stromaggregat auf dem Heck
    hull.build()
    add_tracks(M, hull, [(0.0, 0.17), (0.83, 1.0)], 0.3, 0.99, 0.0, 1.15, 6)
    tp = M.P(0.5, 0.58)
    X, hw = tp[0], 1.5
    tur = Node(M, 'Turret', (X, 0, 1.58), hull)
    tur.add(frustum(X, 0, 1.65, 1.65, 1.5, 1.66, 20), 'Steel', top=False)             # Drehkranz
    tur.add(loft([hsec(X - 2.1, hw * 0.8, 1.78, hw * 0.9, 2.1, hw * 0.74, 2.5),
                  hsec(X - 1.4, hw * 0.95, 1.64, hw, 2.1, hw * 0.85, 2.72),
                  hsec(X + 1.1, hw * 0.95, 1.64, hw, 2.1, hw * 0.82, 2.72),
                  hsec(X + 1.95, hw * 0.7, 1.72, hw * 0.78, 2.05, hw * 0.6, 2.36)]), 'Olive')
    # Folgeradar an der Turmfront (Schale nach vorn)
    tur.add(loft([ring(X + 1.9, 0, 2.15, 0.22, 0.22, 12), ring(X + 2.1, 0, 2.15, 0.5, 0.5, 12), ring(X + 2.16, 0, 2.15, 0.52, 0.52, 12)], smooth=True), 'Steel', top=False)
    tur.add(tube((X + 2.17, 0, 2.15), (X + 2.19, 0, 2.15), 0.46, 12), 'Rubber', top=False)
    for sg in (1, -1):
        smoke_launchers(tur, X - 1.0, sg * hw * 0.98, 2.35, sg, n=4)
    c = (X + 0.2, -0.6)
    tur.add(frustum(c[0], c[1], 0.36, 0.3, 2.7, 2.9, 14), 'Steel', top=False)          # Kommandantenluke
    tur.add(box(X + 0.6, 0.65, 0.4, 0.3, 2.7, 3.0, 0.03), 'Steel', top=False)          # Optik
    tur.add(box(X + 0.81, 0.65, 0.04, 0.24, 2.76, 2.96), 'Glass', top=False)
    antenna(tur, X - 1.9, 1.0, 2.5, 2.4)
    beacon(tur, X - 1.9, -1.0, 2.5, 0.08)
    tur.add(tube((X - 1.4, 0, 2.7), (X - 1.4, 0, 3.25), 0.12, 8), 'Steel', top=False)   # Radarmast
    tur.build()
    # Suchradar (dreht sich im Spiel)
    dish = Node(M, 'Dish', (X - 1.4, 0, 3.25), tur)
    dish.add(frustum(X - 1.4, 0, 0.2, 0.2, 3.25, 3.4, 8), 'Steel', top=False)
    prof = [(-0.9, 0.12), (-0.45, 0.02), (0.0, -0.02), (0.45, 0.02), (0.9, 0.12)]       # gekrümmter Reflektor (Draufsicht)
    dish.add(loft([[(X - 1.4 + dx, y, 3.4), (X - 1.4 + dx + 0.06, y, 3.4), (X - 1.4 + dx + 0.06, y, 4.0), (X - 1.4 + dx, y, 4.0)] for y, dx in prof]), 'Steel', top=False)
    dish.add(tube((X - 1.4, 0, 3.5), (X - 0.85, 0, 3.7), 0.04, 6), 'Steel', top=False)
    dish.add(box(X - 0.82, 0, 0.12, 0.2, 3.62, 3.78), 'Rubber', top=False)
    dish.build()
    # Zwillings-Maschinenkanonen außen am Turm (gemeinsam richtbar)
    gz = 2.2
    gun = Node(M, 'Gun', (X + 0.2, 0, gz), tur)
    gun.add(tube((X + 0.2, -(hw + 0.3), gz), (X + 0.2, hw + 0.3, gz), 0.13, 8), 'Steel', top=False)   # Schildzapfen
    for sg in (1, -1):
        y = sg * (hw + 0.36)
        gun.add(box(X + 0.25, y, 1.9, 0.5, gz - 0.33, gz + 0.33, 0.05), 'Olive', top=False)           # Waffengehäuse
        gun.add(box(X - 0.45, y - sg * 0.3, 0.7, 0.3, gz - 0.2, gz + 0.25), 'Steel', top=False)        # Gurtzuführung
        gun.add(tube((X + 1.1, y, gz), (X + 2.4, y, gz), 0.11, 8), 'Steel', top=False)
        gun.add(tube((X + 2.3, y, gz), (X + 4.4, y, gz), 0.06, 8), 'Steel', top=False)
        gun.add(loft([ring(X + 4.35, y, gz, 0.07, 0.07, 8), ring(X + 4.75, y, gz, 0.13, 0.13, 8)], smooth=True), 'Rubber', top=False)   # Mündungsfeuerdämpfer
    gun.build()
    for sg in (1, -1):
        empty('Muzzle', (X + 4.8, sg * (hw + 0.36), gz), gun)


# ------------------------------------------------------------------ Gebäude
def lathe(cx, cy, prof, n=28):
    """Rotationskörper aus Profil [(r, z), ...] von unten nach oben (Kühlturm, Schornstein, Silo)."""
    return loft([[(cx + math.cos(i / n * math.tau) * r, cy + math.sin(i / n * math.tau) * r, z) for i in range(n)] for r, z in prof], smooth=True)


def hsec_y(y, wb, zb, wm, zm, wt, zt, cx=0.0):
    """Wie hsec, aber Querschnitt bei y (Körper entlang Y)."""
    return [(cx - wb, y, zb), (cx + wb, y, zb), (cx + wm, y, zm), (cx + wt, y, zt), (cx - wt, y, zt), (cx - wm, y, zm)]


def lattice_mast(N, cx, cy, zb, zt, hb, ht, levels=5, r=0.07, mat='Steel'):
    """Gittermast: 4 Eckstiele (unten hb, oben ht halbe Breite) mit Diagonalen und Riegeln."""
    legs = ((-1, -1), (1, -1), (1, 1), (-1, 1))
    P = lambda sx, sy, t: (cx + sx * (hb + (ht - hb) * t), cy + sy * (hb + (ht - hb) * t), zb + (zt - zb) * t)
    for sx, sy in legs:
        N.add(tube(P(sx, sy, 0), P(sx, sy, 1), r, 6), mat, top=False)
    for i in range(levels):
        t0, t1 = i / levels, (i + 1) / levels
        for e in range(4):
            (ax, ay), (bx, by) = legs[e], legs[(e + 1) % 4]
            N.add(tube(P(ax, ay, t0), P(bx, by, t1), r * 0.5, 4), mat, top=False)
            N.add(tube(P(ax, ay, t1), P(bx, by, t1), r * 0.5, 4), mat, top=False)


def windows(N, x0, x1, y, z0, z1, n, face=-1):
    """Fensterband in einer Wand mit Normal (0, face): n Glasfelder mit Stahlrahmen."""
    L = (x1 - x0) / n
    N.add(box((x0 + x1) / 2, y + face * 0.03, x1 - x0 + 0.16, 0.08, z0 - 0.08, z1 + 0.08), 'Steel', top=False)
    for k in range(n):
        N.add(box(x0 + L * (k + 0.5), y + face * 0.08, L - 0.12, 0.04, z0, z1), 'Glass', top=False)


def ladder(N, x, y, z0, z1, face=-1):
    for dx in (-0.2, 0.2):
        N.add(box(x + dx, y + face * 0.08, 0.04, 0.04, z0, z1), 'Steel', top=False)
    for k in range(int((z1 - z0) / 0.4)):
        N.add(box(x, y + face * 0.08, 0.4, 0.03, z0 + 0.3 + k * 0.4, z0 + 0.33 + k * 0.4), 'Steel', top=False)


# ------------------------------------------------------------------ Requisiten von Poly Haven (CC0)
# Vereinfachte Modelle aus assets/props/<id>.glb werden in den Gebäudeknoten eingebaut; ihre Textur liegt als
# art/crop/prop_<id>.jpg vor (tools/make_side_textures.py) -> Material 'Art_prop_<id>' (im Spiel ohne Teamfarbe).
PROP_CACHE = {}
PROP_SMOOTH = {'Barrel_01', 'propane_tank', 'old_tyre'}


def load_prop(pid, tris=120):
    if pid in PROP_CACHE:
        return PROP_CACHE[pid]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, '..', 'assets', 'props', pid + '.glb'))
    obs = [o for o in bpy.data.objects if o not in before]
    bpy.context.view_layer.update()
    verts, faces = [], []
    for o in obs:
        if o.type != 'MESH':
            continue
        n = sum(len(p.vertices) - 2 for p in o.data.polygons)
        if n > tris:
            o.modifiers.new('d', 'DECIMATE').ratio = tris / n
        dg = bpy.context.evaluated_depsgraph_get()
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        uvl = me.uv_layers.active.data
        base, mw = len(verts), o.matrix_world
        verts += [tuple(mw @ v.co) for v in me.vertices]
        for p in me.polygons:
            faces.append(([base + i for i in p.vertices], [tuple(uvl[li].uv) for li in p.loop_indices]))
        ev.to_mesh_clear()
    for o in obs:
        bpy.data.objects.remove(o, do_unlink=True)
    xs = [v[0] for v in verts]; ys = [v[1] for v in verts]; zs = [v[2] for v in verts]
    cx, cy, z0 = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)
    verts = [(x - cx, y - cy, z - z0) for x, y, z in verts]
    PROP_CACHE[pid] = (verts, faces, max(zs) - z0, max(max(xs) - min(xs), max(ys) - min(ys)))
    return PROP_CACHE[pid]


def prop(N, pid, x, y, z, rot=0.0, s=1.6):
    """Setzt eine Requisite auf (x, y, z); gibt ihre Höhe zurück (zum Stapeln)."""
    verts, faces, h, _ = load_prop(pid)
    c, sn = math.cos(rot), math.sin(rot)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    vs = [bm.verts.new((x + (vx * c - vy * sn) * s, y + (vx * sn + vy * c) * s, z + vz * s)) for vx, vy, vz in verts]
    sm = pid in PROP_SMOOTH
    for idx, uvs in faces:
        try:
            f = bm.faces.new([vs[i] for i in idx])
        except ValueError:
            continue
        f.smooth = sm
        for l, t in zip(f.loops, uvs):
            l[uvl].uv = t
    bm.normal_update()
    N.add(bm, 'Steel', img='prop_' + pid, keepuv=True, allfaces=True)
    return h * s


def cluster(N, M, u, v, kinds, n, seed=1, z=0.35, s=1.6):
    """Lockere Gruppe aus n Requisiten um den Bildpunkt (u, v); Kisten werden teils gestapelt."""
    rnd = random.Random(seed)
    cx, cy = M.P(u, v)
    last = None
    for i in range(n):
        pid = kinds[i % len(kinds)]
        size = load_prop(pid)[3] * s
        if last and last[0] == pid and 'crate' in pid and rnd.random() < 0.45:   # auf die vorige Kiste stapeln
            prop(N, pid, last[1], last[2], z + last[3], last[4] + (rnd.random() - 0.5) * 0.5, s)
            last = None
            continue
        a, r = i * 2.4 + rnd.random() * 0.6, 0.5 * math.sqrt(i) * max(size, 1.0)
        (bx0, by1), (bx1, by0) = M.P(0, 0), M.P(1, 1)     # innerhalb des Sockels bleiben
        mg = size * 0.5 + 0.25
        x = min(max(cx + math.cos(a) * r, bx0 + mg), bx1 - mg)
        y = min(max(cy + math.sin(a) * r, by0 + mg), by1 - mg)
        rot = rnd.random() * math.tau if 'crate' not in pid else rnd.choice((0, math.pi / 2)) + (rnd.random() - 0.5) * 0.3
        h = prop(N, pid, x, y, z, rot, s)
        last = (pid, x, y, h, rot)


def barriers(N, M, u0, u1, v, z=0.35, s=1.6):
    """Reihe Betonsperren entlang einer Bildzeile."""
    a, b = M.P(u0, v), M.P(u1, v)
    L = load_prop('concrete_road_barrier')[3] * s + 0.15
    n = max(1, int(abs(b[0] - a[0]) / L))
    for i in range(n):
        prop(N, 'concrete_road_barrier', a[0] + (b[0] - a[0]) * (i + 0.5) / n, a[1], z, 0.0, s)


CRATES = ['wooden_military_crate']
DRUMS = ['Barrel_01', 'Barrel_01', 'propane_tank']
MIXED = ['wooden_military_crate', 'Barrel_01', 'metal_jerrycan_green', 'Barrel_01']


# ------------------------------------------------------------------ Gebäude
# Die Vorlagen sind schräg von oben gezeichnet: unter jedem Dach ist die Südfassade mitgezeichnet, und hohe Teile
# (Kran, Schornstein, Kühlturm, Mast) erscheinen nach Norden versetzt. Deshalb gilt für alle Gebäude:
#  * Körper folgen exakt den Umrissen im Bild (Bildkoordinaten u, v);
#  * die gezeichnete Fassade wird auf eine schräge Südwand projiziert (ublock/shed mit 'front');
#  * hohe Teile stehen auf ihrem Fuß, ihre Deckfläche holt sich den versetzt gezeichneten Bildausschnitt (cap_uv/src_uv),
#    und die am Boden zurückbleibende Zeichnung wird mit einer Betonplatte abgedeckt (cover);
#  * keine frei platzierten Zusatzteile, die mit gezeichneten Details kollidieren.
def bld_pad(N, M, u0=0.0, v0=0.0, u1=1.0, v1=1.0, h=0.35):
    N.add(prism(M.rect(u0, v0, u1, v1), 0.0, h, 0.05), 'Concrete')


def art_fn(M):
    """Bildprojektion für Dachflächen und für die schräge Südwand (gezeichnete Fassade)."""
    def fn(f):
        if f.normal.z > 0.35 or (f.normal.y < -0.25 and f.normal.z > 0.02):
            return lambda c: M.UV(c.x, c.y)
        return None
    return fn


def ublock(N, M, u0, v0, u1, v1, z0, z1, side='Olive', front=None, inset=0.0):
    """Quader nach Bildkoordinaten: Dach u0..u1 x v0..v1 auf Höhe z1. front = v-Wert, bis zu dem die gezeichnete
    Südfassade reicht -> schräge Südwand vom Dachrand hinunter zum Boden bei v = front, mit Bild."""
    (xa, yn), (xb, ys) = M.P(u0, v0), M.P(u1, v1)
    yf = M.P(u0, front)[1] if front is not None else ys
    i = inset
    verts = [(xa, yn, z0), (xb, yn, z0), (xb, yf, z0), (xa, yf, z0),
             (xa + i, yn - i, z1), (xb - i, yn - i, z1), (xb - i, ys, z1), (xa + i, ys, z1)]
    bm = mkbm(verts, [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7], [3, 2, 1, 0]])
    N.add(bm, side, uvfn=art_fn(M) if front is not None else None)


def shed(N, M, u0, u1, v0, v1, vf, prof, z0=0.35, side='Olive'):
    """Halle mit Dachprofil prof = [(t, z), ...] (t = 0..1 von West nach Ost), von v0 bis v1; davor die schräge
    Südwand bis v = vf mit der gezeichneten Giebelseite."""
    xa, xb = M.P(u0, 0)[0], M.P(u1, 0)[0]
    yn, ys, yf = M.P(0, v0)[1], M.P(0, v1)[1], M.P(0, vf)[1]
    pts = [(xa, z0)] + [(xa + (xb - xa) * t, z) for t, z in prof] + [(xb, z0)]
    secs = [[(x, yn, z) for x, z in pts], [(x, ys, z) for x, z in pts], [(x, yf, z0) for x, z in pts]]
    bm = loft(secs, caps='first')
    N.add(bm, side, uvfn=art_fn(M))


PLAIN_CONCRETE = ('yard', 0.405, 0.49, 0.59, 0.63)   # glatter Betonboden (Inneres der Hofmarkierung)


def cover(N, M, u0, v0, u1, v1, src=None, z=0.35):
    """Betonplatten über einer Bodenzeichnung, die in 3D an anderer Stelle steht. src = (bild, u0, v0, u1, v1):
    glatter Bodenausschnitt; er wird in natürlicher Größe gekachelt (abwechselnd gespiegelt, damit keine Nähte entstehen)."""
    img, a0, b0, a1, b1 = src or PLAIN_CONCRETE
    (xa, yn), (xb, ys) = M.P(u0, v0), M.P(u1, v1)
    nx = max(1, round((xb - xa) / ((a1 - a0) * 15.6)))
    ny = max(1, round((yn - ys) / ((b1 - b0) * 15.6)))
    for i in range(nx):
        for j in range(ny):
            bm = prism(rect_inset_poly(xa + (xb - xa) * i / nx, ys + (yn - ys) * j / ny, xa + (xb - xa) * (i + 1) / nx, ys + (yn - ys) * (j + 1) / ny), z - 0.03, z + 0.025, 0.0)
            ua, ub = (a0, a1) if i % 2 == 0 else (a1, a0)
            va, vb = (b0, b1) if j % 2 == 0 else (b1, b0)
            N.add(bm, 'Concrete', img=img, uvfn=src_uv(bm, ua, va, ub, vb))


def cap_uv(M, cx, cy, r, uc, vc, ru):
    """Deckfläche (Radius r um cx, cy) eines stehenden Körpers bekommt den Bildkreis um (uc, vc) mit Radius ru."""
    rv = ru * M.W / M.D
    def fn(f):
        if f.normal.z < 0.9:
            return None
        return lambda c: (uc + (c.x - cx) / r * ru, 1 - (vc - (c.y - cy) / r * rv))
    return fn


def m_hq():
    M = Model('yard', (15.6, 15.5), kind='bld')
    N = Node(M, 'Base')
    bld_pad(N, M)
    # Werkstattgebäude: Dach mit Emblem, Südfassade mit Rolltor
    ublock(N, M, 0.085, 0.075, 0.425, 0.30, 0.35, 4.4, 'Olive', front=0.43)
    ublock(N, M, 0.148, 0.078, 0.222, 0.165, 4.4, 4.8, 'Steel')           # Lüftungsgitter
    ublock(N, M, 0.303, 0.105, 0.354, 0.232, 4.4, 4.75, 'Steel')          # Doppellüfter
    f = M.P(0.398, 0.105)
    flag(N, f[0], f[1], 4.4, 3.6)
    # Turmdrehkran: steht auf seinem gezeichneten Sockel; Kanzel, Ausleger und Winde tragen ihre Bildausschnitte
    kc = M.P(0.75, 0.42)
    N.add(prism([(kc[0] + x, kc[1] + y) for x, y in circle_poly(0, 0, 1.75, 8, math.pi / 8)], 0.35, 0.95, 0.12), 'Steel')
    lattice_mast(N, kc[0], kc[1], 0.95, 8.6, 0.6, 0.6, 7, 0.08, 'Hazard')
    K = Node(M, 'Crane', (kc[0], kc[1], 8.6), N)   # Oberwagen dreht sich im Spiel um den Turm
    cab = prism(M.rect(0.69, 0.355, 0.81, 0.485), 8.6, 10.1, 0.08)
    K.add(cab, 'Olive', uvfn=src_uv(cab, 0.74, 0.12, 0.86, 0.26))
    cs = M.P(0.75, 0.485)
    K.add(box(cs[0], cs[1] - 0.03, 1.3, 0.06, 9.15, 9.85), 'Glass', top=False)                  # Kanzelfenster
    jib = prism(M.rect(0.42, 0.385, 0.69, 0.455), 9.15, 9.6, 0.0)
    K.add(jib, 'Hazard', uvfn=src_uv(jib, 0.42, 0.14, 0.75, 0.21))
    j0, j1 = M.P(0.42, 0.42), M.P(0.69, 0.42)
    for k in range(5):   # Untergurt-Fachwerk
        xa, xb = j0[0] + (j1[0] - j0[0]) * k / 5, j0[0] + (j1[0] - j0[0]) * (k + 1) / 5
        K.add(tube((xa, j0[1], 9.2), ((xa + xb) / 2, j0[1], 8.75), 0.035, 4), 'Hazard', top=False)
        K.add(tube(((xa + xb) / 2, j0[1], 8.75), (xb, j0[1], 9.2), 0.035, 4), 'Hazard', top=False)
    K.add(tube((j0[0], j0[1], 8.75), (j1[0], j1[1], 8.75), 0.05, 6), 'Hazard', top=False)
    cw = prism(M.rect(0.81, 0.36, 0.895, 0.48), 8.9, 9.6, 0.0)
    K.add(cw, 'Steel', uvfn=src_uv(cw, 0.85, 0.09, 0.93, 0.23))                                    # Winde/Gegengewicht
    lattice_mast(K, kc[0], kc[1], 10.1, 12.2, 0.45, 0.08, 3, 0.05, 'Hazard')
    ce = M.P(0.89, 0.42)
    K.add(tube((kc[0], kc[1], 12.2), (j0[0] + 0.4, j0[1], 9.6), 0.03, 4), 'Steel', top=False)
    K.add(tube((kc[0], kc[1], 12.2), (ce[0], ce[1], 9.6), 0.03, 4), 'Steel', top=False)
    beacon(K, kc[0], kc[1], 12.2, 0.16)
    hk = M.P(0.525, 0.42)                                                                            # Haken am Seil
    K.add(tube((hk[0], hk[1], 9.15), (hk[0], hk[1], 5.6), 0.03, 4), 'Steel', top=False)
    K.add(box(hk[0], hk[1], 0.5, 0.5, 5.1, 5.6, 0.05), 'Hazard', top=False)
    cover(N, M, 0.428, 0.068, 0.94, 0.322)        # dort ist der Kran in der Vorlage liegend gezeichnet
    cover(N, M, 0.49, 0.322, 0.565, 0.435)        # gezeichnetes Seil mit Haken
    # Materiallager
    ublock(N, M, 0.095, 0.46, 0.335, 0.585, 0.35, 1.5, 'Steel', front=0.615)     # Stahlträger
    ublock(N, M, 0.085, 0.63, 0.33, 0.722, 0.35, 1.3, 'Steel', front=0.748)      # Rohre
    ublock(N, M, 0.118, 0.77, 0.292, 0.893, 0.35, 1.25, 'Concrete', front=0.918)  # Betonsteine
    ublock(N, M, 0.685, 0.54, 0.895, 0.615, 0.35, 1.2, 'Steel', front=0.642)     # Holzstapel
    ublock(N, M, 0.69, 0.672, 0.776, 0.725, 0.35, 1.35, 'Olive', front=0.778)    # Kisten
    ublock(N, M, 0.786, 0.645, 0.886, 0.715, 0.35, 1.85, 'Olive', front=0.787)
    N.add(prism(M.rect(0.70, 0.79, 0.86, 0.905), 0.35, 0.5, 0.0), 'Steel')        # Palette
    for u, v in ((0.735, 0.805), (0.822, 0.805), (0.778, 0.838)):                  # Fässer
        c = M.P(u, v)
        N.add(frustum(c[0], c[1], 0.55, 0.55, 0.5, 1.65, 14), 'Steel')
    # Zelthalle
    shed(N, M, 0.365, 0.64, 0.70, 0.80, 0.93, [(0, 2.3), (0.12, 2.9), (0.5, 3.1), (0.88, 2.9), (1, 2.3)], side='Cloth')
    for u, v in ((0.02, 0.98), (0.98, 0.98), (0.98, 0.04)):                        # Flutlichtmasten in den Sockelecken
        q = M.P(u, v)
        N.add(tube((q[0], q[1], 0.35), (q[0], q[1], 5.0), 0.08, 6), 'Steel', top=False)
        lamp(N, (q[0], q[1], 5.0), (-q[0], -q[1], -4.0), 0.22)
    N.build()
    K.build()
    ex = M.P(0.49, 1.08)
    empty('Exit', (ex[0], ex[1], 0), N)


def m_power():
    M = Model('power', (11.6, 11.95), kind='bld')
    N = Node(M, 'Base')
    bld_pad(N, M, 0.0, 0.05)
    towers = []
    for u in (0.25, 0.745):
        c = M.P(u, 0.31)
        towers.append(c)
        # Kühlturm (hyperbolisch) auf seinem Fuß; die Öffnung oben trägt den versetzt gezeichneten Bildkreis
        t = lathe(c[0], c[1], [(2.15, 0.35), (2.0, 1.6), (1.78, 3.4), (1.62, 5.2), (1.56, 6.3), (1.58, 7.0), (1.66, 7.5)], 32)
        N.add(t, 'Concrete', uvfn=cap_uv(M, c[0], c[1], 1.66, u, 0.135, 0.137))
        N.add(frustum(c[0], c[1], 2.1, 2.07, 1.75, 2.0, 32), 'Hazard', top=False)
        for a in (0.5, 2.6, 4.7):
            beacon(N, c[0] + math.cos(a) * 1.6, c[1] + math.sin(a) * 1.6, 7.5, 0.11)
        cover(N, M, u - 0.15, 0.052, u + 0.15, 0.15)                         # gezeichneter oberer Turmrand
    # Dampfleitungen von den Türmen zum Maschinenhaus
    for u, s in ((0.455, -1), (0.525, 1)):
        a, b = M.P(u, 0.215), M.P(u, 0.42)
        N.add(tube((a[0], a[1], 2.2), (b[0], b[1], 2.2), 0.28, 10), 'Steel')
        N.add(tube((a[0], a[1], 2.2), (a[0] + s * 1.0, a[1], 2.2), 0.28, 10), 'Steel')
    ublock(N, M, 0.435, 0.415, 0.565, 0.545, 0.35, 5.0, 'Steel')                    # Schaltwarte
    ublock(N, M, 0.295, 0.50, 0.705, 0.69, 0.35, 4.0, 'Olive', front=0.93)          # Maschinenhaus mit Tor
    for u0 in (0.402, 0.515):
        ublock(N, M, u0, 0.565, u0 + 0.075, 0.637, 4.0, 4.3, 'Steel')               # Dachlüfter
    # Transformatoren: Isolatoren stehen auf dem Trafo, ihre Zeichnung dahinter wird abgedeckt
    for ua in (0.09, 0.785):
        ub = ua + 0.125
        for va, vb, vf, c0, c1 in ((0.575, 0.655, 0.68, 0.505, 0.573), (0.745, 0.82, 0.848, 0.672, 0.743)):
            ublock(N, M, ua, va, ub, vb, 0.35, 1.9, 'Steel', front=vf)
            cover(N, M, ua + 0.01, c0, ub - 0.005, c1)
            for du in (0.025, 0.065, 0.105):
                q = M.P(ua + du, (va + vb) / 2 - 0.012)
                N.add(frustum(q[0], q[1], 0.1, 0.05, 1.9, 2.6, 6), 'Concrete', top=False)
                N.add(frustum(q[0], q[1], 0.06, 0.06, 2.6, 2.68, 6), 'Steel', top=False)
        ublock(N, M, ua + 0.02, 0.84, ua + 0.105, 0.905, 0.35, 1.3, 'Olive', front=0.925)   # Schaltschrank
    N.build()
    for c in towers:
        empty('FX_steam', (c[0], c[1], 7.4), N)
    ex = M.P(0.5, 1.06)
    empty('Exit', (ex[0], ex[1], 0), N)


def dish_bowl(C, n_up, R=3.4, depth=0.85, th=0.16, uvc=(0.364, 0.6875), uvr=(0.3, 0.281), nr=9, ns=36):
    """Parabolschüssel: Innenseite mit Bild-UVs (Kreis uvc/uvr im Bild), Rückseite, Randwulst.
    C = Scheitelpunkt (Welt), n_up = Blickrichtung der Schüssel. Gibt bmesh mit UV-Layer zurück."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    q = Vector((0, 0, 1)).rotation_difference(Vector(n_up).normalized())
    M4 = Matrix.Translation(Vector(C)) @ q.to_matrix().to_4x4()

    def ring(r, z):
        return [bm.verts.new(M4 @ Vector((math.cos(i / ns * math.tau) * r, math.sin(i / ns * math.tau) * r, z))) for i in range(ns)]
    front = [ring(R * k / nr, depth * (k / nr) ** 2) for k in range(1, nr + 1)]
    back = [ring(R * k / nr, depth * (k / nr) ** 2 - th) for k in range(1, nr + 1)]
    lip = ring(R + 0.12, depth + 0.04)
    lipb = ring(R + 0.12, depth - th - 0.04)
    cf = bm.verts.new(M4 @ Vector((0, 0, 0)))
    cb = bm.verts.new(M4 @ Vector((0, 0, -th)))

    def uv_of(r, i, mirror=1):
        a = i / ns * math.tau
        return (uvc[0] + math.cos(a) * r / R * uvr[0] * mirror, uvc[1] + math.sin(a) * r / R * uvr[1])

    def face(vs, uvs, smooth=True):
        try:
            f = bm.faces.new(vs)
        except ValueError:
            return None
        f.smooth = smooth
        for l, t in zip(f.loops, uvs):
            l[uvl].uv = t
        return f
    rads = [R * k / nr for k in range(1, nr + 1)]
    for i in range(ns):
        j = (i + 1) % ns
        # Innenseite (Bild)
        face([cf, front[0][i], front[0][j]], [uv_of(0, 0), uv_of(rads[0], i), uv_of(rads[0], j)])
        for k in range(nr - 1):
            face([front[k][i], front[k + 1][i], front[k + 1][j], front[k][j]],
                 [uv_of(rads[k], i), uv_of(rads[k + 1], i), uv_of(rads[k + 1], j), uv_of(rads[k], j)])
        # Rückseite (gespiegelt, gleiche Paneele)
        face([cb, back[0][j], back[0][i]], [uv_of(0, 0, -1), uv_of(rads[0], j, -1), uv_of(rads[0], i, -1)])
        for k in range(nr - 1):
            face([back[k][j], back[k + 1][j], back[k + 1][i], back[k][i]],
                 [uv_of(rads[k], j, -1), uv_of(rads[k + 1], j, -1), uv_of(rads[k + 1], i, -1), uv_of(rads[k], i, -1)])
        # Randwulst (ohne Bild -> flach, Seitenmaterial)
        face([front[-1][i], lip[i], lip[j], front[-1][j]], [(0, 0)] * 4, False)
        face([lip[i], lipb[i], lipb[j], lip[j]], [(0, 0)] * 4, False)
        face([lipb[i], back[-1][i], back[-1][j], lipb[j]], [(0, 0)] * 4, False)
    bm.normal_update()
    return bm, M4


def m_radar():
    M = Model('radar', (11.2, 11.93), kind='bld')
    N = Node(M, 'Base', img='radar_base')
    bld_pad(N, M, 0.0, 0.06)
    cover(N, M, 0.03, 0.085, 0.59, 0.525)
    cover(N, M, 0.59, 0.14, 0.655, 0.515)                                   # retuschierte Fläche unter der Schüssel
    pc = M.P(0.33, 0.69)
    N.add(prism([(pc[0] + x, pc[1] + y) for x, y in circle_poly(0, 0, 2.35, 8, math.pi / 8)], 0.35, 2.0, 0.2), 'Olive')
    N.add(prism([(pc[0] + x, pc[1] + y) for x, y in circle_poly(0, 0, 1.9, 8, math.pi / 8)], 2.0, 2.3, 0.1), 'Steel')
    # Betriebsgebäude mit Südfassade (Tür), Klimagerät an der gezeichneten Stelle
    ublock(N, M, 0.665, 0.31, 0.925, 0.555, 0.35, 3.9, 'Olive', front=0.705)
    ublock(N, M, 0.757, 0.385, 0.835, 0.462, 3.9, 4.3, 'Steel')
    # Kabelkanal Sockel -> Verteilerkasten am Gebäude
    for v in (0.685, 0.705):
        a, b = M.P(0.5, v), M.P(0.632, v)
        N.add(tube((a[0], a[1], 0.7), (b[0], b[1], 0.7), 0.13, 8), 'Steel')
    for u in (0.618, 0.638):
        a, b = M.P(u, 0.71), M.P(u, 0.6)
        N.add(tube((a[0], a[1], 0.7), (b[0], b[1], 0.7), 0.13, 8), 'Steel')
    ublock(N, M, 0.60, 0.52, 0.662, 0.60, 0.35, 1.5, 'Steel')
    ublock(N, M, 0.59, 0.79, 0.712, 0.875, 0.35, 1.3, 'Steel', front=0.905)         # Aggregat
    ublock(N, M, 0.77, 0.745, 0.91, 0.845, 0.35, 1.4, 'Olive', front=0.88)          # Transportkisten
    # Gittermast auf dem Dach (in der Vorlage liegend gezeichnet -> Zeichnung abgedeckt)
    cover(N, M, 0.755, 0.062, 0.93, 0.305)
    c = M.P(0.865, 0.345)
    zt = 10.0
    lattice_mast(N, c[0], c[1], 3.9, zt, 0.55, 0.25, 5, 0.07)
    N.add(box(c[0], c[1], 0.8, 0.8, zt, zt + 0.12), 'Hazard', top=False)
    for sx in (-1, 1):  # Richtfunk-Paneele
        N.add(box(c[0] + sx * 0.55, c[1], 0.12, 0.7, 8.0, 9.2), 'Steel', top=False)
    beacon(N, c[0], c[1], zt + 0.12, 0.13)
    antenna(N, c[0] + 0.22, c[1] + 0.22, zt + 0.12, 2.0)
    N.build()

    # Drehbare Antenne    # Drehbare Antenne: Drehkranz, Säule, Gabel, Parabolschüssel mit Speisehorn
    dish = Node(M, 'Dish', (pc[0], pc[1], 2.3), N, img='radar')
    X, Y = pc
    dish.add(frustum(X, Y, 1.75, 1.6, 2.3, 2.6, 24), 'Steel', top=False)
    dish.add(box(X, Y, 1.9, 1.6, 2.6, 3.4, 0.2), 'Olive', top=False)
    el = math.radians(40)                       # Schüssel um 40° aus der Senkrechten nach Süden (-Y, zur Kamera) geneigt
    n_up = Vector((0, -math.sin(el), math.cos(el)))
    A = Vector((X, Y + 0.35, 4.3))               # Kippachse
    for sx in (-1, 1):  # Gabelarme
        dish.add(box(X + sx * 0.95, Y + 0.35, 0.22, 0.9, 3.2, 4.6, 0.05), 'Olive', top=False)
    dish.add(tube((X - 1.15, A.y, A.z), (X + 1.15, A.y, A.z), 0.2, 10), 'Steel', top=False)
    C = A + n_up * 0.75                         # Scheitel der Schüssel
    dish.add(tube(A - n_up * 0.1, C - n_up * 0.1, 0.55, 12), 'Steel', top=False)     # Nabe
    dish.add(box(X, A.y + 0.95, 1.1, 0.6, 3.5, 4.1, 0.08), 'Steel', top=False)         # Gegengewicht
    bowl, M4 = dish_bowl(C, n_up)
    dish.add(bowl, 'Olive', img='radar', keepuv=True)
    # Speisehorn im Brennpunkt mit 4 Streben
    F = M4 @ Vector((0, 0, 2.3))
    for k in range(4):
        a = k * math.pi / 2
        rim = M4 @ Vector((math.cos(a) * 3.3, math.sin(a) * 3.3, 0.8))
        dish.add(tube(rim, F, 0.05, 6), 'Steel', top=False)
    dish.add(tube(F - n_up * 0.25, F + n_up * 0.2, 0.28, 10), 'Steel', top=False)
    dish.add(tube(F - n_up * 0.32, F - n_up * 0.25, 0.2, 10), 'Hazard', top=False)
    dish.build()


def m_barracks():
    M = Model('barracks', (11.6, 11.37), kind='bld')
    N = Node(M, 'Base')
    bld_pad(N, M, 0.0, 0.05)
    # Unterkünfte: Satteldach, Giebelseite nach Süden; Klimageräte dahinter
    for u0, u1 in ((0.04, 0.31), (0.69, 0.96)):
        shed(N, M, u0, u1, 0.19, 0.77, 0.885, [(0, 2.1), (0.5, 3.7), (1, 2.1)], side='Olive')
    for u0, u1 in ((0.10, 0.185), (0.815, 0.90)):
        ublock(N, M, u0, 0.10, u1, 0.165, 0.35, 1.5, 'Steel', front=0.188)
    # Mitteltrakt: Funkplattform, Technikdach mit Lüfter, Eingangsbau mit Tür und Bannern, Treppe
    ublock(N, M, 0.335, 0.115, 0.665, 0.30, 0.35, 2.7, 'Steel')
    ublock(N, M, 0.36, 0.30, 0.64, 0.53, 0.35, 2.2, 'Steel')
    ublock(N, M, 0.44, 0.37, 0.56, 0.455, 2.2, 2.65, 'Steel', front=0.478)
    ublock(N, M, 0.335, 0.53, 0.665, 0.70, 0.35, 3.5, 'Olive', front=0.845)
    N.add(prism(M.rect(0.43, 0.845, 0.57, 0.955), 0.35, 0.55, 0.0), 'Steel')
    # Funkmast mit zwei Richtantennen an den gezeichneten Stellen, Teamflagge
    a = M.P(0.5, 0.165)
    lattice_mast(N, a[0], a[1], 2.7, 7.6, 0.42, 0.1, 5, 0.05)
    N.add(box(a[0] + 0.75, a[1], 1.3, 0.05, 6.6, 7.4), 'Team', top=False)
    beacon(N, a[0], a[1], 7.6, 0.08)
    for u in (0.437, 0.557):
        c = M.P(u, 0.127)
        N.add(tube((c[0], c[1], 2.7), (c[0], c[1], 3.3), 0.05, 6), 'Steel', top=False)
        N.add(frustum(c[0], c[1], 0.12, 0.5, 3.3, 3.5, 12), 'Steel')
    # Kisten und Sandsäcke neben der Treppe
    ublock(N, M, 0.272, 0.815, 0.362, 0.885, 0.35, 1.15, 'Olive', front=0.935)
    ublock(N, M, 0.60, 0.815, 0.70, 0.885, 0.35, 1.15, 'Olive', front=0.935)
    N.build()
    ex = M.P(0.5, 1.08)
    empty('Exit', (ex[0], ex[1], 0), N)


def m_factory():
    M = Model('factory', (15.6, 14.76), kind='bld')
    N = Node(M, 'Base')
    bld_pad(N, M, 0.0, 0.07)
    Y = lambda v: M.P(0, v)[1]
    # Halle: Flachdach mit Lüftern, Dachschräge mit Emblem, darunter die Fensterfront
    xa, xb = M.P(0.17, 0)[0], M.P(0.69, 0)[0]
    prof = [(Y(0.13), 0.35), (Y(0.13), 6.2), (Y(0.40), 6.2), (Y(0.545), 4.7), (Y(0.63), 2.95), (Y(0.63), 0.35)]
    N.add(loft([[(xa, y, z) for y, z in prof], [(xb, y, z) for y, z in prof]]), 'Olive')
    for u0 in (0.26, 0.405, 0.548):
        ublock(N, M, u0, 0.21, u0 + 0.11, 0.33, 6.2, 6.5, 'Steel')
    ublock(N, M, 0.40, 0.075, 0.575, 0.128, 0.35, 5.0, 'Steel')                     # Abluftkasten hinter der Halle
    # Aggregate links mit Rohrleitung
    ublock(N, M, 0.095, 0.205, 0.19, 0.335, 0.35, 3.2, 'Steel', front=0.362)
    ublock(N, M, 0.095, 0.44, 0.19, 0.555, 0.35, 3.2, 'Steel', front=0.585)
    a, b = M.P(0.075, 0.39), M.P(0.075, 0.56)
    N.add(tube((a[0], a[1], 1.6), (b[0], b[1], 1.6), 0.3, 10), 'Steel')
    # Vorbau mit Rolltor, Rampe, Werkstatt
    ublock(N, M, 0.05, 0.63, 0.26, 0.71, 0.35, 2.95, 'Steel', front=0.80)
    ublock(N, M, 0.26, 0.63, 0.57, 0.71, 0.35, 2.95, 'Steel', front=0.87)
    N.add(prism(M.rect(0.35, 0.87, 0.51, 0.975), 0.35, 0.5, 0.0), 'Steel')
    ublock(N, M, 0.57, 0.63, 0.94, 0.71, 0.35, 2.95, 'Steel', front=0.90)
    ublock(N, M, 0.085, 0.805, 0.20, 0.885, 0.35, 1.2, 'Olive', front=0.925)        # Kisten
    # Schmelzofen; der Schornstein steht darauf (in der Vorlage liegend gezeichnet -> abgedeckt)
    ublock(N, M, 0.765, 0.33, 0.945, 0.50, 0.35, 5.0, 'Steel', front=0.61)
    c = M.P(0.855, 0.40)
    ch = lathe(c[0], c[1], [(0.95, 5.0), (0.82, 7.0), (0.72, 10.0), (0.8, 10.4), (0.8, 10.9)], 20)
    N.add(ch, 'Steel', uvfn=cap_uv(M, c[0], c[1], 0.8, 0.855, 0.165, 0.052))
    N.add(frustum(c[0], c[1], 0.78, 0.76, 9.4, 9.7, 20), 'Hazard', top=False)
    beacon(N, c[0] + 0.72, c[1], 10.9, 0.11)
    beacon(N, c[0] - 0.72, c[1], 10.9, 0.11)
    cover(N, M, 0.70, 0.072, 0.935, 0.328, ('side_pad43', 0.14, 0.2, 0.36, 0.5))
    a, b = M.P(0.69, 0.435), M.P(0.77, 0.435)
    N.add(tube((a[0], a[1], 3.6), (b[0], b[1], 3.6), 0.4, 10), 'Steel')
    N.build()
    empty('FX_smoke', (c[0], c[1], 11.1), N)
    ex = M.P(0.47, 1.08)
    empty('Exit', (ex[0], ex[1], 0), N)


def m_helipad():
    """Flugfeld 4 x 8 Zellen (15,6 x 32 m): Vorlage im Südteil, im Norden verlängerte Startbahn und Vorfeld mit
    Hubschrauber-Landeplatz. Modellmitte = Mitte der Grundfläche."""
    TOT = 32.0
    Wm, Dm = 15.6, 23.09
    M = Model('airfield', (Wm, Dm), (0.5, 1 - (TOT / 2) / Dm), kind='bld')
    N = Node(M, 'Base')
    Z = 0.3
    PLAIN = ('airfield', 0.3, 0.16, 0.44, 0.24)
    N.add(prism(M.poly([(0.0, 0.11), (0.52, 0.11), (0.52, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]), 0.0, Z, 0.03), 'Concrete')
    # ---- Verlängerung nach Norden
    yn, ye = M.P(0.5, 0.0)[1], TOT / 2            # Nordkante der Vorlage, Nordkante des Feldes
    xl, xm, xr = -Wm / 2, M.P(0.6, 0)[0], Wm / 2
    rw = prism(rect_inset_poly(xm, yn - 0.02, xr, ye), 0.0, Z, 0.0)
    N.add(rw, 'Concrete', img='airfield', uvfn=src_uv(rw, 0.6, 0.25, 1.0, 0.62))      # Startbahn läuft weiter
    ap = prism(rect_inset_poly(xl, yn - 0.02, xm, ye), 0.0, Z, 0.0)
    N.add(ap, 'Concrete', img='airfield', uvfn=src_uv(ap, 0.17, 0.56, 0.5, 0.9))      # Vorfeld
    nx0, ny0 = M.P(0.0, 0.11)
    nt = prism(rect_inset_poly(xl, ny0 - 0.02, M.P(0.52, 0)[0], yn), 0.0, Z, 0.0)
    N.add(nt, 'Concrete', img='airfield', uvfn=src_uv(nt, 0.17, 0.56, 0.5, 0.9))
    # Hubschrauber-Landeplatz auf dem Vorfeld
    hc = ((xl + xm) / 2, (yn + ye) / 2 + 0.2)
    N.add(frustum(hc[0], hc[1], 3.5, 3.5, Z, Z + 0.04, 28), 'Hazard', top=False)
    N.add(frustum(hc[0], hc[1], 3.15, 3.15, Z, Z + 0.06, 28), 'Rubber', top=False)
    for dx in (-0.9, 0.9):
        N.add(box(hc[0] + dx, hc[1], 0.4, 2.6, Z + 0.06, Z + 0.08), 'Concrete', top=False)
    N.add(box(hc[0], hc[1], 1.8, 0.4, Z + 0.06, Z + 0.08), 'Concrete', top=False)
    for k in range(8):
        a = k / 8 * math.tau
        N.add(frustum(hc[0] + math.cos(a) * 3.5, hc[1] + math.sin(a) * 3.5, 0.12, 0.09, Z, Z + 0.16, 6), 'Light', top=False)
    # ---- Towergebäude mit Südfassade; der Tower steht darauf, seine Kanzel trägt den versetzt gezeichneten Bildkreis
    ublock(N, M, 0.11, 0.15, 0.345, 0.20, Z, 2.7, 'Olive', front=0.248)
    c = M.P(0.257, 0.175)
    N.add(frustum(c[0], c[1], 0.95, 0.85, 2.7, 6.2, 8), 'Olive', top=False)
    N.add(frustum(c[0], c[1], 1.25, 1.3, 6.0, 6.25, 8), 'Steel', top=False)
    N.add(frustum(c[0], c[1], 1.25, 1.5, 6.25, 7.5, 8), 'Glass', top=False)                  # nach außen geneigte Scheiben
    roof = frustum(c[0], c[1], 1.65, 1.5, 7.5, 7.7, 8)
    N.add(roof, 'Steel', uvfn=cap_uv(M, c[0], c[1], 1.5, 0.257, 0.092, 0.058))
    beacon(N, c[0], c[1], 7.7, 0.14)
    antenna(N, c[0] + 0.4, c[1], 7.7, 2.4)
    cover(N, M, 0.185, 0.112, 0.335, 0.15, PLAIN, Z)                                           # gezeichnete Kanzel
    # ---- Hangar: Tonnendach, Torseite nach Süden
    shed(N, M, 0.055, 0.485, 0.265, 0.445, 0.535, [(i / 10, 2.0 + 3.4 * math.sin(math.pi * i / 10)) for i in range(11)], Z, 'Olive')
    # ---- Kleinteile an den gezeichneten Stellen
    ublock(N, M, 0.055, 0.545, 0.125, 0.60, Z, 1.2, 'Olive', front=0.622)                      # Kiste
    ublock(N, M, 0.50, 0.655, 0.585, 0.71, Z, 1.3, 'Steel', front=0.735)                       # Tankpumpe
    ublock(N, M, 0.225, 0.865, 0.365, 0.903, Z, 1.0, 'Olive', front=0.918)                     # Kistenreihe
    for u in (0.135, 0.17):                                                                     # Fässer
        q = M.P(u, 0.885)
        N.add(frustum(q[0], q[1], 0.34, 0.34, Z, 1.3, 12), 'Olive')
    w = M.P(0.585, 0.125)                                                                       # Windsack neben der Bahn
    N.add(tube((w[0], w[1], Z), (w[0], w[1], 3.6), 0.06, 6), 'Steel', top=False)
    N.add(loft([ring(w[0], w[1], 3.5, 0.26, 0.26, 8), ring(w[0] - 1.3, w[1], 3.4, 0.12, 0.12, 8)], smooth=True), 'Hazard', top=False)
    # ---- Bahnbefeuerung genau auf den gezeichneten Lampen; in der Verlängerung im selben Abstand weiter
    vs = [0.11, 0.19, 0.275, 0.355, 0.44, 0.525, 0.62, 0.705, 0.79, 0.875]
    pts = [M.P(u, v) for v in vs for u in (0.647, 0.902)]
    step = 0.085 * Dm
    y = M.P(0, 0.11)[1] + step
    while y < ye - 0.5:
        pts += [(M.P(0.647, 0)[0], y), (M.P(0.902, 0)[0], y)]
        y += step
    for q in pts:
        N.add(frustum(q[0], q[1], 0.2, 0.15, Z, Z + 0.13, 8), 'Steel', top=False)
        N.add(frustum(q[0], q[1], 0.13, 0.09, Z + 0.13, Z + 0.22, 8), 'Light', top=False)
    N.build()
    empty('Exit', (hc[0], hc[1], 0), N)          # Hubschrauber erscheinen auf dem Landeplatz


def m_turret():
    M = Model('turret', (7.4, 9.01), (0.5, 0.57), kind='bld')
    N = Node(M, 'Base', img='turret_base')
    oct_ = M.poly([(0.3, 0.14), (0.7, 0.14), (1.0, 0.38), (1.0, 0.77), (0.7, 1.0), (0.3, 1.0), (0.0, 0.77), (0.0, 0.38)])
    N.add(prism(oct_, 0.0, 1.2, 0.15), 'Steel')
    N.add(prism(oct_, 0.75, 0.95, -0.06), 'Team', top=False)
    N.build()
    tp = M.P(0.5, 0.58)
    tur = Node(M, 'Turret', (tp[0], tp[1], 1.2), N, img='turret')
    x0, y0, x1, y1 = bbox(M, 0.28, 0.3, 0.72, 0.87)
    w = (x1 - x0) / 2
    tur.add(frustum(tp[0], tp[1], w * 0.95, w * 0.95, 1.15, 1.32, 20), 'Steel', top=False)   # Drehkranz
    tur.add(loft([hsec_y(y0, w * 0.72, 1.4, w * 0.86, 1.75, w * 0.68, 2.3),               # Turmheck
                  hsec_y(y0 + 0.9, w * 0.88, 1.25, w, 1.75, w * 0.8, 2.6),
                  hsec_y(y1 - 1.5, w * 0.88, 1.25, w, 1.72, w * 0.76, 2.6),
                  hsec_y(y1, w * 0.52, 1.4, w * 0.62, 1.72, w * 0.46, 2.25)]), 'Olive')     # Keilfront
    tur.build()
    gp = M.P(0.5, 0.36)
    gun = Node(M, 'Gun', (gp[0], gp[1], 2.1), tur, img='turret')
    for u in (0.41, 0.59):
        a, b = M.P(u, 0.36), M.P(u, 0.0)
        gun.add(tube((a[0], a[1], 2.1), (a[0], a[1] + 1.5, 2.1), 0.28, 12), 'Steel', top=False)   # Rohrwiege
        gun.add(tube((a[0], a[1] + 1.4, 2.1), (b[0], b[1], 2.1), 0.17, 12), 'Steel')
        gun.add(tube((b[0], b[1] - 0.55, 2.1), (b[0], b[1], 2.1), 0.27, 10), 'Steel', top=False)
        gun.add(tube((b[0], b[1], 2.1), (b[0], b[1] + 0.02, 2.1), 0.12, 10), 'Rubber', top=False)
    gun.add(box(gp[0], gp[1] + 0.3, 1.7, 0.4, 1.82, 2.38, 0.05), 'Steel', top=False)            # Blende
    gun.build()
    tip = M.P(0.5, 0.0)
    empty('Muzzle', (tip[0], tip[1], 2.1), gun)


def m_samturret():
    """Raketenturm (Boden- und Flugabwehr): Sockel wie der Geschützturm, drehbarer Werfer mit zwei Vierfachstartern, Radar."""
    M = Model('turret', (7.4, 9.01), (0.5, 0.57), kind='bld')
    N = Node(M, 'Base', img='turret_base')
    oct_ = M.poly([(0.3, 0.14), (0.7, 0.14), (1.0, 0.38), (1.0, 0.77), (0.7, 1.0), (0.3, 1.0), (0.0, 0.77), (0.0, 0.38)])
    N.add(prism(oct_, 0.0, 1.2, 0.15), 'Steel')
    N.add(prism(oct_, 0.75, 0.95, -0.06), 'Team', top=False)
    N.build()
    tp = M.P(0.5, 0.58)
    X, Y = tp
    tur = Node(M, 'Turret', (X, Y, 1.2), N, img='turret')
    tur.add(frustum(X, Y, 1.7, 1.45, 1.15, 1.75, 20), 'Steel', top=False)             # Drehsockel
    tur.add(box(X, Y, 1.5, 1.7, 1.75, 3.0, 0.12), 'Olive', top=False)                  # Säule mit Elektronik
    tur.add(tube((X - 2.0, Y, 2.7), (X + 2.0, Y, 2.7), 0.2, 10), 'Steel', top=False)    # Querträger
    tur.add(box(X, Y - 0.95, 1.1, 0.5, 1.9, 2.6, 0.05), 'Steel', top=False)            # Gegengewicht/Aggregat
    el = math.radians(22)
    Rm = Matrix.Rotation(el, 3, 'X')

    def R(px, py, pz):   # Punkt um die Kippachse (durch Y, z = 2.7) nach oben schwenken
        v = Rm @ Vector((px, py - Y, pz - 2.7))
        return (v.x, v.y + Y, v.z + 2.7)
    for sg in (1, -1):
        cx = X + sg * 1.95
        bm = box(cx, Y + 0.25, 1.35, 3.7, 2.05, 3.35, 0.04)                            # Startbehälter
        bmesh.ops.rotate(bm, cent=(cx, Y, 2.7), matrix=Rm, verts=bm.verts)
        tur.add(bm, 'Olive', top=False)
        for dx in (-0.32, 0.32):
            for dz in (-0.32, 0.32):   # vier Startrohre mit sichtbaren Flugkörperspitzen
                tur.add(tube(R(cx + dx, Y + 2.05, 2.7 + dz), R(cx + dx, Y + 2.14, 2.7 + dz), 0.27, 10), 'Rubber', top=False)
                tur.add(tube(R(cx + dx, Y + 2.1, 2.7 + dz), R(cx + dx, Y + 2.3, 2.7 + dz), 0.13, 8), 'Hazard', top=False)
                tur.add(tube(R(cx + dx, Y - 1.62, 2.7 + dz), R(cx + dx, Y - 1.56, 2.7 + dz), 0.24, 10), 'Rubber', top=False)
        for k in range(3):             # Spannbänder
            yy = Y - 1.0 + k * 1.3
            b2 = box(cx, yy, 1.41, 0.1, 2.02, 3.38)
            bmesh.ops.rotate(b2, cent=(cx, Y, 2.7), matrix=Rm, verts=b2.verts)
            tur.add(b2, 'Steel', top=False)
    antenna(tur, X + 0.5, Y - 0.6, 3.0, 2.2)
    beacon(tur, X - 0.5, Y - 0.6, 3.0, 0.09)
    tur.add(tube((X, Y + 0.2, 3.0), (X, Y + 0.2, 3.5), 0.1, 8), 'Steel', top=False)
    tur.build()
    dish = Node(M, 'Dish', (X, Y + 0.2, 3.5), tur)
    dish.add(frustum(X, Y + 0.2, 0.18, 0.18, 3.5, 3.62, 8), 'Steel', top=False)
    prof = [(-0.85, -0.1), (-0.4, -0.01), (0.0, 0.03), (0.4, -0.01), (0.85, -0.1)]
    dish.add(loft([[(X + dx, Y + 0.2 + dy, 3.62), (X + dx, Y + 0.26 + dy, 3.62), (X + dx, Y + 0.26 + dy, 4.3), (X + dx, Y + 0.2 + dy, 4.3)] for dx, dy in prof]), 'Steel', top=False)
    dish.build()
    for sg in (1, -1):
        m = R(X + sg * 1.95, Y + 2.3, 2.7)
        empty('Muzzle', m, tur)


def m_wall():
    L, T, H = 4.0, 1.1, 2.6
    M = Model('wall', (L, T), kind='bld')
    N = Node(M, 'Base')
    bm = prism(rect_inset_poly(-L / 2, -T / 2, L / 2, T / 2), 0.0, H, 0.08)

    def uvfn(f):
        if abs(f.normal.y) > 0.6:  # Längsseiten: Wandbild
            return lambda c: ((c.x + L / 2) / L * 0.345 if f.normal.y < 0 else (L / 2 - c.x) / L * 0.345, c.z / H)
        return None
    N.add(bm, 'Steel', uvfn=uvfn)
    N.build()


def src_uv(bm, u0, v0, u1, v1):
    """Deckflächen eines Teils auf einen Bildausschnitt (u,v von oben links) abbilden."""
    xs = [v.co.x for v in bm.verts]; ys = [v.co.y for v in bm.verts]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)

    def fn(f):
        if f.normal.z <= 0.35:
            return None
        return lambda c: (u0 + (c.x - x0) / (x1 - x0) * (u1 - u0), 1 - (v0 + (y1 - c.y) / (y1 - y0) * (v1 - v0)))
    return fn


def m_refinery():
    """Keine Vorlage vorhanden: aus Ausschnitten der anderen Vorlagen zusammengesetzt (gleicher Stil)."""
    M = Model('yard', (15.6, 11.6), kind='bld')
    N = Node(M, 'Base')
    pad = prism(M.rect(0, 0, 1, 1), 0.0, 0.35, 0.05)
    N.add(pad, 'Concrete', img='side_pad43', uvfn=src_uv(pad, 0, 0, 1, 1))
    for u in (0.13, 0.33, 0.53):
        c = M.P(u, 0.27)
        b = lathe(c[0], c[1], [(1.78, 0.35), (1.78, 0.7), (1.7, 0.75), (1.7, 5.3), (1.55, 5.9), (1.2, 6.2)], 24)   # Silo mit Schulter
        N.add(b, 'Olive', img='power', uvfn=src_uv(b, 0.085, 0.0, 0.455, 0.3))
        ladder(N, c[0], c[1] - 1.7, 0.8, 5.3)
        N.add(frustum(c[0], c[1], 1.8, 1.8, 2.6, 3.0, 24), 'Hazard', top=False)
    a, b2 = M.P(0.13, 0.27), M.P(0.86, 0.27)
    N.add(tube((a[0], a[1] + 1.9, 4.4), (b2[0], a[1] + 1.9, 4.4), 0.22, 10), 'Steel', top=False)
    N.add(tube((a[0], a[1] - 1.9, 3.4), (b2[0], a[1] - 1.9, 3.4), 0.22, 10), 'Steel', top=False)
    hb = prism(M.rect(0.62, 0.48, 0.97, 0.95), 0.35, 4.2, 0.25)
    N.add(hb, 'Olive', img='barracks', uvfn=src_uv(hb, 0.36, 0.30, 0.64, 0.53))
    st = lathe(*M.P(0.86, 0.24), [(0.95, 0.35), (0.8, 1.2), (0.7, 3.5), (0.6, 9.8), (0.68, 10.15), (0.68, 10.5)], 18)
    sa, sb = M.P(0.13, 0.27), M.P(0.53, 0.27)
    N.add(box((sa[0] + sb[0]) / 2, sa[1], sb[0] - sa[0], 0.9, 6.2, 6.28), 'Steel', top=False)      # Laufsteg über den Silos
    railing(N, sa[0] - 0.3, sa[1] - 0.45, sb[0] + 0.3, sa[1] + 0.45, 6.28, 0.8)
    N.add(st, 'Steel', img='factory', uvfn=src_uv(st, 0.82, 0.12, 0.95, 0.25))
    dock = prism(M.rect(0.02, 0.6, 0.52, 0.98), 0.35, 0.42, 0.0)
    N.add(dock, 'Concrete', img='airfield', uvfn=src_uv(dock, 0.17, 0.56, 0.5, 0.9))
    hp = prism(M.rect(0.3, 0.5, 0.52, 0.72), 0.42, 2.9, 0.3)
    N.add(hp, 'Olive', img='harvester', uvfn=src_uv(hp, 0.28, 0.47, 0.72, 0.81))
    x0, y0, x1, y1 = bbox(M, 0.62, 0.48, 0.97, 0.95)
    team_band(N, (x0 + 0.22, y0 + 0.22, x1 - 0.22, y1 - 0.22), 4.1)
    door(N, (x0 + x1) / 2, y0 + 0.02, 1.6, 2.2)
    for u in (0.13, 0.33, 0.53):
        q = M.P(u, 0.27)
        beacon(N, q[0] + 1.2, q[1], 6.2, 0.1)
        N.add(frustum(q[0], q[1] + 0.75, 0.3, 0.3, 6.2, 6.5, 10), 'Steel', top=False)
    beacon(N, *M.P(0.86, 0.24), 10.5, 0.12)
    dx0, dy0, dx1, dy1 = bbox(M, 0.02, 0.6, 0.52, 0.98)
    for x in (dx0 + 0.3, dx1 - 0.3):   # Andocklichter
        for y in (dy0 + 0.4, dy1 - 0.4):
            N.add(frustum(x, y, 0.16, 0.12, 0.42, 0.55, 8), 'Light', top=False)
    cluster(N, M, 0.725, 0.39, ['Barrel_01'], 3, 61)
    N.build()
    dk = M.P(0.2, 0.83)
    empty('Dock', (dk[0], dk[1], 0), N)
    c = M.P(0.86, 0.24)
    empty('FX_smoke', (c[0], c[1], 10.7), N)


MODELS = {'refinery': m_refinery, 'tank': m_tank, 'ifv': m_ifv, 'artillery': m_artillery, 'mcv': m_mcv, 'harvester': m_harvester, 'heli': m_heli,
          'jet': m_jet, 'hq': m_hq, 'power': m_power, 'radar': m_radar, 'barracks': m_barracks, 'factory': m_factory,
          'helipad': m_helipad, 'turret': m_turret, 'wall': m_wall, 'flak': m_flak, 'samturret': m_samturret}

bpy.ops.wm.read_factory_settings(use_empty=True)
for name, fn in MODELS.items():
    if ONLY and name not in ONLY:
        continue
    clear()
    fn()
    export(name)
print('FERTIG')
