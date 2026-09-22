# Architektur — Axionis Voice

Interne technische Dokumentation. Für Nutzungsanleitung siehe [README.md](../README.md).

## Überblick

Axionis Voice ist eine Electron-Tray-App für Windows (kein Installer-Prozess außer NSIS für die
Verteilung — kein Backend, kein Server, keine Axionis-eigene Infrastruktur beteiligt). Sie läuft
komplett lokal und spricht nur mit zwei externen APIs: ElevenLabs (Speech-to-Text) und optional
Groq (LLM-Textpolitur).

```
Win+Y ──▶ recorder-renderer.js (Mikro + VAD)
              │  (Stop: Stille erkannt ODER Hotkey ODER Max-Dauer erreicht)
              ▼
         main.js: recorder:recording (audio buffer)
              │
              ▼
         scribe.js ──▶ ElevenLabs /v1/speech-to-text (+ keyterms aus Glossar)
              │
              ▼
         clean.js (regelbasiert, kostenlos: Füllwörter, Wortwiederholungen)
              │
              ▼ (nur wenn KI-Politur aktiviert)
         polish.js ──▶ Groq /chat/completions (optional)
              │
              ▼
         voiceCommands.js (Sprachbefehle → Satzzeichen: "komma" → ",", ...)
              │
              ▼
         inserter.js (Zwischenablage sichern → einfügen → wiederherstellen)
```

## Prozesse / Fenster

Electron trennt Haupt- (main.js) und Renderer-Prozesse (BrowserWindows). Diese App hat vier
BrowserWindows, alle mit `nodeIntegration: true, contextIsolation: false` (kein Preload-Skript
nötig — bewusst einfach gehalten, da nur lokaler, selbst geschriebener Code geladen wird, nie
fremder/Remote-Content):

| Fenster | Zweck | sichtbar? |
|---|---|---|
| `recorder.html` + `recorder-renderer.js` | `getUserMedia`/`MediaRecorder`, Voice-Activity-Detection (VAD), Start-/Stop-Beep | nie (1×1px, versteckt) |
| `settings.html` + `settings-renderer.js` | Einstellungsmaske | auf Anfrage (Tray-Menü, Status-Icon-Klick, Erststart ohne Key) |
| `widget.html` + `widget-renderer.js` | immer sichtbares Status-Icon unten rechts | immer (abschaltbar) |
| Tray (`Tray`-API, kein BrowserWindow) | Kontextmenü, Tooltip mit Status | immer |

## Zustandsmaschine (main.js)

`state` ∈ `idle | recording | transcribing | polishing | error`, zentral in `main.js` gehalten.
`setStatus()` ist der einzige Ort, der `state` ändert — aktualisiert bei jedem Wechsel automatisch
Tray-Tooltip (`updateTray()`) und Status-Icon (`notifyWidget()`). Ausnahme: der Wechsel in den
"Lock-Modus" (Feststelltaste, zweimal schnell Win+Y) läuft außerhalb von `setStatus()` und ruft
`updateTray()`/`notifyWidget()` deshalb explizit selbst auf.

`lockMode` (bool): true = Silence-Auto-Stop ist deaktiviert, Aufnahme läuft bis zum nächsten
Hotkey-Druck oder bis `maxRecordMs` erreicht ist (derselbe Wert gilt für Normal- und Lock-Modus).

## Konfiguration (`settings.js`)

Einzige Quelle der Wahrheit für Nutzereinstellungen. Speicherort: `app.getPath('userData')/config.json`
(Windows: `%AppData%\Axionis Voice\config.json`). Wichtig: `app.setName('Axionis Voice')` wird in
main.js explizit gesetzt, weil Electron im **Dev-Betrieb** (`electron .`) den `name`-Wert aus
package.json für den userData-Pfad nutzt, in der **gebauten** App aber `productName` — ohne das
`setName()` würden Dev- und installierte Version in zwei verschiedenen Ordnern lesen/schreiben
(siehe [LESSONS-LEARNED.md](LESSONS-LEARNED.md)).

Secrets (ElevenLabs-/Groq-Key) werden nie im Klartext gespeichert: `safeStorage.encryptString()`
(Windows DPAPI, an das jeweilige Windows-Konto gebunden) vor dem Schreiben, `decryptString()` beim
Lesen. Der Renderer der Einstellungsmaske bekommt beim Laden nur Booleans (`hasElevenLabsKey` etc.),
nie den Klartext-Key zurück.

Alle Felder: `elevenLabsKey`, `llmPolishEnabled`, `llmApiKey`, `llmBaseUrl`, `llmModel`, `silenceMs`,
`hotkey`, `showWidget`, `glossary` (Array), `maxRecordMs`, `widgetX`/`widgetY` (Position, `null` =
Standard unten rechts).

## Status-Icon / Widget (`widget.html`, `widget-renderer.js`)

Eigenes, immer-sichtbares `BrowserWindow` (frameless, transparent, `alwaysOnTop`, `skipTaskbar`).
Design-Entscheidungen mit Begründung:

- **Frei verschiebbar, aber kein `-webkit-app-region: drag`**: dieses Attribut hat in der Praxis
  normale Klick-Events auf demselben Element unzuverlässig gemacht (siehe Lessons Learned). Ziehen
  ist deshalb manuell gebaut: `mousedown` merkt Startposition (Fenster + Maus via `screenX/screenY`),
  `mousemove` berechnet Delta und schickt per IPC (`widget:drag-to`) die neue Fensterposition,
  `mouseup` löst nur dann `widget:open-settings` aus, wenn die Bewegung unter einem Schwellwert
  (4px) blieb — sonst war es ein Ziehen, kein Klick.
- **Position-Persistenz**: `widgetWin.on('moved', ...)` speichert (entprellt, 400ms) die neue
  Position in `settings.js`. Die ersten 1.5s nach dem Erzeugen des Fensters werden ignoriert, weil
  Windows selbst direkt beim Erstellen oft ein `moved`-Event feuert (Positions-/DPI-Finalisierung),
  das sonst fälschlich als Nutzer-Aktion gespeichert würde.
- **Kein `filter: drop-shadow`**: erzeugt in einem `transparent: true`-Fenster ein sichtbares
  Rechteck statt eines weichen Leuchtens. Aller Glow-Effekt läuft über `box-shadow` oder die
  Masken-basierte "Beam"-Technik (conic-gradient + `mask-composite: exclude`), identisch zu den
  Lichteffekten auf axionisconsulting.com (`css/effects.css`, Klasse `.beam`).
- **Großzügiges CSS-Padding** (16px) um den sichtbaren Inhalt: nötig, damit `box-shadow` nicht hart
  an der Fensterkante (`overflow: hidden`) abgeschnitten wird — Kompromiss, da dieses Padding auch
  bedeutet, dass die Pille beim Ziehen nie exakt bis an den Bildschirmrand reicht.

## Sicherheit / Prompt-Hardening (`polish.js`)

Der diktierte Text wird nie als bloßer User-Turn an das Politur-Modell geschickt. Grund: ein
Chat-Modell interpretiert Text, der wie eine Anfrage klingt ("Schreibe mir...", "Liste mir...
auf"), sonst als Auftrag und beantwortet ihn inhaltlich, statt ihn nur zu bereinigen — reproduzierbar
verifiziert (siehe CHANGELOG 0.1.x). Gegenmaßnahmen (beide zusammen, nicht nur eine):

1. **Prompt-Härtung**: Text steht zwischen `<diktat>`-Tags, System-Prompt weist explizit an, dass
   Fragen/Befehle darin niemals auszuführen sind.
2. **Längen-Plausibilitätsprüfung** (Defense in Depth, `MAX_GROWTH_RATIO = 1.6`): wenn die Antwort
   drastisch länger als der Input ist, wird sie verworfen und `main.js` fällt automatisch auf den
   regelbasiert bereinigten Text zurück (derselbe Mechanismus wie bei einem API-Timeout/-Fehler).

## ElevenLabs-Glossar (`scribe.js`)

`keyterms`-Parameter der Scribe-API (Liste von Begriffen, auf die die Erkennung "gebiast" wird).
**Wichtig, nirgends in der offiziellen Doku dokumentiert** (live am Endpunkt verifiziert): mehrere
Begriffe müssen als mehrfach wiederholtes `keyterms`-Multipart-Feld gesendet werden, nicht als
JSON-Array-String in einem Feld (wird als ein einzelner, zu langer Begriff mit "invalid characters"
abgelehnt, da `[`/`]` zu den verbotenen Zeichen zählen). `buildMultipart()` unterstützt deshalb
Array-Werte für genau diesen Fall (ein Feldname → mehrere Form-Data-Teile).

## Build/Distribution

`electron-builder` mit NSIS-Target (`npm run dist`), Icon selbst gerendert (`tools/make-icon.js`,
Pixel-für-Pixel ohne externe Bildbibliothek — Blitz-Polygon aus dem echten Website-SVG-Pfad
abgeleitet, siehe Kommentare in der Datei). Kein Code-Signing (kostenpflichtiges Zertifikat) —
SmartScreen-Warnung beim ersten Start ist erwartetes Verhalten für unsignierte Freeware.

Release-Prozess: `npm run dist` → `gh release create vX.Y.Z <exe>`. Landingpage
(axionisconsulting.com/voice/) verlinkt auf `.../releases/latest`, nie einen festen Dateinamen —
bleibt dadurch bei jedem Release automatisch aktuell, ohne die Seite anzufassen.
