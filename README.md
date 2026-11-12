# Atomic Dawn

Zwei Parteien: **Allianz** (blaugrauer Tarnanstrich, kühle Verbandsfarben) und **Achsenmacht** (rotbrauner Tarnanstrich, warme Verbandsfarben). Die eigene Partei und eine von 8 Verbandsfarben werden im Menü gewählt; alle Computergegner gehören zur anderen Partei und bekommen zufällig verschiedene Farben.

Modernes 3D-Echtzeit-Strategiespiel im Browser (Three.js): Basisbau, Erzwirtschaft, Panzer, Infanterie,
Kampfhubschrauber und bis zu 3 Computergegner. Das Spielprinzip lehnt sich an klassische Basisbau-RTS an;
Fraktionen, Einheiten, Modelle und Karten sind eigenständig.

## Starten (Windows-Paket)
Unter [Releases](https://github.com/Danyo1986/Atomic_Dawn/releases) liegt `AtomicDawn-Client-<Version>-win-x64.zip`
(Prüfsummen in `SHA256SUMS.txt`). Entpacken und `AtomicDawn.exe` starten – das Spiel öffnet sich in einem eigenen
Edge-Fenster (sonst Chrome bzw. Standardbrowser), der Spielserver läuft nur lokal auf `127.0.0.1` und beendet sich
mit dem Fenster. Keine Installation von Node.js nötig. Protokoll: `%LOCALAPPDATA%\AtomicDawn\launcher.log`.

Paket bauen: `node tools/release.mjs 1.0.0` (Ergebnis in `dist/release/`), mit `--publish` zusätzlich Quelltext,
Tag und GitHub-Release (braucht Node 22+ und die GitHub CLI).

## Starten (aus dem Quelltext)
```
start.bat            (oder: node server.js 8090)
```
Dann http://localhost:8090 öffnen. Ein lokaler Server ist nötig, weil Modelle per `fetch` geladen werden
(`file://` geht nicht). Einzige Voraussetzung: Node.js. Three.js liegt in `vendor/`, es wird nichts aus dem Netz
geladen außer den Google-Schriften (optional).

## Steuerung
| Eingabe | Wirkung |
|---|---|
| Linksklick / Ziehen | Auswahl / Rahmenauswahl (Shift = hinzufügen), Doppelklick = alle gleichen Einheiten |
| Rechtsklick | Bewegen, Angreifen, Erz sammeln, Sammler zur Raffinerie; mit Gebäude: Sammelpunkt |
| Pfeiltasten / Bildschirmrand / mittlere Maustaste | Kamera bewegen, Mausrad = Zoom, Q/E = drehen |
| A | Angriffsbewegung (dann Ziel klicken) |
| S / D / H | Stopp / Mobile Basis entfalten / zur Basis |
| Strg+1–9, 1–9 | Gruppen festlegen / wählen (doppelt = hinspringen) |
| R / V | Reparier- / Verkaufsmodus |
| N | Atomrakete: Ziel wählen (wenn die Abschussbasis bereit ist) |
| Leertaste | zum letzten Angriff springen |
| Esc / P / M | Pause-Menü / Pause / Ton |
| Seitenleiste | Links = bauen (Shift: 5×), Rechts = abbrechen; fertiges Gebäude anklicken → platzieren |

## Inhalt
- **Gebäude:** Hauptquartier (aus Mobiler Basis), Kraftwerk, Erzraffinerie (inkl. Sammler), Kaserne, Waffenfabrik,
  Radarstation (Radarkarte), Flugfeld, Geschützturm, Raketenturm (Luft- und Bodenziele), Teslaturm (nur Achsenmacht: Blitz, sofortiger Treffer) bzw. Prismaturm (nur Allianz: Laserstrahl, große Reichweite) – beide nur gegen Bodenziele, ab Radarstation, hoher Energiebedarf –, Mauer (ziehen zum Bauen),
  Abschussbasis (Superwaffe, eine je Spieler: Atomrakete lädt 5 Minuten, Ziel mit N bzw. Knopf in der Seitenleiste wählen; Gegner werden gewarnt, die KI nutzt sie ab „Normal“; nach dem Einschlag ist das Gebiet 15 Sekunden verstrahlt und schwächt Einheiten und Gebäude weiter)
- **Einheiten:** Schütze, Panzerjäger, Wiesel (Späh-Buggy mit MG), Schakal (Schützenpanzer), Wolf (Kampfpanzer), Donner (Panzerhaubitze),
  Luchs (Flugabwehrpanzer), Erzsammler, Mobile Basis, Hornisse (Kampfhubschrauber), Falke (Jagdbomber)
- Flugabwehr: Nur Infanterie, Wiesel (schwach), Schakal, Luchs und die Türme können Luftziele bekämpfen.
- Jedes Flugfeld fasst 3 Jagdbomber und 3 Hubschrauber (Balkenanzeige); weitere Flugfelder vergrößern die Flotte.
- Jagdbomber parken auf der Startbahn, starten auf Befehl und landen nach dem Einsatz wieder.
- Veteranenränge: Abschüsse befördern zu Veteran (›) und Elite (››) – mehr Schaden, Panzerung, Feuerrate; Elite heilt sich selbst
- Energie (Unterversorgung bremst Produktion, schaltet Radar ab), Kriegsnebel, blaue Erzkristalle wachsen langsam nach,
  Reparieren/Verkaufen, Schwierigkeitsgrade, 4 feste Karten (Grenzland, Seenplatte, Hochebene, Frostheim = verschneite Stadt mit Straßenraster und Häusern; 640 × 640 m) + Zufallskarte,
  jede mit befahrbarem Wegenetz (Dämme durch Seen), alle Basen und Erzfelder garantiert erreichbar
- Grafik: PBR-Materialien, HDRI-Beleuchtung, Schatten, Splat-Gelände mit 5 Fototexturen, Wasser,
  GTAO (Umgebungsverdeckung) + Bloom (Stufe „Hoch“), Partikeleffekte, Kettenspuren, Farbabstimmung/Vignette,
  an den Bildausschnitt angepasste Schatten (alle 2 Bilder aktualisiert), deutsche Sprachansagen (Browser-TTS)

## Herkunft der Assets
| Asset | Quelle | Lizenz |
|---|---|---|
| Fahrzeuge, Luftfahrzeuge, Soldaten, Gebäude (Bauhof, Kraftwerk, Kaserne, Waffenfabrik, Radarstation, Flugfeld, Geschützturm, Mauer, Abschussbasis) | 3D-Vorlagen des Nutzers (`../3D-Modelle/*.blend`), aufbereitet mit `tools/prep_models.py` (vereinfacht, Parteifarben, Kettenband, Räder, Gelenke, Embleme je Partei) | eigene |
| Raketenturm | 2D-Vorlagen des Nutzers (`art/src`), in Blender zu 3D-Körpern mit Bildprojektion von oben: `tools/prep_art.py` + `tools/blender_art_models.py` | eigene |
| Raffinerie | aus Ausschnitten der Vorlagen zusammengesetzt (`m_refinery` in `blender_art_models.py`) | eigene |
| Erzkristalle, Bäume (+ alte Modelle in `assets/models_alt`) | prozedural in Blender erzeugt: `tools/blender_models.py` | eigene |
| Gelände-, Beton-, Metalltexturen, HDRI-Himmel | [Poly Haven](https://polyhaven.com) | CC0 |
| Felsen, Büsche, Kisten, Fässer, Barrieren, Reifen | Poly Haven, mit `tools/blender_props.py` reduziert | CC0 |
| Wasser-Normalmap | three.js-Beispiele | MIT |

## Werkzeuge (neu erzeugen)
```
python -I tools/prep_art.py                                     # Vorlagen freistellen/zuschneiden/retuschieren -> art/crop
python -I tools/make_side_textures.py                           # Seitentexturen im Vorlagenstil -> art/crop/side_*.jpg
blender -b --factory-startup -P tools/prep_models.py [-- modell ...]   # 3D-Vorlagen -> buggy tank ifv artillery mcv harvester heli jet rifleman bazooka flak hq power barracks factory radar helipad turret wall silo
blender -b --factory-startup -P tools/blender_art_models.py -- assets/models refinery samturret   # nur diese angeben, sonst werden die Vorlagen-Modelle überschrieben!
python tools/fetch_assets.py                                    # Poly Haven -> assets/textures, assets/raw, assets/hdri
blender -b --factory-startup -P tools/blender_models.py -- assets/models refinery ore1 ore2 ore3 pine1 tree1 ...  # ohne Namen: überschreibt die Vorlagen-Modelle!
blender -b --factory-startup -P tools/blender_props.py  -- assets/raw assets/props
blender -b --factory-startup -P tools/blender_preview.py -- vorschau.png assets/models/tank.glb ...
```
`assets/raw` (≈280 MB Rohdaten) wird nur für `blender_props.py` gebraucht und kann gelöscht werden.
