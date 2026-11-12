"""Lädt CC0-Assets von Poly Haven (polyhaven.com) herunter.
Aufruf:  python tools/fetch_assets.py
Texturen -> assets/textures/<id>/{diff,nor,arm}.jpg
Modelle  -> assets/raw/<id>/<id>.gltf (+bin, Texturen)  -> werden danach mit Blender reduziert
HDRI     -> assets/hdri/sky.hdr
"""
import json, os, sys, urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
API = 'https://api.polyhaven.com/files/'
UA = {'User-Agent': 'asset-fetch'}

TEXTURES = {  # id: Auflösung
    'sparse_grass': '2k', 'aerial_grass_rock': '2k', 'aerial_rocks_02': '2k',
    'coast_sand_01': '2k', 'aerial_ground_rock': '2k', 'forest_leaves_02': '1k',
    'concrete_wall_008': '1k', 'concrete_floor_worn_001': '1k', 'corrugated_iron': '1k',
    'metal_plate': '1k', 'rusty_painted_metal': '1k', 'hangar_concrete_floor': '1k',
    'green_metal_rust': '1k', 'metal_plate_02': '1k',   # Oberflächendetail der Seitentexturen (make_side_textures.py)
    # Winterkarte: Schnee/Asphalt für das Gelände
    'snow_field_aerial': '2k', 'snow_02': '2k', 'asphalt_snow': '2k', 'asphalt_02': '2k',
    # Stadthäuser: Wand- und Dachflächen für die Fassadentexturen (make_city_textures.py)
    'red_brick_03': '1k', 'factory_brick': '1k', 'painted_plaster_wall': '1k', 'yellow_plaster': '1k', 'grey_plaster_02': '1k',
    'concrete_panels': '1k', 'concrete_tile_facade': '1k', 'rectangular_facade_tiles': '1k', 'corrugated_iron_02': '1k',
    'clay_roof_tiles_02': '1k', 'grey_roof_tiles': '1k',
}
MODELS = [
    'namaqualand_boulder_02', 'namaqualand_boulder_05', 'rock_moss_set_01',
    'shrub_02', 'shrub_03', 'wild_rooibos_bush', 'quiver_tree_02',
    'dead_tree_trunk', 'tree_stump_01', 'old_military_crate', 'wooden_military_crate',
    'Barrel_01', 'metal_jerrycan_green', 'concrete_road_barrier', 'old_tyre', 'propane_tank',
    
]
HDRI = 'kloofendal_48d_partly_cloudy_puresky'


def get(url, dst):
    if os.path.exists(dst):
        return
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req) as r, open(dst + '.part', 'wb') as f:
        f.write(r.read())
    os.replace(dst + '.part', dst)
    print('  ok', os.path.relpath(dst, ROOT))


def files(asset):
    req = urllib.request.Request(API + asset, headers=UA)
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def main():
    for tid, res in TEXTURES.items():
        print('Textur', tid)
        f = files(tid)
        for key, name in (('Diffuse', 'diff'), ('nor_gl', 'nor'), ('arm', 'arm')):
            get(f[key][res]['jpg']['url'], os.path.join(ROOT, 'textures', tid, name + '.jpg'))
    for mid in MODELS:
        print('Modell', mid)
        f = files(mid)
        g = f['gltf']['1k']['gltf']
        base = os.path.join(ROOT, 'raw', mid)
        get(g['url'], os.path.join(base, mid + '.gltf'))
        for rel, inc in g['include'].items():
            get(inc['url'], os.path.join(base, rel))
    print('HDRI', HDRI)
    get(files(HDRI)['hdri']['2k']['hdr']['url'], os.path.join(ROOT, 'hdri', 'sky.hdr'))


if __name__ == '__main__':
    sys.exit(main())
