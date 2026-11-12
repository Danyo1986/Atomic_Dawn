"""Modellvorlagen des Nutzers (../3D-Modelle/*.blend) als Spielmodelle aufbereiten.
Aufruf:  blender -b --factory-startup -P tools/prep_models.py -- [modell ...]      (ohne Angabe: alle)
Ausgabe: assets/models/<modell>.glb

Alle Vorlagen bestehen aus vielen Einzelteilen (Front = -X, keine Knochen). Ablauf je Modell:
- Kleinteile (Schrauben, Nieten, Nähte, Reflexe …) fallen weg, Fasen-Modifikatoren werden nicht angewandt.
- Drehen auf +X vorne, Maßstab SCALE (Grundfläche wie die bisherigen Spielmodelle), Boden z = 0.
- Teile werden nach Namensmustern zu Knoten zusammengefasst (Hull/Body, Turret > Gun > Muzzle, Rotor, TailRotor, Load,
  Torso > Arms, LegL/LegR …), zu große Teile einzeln und danach jede Gruppe auf ein Dreiecksbudget vereinfacht.
- Kettenglieder -> Kettenband TrackL/TrackR aus der Hülle der Glieder mit der gezeichneten Kettentextur `Art_side_tread`
  (UV u = Lauflänge / 1.36 m, im Spiel per UV-Versatz animiert); Laufrollen -> einfache Scheiben `WheelT<n>` (drehen);
  Reifen -> Stollenreifen als Drehkörper in `Wheel<F|R><L|R><n>` (Vorderachse lenkt). Radius als Extra `r`.
- Materialien auf die Spielbibliothek (assets.js getMaterial) abgebildet: Oliv -> Olive/OliveDark (Tarnton der Partei),
  Orange -> Team (Teamfarbe), Graphit -> Frame, Stahl -> Steel, Glas -> Canopy, Uniform/Haut für die Soldaten …
Gebäude (Einträge mit fit/period): Eingang der Vorlage bei -Y = Süden, mittig in die Grundfläche eingepasst, Ausfahrt `Exit`
und Effektpunkte `FX_*` über `marks`, bewegliche Teile (Crane, Dish, Turret/Gun) als Gruppen, Emblem -> EmblemAxis + Stern EmblemAllies.
"""
import bpy, bmesh, math, os, re, sys
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', '..', '3D-Modelle')
OUT = os.path.join(HERE, '..', 'assets', 'models')
TREAD_IMG = os.path.join(HERE, '..', 'art', 'crop', 'side_tread.jpg')
TREAD_TILE = 1.36
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

DROP = ('Studio', 'Schraube', 'Niete', 'Radmutter', 'Befestiger', 'Fuge', 'Naht', 'Reflex', 'Blechstoß', 'Ziervertiefung',
        'Scharnier', 'Sohlenprofil', 'Felgenschraube', 'Polsternaht', 'Zierniete', 'Haarriss', 'Riss', 'Rauch · Volumen',
        'Unterlegscheibe', 'Reifenspuren')
MATMAP = [  # (Muster im Vorlagen-Materialnamen, Spielmaterial) – erster Treffer gilt
    # Gebäude
    ('Werkstattsymbol', 'Emblem'), ('Kabine', 'Canopy'), ('Glut', 'Glow'), ('Holz', 'Wood'), ('Asphalt', 'Asphalt'),
    ('Bodenmarkierung', 'Marking'), ('Randlicht', 'Light'), ('Krangelb', 'Hazard'), ('Markierung · Gelb', 'Hazard'),
    ('Kühlturm · Olivband', 'Olive'), ('Kühlturm · Ringsegmente', 'Steel'), ('Kühlturm', 'Concrete'), ('Beton', 'Pad'),
    ('Kupfer', 'Team'), ('Sandsäcke', 'Cloth'), ('Banner', 'Team'), ('Gitterstahl', 'Frame'), ('rußiger Stahl', 'Frame'),
    ('Vertiefungen', 'OliveDark'), ('Seitenflächen', 'OliveDark'), ('dunkles Oliv', 'OliveDark'), ('dunkle Fugen', 'OliveDark'),
    ('Warnlack', 'Team'), ('Warnmarkierung', 'Team'), ('Randprofil', 'Steel'), ('verwitterter Stahl', 'Steel'),
    # Fahrzeuge, Soldaten
    ('Kristall', 'Ore'), ('Gewebeplane', 'Cloth'), ('Olivgewebe', 'Cloth'), ('Rucksack', 'Gear'), ('Gurtband', 'Cloth'),
    ('Schutzweste', 'Gear'), ('Nähte', 'Gear'), ('Uniform', 'Uniform'), ('Haut', 'Skin'), ('Stiefel', 'Rubber'),
    ('Schutzbrille', 'Canopy'), ('Verglasung', 'Canopy'), ('Cockpit', 'Canopy'), ('Blauglas', 'Canopy'), ('Glasfacette', 'Canopy'),
    ('Haube', 'Canopy'), ('Optik', 'Canopy'),
    ('Scheinwerfer', 'Light'), ('Rücklicht', 'TailLight'),
    ('Positionslicht', 'Team'), ('Signallicht', 'Team'), ('Orange', 'Team'), ('Kennzeichnung', 'Team'), ('Oxidrot', 'Team'),
    ('Flanken', 'OliveDark'), ('Unterbau', 'OliveDark'), ('Unterseite', 'OliveDark'), ('Schatten', 'OliveDark'),
    ('Verstärkungen', 'OliveDark'), ('Oliv · Kanten', 'OliveDark'), ('Graugrün', 'OliveDark'),
    ('Oliv', 'Olive'), ('Sand', 'Olive'),
    ('thermisch', 'Nozzle'), ('Düsen', 'Frame'), ('Graphit', 'Frame'), ('Dunkler Stahl', 'Frame'), ('Dunkelgrau', 'Frame'),
    ('Kette', 'Frame'), ('Titan', 'Steel'), ('Stahl', 'Steel'),
    ('Hohlräume', 'Rubber'), ('Profil', 'Rubber'), ('Reifen', 'Rubber'), ('Sitz', 'Gear'), ('Ocker', 'Hazard'),
]
PREVIEW = {  # Farben nur für Kontrollbilder (im Spiel ersetzt assets.js die Materialien nach Namen)
    'Olive': (0.36, 0.42, 0.55), 'OliveDark': (0.24, 0.29, 0.38), 'Team': (0.1, 0.3, 0.85), 'Frame': (0.06, 0.065, 0.07),
    'Steel': (0.25, 0.26, 0.27), 'Rubber': (0.02, 0.02, 0.02), 'Gear': (0.05, 0.07, 0.1), 'Light': (1, 0.8, 0.5),
    'TailLight': (1, 0.05, 0.02), 'Hazard': (0.7, 0.4, 0.03), 'Cloth': (0.3, 0.35, 0.42), 'Canopy': (0.1, 0.3, 0.45),
    'Ore': (0.1, 0.45, 1.0), 'Uniform': (0.25, 0.32, 0.42), 'Skin': (0.7, 0.45, 0.32), 'Nozzle': (0.35, 0.25, 0.15),
    'Emblem': (0.8, 0.78, 0.7), 'Glow': (1.0, 0.45, 0.1), 'Wood': (0.45, 0.3, 0.17), 'Asphalt': (0.08, 0.08, 0.085),
    'Marking': (0.85, 0.85, 0.82), 'Concrete': (0.62, 0.6, 0.57), 'Pad': (0.5, 0.49, 0.47), 'Alloy': (0.55, 0.57, 0.6),
    'White': (0.75, 0.74, 0.7), 'Plant': (0.2, 0.4, 0.1),
}


def has(name, pats):
    return any(p in name for p in pats)


# ------------------------------------------------------------------ Modelle
# groups: [(Knoten, Muster)] – erster Treffer; pivot: Knoten -> Funktion(P) mit P(muster) = (Mitte, min, max) der Teile
CFG = {
    'buggy': dict(src='Offroad-Buggy', scale=1.0, base='Hull', drop=('Lenkrad', 'Lenksäule', 'Schaltknauf', 'Schalthebel',
                  'Vertiefung', 'Kühlrippe', 'Leuchtendichtung', 'Federteller', 'Lüftungsöffnung', 'Dachaufbau · Dekorstreifen'),
                  groups=[('Gun', ('Dachaufbau · Laufmantel', 'Dachaufbau · Laufattrappe', 'Dachaufbau · Außenring', 'Dachaufbau · Dunkle Stirnfläche')),
                          ('Turret', ('Dachaufbau',))],
                  wheels=dict(hub='Reifenkarkasse', parts=('Felge', 'Nabendeckel', 'Nabenring'), remove=('Reifenkarkasse', 'Profilblock')),
                  pivot={'Turret': lambda P: P('Dachaufbau · Drehring')[0], 'Gun': lambda P: gun_root(P)},
                  muzzle=[('Gun', 'gunfront')], target={'Hull': 3300, 'Turret': 420, 'Gun': 160, 'Wheel': 220}),
    'tank': dict(src='Panzer', scale=1.5, base='Hull',
                 groups=[('Gun', ('Rohrattrappe',)), ('Turret', ('Turm', 'Luke', 'Optikblock', 'Antenne', 'Blende', 'Rohrmantel'))],
                 tracks=dict(links=('Kettenglied',), wheel='Laufrolle', remove=('Laufrolle', 'Laufwerksträger')),
                 pivot={'Turret': lambda P: P('Turmkranz')[0], 'Gun': lambda P: gun_root(P)},
                 muzzle=[('Gun', 'gunfront')], target={'Hull': 2400, 'Turret': 800, 'Gun': 300}),
    'ifv': dict(src='Schuetzenpanzer', scale=1.1, base='Hull',
                groups=[('Gun', ('Turmrohr',)), ('Turret', ('Turm', 'Zierelement', 'Antenne'))],
                tracks=dict(links=('Kettenglied',), wheel='Laufrolle', remove=('Laufrolle', 'Laufwerksträger')),
                pivot={'Turret': lambda P: P('Turmkranz')[0], 'Gun': lambda P: gun_root(P)},
                muzzle=[('Gun', 'gunfront')], target={'Hull': 2600, 'Turret': 500, 'Gun': 160}),
    'artillery': dict(src='Haubitzen-Panzer', scale=1.2, base='Hull',
                      groups=[('Gun', ('Rohrattrappe', 'Endstück')),
                              ('Turret', ('Kasematte', 'Dach', 'Rohrwiege', 'Heckflanke', 'Vordere Schulter'))],
                      tracks=dict(links=('Kettenglied',), wheel='Laufrolle', remove=('Laufrolle', 'Laufwerksträger')),
                      pivot={'Turret': lambda P: P('Kasematte')[0], 'Gun': lambda P: Vector((P('Rohrwiege · Sockel')[0].x, 0, P('Rohrattrappe')[0].z))},
                      muzzle=[('Gun', 'gunfront')], target={'Hull': 2200, 'Turret': 900, 'Gun': 400}),
    'mcv': dict(src='Baustellen-Lkw', scale=1.3, base='Hull',
                groups=[], wheels=dict(hub='Reifenkarkasse', parts=('Felge', 'Nabenkappe', 'Radnabe'), remove=('Reifenkarkasse', 'Geländeprofil')),
                target={'Hull': 3600, 'Wheel': 160}),
    'harvester': dict(src='Sammler', scale=1.3, base='Hull',
                      groups=[('Load', ('Erzfragment', 'Großer Kristall'))],
                      tracks=dict(links=('Kettenglied', 'Profilplatte'), wheel='Laufrolle', remove=('Laufrolle', 'Radkranz', 'Radnabe', 'Laufwerkskasten')),
                      pivot={'Load': lambda P: Vector((P('Ladeboden')[0].x, 0, P('Ladeboden')[2].z))},
                      target={'Hull': 3200, 'Load': 700}),
    'heli': dict(src='Helikopter', scale=1.25, base='Body',
                 groups=[('Rotor', ('Hauptrotor', 'Rotorblatt')), ('TailRotor', ('Heckrotor',))],
                 pivot={'Rotor': lambda P: P('Hauptrotor · Nabenkörper')[0], 'TailRotor': lambda P: P('Heckrotor · Nabe')[0]},
                 muzzle=[('Body', 'front', 'Seitengondel · Hauptgehäuse')], target={'Body': 3200, 'Rotor': 500, 'TailRotor': 120}),
    'jet': dict(src='Jet', scale=1.6, base='Body', groups=[],
                muzzle=[('Body', 'below', 'Pfeilflügel · Grundkörper')], fx=[('Body', 'FX_afterburner', 'rear', 'Triebwerksdüse')],
                target={'Body': 3400}),
    # Soldaten: Fasen behalten (soft), weicher schattiert (smooth 65°), höheres Budget, Helmschale mit eigenem Budget
    'rifleman': dict(src='Infanterie-Soldat', height=1.83, base='Torso', soldier=True, part_cap=700, soft=True, smooth=65, min_part=24,
                     protect={'Helmschale': 900, 'Helm · orangefarbener Mittelstreifen': 160},
                     drop=('Metallschnalle', 'Tragegriff'),
                     groups=[('Arms', ('Ärmel', 'Handgelenk', 'Handschuh', 'Requisit')),
                             ('Leg', ('Hosenbein', 'Knieschutz', 'Stiefel'))],
                     muzzle=[('Arms', 'front', 'Requisit')], target={'Torso': 2600, 'Arms': 1200, 'Leg': 420}),
    'bazooka': dict(src='Bazooka-Soldat', height=1.83, base='Torso', soldier=True, part_cap=700, soft=True, smooth=65, min_part=24,
                    protect={'Helmschale': 900, 'Helm · orangefarbener Mittelstreifen': 160},
                     drop=('Metallschnalle', 'Tragegriff'),
                    groups=[('Arms', ('Ärmel', 'Handgelenk', 'Handschuh', 'Requisit')),
                            ('Leg', ('Hosenbein', 'Knieschutz', 'Stiefel'))],
                    muzzle=[('Arms', 'front', 'Requisit')], target={'Torso': 2600, 'Arms': 1200, 'Leg': 420}),
    'flak': dict(src='FLAK-Panzer', scale=1.4, base='Hull',
                 groups=[('Gun', ('Rohrattrappe', 'Endstück')), ('Dish', ('Radar · ',)),
                         ('Turret', ('Turm', 'Verkleidung', 'Radaraufnahme'))],
                 tracks=dict(links=('Kettenglied',), wheel='Laufrolle', remove=('Laufrolle', 'Laufwerksträger')),
                 pivot={'Turret': lambda P: P('Turmkranz')[0], 'Gun': lambda P: gun_root(P),
                        'Dish': lambda P: Vector((P('Radar · Sockel')[0].x, 0, P('Radar · Sockel')[2].z))},
                 muzzle=[('Gun', 'front', 'Rohrattrappe · dunkle Stirnfläche')], target={'Hull': 2400, 'Turret': 700, 'Gun': 400, 'Dish': 500}),
    # ---------------- Gebäude: Eingang der Vorlagen liegt bei -Y (= Süden im Spiel), keine Drehung; fit = halbe Grundfläche (m)
    'hq': dict(src='Bauhof', fit=(7.7, 7.7), base='Base', min_part=8,
               groups=[('Crane', ('Ausleger', 'Gegenausleger', 'Gegengewicht', 'Hakenflasche', 'Hubseil', 'Kranhaken', 'Krankabine',
                                  'Laufkatze', 'Seiltrommel', 'Kran · Mastspitze')),
                       ('EmblemAxis', ('Werkstatt · Hammer', 'Werkstatt · Schraubenschlüssel'))],
               pivot={'Crane': lambda P: Vector((P('Kran · Mastspitze')[0].x, P('Kran · Mastspitze')[0].y, P('Kran · Mastspitze')[1].z))},
               marks=[('Exit', 'exit', 'Einfahrtsrampe')], target={'Base': 6500, 'Crane': 1400, 'EmblemAxis': 300}),
    'power': dict(src='Kraftwerk', fit=(5.75, 5.75), base='Base', min_part=8,
                  drop=('Gittersteg', 'konzentrisches Innengitter', 'Kupferring', 'Kühlrippe'),
                  groups=[], marks=[('FX_steam', 'top', 'Kühlturm · Betonschale'), ('Exit', 'exit', 'Portal · Rolltor')],
                  protect={'Kühlturm · Betonschale': 1600, 'Kühlturm · Lüftungssockel': 320, 'Kühlturm · dunkler Innenboden': 120},
                  target={'Base': 9000}),
    'barracks': dict(src='Kaserne', fit=(5.75, 5.75), base='Base', min_part=8, groups=[],
                     marks=[('Exit', 'exit', 'Eingangstreppe')], target={'Base': 6500}),
    'factory': dict(src='Waffenfabrik', fit=(7.7, 7.7), base='Base', min_part=8,
                    groups=[('EmblemAxis', ('Emblem · ',))],
                    marks=[('FX_smoke', 'top', 'Schornstein · Außenmantel'), ('Exit', 'exit', 'Rolltor · Torblatt')],
                    target={'Base': 6500, 'EmblemAxis': 500}),
    'radar': dict(src='Radarstation', fit=(5.75, 5.75), base='Base', min_part=8,
                  groups=[('Dish', ('Parabolschüssel', 'Reflektor', 'Schüssel', 'Empfangskopf', 'Radar · ', 'Klemmschuh'))],
                  pivot={'Dish': lambda P: Vector((P('Radarsockel · fester Drehring')[0].x, P('Radarsockel · fester Drehring')[0].y,
                                                   P('Radarsockel · fester Drehring')[2].z))},
                  protect={'Parabolschüssel': 1800, 'Reflektor · Ringprofil': 260, 'Radarsockel · fester Drehring': 160},
                  target={'Base': 4000, 'Dish': 3000}),
    'helipad': dict(src='Flughafen', fit=(7.75, 15.9), base='Base', min_part=8,
                    groups=[], marks=[('Exit', 'center', 'Helipad · Landefläche')], target={'Base': 6500}),
    'turret': dict(src='Geschuetzturm', fit=(3.8, 3.8), fit_on='Sockel', rot=math.pi, yaw=math.pi / 2, base='Base', min_part=8,
                   groups=[('Gun', ('Rohrattrappe', 'Endkappe')),
                           ('Turret', ('Turm', 'Drehteller', 'Deckplatte', 'Stahlabdeckung', 'Heckbrücke'))],
                   pivot={'Turret': lambda P: Vector((0, 0, P('Drehteller')[1].z)), 'Gun': lambda P: gun_root(P)},
                   muzzle=[('Gun', 'front', 'Rohrattrappe · dunkle Stirnfläche')], target={'Base': 1600, 'Turret': 900, 'Gun': 500}),
    'silo': dict(src='Abschussbasis', fit=(7.7, 7.7), base='Base', min_part=8, drop=('Außenfuge',),   # Superwaffe: Knoten Rocket startet
                 groups=[('Rocket', ('Raketenrequisit', 'Seitlicher Körper'))],
                 pivot={'Rocket': lambda P: Vector((P('@Rocket')[0].x, P('@Rocket')[0].y, P('@Rocket')[1].z))},
                 protect={'Raketenrequisit · Hauptkörper': 700, 'Raketenrequisit · seitlicher Körper': 260, 'Plattform · Deck': 300},
                 target={'Base': 7000, 'Rocket': 1800}),
    'wall': dict(src='Mauer', period=('Pfeiler · Kern', 4.0), keep=lambda c: abs(c.x) < 2.7, base='Base', min_part=8,
                 groups=[], target={'Base': 420}),
}


def gun_root(P):
    """Drehpunkt des Rohrs: hinteres Ende der Gun-Teile auf der Rohrachse."""
    c, lo, hi = P('@Gun')
    return Vector((lo.x, c.y, c.z))


# ------------------------------------------------------------------ Hilfen
BLD_MATMAP = [  # nur Gebäude: heller gebürsteter Stahl wie in den Vorlagen (Steel der Fahrzeuge wirkt auf großen Flächen fast schwarz)
    ('Stahl · gebürstet', 'Alloy'), ('verwitterter Stahl', 'Alloy'), ('Stahl · Deckflächen', 'Alloy'),
    ('blaues Glas', 'Canopy'), ('Raketenrequisit', 'White'), ('Bepflanzung', 'Plant'), ('Erde', 'Wood'), ('Laufrost', 'Alloy'),
]
CUR_MATMAP = MATMAP


def game_mat(name):
    gm = next((g for k, g in CUR_MATMAP if k in name), 'Steel')
    m = bpy.data.materials.get(gm)
    if not m:
        m = bpy.data.materials.new(gm)
        m.use_nodes = True
        bs = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        bs.inputs['Base Color'].default_value = (*PREVIEW[gm], 1)
    return m


def tread_mat():
    m = bpy.data.materials.get('Art_side_tread')
    if m:
        return m
    m = bpy.data.materials.new('Art_side_tread')
    m.use_nodes = True
    nt = m.node_tree
    bs = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(TREAD_IMG, check_existing=True)
    nt.links.new(tex.outputs['Color'], bs.inputs['Base Color'])
    bs.inputs['Roughness'].default_value = 0.7
    return m


def bounds(mes):
    vs = [v.co for me in mes for v in me.vertices]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    return (lo + hi) / 2, lo, hi


def tris(me):
    return sum(len(p.vertices) - 2 for p in me.polygons)


def decimate(me, ratio):
    """Netz per Collapse-Decimate vereinfachen (über ein Hilfsobjekt)."""
    ob = bpy.data.objects.new('_dec', me)
    bpy.context.scene.collection.objects.link(ob)
    dm = ob.modifiers.new('dec', 'DECIMATE')
    dm.ratio = max(0.02, min(1.0, ratio))
    with bpy.context.temp_override(object=ob, active_object=ob):
        bpy.ops.object.modifier_apply(modifier='dec')
    bpy.data.objects.remove(ob, do_unlink=True)


def join(mes):
    """Netze zu einem zusammenfügen, Materialien vereinigt."""
    bm = bmesh.new()
    mats = []
    for me in mes:
        remap = []
        for m in me.materials:
            if m not in mats:
                mats.append(m)
            remap.append(mats.index(m))
        tmp = bmesh.new(); tmp.from_mesh(me)
        for f in tmp.faces:
            f.material_index = remap[f.material_index] if remap else 0
        tmp.to_mesh(me); tmp.free()
        bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.002)
    out = bpy.data.meshes.new('join')
    bm.to_mesh(out); bm.free()
    for m in mats:
        out.materials.append(m)
    return out


def lathe(c, axis_sign, prof, n, mats, lug=None):
    """Drehkörper um die Y-Achse durch c. prof = [(Radius, Versatz nach außen)], mats[k] = Material des Bands k..k+1.
    lug(i, k) -> Radiusfaktor (Stollen). Ein Radius 0 schließt als Fächer."""
    bm = bmesh.new()
    rings = []
    for i in range(n):
        a = i / n * math.tau
        ring = []
        for k, (r, off) in enumerate(prof):
            f = lug(i, k) if lug else 1.0
            ring.append(bm.verts.new((c.x + math.cos(a) * r * f, c.y + off * axis_sign, c.z + math.sin(a) * r * f)))
        rings.append(ring)
    allm = []
    for m in mats:
        if m not in allm:
            allm.append(m)
    for i in range(n):
        A, B = rings[i], rings[(i + 1) % n]
        for k in range(len(prof) - 1):
            vs = [A[k], A[k + 1], B[k + 1], B[k]]
            if prof[k + 1][0] == 0:
                vs = [A[k], A[k + 1], B[k]]
            try:
                f = bm.faces.new(vs)
            except ValueError:
                continue
            f.material_index = allm.index(mats[k])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    # Normalen nach außen (weg von der Achse bzw. nach außen auf der Stirnseite)
    for f in bm.faces:
        f.normal_update()   # neue bmesh-Flächen haben noch keine Normale – ohne das zeigten Flächen zufällig nach innen
        cc = f.calc_center_median()
        out = Vector((cc.x - c.x, (cc.y - c.y) * 3 + 0.3 * axis_sign, cc.z - c.z))
        if f.normal.dot(out) < 0:
            f.normal_flip()
    me = bpy.data.meshes.new('lathe')
    bm.to_mesh(me); bm.free()
    for m in allm:
        me.materials.append(game_mat_named(m))
    return me


def game_mat_named(gm):
    m = bpy.data.materials.get(gm)
    if not m:
        m = bpy.data.materials.new(gm)
        m.use_nodes = True
        bs = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        bs.inputs['Base Color'].default_value = (*PREVIEW[gm], 1)
    return m


def tyre(c, r, w, sg):
    """Stollenreifen (Lauffläche abwechselnd hoch/tief) um die Nabe c."""
    prof = [(0.66 * r, -0.9 * w), (0.86 * r, -1.0 * w), (0.96 * r, -0.92 * w), (r, -0.7 * w), (r, 0.7 * w), (0.96 * r, 0.92 * w),
            (0.86 * r, 1.0 * w), (0.66 * r, 0.9 * w)]
    return lathe(c, sg, prof, 22, ['Rubber'] * 7, lug=lambda i, k: (1.0 if i % 2 == 0 else 0.94) if 2 <= k <= 5 else 1.0)


def roadwheel(c, r, w, sg):
    """Laufrolle als Scheibe: Laufkranz, Olivscheibe, Stahlnabe (nur Außenseite)."""
    prof = [(r, -w / 2), (r, w / 2), (0.8 * r, w / 2 + 0.02), (0.36 * r, w / 2 + 0.05), (0.0, w / 2 + 0.07)]
    return lathe(c, sg, prof, 10, ['Frame', 'Frame', 'Olive', 'Steel'])


def tread_band(pts_xz, y0, y1):
    """Kettenband als geschlossener Ring mit Stärke: Lauffläche außen (gezeichnete Kettentextur, UV u = Lauflänge / TREAD_TILE,
    im Spiel per UV-Versatz animiert), Innenfläche und Seitenwangen dunkel (Frame). Profil = konvexe Hülle der Kettenglieder."""
    prof = hull2d([(round(x, 3), round(z, 3)) for x, z in pts_xz])
    simp = [prof[0]]
    for p in prof[1:]:
        if math.dist(p, simp[-1]) > 0.12:
            simp.append(p)
    if math.dist(simp[-1], simp[0]) < 0.12:
        simp.pop()
    prof = simp
    n = len(prof)
    cx = sum(p[0] for p in prof) / n; cz = sum(p[1] for p in prof) / n
    # Innenprofil: jede Ecke entlang der gemittelten Kanten-Innennormalen um die Kettenstärke versetzt
    T = min(0.2, 0.25 * (max(p[1] for p in prof) - min(p[1] for p in prof)))
    def inward(a, b):
        dx, dz = b[0] - a[0], b[1] - a[1]
        l = math.hypot(dx, dz) or 1
        nx, nz = -dz / l, dx / l
        mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        return (nx, nz) if nx * (cx - mx) + nz * (cz - mz) > 0 else (-nx, -nz)
    inner = []
    for i in range(n):
        n1 = inward(prof[i - 1], prof[i]); n2 = inward(prof[i], prof[(i + 1) % n])
        sx, sz = n1[0] + n2[0], n1[1] + n2[1]
        k = T / max(0.35, 1 + n1[0] * n2[0] + n1[1] * n2[1])
        inner.append((prof[i][0] + sx * k, prof[i][1] + sz * k))
    L = [0.0]
    for i in range(1, n):
        L.append(L[-1] + math.dist(prof[i - 1], prof[i]))
    per = L[-1] + math.dist(prof[-1], prof[0])
    ym = (y0 + y1) / 2
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    o0 = [bm.verts.new((x, y0, z)) for x, z in prof]; o1 = [bm.verts.new((x, y1, z)) for x, z in prof]
    i0 = [bm.verts.new((x, y0, z)) for x, z in inner]; i1 = [bm.verts.new((x, y1, z)) for x, z in inner]

    def face(vs, mat, want):
        f = bm.faces.new(vs)
        f.material_index = mat
        f.normal_update()
        if f.normal.dot(want(f.calc_center_median())) < 0:
            f.normal_flip()
        return f
    for i in range(n):
        j = (i + 1) % n
        f = face([o0[i], o0[j], o1[j], o1[i]], 0, lambda c: Vector((c.x - cx, 0, c.z - cz)))   # Lauffläche
        s0, s1 = L[i], (L[j] if j else per)
        for l in f.loops:
            sv = s0 if l.vert in (o0[i], o1[i]) else s1
            l[uvl].uv = (sv / TREAD_TILE, 0 if l.vert in (o0[i], o0[j]) else 1)
        f.smooth = True
        face([i0[i], i0[j], i1[j], i1[i]], 1, lambda c: Vector((cx - c.x, 0, cz - c.z))).smooth = True   # Innenseite
        face([o0[i], o0[j], i0[j], i0[i]], 1, lambda c: Vector((0, y0 - ym, 0)))                          # Seitenwangen
        face([o1[i], o1[j], i1[j], i1[i]], 1, lambda c: Vector((0, y1 - ym, 0)))
    me = bpy.data.meshes.new('band')
    bm.to_mesh(me); bm.free()
    me.materials.append(tread_mat())
    me.materials.append(game_mat_named('Frame'))
    return me


def hull2d(pts):
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


def star_for(mes):
    """Fünfzackiger Stern in der Ebene eines Emblems (gleiche Mitte und Größe), Spitze nach oben bzw. auf Dächern nach Norden."""
    vs = [v.co.copy() for me in mes for v in me.vertices]
    cen = sum(vs, Vector()) / len(vs)
    ref = Vector((cen.x, cen.y, 0))
    ref = (ref.normalized() * 0.6 if ref.length > 1e-6 else Vector()) + Vector((0, 0, 1))
    n = Vector()
    for me in mes:
        for p in me.polygons:
            if p.normal.dot(ref) > 0.3:
                n += p.normal * p.area
    n.normalize()
    up = Vector((0, 0, 1)) - n * n.z
    if up.length < 0.2:
        up = Vector((0, 1, 0)) - n * n.y
    v = up.normalized(); u = v.cross(n)
    R = 0.95 * max(max(abs((p - cen).dot(u)) for p in vs), max(abs((p - cen).dot(v)) for p in vs))
    o = cen + n * 0.03
    bm = bmesh.new()
    mid = bm.verts.new(o)
    ring = [bm.verts.new(o + (u * math.sin(i * math.pi / 5) + v * math.cos(i * math.pi / 5)) * (R if i % 2 == 0 else R * 0.4))
            for i in range(10)]
    for i in range(10):
        f = bm.faces.new([mid, ring[i], ring[(i + 1) % 10]])
        f.normal_update()
        if f.normal.dot(n) < 0:
            f.normal_flip()
    me = bpy.data.meshes.new('star')
    bm.to_mesh(me); bm.free()
    me.materials.append(game_mat_named('Emblem'))
    return me


def cube_uv(me, size=2.0):
    bm = bmesh.new(); bm.from_mesh(me)
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal; ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            p = l.vert.co
            u, v = (p.y, p.z) if ax == 0 else (p.x, p.z) if ax == 1 else (p.x, p.y)
            l[uv].uv = (u / size, v / size)
    bm.to_mesh(me); bm.free()


def finish(ob, keep_uv=False, angle=40):
    with bpy.context.temp_override(object=ob, active_object=ob, selected_editable_objects=[ob]):
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    for mod in list(ob.modifiers):
        with bpy.context.temp_override(object=ob, active_object=ob):
            bpy.ops.object.modifier_apply(modifier=mod.name)
    if not keep_uv:
        cube_uv(ob.data)


def empty(name, loc, parent):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.parent = parent
    e.location = Vector(loc) - parent.matrix_world.translation
    return e


# ------------------------------------------------------------------ Aufbau eines Modells
def build(key, C):
    global CUR_MATMAP
    CUR_MATMAP = (BLD_MATMAP + MATMAP) if ('fit' in C or 'period' in C) else MATMAP
    bpy.ops.wm.open_mainfile(filepath=os.path.join(SRC, C['src'] + '.blend'))
    drop = DROP + C.get('drop', ())
    # erst auswerten, dann löschen: Teile hängen teils an Leerobjekten (Radarschüssel: Neigung über ein Eltern-Empty)
    use = [o for o in bpy.data.objects if o.type in ('MESH', 'CURVE') and not has(re.sub(r'\.\d+$', '', o.name), drop)]
    for o in use:
        if o.type == 'CURVE':
            o.data.resolution_u = min(o.data.resolution_u, 4)
            o.data.bevel_resolution = 0
        for m in list(o.modifiers):
            if m.type == 'BEVEL' and C.get('soft'):   # Soldaten: Fase mit einem Segment behalten, sonst wirken Ausrüstung und Waffe klotzig
                m.segments = 1; m.harden_normals = False
            elif m.type in ('BEVEL', 'WEIGHTED_NORMAL', 'SUBSURF'):
                o.modifiers.remove(m)
    dg = bpy.context.evaluated_depsgraph_get()
    raw = []
    for o in use:
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=False, depsgraph=dg)
        me.transform(o.matrix_world)
        if o.matrix_world.determinant() < 0:
            me.flip_normals()
        if len(me.vertices):
            raw.append((re.sub(r'\.\d+$', '', o.name), me))
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    if 'keep' in C:   # nur ein Ausschnitt der Vorlage (Mauer: ein Feld zwischen zwei Pfeilern)
        raw = [(n, me) for n, me in raw if C['keep'](bounds([me])[0])]
    # Maßstab: fest, über die Höhe (Soldaten), über die Grundfläche (Gebäude, mittig) oder über den Pfeilerabstand (Mauer)
    _, lo, hi = bounds([m for _, m in raw])
    ctr = Vector((0, 0, 0))
    if 'height' in C:
        S = C['height'] / (hi.z - lo.z)
    elif 'fit' in C:
        if 'fit_on' in C:   # Grundfläche nur aus diesen Teilen (Geschützturm: Sockel, die Rohre ragen darüber hinaus)
            _, lo, hi = bounds([me for n, me in raw if C['fit_on'] in n])
        S = min(C['fit'][0] * 2 / (hi.x - lo.x), C['fit'][1] * 2 / (hi.y - lo.y))
        ctr = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, 0))
    elif 'period' in C:
        xs = sorted(bounds([me])[0].x for n, me in raw if n == C['period'][0])
        S = C['period'][1] / (xs[-1] - xs[0])
        ctr = Vector(((xs[0] + xs[-1]) / 2, (lo.y + hi.y) / 2, 0))
    else:
        S = C['scale']
    T = Matrix.Translation((0, 0, -lo.z * S)) @ Matrix.Rotation(C.get('rot', 0 if ('fit' in C or 'period' in C) else math.pi), 4, 'Z') \
        @ Matrix.Scale(S, 4) @ Matrix.Translation(-ctr)
    half = Vector(((hi.x - lo.x) / 2 * S, (hi.y - lo.y) / 2 * S, 0))
    parts = []
    for name, me in raw:
        me.transform(T)
        for i, ms in enumerate(me.materials):
            me.materials[i] = game_mat(ms.name if ms else '')
        parts.append((name, me))

    def P(pat):
        if pat.startswith('@'):
            mes = groups[pat[1:]]
        else:
            mes = [me for n, me in parts if n == pat] or [me for n, me in parts if pat in n]
        return bounds(mes)

    extra = {}   # Knoten -> [(Netz, ohne UV-Neuberechnung)]
    radius = {}
    # Kettenband + Laufrollen
    tr = C.get('tracks')
    if tr:
        for side, sg in (('TrackL', 1), ('TrackR', -1)):
            links = [me for n, me in parts if has(n, tr['links']) and bounds([me])[0].y * sg > 0]
            pts = [(v.co.x, v.co.z) for me in links for v in me.vertices]
            _, l0, h0 = bounds(links)
            extra.setdefault(side, []).append((tread_band(pts, l0.y, h0.y), True))
        k = 0
        for n, me in parts:
            if n == tr['wheel']:
                c, l0, h0 = bounds([me])
                r = (h0.z - l0.z) / 2
                sg = 1 if c.y > 0 else -1
                w = h0.y - l0.y
                nm = 'WheelT%d' % k; k += 1
                extra[nm] = [(roadwheel(Vector((0, 0, 0)), r, w * 0.6, sg), False)]
                extra[nm + '@'] = c
                radius[nm] = r
        parts = [(n, me) for n, me in parts if not has(n, tr['links'] + tr['remove'])]
    # Reifen
    wh = C.get('wheels')
    hubs = {}
    if wh:
        hl = [bounds([me]) for n, me in parts if n == wh['hub']]
        xs = sorted({round(c.x, 1) for c, _, _ in hl}, reverse=True)
        for c, l0, h0 in hl:
            ax = xs.index(round(c.x, 1))
            nm = 'Wheel' + ('F' if ax == 0 else 'R') + ('L' if c.y > 0 else 'R') + ('' if ax == 0 else str(ax))
            hubs[nm] = (c, (h0.y - l0.y) / 2)
            radius[nm] = c.z
        parts = [(n, me) for n, me in parts if not has(n, wh['remove'])]

    # Gruppen
    groups = {}
    for n, me in parts:
        g = next((gn for gn, pats in C['groups'] if has(n, pats)), C['base'])
        c = bounds([me])[0]
        if wh and has(n, wh['parts']) and hubs:
            g = min(hubs, key=lambda k: (hubs[k][0] - c).length)
        if g == 'Leg':
            g = 'LegL' if c.y > 0 else 'LegR'
        groups.setdefault(g, []).append(me)
    if 'EmblemAxis' in groups:   # Emblem der Vorlage gilt für die Achsenmacht, die Allianz bekommt an gleicher Stelle einen Stern
        extra['EmblemAllies'] = [(star_for(groups['EmblemAxis']), False)]

    # Drehpunkte
    piv = {g: Vector((0, 0, 0)) for g in list(groups) + [k for k in extra if not k.endswith('@')]}
    for g, fn in C.get('pivot', {}).items():
        piv[g] = fn(P)
    for g, (c, _) in hubs.items():
        piv[g] = c
    for g in extra:
        if g.endswith('@'):
            piv[g[:-1]] = extra[g]
    if C.get('soldier'):
        cb, lb, hb = P('Hosenbund')
        piv['Torso'] = Vector((cb.x, 0, cb.z))
        for g in ('LegL', 'LegR'):
            cl = bounds(groups[g])[0]
            piv[g] = Vector((cb.x, cl.y, cb.z))
        ca = P('Ärmel')
        piv['Arms'] = Vector((P('Kragen')[0].x, 0, ca[2].z - 0.06))

    objs = {}
    total = 0
    cap = C.get('part_cap', 600)
    for g in sorted(set(groups) | {k for k in extra if not k.endswith('@')}):
        tgt = C['target'].get(g, C['target'].get('Wheel' if g.startswith('Wheel') else 'Leg' if g.startswith('Leg') else g, 400))
        if g in groups:
            # je Teil vereinfachen (ein gemeinsames Collapse über die ganze Gruppe verschmilzt Teile zu Splittern):
            # erst zu große Teile kappen, dann das Restbudget anteilig auf alle Teile über 24 Dreiecken verteilen
            # geschützte Teile (große glatte Formen: Kühlturm, Radarschüssel) bekommen ein eigenes festes Budget
            prot = C.get('protect', {})
            mes = []
            for n, me in [(n, me) for n, me in parts if me in groups[g]]:
                k = next((p for p in prot if p in n), None)
                if k:
                    if tris(me) > prot[k]:
                        decimate(me, prot[k] / tris(me))
                else:
                    mes.append(me)
            for me in mes:
                t = tris(me)
                if t > cap:
                    decimate(me, cap / t)
            small = sum(tris(me) for me in mes if tris(me) <= 24)
            big = [me for me in mes if tris(me) > 24]
            bt = sum(tris(me) for me in big)
            tgt -= sum(tris(me) for me in groups[g] if me not in mes)
            if small + bt > tgt and bt:
                r = max(0.08, (tgt - small) / bt)
                for me in big:
                    decimate(me, max(r, C.get('min_part', 16) / tris(me)))
            me = join(groups[g])
        else:
            me = bpy.data.meshes.new(g)
        me.transform(Matrix.Translation(-piv[g]))
        ob = bpy.data.objects.new(g, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.location = piv[g]
        finish(ob, angle=C.get('smooth', 40))
        add = list(extra.get(g, []))
        if g in hubs:
            c, w = hubs[g]
            add.append((tyre(Vector((0, 0, 0)) + (c - piv[g]), c.z, w, 1 if c.y > 0 else -1), False))
        for xm, keep in add:   # erzeugte Teile (Kettenband, Laufrollen, Reifen) nach dem Vereinfachen anfügen
            if not keep:
                cube_uv(xm)
            for m in xm.materials:
                if m.name not in ob.data.materials:
                    ob.data.materials.append(m)
            idx = [list(ob.data.materials).index(m) for m in xm.materials]
            bm = bmesh.new(); bm.from_mesh(ob.data)
            n0 = len(bm.faces)
            tmp = bmesh.new(); tmp.from_mesh(xm)
            for f in tmp.faces:
                f.material_index = idx[f.material_index]
            tmp.to_mesh(xm); tmp.free()
            bm.from_mesh(xm)
            bm.to_mesh(ob.data); bm.free()
        if g in radius:
            ob['r'] = radius[g]
        n = tris(ob.data)
        total += n
        objs[g] = ob
        print('KNOTEN', g, n, [m.name for m in ob.data.materials])

    # Hierarchie
    def parent(ch, pa):
        if ch in objs and pa in objs:
            w = objs[ch].matrix_world.translation.copy()
            objs[ch].parent = objs[pa]
            objs[ch].location = w - objs[pa].location
    parent('Gun', 'Turret')
    parent('Dish', 'Turret')
    parent('Arms', 'Torso')
    bpy.context.view_layer.update()
    for spec in C.get('muzzle', []):
        node, kind = spec[0], spec[1]
        if kind == 'gunfront':
            c, lo, hi = bounds([objs['Gun'].data])
            p = objs['Gun'].matrix_world @ Vector((hi.x + 0.05, c.y, c.z))
            empty('Muzzle', p, objs[node])
        else:
            sel = [me for n, me in parts if n == spec[2]] or [me for n, me in parts if spec[2] in n]
            if spec[2] == 'Requisit':   # Waffe der Soldaten: vorderstes Ende
                c, lo, hi = bounds(sel)
                empty('Muzzle', (hi.x + 0.02, c.y, c.z), objs[node])
                continue
            for me in sel:
                c, lo, hi = bounds([me])
                if kind == 'front':
                    empty('Muzzle', (hi.x + 0.05, c.y, c.z), objs[node])
                elif kind == 'below':
                    empty('Muzzle', (c.x, c.y, lo.z - 0.15), objs[node])
    for node, name, kind, pat in C.get('fx', []):
        for me in [me for n, me in parts if pat in n]:
            c, lo, hi = bounds([me])
            empty(name, (lo.x - 0.1, c.y, c.z), objs[node])
    # Gebäude: Ausfahrt (vor der Südkante), Landeplatz, Rauch-/Dampfpunkte
    for name, kind, pat in C.get('marks', []):
        sel = [me for n, me in parts if pat in n]
        if kind == 'top':
            for me in sel:
                c, l0, h0 = bounds([me])
                empty(name, (c.x, c.y, h0.z), objs[C['base']])
        elif kind == 'exit':
            empty(name, (bounds(sel)[0].x, -C['fit'][1] - 0.9, 0), objs[C['base']])
        elif kind == 'center':
            c, l0, _ = bounds(sel)
            empty(name, (c.x, c.y, l0.z), objs[C['base']])
    if C.get('yaw'):   # Geschützturm: Rohre nach Norden (+Y), Drehung in die Netze einrechnen (das Spiel setzt rotation.y)
        R = Matrix.Rotation(C['yaw'], 4, 'Z')
        for ob in bpy.data.objects:
            if ob.type == 'MESH':
                ob.data.transform(R)
            ob.location = R @ ob.location
    print('MODELL', key, 'DREIECKE', total, 'MASSSTAB', round(S, 3))
    path = os.path.join(OUT, key + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False, export_apply=True, export_yup=True,
                              export_materials='EXPORT', export_image_format='JPEG', export_jpeg_quality=88,
                              export_cameras=False, export_lights=False, export_extras=True)
    print('EXPORT', path)


for key in (argv or list(CFG)):
    build(key, CFG[key])
