// settings.js — Nutzer-Konfiguration (ersetzt .env für das gebaute Produkt).
// Speichert pro Windows-Konto verschlüsselt in app.getPath('userData')/config.json.
// Secrets (API-Keys) werden nie im Klartext auf Platte geschrieben (Electron safeStorage
// = Windows DPAPI, an das jeweilige Nutzerkonto gebunden) und nie unverschlüsselt an
// den Renderer zurückgegeben — dort erscheinen nur Booleans ("ist gesetzt").
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const DEFAULT_LLM_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_LLM_MODEL = 'openai/gpt-oss-20b';
const DEFAULT_SILENCE_MS = 1800;
const DEFAULT_HOTKEY = 'Super+Y';
const DEFAULT_MAX_RECORD_MS = 30 * 60 * 1000; // 30 Minuten

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

// Bis 0.13.0 hiess das Produkt "Axionis Voice" (der Name ist jetzt der Sparte vorbehalten,
// unter der auch kuenftige Voice-/Telefon-Agenten laufen). Electron leitet den
// userData-Ordner aus productName ab — ohne diese Uebernahme wuerde die umbenannte App in
// einem leeren Ordner starten: API-Keys, Hotkey, Glossar und Ersparnis-Zaehler waeren
// scheinbar weg, obwohl die Datei noch daneben liegt.
// Die verschluesselten Keys bleiben lesbar, weil safeStorage/DPAPI an das Windows-Konto
// gebunden ist und nicht an den Pfad.
const LEGACY_APP_NAME = 'Axionis Voice';
let legacyCheckDone = false;

function migrateLegacyConfig() {
  const target = configPath();
  if (fs.existsSync(target)) return; // schon eine eigene Config da -> nichts zu tun
  try {
    const legacy = path.join(path.dirname(app.getPath('userData')), LEGACY_APP_NAME, 'config.json');
    if (!fs.existsSync(legacy)) return;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(legacy, target);
    console.log(`[settings] Konfiguration aus "${LEGACY_APP_NAME}" uebernommen.`);
  } catch (e) {
    // Fehlschlag darf den Start nicht verhindern — dann steht der Nutzer eben vor der
    // Ersteinrichtung, statt vor einer kaputten App.
    console.error('[settings] Uebernahme der alten Konfiguration fehlgeschlagen:', e && e.message);
  }
}

function readRaw() {
  if (!legacyCheckDone) {
    legacyCheckDone = true;
    migrateLegacyConfig();
  }
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeRaw(data) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(data, null, 2), 'utf8');
}

function encrypt(plain) {
  if (safeStorage.isEncryptionAvailable()) {
    return { enc: true, value: safeStorage.encryptString(plain).toString('base64') };
  }
  // Fallback fuer Systeme ohne OS-Verschluesselung (selten): Klartext, aber lieber
  // funktionierend als ein kaputtes Tool.
  return { enc: false, value: plain };
}

function decrypt(field) {
  if (!field || !field.value) return '';
  if (!field.enc) return field.value;
  try {
    return safeStorage.decryptString(Buffer.from(field.value, 'base64'));
  } catch {
    return '';
  }
}

// Nutzungszaehler fuer die Ersparnis-Anzeige in der Maske. Bleibt rein lokal in der
// config.json — es gibt keinen Server, an den irgendetwas davon gehen koennte.
function readStats(raw) {
  const s = raw.stats || {};
  return {
    dictations: Number.isFinite(s.dictations) ? s.dictations : 0,
    chars: Number.isFinite(s.chars) ? s.chars : 0,
    recordedMs: Number.isFinite(s.recordedMs) ? s.recordedMs : 0,
  };
}

// Bewusst eine eigene Funktion statt eines Feldes in saveSettings: hier wird
// hochgezaehlt, nicht gesetzt. Ueber saveSettings muesste der Aufrufer erst lesen und
// wuerde dabei einen zwischenzeitlichen Schreibvorgang ueberschreiben.
function addDictation({ chars, recordedMs } = {}) {
  const raw = readRaw();
  const cur = readStats(raw);
  raw.stats = {
    dictations: cur.dictations + 1,
    chars: cur.chars + (Number.isFinite(chars) && chars > 0 ? chars : 0),
    recordedMs: cur.recordedMs + (Number.isFinite(recordedMs) && recordedMs > 0 ? recordedMs : 0),
  };
  writeRaw(raw);
  return raw.stats;
}

function getSettings() {
  const raw = readRaw();
  const elevenLabsKey = decrypt(raw.elevenLabsKey);
  const llmApiKey = decrypt(raw.llmApiKey);
  return {
    elevenLabsKey,
    hasElevenLabsKey: !!elevenLabsKey,
    llmPolishEnabled: !!raw.llmPolishEnabled,
    llmApiKey,
    hasLlmApiKey: !!llmApiKey,
    llmBaseUrl: raw.llmBaseUrl || DEFAULT_LLM_BASE_URL,
    llmModel: raw.llmModel || DEFAULT_LLM_MODEL,
    silenceMs: Number.isFinite(raw.silenceMs) ? raw.silenceMs : DEFAULT_SILENCE_MS,
    hotkey: raw.hotkey || DEFAULT_HOTKEY,
    showWidget: raw.showWidget !== false, // Default an
    glossary: Array.isArray(raw.glossary) ? raw.glossary : [],
    maxRecordMs: Number.isFinite(raw.maxRecordMs) ? raw.maxRecordMs : DEFAULT_MAX_RECORD_MS,
    // null = noch nie verschoben -> main.js setzt die Standardposition unten rechts.
    widgetX: Number.isFinite(raw.widgetX) ? raw.widgetX : null,
    widgetY: Number.isFinite(raw.widgetY) ? raw.widgetY : null,
    stats: readStats(raw),
  };
}

// Nur uebergebene Felder werden geaendert; leere/undefined Secret-Felder lassen den
// bisherigen gespeicherten Wert unangetastet (Maske zeigt Secrets nie im Klartext an,
// ein leeres Feld beim Speichern heisst also "unveraendert lassen", nicht "loeschen").
function saveSettings({ elevenLabsKey, llmPolishEnabled, llmApiKey, llmModel, silenceMs, hotkey, showWidget, glossary, maxRecordMs, widgetX, widgetY } = {}) {
  const raw = readRaw();
  if (elevenLabsKey) raw.elevenLabsKey = encrypt(elevenLabsKey);
  if (llmApiKey) raw.llmApiKey = encrypt(llmApiKey);
  if (llmPolishEnabled !== undefined) raw.llmPolishEnabled = !!llmPolishEnabled;
  // Leeres Feld heisst "Voreinstellung", nicht "leerer Modellname" — sonst ginge eine
  // geleerte Eingabe als ungueltiges Modell an Groq.
  if (typeof llmModel === 'string') raw.llmModel = llmModel.trim() || undefined;
  if (Number.isFinite(silenceMs)) raw.silenceMs = silenceMs;
  if (hotkey) raw.hotkey = hotkey;
  if (showWidget !== undefined) raw.showWidget = !!showWidget;
  if (Array.isArray(glossary)) raw.glossary = glossary;
  if (Number.isFinite(maxRecordMs)) raw.maxRecordMs = maxRecordMs;
  if (widgetX === null && widgetY === null) { raw.widgetX = null; raw.widgetY = null; } // Position zuruecksetzen
  else if (Number.isFinite(widgetX) && Number.isFinite(widgetY)) { raw.widgetX = widgetX; raw.widgetY = widgetY; }
  writeRaw(raw);
  return getSettings();
}

module.exports = { getSettings, saveSettings, addDictation, DEFAULT_LLM_BASE_URL, DEFAULT_LLM_MODEL, DEFAULT_SILENCE_MS, DEFAULT_HOTKEY, DEFAULT_MAX_RECORD_MS };
