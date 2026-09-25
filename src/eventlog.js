// eventlog.js — was die App zuletzt getan hat, nachlesbar.
//
// Warum es das gibt: Bis 0.19.0 meldete die Windows-Fassung Fehler ausschliesslich als
// kurze Benachrichtigung. Die ist nach Sekunden weg. Als am 25.09.2026 ein falscher
// Text eingefuegt wurde, war die einzige Spur ein Screenshot, den der Nutzer zufaellig
// gemacht hatte. Die Android-Fassung hat so ein Protokoll laengst; hier fehlte es.
//
// Zwei Ebenen, wie dort:
//   note()  — was passiert ist, in normaler Sprache. Immer sichtbar.
//   trace() — technische Einzelheiten. Nur mit eingeschaltetem Schalter.
//
// ══ Was hier NICHT hineingehoert ═════════════════════════════════════════════════
//
// NIEMALS der diktierte Text selbst, weder ganz noch teilweise. Das Protokoll laesst
// sich mit einem Knopf in die Zwischenablage legen und landet damit womoeglich in einer
// E-Mail an uns. Es darf deshalb nichts enthalten, was der Nutzer gesprochen hat.
// Zeichenzahlen, Dauern, Fehlermeldungen und Namen von Anbietern sind in Ordnung.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const MAX_ENTRIES = 200;
const entries = [];

function logPath() {
  return path.join(app.getPath('userData'), 'events.log');
}

function add(tech, line) {
  const stamp = new Date().toISOString().slice(11, 19);
  entries.unshift({ tech, line: `${stamp}  ${line}` });
  while (entries.length > MAX_ENTRIES) entries.pop();
  // Zusaetzlich auf die Platte, damit ein Vorfall einen Neustart der App ueberlebt.
  // Fehler dabei werden verschluckt: Ein Protokoll darf das Diktieren nie stoeren.
  try {
    fs.appendFileSync(logPath(), `${new Date().toISOString()}\t${tech ? 't' : 'n'}\t${line}\n`);
  } catch { /* ignore */ }
}

const note = (line) => add(false, line);
const trace = (line) => add(true, line);

function snapshot(includeTech) {
  return entries.filter((e) => includeTech || !e.tech).map((e) => e.line);
}

/**
 * Haelt die Datei klein. Wird beim Start aufgerufen: Ohne das waechst sie unbegrenzt,
 * und niemand merkt es, weil sie nie jemand ansieht.
 */
function trimFile() {
  try {
    const p = logPath();
    if (!fs.existsSync(p)) return;
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    if (lines.length <= 2000) return;
    fs.writeFileSync(p, lines.slice(-1000).join('\n'));
  } catch { /* ignore */ }
}

module.exports = { note, trace, snapshot, trimFile, logPath, MAX_ENTRIES };
