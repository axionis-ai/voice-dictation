// inserter.js — fügt Text ins aktuell fokussierte Fenster ein.
// Strategie (zero native deps):
//   1. Alten Clipboard-Inhalt sichern (Text + Bild-Flag)
//   2. clipboard.writeText(text)
//   3. PowerShell SendKeys "^v" simuliert Ctrl+V
//   4. ~250ms warten, damit das Ziel den Paste liest
//   5. Alten Clipboard-Inhalt wiederherstellen
const { clipboard } = require('electron');
const { execSync } = require('child_process');

const PASTE_DELAY_MS = 250;

// PowerShell paste: Add-Type System.Windows.Forms + SendWait("^v").
// ^ = Ctrl in SendKeys-Syntax.
const PS_PASTE = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')`;

function snapshotClipboard() {
  // Nur Text-Snapshot (Bild-Restore überspringen wir bewusst — selten relevant beim Diktieren).
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

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function insert(text) {
  if (!text) return;
  const snap = snapshotClipboard();
  try {
    clipboard.writeText(text);
    // Simuliere Ctrl+V via PowerShell SendKeys
    execSync(`powershell -NoProfile -Command "${PS_PASTE}"`, { windowsHide: true, timeout: 5000 });
  } catch (err) {
    // Paste fehlgeschlagen (z.B. elevated Ziel) — Text bleibt im Clipboard, User kann manuell Ctrl+V.
    throw new Error(`Paste fehlgeschlagen: ${err.message} (Text liegt im Clipboard — manuell Ctrl+V)`);
  } finally {
    // Clipboard nach kurzer Pause wiederherstellen, damit Paste nicht das alte liest.
    setTimeout(() => restoreClipboard(snap), PASTE_DELAY_MS);
  }
}

module.exports = { insert };