// settings-renderer.js — läuft in src/settings.html (nodeIntegration, kein Preload,
// gleiches Muster wie recorder-renderer.js). Lädt/speichert nie Klartext-Secrets,
// nur Booleans ("ist gesetzt") kommen vom Main-Prozess zurück.
const { ipcRenderer, shell } = require('electron');

const elevenLabsKeyEl = document.getElementById('elevenLabsKey');
const polishEnabledEl = document.getElementById('polishEnabled');
const polishFieldsEl = document.getElementById('polishFields');
const llmApiKeyEl = document.getElementById('llmApiKey');
const statusEl = document.getElementById('status');

document.getElementById('elevenLink').addEventListener('click', (e) => {
  e.preventDefault();
  shell.openExternal('https://elevenlabs.io/app/settings/api-keys');
});
document.getElementById('groqLink').addEventListener('click', (e) => {
  e.preventDefault();
  shell.openExternal('https://console.groq.com/keys');
});

function updatePolishFieldsVisibility() {
  polishFieldsEl.classList.toggle('show', polishEnabledEl.checked);
}
polishEnabledEl.addEventListener('change', updatePolishFieldsVisibility);

ipcRenderer.invoke('settings:load').then((s) => {
  elevenLabsKeyEl.placeholder = s.hasElevenLabsKey ? '•••• bereits gespeichert — zum Ändern neu eingeben' : 'xi-...';
  polishEnabledEl.checked = !!s.llmPolishEnabled;
  llmApiKeyEl.placeholder = s.hasLlmApiKey ? '•••• bereits gespeichert — zum Ändern neu eingeben' : 'gsk_...';
  updatePolishFieldsVisibility();
});

document.getElementById('closeBtn').addEventListener('click', () => {
  ipcRenderer.send('settings:close');
});

document.getElementById('saveBtn').addEventListener('click', async () => {
  const elevenLabsKey = elevenLabsKeyEl.value.trim();
  const llmPolishEnabled = polishEnabledEl.checked;
  const llmApiKey = llmApiKeyEl.value.trim();

  const result = await ipcRenderer.invoke('settings:save', { elevenLabsKey, llmPolishEnabled, llmApiKey });
  if (!result.ok) {
    statusEl.textContent = result.error || 'ElevenLabs-Key wird benötigt.';
    statusEl.style.color = '#ff8a8a';
    return;
  }
  statusEl.textContent = 'Gespeichert ✓';
  statusEl.style.color = '';
  setTimeout(() => ipcRenderer.send('settings:close'), 500);
});
