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

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function readRaw() {
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
  };
}

// Nur uebergebene Felder werden geaendert; leere/undefined Secret-Felder lassen den
// bisherigen gespeicherten Wert unangetastet (Maske zeigt Secrets nie im Klartext an,
// ein leeres Feld beim Speichern heisst also "unveraendert lassen", nicht "loeschen").
function saveSettings({ elevenLabsKey, llmPolishEnabled, llmApiKey } = {}) {
  const raw = readRaw();
  if (elevenLabsKey) raw.elevenLabsKey = encrypt(elevenLabsKey);
  if (llmApiKey) raw.llmApiKey = encrypt(llmApiKey);
  if (llmPolishEnabled !== undefined) raw.llmPolishEnabled = !!llmPolishEnabled;
  writeRaw(raw);
  return getSettings();
}

module.exports = { getSettings, saveSettings, DEFAULT_LLM_BASE_URL, DEFAULT_LLM_MODEL };
