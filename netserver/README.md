# Atomic Dawn – Mehrspieler-Server

Kleiner Vermittlungsserver für Online-Spiele mit bis zu 4 Spielern. Er verwaltet Lobbys (Räume mit Code, 4 Plätze:
Mensch, Computer, offen oder geschlossen; Partei, Verbandsfarbe, Team) und gibt im 100-ms-Takt die Befehle aller
Spieler weiter. Das Spiel selbst rechnet jeder Rechner (Lockstep). Der Server braucht daher kaum Leistung.

- Keine Abhängigkeiten: nur Node.js 18 oder neuer.
- Start: `node server.js` (Port 8091) bzw. `node server.js 9000` oder Umgebungsvariable `PORT`.
- `MAX_ROOMS` begrenzt die Zahl gleichzeitiger Räume (Standard 200).
- `GET /` liefert eine Statuszeile als JSON (Räume, Verbindungen). Damit kann der Hoster prüfen, ob der Server läuft.

## Im Internet betreiben

Der Server braucht einen öffentlich erreichbaren Rechner mit Node.js:

1. **Hoster mit Node-Unterstützung** (z. B. Render, Railway, Fly.io, Glitch): diesen Ordner als eigenes Projekt
   hochladen, Startbefehl `node server.js`. Den Port setzt der Hoster über `PORT`. Er stellt meist auch HTTPS bereit,
   die Adresse im Spiel lautet dann `wss://<name>.<hoster>`.
2. **Eigener Server / VPS**: `node server.js` dauerhaft laufen lassen (z. B. mit `pm2` oder als systemd-Dienst) und den
   Port in der Firewall freigeben. Mit vorgeschaltetem Webserver (nginx, Caddy) für TLS wird daraus `wss://…`;
   ohne TLS lautet die Adresse `ws://<ip>:8091`.

Damit Spieler die Adresse nicht eintippen müssen, trägt man sie in `js/lobby.js` als `DEFAULT_SERVER` ein und baut ein
neues Paket (`node tools/release.mjs <version>`).

## Regeln

- Nur Spieler mit **derselben Spielversion** (`js/version.js`, im Paket die Versionsnummer) kommen in einen Raum,
  weil Lockstep identischen Spielcode braucht.
- Der Gastgeber stellt Karte, Startkapital, Kriegsnebel und die Computerplätze ein. Jeder Spieler wählt selbst
  Partei, Farbe und Team und meldet sich als bereit. Start ab zwei Teams.
  Spielmodus (`settings.mode`, nur Gastgeber): `ffa` (Standard, jeder ein eigenes Team), `2v2`/`2v1`/`3v1` (Team 0/1 automatisch verteilt,
  Start nur bei passender Spielerzahl 4/3/4 und Teamgröße; Startplätze reihum nach Team, Verbündete benachbart), `free` (Teams frei).
- Verlässt jemand das laufende Spiel, übernimmt ab dem nächsten Takt auf allen Rechnern die KI seinen Platz.
- Pause (Pausenmenü → „Spiel für alle anhalten“) hält die Takte für alle an.
- Alle 5 s vergleicht der Server Prüfsummen. Rechnen die Rechner auseinander, bekommen alle die Meldung „asynchron“.
