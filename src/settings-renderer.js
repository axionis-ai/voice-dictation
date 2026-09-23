// settings-renderer.js — läuft in src/settings.html (nodeIntegration, kein Preload,
// gleiches Muster wie recorder-renderer.js). Lädt/speichert nie Klartext-Secrets,
// nur Booleans ("ist gesetzt") kommen vom Main-Prozess zurück.
const { ipcRenderer, shell } = require('electron');

const elevenLabsKeyEl = document.getElementById('elevenLabsKey');
const polishEnabledEl = document.getElementById('polishEnabled');
const polishFieldsEl = document.getElementById('polishFields');
const llmApiKeyEl = document.getElementById('llmApiKey');
const statusEl = document.getElementById('status');
const silenceMsEl = document.getElementById('silenceMs');
const silenceMsValueEl = document.getElementById('silenceMsValue');
const maxRecordMinEl = document.getElementById('maxRecordMin');
const maxRecordMinValueEl = document.getElementById('maxRecordMinValue');
const hotkeyBoxEl = document.getElementById('hotkeyBox');
const hotkeyChangeBtnEl = document.getElementById('hotkeyChangeBtn');
const showWidgetEl = document.getElementById('showWidget');
const glossaryEl = document.getElementById('glossary');

let currentHotkey = 'Super+Y'; // vom Main-Prozess geladener/zuletzt gezeigter Accelerator (Fallback bei Esc)
let pendingHotkey = null;      // != null, sobald in dieser Sitzung eine neue Kombination erfasst wurde

silenceMsEl.addEventListener('input', () => {
  silenceMsValueEl.textContent = `${parseFloat(silenceMsEl.value).toFixed(1)} s`;
});
maxRecordMinEl.addEventListener('input', () => {
  maxRecordMinValueEl.textContent = `${maxRecordMinEl.value} min`;
});

// Accelerator (Electron-Format, z.B. "Control+Alt+Y") <-> Anzeige ("Strg + Alt + Y").
function acceleratorToDisplay(accelerator) {
  return accelerator
    .split('+')
    .map((part) => ({ Control: 'Strg', Alt: 'Alt', Shift: 'Umschalt', Super: 'Win' }[part] || part))
    .join(' + ');
}

// Physischen Tastencode (e.code) auf einen Electron-Accelerator-Tastennamen abbilden.
function codeToAcceleratorKey(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  const named = {
    Space: 'Space', Tab: 'Tab', Escape: 'Escape', Backspace: 'Backspace', Delete: 'Delete',
    Enter: 'Return', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", Minus: '-', Equal: '=',
  };
  return named[code] || null;
}

function isModifierCode(code) {
  return ['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight'].includes(code);
}

function startHotkeyCapture() {
  hotkeyBoxEl.textContent = 'Drücke deine Tastenkombination... (Esc = abbrechen)';
  hotkeyBoxEl.classList.add('listening');

  function onKeydown(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') { cleanup(); renderHotkey(pendingHotkey || currentHotkey); return; }
    if (isModifierCode(e.code)) return; // noch nicht fertig — wartet auf Hauptaste

    const modifiers = [];
    if (e.ctrlKey) modifiers.push('Control');
    if (e.altKey) modifiers.push('Alt');
    if (e.shiftKey) modifiers.push('Shift');
    if (e.metaKey) modifiers.push('Super');

    if (modifiers.length === 0) {
      statusEl.textContent = 'Mindestens eine Zusatztaste (Strg/Alt/Umschalt/Win) nötig.';
      statusEl.style.color = '#ff8a8a';
      return; // weiter warten
    }
    const mainKey = codeToAcceleratorKey(e.code);
    if (!mainKey) {
      statusEl.textContent = 'Diese Taste wird nicht unterstützt — andere Kombination probieren.';
      statusEl.style.color = '#ff8a8a';
      return;
    }
    statusEl.textContent = '';
    pendingHotkey = [...modifiers, mainKey].join('+');
    cleanup();
    renderHotkey(pendingHotkey);
  }

  function cleanup() {
    hotkeyBoxEl.classList.remove('listening');
    window.removeEventListener('keydown', onKeydown, true);
  }

  window.addEventListener('keydown', onKeydown, true);
}

function renderHotkey(accelerator) {
  hotkeyBoxEl.textContent = acceleratorToDisplay(accelerator);
}

hotkeyChangeBtnEl.addEventListener('click', startHotkeyCapture);

document.getElementById('elevenLink').addEventListener('click', (e) => {
  e.preventDefault();
  shell.openExternal('https://try.elevenlabs.io/2igpd7r1n610');
});
document.getElementById('groqLink').addEventListener('click', (e) => {
  e.preventDefault();
  shell.openExternal('https://console.groq.com/keys');
});
document.getElementById('firstRunElevenLink').addEventListener('click', (e) => {
  e.preventDefault();
  shell.openExternal('https://try.elevenlabs.io/2igpd7r1n610');
});
document.getElementById('privacyLink').addEventListener('click', (e) => {
  e.preventDefault();
  shell.openExternal('https://axionisconsulting.com/voice/datenschutz');
});
document.getElementById('siteLink').addEventListener('click', (e) => {
  e.preventDefault();
  shell.openExternal('https://axionisconsulting.com');
});

// Ersparnis-Anzeige. Bewusst die ehrliche Rechnung: reine Tippzeit MINUS der Zeit, die
// das Diktieren selbst gekostet hat. Eine kleinere Zahl, die aber jeder Nachrechnung
// standhaelt. 200 Anschlaege/Minute entsprechen fluessigem Tippen (~40 Woerter/Min.);
// die Annahme steht mit im Text, damit die Zahl einzuordnen ist.
const TYPING_CPM = 200;

function formatDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 1) return 'unter 1 min';
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function renderStats(stats) {
  const savedEl = document.getElementById('statsSaved');
  const detailEl = document.getElementById('statsDetail');
  if (!stats || !stats.dictations) return; // Startzustand steht schon im HTML

  const typingMs = (stats.chars / TYPING_CPM) * 60000;
  const savedMs = Math.max(0, typingMs - stats.recordedMs);
  savedEl.textContent = formatDuration(savedMs);
  detailEl.textContent =
    `${stats.dictations} ${stats.dictations === 1 ? 'Diktat' : 'Diktate'}, `
    + `${stats.chars.toLocaleString('de-DE')} Zeichen. Abtippen hätte rund `
    + `${formatDuration(typingMs)} gedauert (bei 200 Anschlägen pro Minute), `
    + `gesprochen hast du ${formatDuration(stats.recordedMs)}.`;
}

function updatePolishFieldsVisibility() {
  polishFieldsEl.classList.toggle('show', polishEnabledEl.checked);
}
polishEnabledEl.addEventListener('change', updatePolishFieldsVisibility);

ipcRenderer.invoke('settings:load').then((s) => {
  // Erstnutzer-Anleitung nur zeigen, solange wirklich kein Key hinterlegt ist.
  if (!s.hasElevenLabsKey) document.getElementById('firstRun').hidden = false;

  elevenLabsKeyEl.placeholder = s.hasElevenLabsKey ? '•••• gespeichert — zum Ändern neu eingeben' : 'xi-...';
  polishEnabledEl.checked = !!s.llmPolishEnabled;
  llmApiKeyEl.placeholder = s.hasLlmApiKey ? '•••• gespeichert — zum Ändern neu eingeben' : 'gsk_...';
  updatePolishFieldsVisibility();

  const seconds = (s.silenceMs / 1000).toFixed(1);
  silenceMsEl.value = seconds;
  silenceMsValueEl.textContent = `${seconds} s`;

  const maxMin = Math.round(s.maxRecordMs / 60000);
  maxRecordMinEl.value = maxMin;
  maxRecordMinValueEl.textContent = `${maxMin} min`;

  currentHotkey = s.hotkey;
  renderHotkey(currentHotkey);

  showWidgetEl.checked = s.showWidget !== false;
  glossaryEl.value = (s.glossary || []).join(', ');

  renderStats(s.stats);

  if (s.appVersion) document.getElementById('appVersion').textContent = `v${s.appVersion}`;
});

document.getElementById('closeBtn').addEventListener('click', () => {
  ipcRenderer.send('settings:close');
});

document.getElementById('resetWidgetPosBtn').addEventListener('click', async () => {
  await ipcRenderer.invoke('widget:reset-position');
  statusEl.textContent = 'Position zurückgesetzt ✓';
  statusEl.style.color = '';
});

document.getElementById('saveBtn').addEventListener('click', async () => {
  const elevenLabsKey = elevenLabsKeyEl.value.trim();
  const llmPolishEnabled = polishEnabledEl.checked;
  const llmApiKey = llmApiKeyEl.value.trim();
  const silenceMs = Math.round(parseFloat(silenceMsEl.value) * 1000);
  const maxRecordMs = Math.round(parseFloat(maxRecordMinEl.value) * 60000);
  const hotkey = pendingHotkey || currentHotkey;
  const showWidget = showWidgetEl.checked;
  const glossary = glossaryEl.value.split(',').map((s) => s.trim()).filter(Boolean);

  const result = await ipcRenderer.invoke('settings:save', { elevenLabsKey, llmPolishEnabled, llmApiKey, silenceMs, hotkey, showWidget, glossary, maxRecordMs });
  if (!result.ok) {
    statusEl.textContent = result.error || 'ElevenLabs-Key wird benötigt.';
    statusEl.style.color = '#ff8a8a';
    return;
  }
  currentHotkey = hotkey;
  pendingHotkey = null;
  statusEl.textContent = 'Gespeichert ✓';
  statusEl.style.color = '';
  setTimeout(() => ipcRenderer.send('settings:close'), 500);
});
