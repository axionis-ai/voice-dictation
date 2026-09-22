# Lessons Learned

Technische Erkenntnisse aus der Entwicklung, die beim nächsten Electron-Projekt (oder bei einer
Weiterentwicklung dieses hier) Zeit sparen. Jede davon hat in der Praxis zu echten, teils
verwirrenden Fehlersuchen geführt — hier bewusst mit Ursache und nicht nur Symptom festgehalten.

## 1. OneDrive + `node_modules` verträgt sich schlecht

Ein Projektordner, der live von OneDrive synchronisiert wird, führte zu einer strukturell
korrupten `node_modules`-Installation (einzelne Pakete fehlten Dateien, z. B. `fs-extra`s
`copy-sync/index.js`) — vermutlich durch Schreibkonflikte, während OneDrive parallel synchronisiert.
`npm install` allein behebt das **nicht** zuverlässig, da npm bereits vorhandene (aber unvollständige)
Paketordner nicht automatisch neu herunterlädt. Fix: `node_modules` komplett löschen, dann neu
installieren. Empfehlung: Node-Projekte nach Möglichkeit außerhalb live-synchronisierter Ordner
entwickeln, oder den Ordner von der Synchronisation ausschließen.

## 2. `ELECTRON_RUN_AS_NODE=1` macht Electron unbemerkt zu einem reinen Node-Prozess

Wenn diese Umgebungsvariable gesetzt ist (z. B. von einem übergeordneten Dev-Tool/Terminal geerbt),
verhält sich `electron.exe` wie ein normales Node.js-Binary: `require('electron')` liefert dann
nur einen Pfad-String statt der echten API — `app`, `BrowserWindow`, `Tray`, `safeStorage` etc. sind
alle `undefined`, oft ohne offensichtlichen Fehler an der erwarteten Stelle. Symptom war zunächst
kaum von "Electron startet einfach nicht" zu unterscheiden. Fix: `env -u ELECTRON_RUN_AS_NODE`
vor jedem Start, wenn man eine automatisierte Shell/CI-Umgebung für echte GUI-Tests nutzt.

## 3. `app.getName()` liefert im Dev- und im gebauten Betrieb unterschiedliche Werte

Im Dev-Betrieb (`electron .`) nutzt Electron das `name`-Feld aus `package.json` für den
`userData`-Pfad (`app.getPath('userData')`). In der mit `electron-builder` gebauten App wird
stattdessen `productName` verwendet. Ohne Gegenmaßnahme landen Konfigurationsdateien der Dev- und
der installierten Version in zwei verschiedenen Ordnern — das Tool "vergisst" scheinbar
zufällig gespeicherte Einstellungen, je nachdem wie es gerade gestartet wurde. Fix: `app.setName(...)`
explizit und früh in `main.js` aufrufen, mit demselben Wert wie `productName`.

## 4. `filter: drop-shadow()` in einem transparenten Electron-Fenster kann als sichtbares Rechteck rendern

CSS `filter`-Effekte (hier: ein Leucht-Schatten auf einem SVG-Icon) rendern in einem
`transparent: true`-BrowserWindow gelegentlich mit einer sichtbaren rechteckigen Kante statt eines
weichen Verlaufs — vermutlich ein Rendering-Sonderfall der GPU-Kompositierung bei transparenten
Fenstern. `box-shadow` und maskenbasierte Techniken (`mask-composite`, conic-gradient) sind davon
nicht betroffen. Faustregel: in transparenten Fenstern `filter` grundsätzlich meiden.

## 5. `-webkit-app-region: drag` und ein Klick-Handler auf demselben Element vertragen sich nicht zuverlässig

Ein Element mit `-webkit-app-region: drag` (Standard-Technik, um frameless Fenster ziehbar zu
machen) hat in der Praxis normale `click`-Events auf genau diesem Element unzuverlässig gemacht —
nach dem ersten Ziehversuch reagierte ein Klick nicht mehr zuverlässig. Robuster Ersatz: Ziehen
manuell über `mousedown`/`mousemove`/`mouseup` bauen, mit einem kleinen Bewegungs-Schwellwert
(hier 4px), der entscheidet, ob eine Geste ein Klick oder ein Zug war — kein `-webkit-app-region`
nötig.

## 6. `webContents.sendInputEvent()` liefert immer `screenX`/`screenY` = 0

Beim Testen der Zieh-Logik über synthetische Maus-Events (`sendInputEvent`) blieben `screenX`/
`screenY` des resultierenden DOM-`MouseEvent` konstant `0` — unabhängig von den übergebenen
Koordinaten. Für Logik, die auf absoluten Bildschirmkoordinaten basiert (z. B. Fenster-Ziehen über
Deltas), lässt sich das **nicht** über synthetische Events verifizieren; das ist eine Grenze des
Test-Werkzeugs, kein Hinweis auf einen Fehler im echten Verhalten bei echter Mauseingabe.
Konsequenz: solche Logik per Code-Review + einmaligem echtem Test durch einen Menschen absichern,
nicht per automatisiertem Maus-Event-Test.

## 7. CSS-Transitions/-Animationen können in einem `show: false`-Fenster eingefroren bleiben

In einem unsichtbaren (`show: false`) `BrowserWindow` wurde eine laufende `transition` (z. B.
Breitenänderung) nie über ihren Startwert hinaus animiert — `getComputedStyle()` lieferte dauerhaft
den Ausgangswert, obwohl die zugehörige CSS-Regel nachweislich korrekt matchte (verifiziert über
`element.matches(selector)` und `cssRules[i].cssText`). Vermutung: Chromium pausiert die
Rendering-/Compositor-Pipeline für unsichtbare Fenster, wodurch die Transition nie einen zweiten
Frame bekommt. Konsequenz: `getComputedStyle()` einer transitionierenden Eigenschaft aus einem
verstecken Test-Fenster ist unzuverlässig — stattdessen die zugrunde liegende CSS-Regel direkt
prüfen (Selector-Match + Regel-Text), nicht den animierten Wert.

## 8. ElevenLabs Scribe `keyterms`: Encoding nirgends dokumentiert, live verifiziert

Die API-Doku nennt den Parameter `keyterms` (Liste von Begriffen zur Erkennungs-Verbesserung),
zeigt aber in keinem Beispiel, wie mehrere Begriffe in einer `multipart/form-data`-Anfrage kodiert
werden. Ein JSON-Array-String in einem Feld (`["Bionix","Axionis"]`) wird mit
`"Some keyword contains invalid characters"` abgelehnt, weil `[`/`]` zu den für Keyterms verbotenen
Zeichen zählen. Richtig (live gegen die echte API bestätigt, inklusive Vorher/Nachher-Vergleich mit
synthetisierter Sprache): das Feld `keyterms` mehrfach wiederholen, ein Begriff pro Formularteil.

## 9. Windows feuert ein `moved`-Event direkt beim Erzeugen eines Fensters

Auch ohne jede Nutzerinteraktion löst das bloße Erzeugen eines `BrowserWindow` unter Windows manchmal
sofort ein `moved`-Event aus (vermutlich Positions-/DPI-Finalisierung durch den Fenstermanager).
Ohne Gegenmaßnahme wird das fälschlich als "Nutzer hat das Fenster verschoben" gespeichert. Fix:
`moved`-Events in den ersten 1–2 Sekunden nach dem Erzeugen des Fensters ignorieren.

## Prozess-Lektion: kleine Screenshots lügen

Mehrfach wurden Größen/Formen aus winzigen (~150×80px) Screenshots falsch eingeschätzt (z. B. ein
korrekt 44px breites Element für "zu breit" gehalten). Bei Unsicherheit über Maße/Farben:
`getComputedStyle()`/`matches()` direkt abfragen statt aus einem kleinen Bild zu schätzen.
