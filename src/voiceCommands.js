// voiceCommands.js — Sprachbefehle: gesprochene Steuerwörter werden zu Zeichensetzung/Struktur.
// Laeuft als LETZTER Schritt nach Scribe + clean + polish, sodass eingefuegte Zeichen
// vom LLM nicht mehr weg-normalisiert werden.
// Wortgrenzen via Unicode-Lookarounds (kein \b — versagt an Umlauten, siehe clean.js).

// Reihenfolge: Laengere Phrasen zuerst, damit "neuer Absatz" nicht zu "neuer"+Rest zerrissen wird.
// offene/geschlossene Klammer vor den Einzelzeichen, damit "klammer" alleine nicht greift.
const COMMANDS = [
  [/(?<!\p{L})neuer absatz(?!\p{L})/giu, '\n\n'],
  [/(?<!\p{L})neue zeile(?!\p{L})/giu, '\n'],
  [/(?<!\p{L})offene klammer(?!\p{L})/giu, ' ('],
  [/(?<!\p{L})geschlossene klammer(?!\p{L})/giu, ') '],
  [/(?<!\p{L})komma(?!\p{L})/giu, ','],
  [/(?<!\p{L})semikolon(?!\p{L})/giu, ';'],
  [/(?<!\p{L})strichpunkt(?!\p{L})/giu, ';'],
  [/(?<!\p{L})doppelpunkt(?!\p{L})/giu, ':'],
  [/(?<!\p{L})punkt(?!\p{L})/giu, '.'],
  [/(?<!\p{L})fragezeichen(?!\p{L})/giu, '?'],
  [/(?<!\p{L})ausrufezeichen(?!\p{L})/giu, '!'],
  [/(?<!\p{L})bindestrich(?!\p{L})/giu, '-'],
  [/(?<!\p{L})gedankenstrich(?!\p{L})/giu, '—'],
];

function applyCommands(text) {
  if (!text) return text;
  let out = text;
  for (const [re, repl] of COMMANDS) out = out.replace(re, repl);
  // Typografie: kein Leerzeichen VOR Zeichensetzung (", " statt " , ").
  out = out.replace(/[ \t]+([,.;:?!])/g, '$1');
  // Keine Leerzeichen direkt vor Zeilenumbruch.
  out = out.replace(/[ \t]+\n/g, '\n');
  // Keine Leerzeichen am Zeilenanfang (kein Einrücken im Diktat).
  out = out.replace(/\n[ \t]+/g, '\n');
  // Maximal ein Absatzabstand (\n\n), keine Dreifach-Zeilen.
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

module.exports = { applyCommands };