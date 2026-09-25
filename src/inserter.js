// inserter.js — fügt Text ins aktuell fokussierte Fenster ein.
//
// Ablauf:
//   1. Alten Zwischenablage-Inhalt sichern
//   2. Diktat in die Zwischenablage legen
//   3. Strg+V an das fokussierte Fenster schicken (PowerShell SendKeys)
//   4. kurz warten, damit das Ziel den Einfügevorgang wirklich ausführt
//   5. alten Inhalt zurückgeben — ABER NUR, WENN SCHRITT 3 GEKLAPPT HAT
//
// ══ Warum Schritt 5 diese Bedingung hat ══════════════════════════════════════════
//
// Am 25.09.2026 am Testgerät beobachtet: Es wurde NICHT das Diktat eingefügt, sondern
// ein älterer Text aus der Zwischenablage. Gleichzeitig erschien die Meldung
// "Paste fehlgeschlagen: spawnSync cmd.exe ETIMEDOUT (Text liegt im Clipboard)".
//
// Die Ursache war ein Wettlauf, den die alte Fassung selbst gebaut hat:
//
//   - Die Zeitgrenze für PowerShell lag bei 5 Sekunden. Auf einem ausgelasteten Rechner
//     reicht das für einen Kaltstart von PowerShell nicht, also kam ETIMEDOUT.
//   - Das Zurückgeben des alten Inhalts stand in einem `finally` — es lief also AUCH im
//     Fehlerfall, 250 ms später.
//   - PowerShell lief aber weiter und schickte sein Strg+V erst danach ab. Zu diesem
//     Zeitpunkt stand in der Zwischenablage längst wieder der ALTE Text. Genau der
//     wurde eingefügt.
//   - Und die Fehlermeldung behauptete, das Diktat liege noch in der Zwischenablage —
//     wo es 250 ms später überschrieben wurde. Die Meldung war schlicht unwahr.
//
// Deshalb jetzt: Im Fehlerfall wird NICHTS zurückgegeben. Das Diktat bleibt in der
// Zwischenablage, damit die Meldung stimmt und der Text nicht verloren ist. Der alte
// Inhalt ist dann weg — das ist der kleinere Schaden. Ein Diktat ist gesprochene Arbeit
// und hat bei der Erkennung Geld gekostet; ein alter Zwischenablage-Inhalt meist nicht.
const { clipboard } = require('electron');
const { spawnSync } = require('child_process');

/** Wartezeit, bis das Ziel den Einfügevorgang ausgeführt hat. */
const PASTE_DELAY_MS = 600;

/**
 * Zeitgrenze für PowerShell. Früher 5 s — zu knapp: Ein Kaltstart von PowerShell dauert
 * auf einem beschäftigten Rechner regelmäßig länger, und die Folge war kein sauberer
 * Fehlschlag, sondern ein verspätetes Einfügen des falschen Texts.
 */
const PASTE_TIMEOUT_MS = 20000;

// ^ ist Strg in der SendKeys-Schreibweise.
const PS_PASTE = "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')";

function snapshotClipboard() {
  // Nur Text sichern. Bilder werden bewusst nicht wiederhergestellt — beim Diktieren
  // praktisch nie relevant, und der Aufwand stünde in keinem Verhältnis.
  return {
    text: clipboard.readText(),
    hasText: clipboard.availableFormats().includes('text/plain'),
  };
}

function restoreClipboard(snap) {
  try {
    if (snap.hasText) clipboard.writeText(snap.text);
  } catch { /* ignore */ }
}

async function insert(text) {
  if (!text) return;
  const snap = snapshotClipboard();
  clipboard.writeText(text);

  // spawnSync direkt auf powershell.exe statt execSync: execSync geht den Umweg über
  // cmd.exe, was einen zusätzlichen Prozessstart kostet und in der Fehlermeldung
  // auftauchte ("spawnSync C:\\Windows\\system32\\cmd.exe ETIMEDOUT"), obwohl cmd gar
  // nichts zur Sache tut.
  const res = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', PS_PASTE],
    { windowsHide: true, timeout: PASTE_TIMEOUT_MS, encoding: 'utf8' }
  );

  if (res.error || res.status !== 0) {
    const grund = res.error ? res.error.message : `beendet mit Code ${res.status}`;
    // KEIN Zurückgeben des alten Inhalts: Das Diktat bleibt in der Zwischenablage,
    // sonst wäre die folgende Meldung unwahr.
    throw new Error(
      `Einfügen fehlgeschlagen (${grund}). Dein Diktat liegt in der Zwischenablage — ` +
      'mit Strg+V selbst einfügen.'
    );
  }

  // Erst nach dem Einfügen zurückgeben, und nur im Erfolgsfall.
  setTimeout(() => restoreClipboard(snap), PASTE_DELAY_MS);
}

module.exports = { insert, PASTE_DELAY_MS, PASTE_TIMEOUT_MS };
