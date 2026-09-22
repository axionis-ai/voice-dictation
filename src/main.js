// main.js — Electron Hauptprozess.
// - Tray-Icon mit Status (idle/recording/transcribing/error)
// - globalShortcut Super+J toggelt Aufnahme
// - hidden BrowserWindow für Recorder (getUserMedia + MediaRecorder)
// - IPC: recorder:recording -> scribe.transcribe -> inserter.insert
// - Einstellungsfenster für ElevenLabs-/Groq-Key (ersetzt .env)
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage } = require('electron');
const path = require('path');
const scribe = require('./scribe');
const inserter = require('./inserter');
const clean = require('./clean');
const polish = require('./polish');
const voiceCommands = require('./voiceCommands');
const settings = require('./settings');
const autostart = require('./autostart');

const APP_NAME = 'Axionis Voice';
const HOTKEY = 'Super+Y';
let tray = null;
let recorderWin = null;
let settingsWin = null;
let state = 'idle'; // idle | recording | transcribing | error
let lastError = '';
const DOUBLE_TAP_MS = 500; // Doppelklick-Fenster für Feststelltaste (Lock-Modus)
let recordingStartedAt = 0;
let lockMode = false;     // true = Aufnahme läuft bis manuell gestoppt (kein Silence-Auto-Stop)

function setStatus(next, err) {
  state = next;
  if (err) lastError = err;
  updateTray();
}

function hotkeyLabel() {
  // Anzeige: CommandOrControl -> Ctrl, Super -> Win
  return HOTKEY.replace('CommandOrControl', 'Ctrl').replace('Super', 'Win');
}

function stateLabel() {
  if (!settings.getSettings().hasElevenLabsKey) return 'Nicht eingerichtet — Klick für Einstellungen';
  switch (state) {
    case 'recording': return lockMode
      ? `● REC (Feststelltaste) — ${hotkeyLabel()} zum Stoppen`
      : `● REC — nochmal ${hotkeyLabel()} zum Stoppen`;
    case 'transcribing': return '… transkribiere (Scribe)';
    case 'polishing': return '… poliere (Groq)';
    case 'error': return `⚠ Fehler: ${lastError}`;
    default: return `${hotkeyLabel()} = Diktat starten`;
  }
}

function updateTray() {
  if (!tray) return;
  tray.setToolTip(`${APP_NAME} — ${stateLabel()}`);
  const menu = Menu.buildFromTemplate([
    { label: stateLabel(), enabled: false },
    { type: 'separator' },
    { label: `Hotkey: ${hotkeyLabel()}`, enabled: false },
    { label: 'Einstellungen...', click: () => openSettingsWindow() },
    { type: 'separator' },
    {
      label: 'Test-Paste (Clipboard "Test")',
      click: async () => {
        try { await inserter.insert('Axionis-Voice-Test ✓'); } catch (e) { setStatus('error', e.message); }
      },
    },
    { type: 'separator' },
    {
      label: autostart.isEnabled()
        ? 'Autostart: AN  (klicken zum Ausschalten)'
        : 'Autostart: AUS (klicken zum Anschalten)',
      click: () => {
        if (autostart.isEnabled()) autostart.disable(); else autostart.enable();
        updateTray();
      },
    },
    { type: 'separator' },
    { label: 'Beenden', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function createRecorderWindow() {
  recorderWin = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  recorderWin.loadFile(path.join(__dirname, 'recorder.html'));
}

function openSettingsWindow() {
  if (settingsWin) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 420,
    height: settings.getSettings().llmPolishEnabled ? 560 : 460,
    resizable: false,
    title: `${APP_NAME} — Einstellungen`,
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; updateTray(); });
}

function toggleDictation() {
  if (!settings.getSettings().hasElevenLabsKey) {
    openSettingsWindow();
    return;
  }
  const now = Date.now();
  console.log(`[tap] state=${state} lockMode=${lockMode} sinceStart=${recordingStartedAt ? now - recordingStartedAt : '-'}ms`);
  if (state === 'recording') {
    // Zweiter Tap innerhalb des Doppelklick-Fensters UND noch nicht gelockt
    // -> Feststelltaste: Silence-Auto-Stop deaktivieren, Aufnahme läuft bis zum nächsten Tap.
    if (!lockMode && Date.now() - recordingStartedAt < DOUBLE_TAP_MS) {
      lockMode = true;
      recorderWin.webContents.send('recorder:lock');
      updateTray();
      return;
    }
    // sonst: Stop -> transkribieren -> einfügen
    lockMode = false;
    recorderWin.webContents.send('recorder:stop');
  } else if (state === 'idle' || state === 'error') {
    // Start
    setStatus('recording');
    lockMode = false;
    recordingStartedAt = Date.now();
    recorderWin.webContents.send('recorder:start');
  }
  // während transcribing/polishing ignorieren
}

ipcMain.on('recorder:state', (_e, s) => {
  if (s === 'idle' && state === 'recording') {
    // Recorder gestoppt ohne Daten? Dann zurück zu idle.
  }
});

ipcMain.on('recorder:log', (_e, msg) => {
  console.log('[rend]', msg);
});

ipcMain.on('recorder:error', (_e, msg) => {
  console.error('[rend] FEHLER:', msg);
  setStatus('error', msg);
});

ipcMain.on('recorder:recording', async (_e, arrayBuffer, meta) => {
  console.log(`[vd] recorder:recording eingangen bytes=${arrayBuffer && arrayBuffer.byteLength} meta=${JSON.stringify(meta)}`);
  setStatus('transcribing');
  try {
    const buf = Buffer.from(arrayBuffer);
    console.log(`[vd] buffer laenge=${buf.length}`);
    let text = await scribe.transcribe(buf, { ext: meta.ext, mime: meta.mime });
    console.log(`[vd] scribe rohtext laenge=${text.length} inhalt=${JSON.stringify(text.slice(0, 120))}`);
    text = clean.cleanTranscript(text); // regelbasiert (kostenlos, instant)
    console.log(`[vd] clean laenge=${text.length}`);
    if (settings.getSettings().llmPolishEnabled) {
      setStatus('polishing');
      try {
        text = await polish.polish(text, { timeoutMs: 8000 });
        console.log(`[vd] polish laenge=${text.length}`);
      } catch (e) {
        // Politur fehlgeschlagen/Timeout -> regelbasiert bereinigter Text bleibt, Paste nicht blockieren.
        setStatus('transcribing');
        console.error('[vd] Politur-Fallback:', e.message);
      }
    }
    text = voiceCommands.applyCommands(text);
    console.log(`[vd] voiceCommands laenge=${text.length} inhalt=${JSON.stringify(text.slice(0, 120))}`);
    await inserter.insert(text);
    console.log(`[vd] insert fertig`);
    setStatus('idle');
  } catch (err) {
    console.error('[vd] PIPELINE-FEHLER:', err && err.stack ? err.stack : err);
    setStatus('error', err.message);
  }
});

// --- Settings-IPC ---
ipcMain.handle('settings:load', () => {
  const s = settings.getSettings();
  return {
    hasElevenLabsKey: s.hasElevenLabsKey,
    hasLlmApiKey: s.hasLlmApiKey,
    llmPolishEnabled: s.llmPolishEnabled,
  };
});

ipcMain.handle('settings:save', (_e, { elevenLabsKey, llmPolishEnabled, llmApiKey }) => {
  const current = settings.getSettings();
  if (!elevenLabsKey && !current.hasElevenLabsKey) {
    return { ok: false, error: 'ElevenLabs-Key wird benötigt.' };
  }
  if (llmPolishEnabled && !llmApiKey && !current.hasLlmApiKey) {
    return { ok: false, error: 'KI-Politur aktiviert, aber kein Groq-Key eingegeben.' };
  }
  settings.saveSettings({ elevenLabsKey, llmPolishEnabled, llmApiKey });
  updateTray();
  return { ok: true };
});

ipcMain.on('settings:close', () => {
  if (settingsWin) settingsWin.close();
});

// Single-Instance-Lock: verhindert, dass nach Restarts mehrere Electron-Instanzen
// laufen (Hotkey klemmt sonst, weil nur die erste registriert ist und die anderen
// den Tray belegen). Die zweite Instanz beendet sich sofort, die erste laeuft weiter.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log(`${APP_NAME} laeuft bereits — zweite Instanz beendet.`);
  app.quit();
} else {
  app.on('second-instance', () => {
    // Bereits laufende Instanz: Tray ist da, nichts zu fokussieren (hidden window).
    console.log('Zweiter Startversuch ignoriert — bestehende Instanz aktiv.');
  });

  app.whenReady().then(() => {
    // Tray
    const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    tray.on('click', () => {
      if (!settings.getSettings().hasElevenLabsKey) openSettingsWindow();
    });
    updateTray();

    // Recorder window (hidden)
    createRecorderWindow();

    // Global Hotkey
    const ok = globalShortcut.register(HOTKEY, toggleDictation);
    if (!ok) {
      setStatus('error', `Hotkey ${HOTKEY} konnte nicht registriert werden (von Windows belegt?)`);
    } else {
      console.log(`Hotkey registriert: ${HOTKEY}`);
    }

    // Erststart ohne Key: Einstellungen direkt zeigen statt stumm zu warten.
    if (!settings.getSettings().hasElevenLabsKey) {
      openSettingsWindow();
    }
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  // Tray-only app: nicht beenden, wenn alle Fenster geschlossen.
  app.on('window-all-closed', (e) => { /* nothing — tray stays */ });
}
