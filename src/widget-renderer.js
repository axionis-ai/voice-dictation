// widget-renderer.js — laeuft in src/widget.html, dem immer sichtbaren Status-Icon
// unten rechts. Main-Prozess schickt 'widget:state' bei jeder Statusaenderung;
// Klick auf die Pille oeffnet die Einstellungen (zusaetzlich zum Tray-Menue).
const { ipcRenderer } = require('electron');

const STATE_CLASSES = ['state-idle', 'state-needs-setup', 'state-recording', 'state-processing', 'state-error'];

function applyState({ state, hasElevenLabsKey }) {
  let cls = 'state-idle';
  if (!hasElevenLabsKey) cls = 'state-needs-setup';
  else if (state === 'recording') cls = 'state-recording';
  else if (state === 'transcribing' || state === 'polishing') cls = 'state-processing';
  else if (state === 'error') cls = 'state-error';
  document.body.classList.remove(...STATE_CLASSES);
  document.body.classList.add(cls);
}

ipcRenderer.on('widget:state', (_e, payload) => applyState(payload));

document.getElementById('pill').addEventListener('click', () => {
  ipcRenderer.send('widget:open-settings');
});
