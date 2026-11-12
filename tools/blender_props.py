"""Reduziert die heruntergeladenen Poly-Haven-Modelle (assets/raw) auf spieltaugliche Polygonzahlen.
blender -b --factory-startup -P tools/blender_props.py -- <raw-ordner> <ausgabeordner>
Blätter/Alpha-Materialien werden ausgedünnt (ganze Blattkarten entfernt), feste Geometrie dezimiert.
Ausgabe: <ausgabe>/<id>.glb, Ursprung unten mittig, Texturen max. 512/1024 px als JPEG eingebettet.
"""
import bpy, bmesh, sys, os, random
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
RAW, OUT = argv[0], argv[1]
os.makedirs(OUT, exist_ok=True)
# id: (Ziel-Dreiecke, Texturgröße)
TARGET = {
    # Karte: aus RTS-Entfernung gesehen, hundertfach instanziert -> knapp halten
    'namaqualand_boulder_02': (240, 512), 'namaqualand_boulder_05': (240, 512),
    'rock_moss_set_01': (420, 512), 'quiver_tree_02': (800, 512),   # Büsche kommen aus blender_trees.py
    'dead_tree_trunk': (320, 512), 'tree_stump_01': (300, 512), 'old_military_crate': (320, 512),
    'wooden_military_crate': (300, 512), 'Barrel_01': (260, 512), 'metal_jerrycan_green': (240, 512),
    'concrete_road_barrier': (200, 512), 'old_tyre': (260, 256), 'propane_tank': (260, 512),
}


def is_alpha(mat):
    if not mat or not mat.use_nodes:
        return False
    b = mat.node_tree.nodes.get('Principled BSDF')
    return bool(b and b.inputs['Alpha'].is_linked)


def thin_islands(ob, keep):
    """Entfernt zufällige zusammenhängende Inseln (Blattkarten), behält Anteil 'keep'."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    seen = set()
    rnd = random.Random(7)
    kill = []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, island = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop()
            island.append(g)
            for v in g.verts:
                for h in v.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        if rnd.random() > keep:
            kill.extend(island)
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    # verbleibende Karten etwas vergrößern, damit die Krone dicht bleibt
    bm.to_mesh(me)
    bm.free()


def tris(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)


def process(aid):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    path = os.path.join(RAW, aid, aid + '.gltf')
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    # Bei Sets nur das erste Objekt-"Cluster" behalten? -> alles behalten, aber zentrieren
    target, texsize = TARGET[aid]
    total = tris(meshes)
    alpha_objs, solid_objs = [], []
    for o in meshes:
        (alpha_objs if any(is_alpha(s.material) for s in o.material_slots) else solid_objs).append(o)
    ta, ts = tris(alpha_objs), tris(solid_objs)
    budget_solid = min(ts, target * (0.35 if ta else 1.0))
    budget_alpha = max(0, target - budget_solid)
    for o in alpha_objs:
        thin_islands(o, min(1.0, budget_alpha / max(ta, 1)))
    for o in solid_objs:
        r = min(1.0, budget_solid / max(ts, 1))
        if r < 0.98:
            if o.data.users > 1:
                o.data = o.data.copy()
            m = o.modifiers.new('dec', 'DECIMATE')
            m.ratio = r
            with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
                bpy.ops.object.modifier_apply(modifier='dec')
    # Alle Teile zu einem Objekt verbinden: ein Zeichenaufruf je Material statt je Einzelteil
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    if len(meshes) > 1:
        for o in meshes:
            if o.data.users > 1:
                o.data = o.data.copy()
        with bpy.context.temp_override(object=meshes[0], active_object=meshes[0], selected_objects=meshes, selected_editable_objects=meshes):
            bpy.ops.object.join()
        meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    # Texturen verkleinern
    for img in bpy.data.images:
        if img.size[0] > texsize:
            img.scale(texsize, texsize)
    # Ursprung: Mitte unten
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    off = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
    for o in bpy.data.objects:
        if o.parent is None:
            o.location -= off
    after = tris([o for o in bpy.data.objects if o.type == 'MESH'])
    print(f'PROP {aid}: {total} -> {after} tris, size {tuple(round(v, 2) for v in (mx - mn))}')
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, aid + '.glb'), export_format='GLB',
                              export_image_format='JPEG', export_jpeg_quality=82, export_apply=True)


for aid in TARGET:
    if os.path.exists(os.path.join(RAW, aid, aid + '.gltf')):
        try:
            process(aid)
        except Exception as ex:
            print('FEHLER', aid, ex)
print('FERTIG')
