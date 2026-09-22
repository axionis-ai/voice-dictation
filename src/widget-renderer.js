// widget-renderer.js — laeuft in src/widget.html, dem immer sichtbaren Status-Icon
// unten rechts. Main-Prozess schickt 'widget:state' bei jeder Statusaenderung;
// Klick auf die Pille oeffnet die Einstellungen (zusaetzlich zum Tray-Menue).
const { ipcRenderer } = require('electron');

const STATE_CLASSES = ['state-idle', 'state-needs-setup', 'state-recording', 'state-processing', 'state-error'];
const pillEl = document.getElementById('pill');

const TITLE_TEXT = {
  'state-idle': 'Axionis Voice — Bereit',
  'state-needs-setup': 'Axionis Voice — Einrichtung nötig',
  'state-recording': 'Axionis Voice — Aufnahme läuft',
  'state-processing': 'Axionis Voice — Verarbeite Diktat',
  'state-error': 'Axionis Voice — Fehler',
};

function applyState({ state, hasElevenLabsKey }) {
  let cls = 'state-idle';
  if (!hasElevenLabsKey) cls = 'state-needs-setup';
  else if (state === 'recording') cls = 'state-recording';
  else if (state === 'transcribing' || state === 'polishing') cls = 'state-processing';
  else if (state === 'error') cls = 'state-error';
  document.body.classList.remove(...STATE_CLASSES);
  document.body.classList.add(cls);
  pillEl.title = TITLE_TEXT[cls];
}

ipcRenderer.on('widget:state', (_e, payload) => applyState(payload));

// Ziehen selbst gebaut statt -webkit-app-region:drag: die native Drag-Region
// verschluckt auf diesem Element auch normale click-Events komplett (verifiziert —
// deshalb ging "Einstellungen oeffnen" nach dem ersten Drag-Versuch nicht mehr).
// Bewegung < DRAG_THRESHOLD beim Loslassen = Klick -> Einstellungen; sonst war es
// ein Ziehen, dann passiert beim Loslassen nichts weiter (Position ist schon gesetzt).
const DRAG_THRESHOLD = 4;
let dragging = false;
let dragStarted = false;
let startScreenX = 0, startScreenY = 0;
let winStartX = 0, winStartY = 0;

pillEl.addEventListener('mousedown', async (e) => {
  if (e.button !== 0) return;
  dragging = true;
  dragStarted = false;
  startScreenX = e.screenX;
  startScreenY = e.screenY;
  const pos = await ipcRenderer.invoke('widget:get-position');
  winStartX = pos.x;
  winStartY = pos.y;
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dx = e.screenX - startScreenX;
  const dy = e.screenY - startScreenY;
  if (!dragStarted && Math.hypot(dx, dy) > DRAG_THRESHOLD) dragStarted = true;
  if (dragStarted) {
    ipcRenderer.send('widget:drag-to', { x: winStartX + dx, y: winStartY + dy });
  }
});

window.addEventListener('mouseup', () => {
  if (dragging && !dragStarted) {
    ipcRenderer.send('widget:open-settings');
  }
  dragging = false;
  dragStarted = false;
});
