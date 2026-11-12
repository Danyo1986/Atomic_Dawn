"""Rendert Kontrollbilder von GLB-Modellen (Workbench).
blender -b --factory-startup -P tools/blender_preview.py -- <out.png> <a.glb> [b.glb ...]
"""
import bpy, sys, math, os
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
out, files = argv[0], argv[1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
cols = math.ceil(math.sqrt(len(files)))
x = 0
for i, f in enumerate(files):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f)
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None]
    # Bounding box
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in new if o.type == 'MESH' for c in o.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    size = max(mx - mn)
    s = 10.0 / size
    for r in roots:
        r.scale = (s, s, s)
        r.location = (i % cols * 14 - (mn.x + mx.x) / 2 * s, -(i // cols) * 14 - (mn.y + mx.y) / 2 * s, -mn.z * s)
bpy.context.view_layer.update()
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
sc.collection.objects.link(cam)
rows = math.ceil(len(files) / cols)
cx, cy = (cols - 1) * 7, -(rows - 1) * 7
cam.data.type = 'ORTHO'
cam.data.ortho_scale = max(cols, rows) * 15
cam.location = (cx + 40, cy - 40, 45)
cam.rotation_euler = (math.radians(55), 0, math.radians(45))
sc.camera = cam
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'TEXTURE'
sc.display.shading.show_cavity = True
sc.display.shading.show_shadows = True
sc.render.resolution_x = int(os.environ.get('RES', 1400))
sc.render.resolution_y = int(os.environ.get('RES', 1400))
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
