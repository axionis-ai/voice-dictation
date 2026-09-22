// main.js — Electron Hauptprozess.
// - Tray-Icon mit Status (idle/recording/transcribing/error)
// - globalShortcut Super+J toggelt Aufnahme
// - hidden BrowserWindow für Recorder (getUserMedia + MediaRecorder)
// - IPC: recorder:recording -> scribe.transcribe -> inserter.insert
// - Einstellungsfenster für ElevenLabs-/Groq-Key (ersetzt .env)
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');
const scribe = require('./scribe');
const inserter = require('./inserter');
const clean = require('./clean');
const polish = require('./polish');
const voiceCommands = require('./voiceCommands');
const settings = require('./settings');
const autostart = require('./autostart');

const APP_NAME = 'Axionis Voice';
// Erzwingt denselben app-Namen (und damit denselben userData-Ordner fuer settings.js)
// im Dev-Betrieb (electron . liest sonst package.json "name", nicht "build.productName")
// wie in der gebauten/installierten App — sonst landet die Config je nach Startart in
// zwei verschiedenen Ordnern.
app.setName(APP_NAME);
let registeredHotkey = null; // aktuell bei Electron registrierter Accelerator (zum sauberen Unregister bei Wechsel)
let tray = null;
let recorderWin = null;
let settingsWin = null;
let widgetWin = null;
let state = 'idle'; // idle | recording | transcribing | error
let lastError = '';
const DOUBLE_TAP_MS = 500; // Doppelklick-Fenster für Feststelltaste (Lock-Modus)
let recordingStartedAt = 0;
let lockMode = false;     // true = Aufnahme läuft bis manuell gestoppt (kein Silence-Auto-Stop)

function setStatus(next, err) {
  state = next;
  if (err) lastError = err;
  updateTray();
  notifyWidget();
}

// Schickt den aktuellen Status ans immer sichtbare Status-Icon (unten rechts) —
// separat von updateTray(), damit auch reine Lock-Mode-Wechsel (kein setStatus-Aufruf)
// das Icon aktualisieren koennen.
function notifyWidget() {
  if (!widgetWin) return;
  widgetWin.webContents.send('widget:state', {
    state,
    hasElevenLabsKey: settings.getSettings().hasElevenLabsKey,
  });
}

function hotkeyLabel() {
  // Anzeige: CommandOrControl -> Ctrl, Super -> Win
  return settings.getSettings().hotkey.replace('CommandOrControl', 'Ctrl').replace('Super', 'Win');
}

// Registriert den in den Einstellungen hinterlegten Hotkey neu (z.B. nach Aenderung
// in der Maske). Neuen Accelerator ZUERST probieren, alten erst bei Erfolg abmelden —
// so bleibt bei einer belegten Kombination der bisherige Hotkey unangetastet nutzbar.
function registerHotkey() {
  const hotkey = settings.getSettings().hotkey;
  if (hotkey === registeredHotkey) return true;
  const ok = globalShortcut.register(hotkey, toggleDictation);
  if (!ok) {
    setStatus('error', `Hotkey ${hotkey} konnte nicht registriert werden (von Windows belegt?)`);
    return false;
  }
  if (registeredHotkey) globalShortcut.unregister(registeredHotkey);
  registeredHotkey = hotkey;
  console.log(`Hotkey registriert: ${hotkey}`);
  return true;
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

// Immer sichtbares Status-Icon unten rechts (ueber der Taskleiste) — zeigt live, ob
// das Tool aktiv/am Aufnehmen ist, Klick oeffnet die Einstellungen als zweiter Weg
// neben dem Tray-Menue.
function createWidgetWindow() {
  const WIN_W = 140, WIN_H = 60, MARGIN = 12;
  const workArea = screen.getPrimaryDisplay().workArea;
  widgetWin = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: workArea.x + workArea.width - WIN_W - MARGIN,
    y: workArea.y + workArea.height - WIN_H - MARGIN,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  widgetWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  widgetWin.loadFile(path.join(__dirname, 'widget.html'));
  widgetWin.on('closed', () => { widgetWin = null; });
}

function openSettingsWindow() {
  if (settingsWin) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 420,
    height: settings.getSettings().llmPolishEnabled ? 700 : 600,
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
      notifyWidget();
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
    recorderWin.webContents.send('recorder:start', { silenceMs: settings.getSettings().silenceMs });
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
    silenceMs: s.silenceMs,
    hotkey: s.hotkey,
  };
});

ipcMain.handle('settings:save', (_e, { elevenLabsKey, llmPolishEnabled, llmApiKey, silenceMs, hotkey }) => {
  const current = settings.getSettings();
  if (!elevenLabsKey && !current.hasElevenLabsKey) {
    return { ok: false, error: 'ElevenLabs-Key wird benötigt.' };
  }
  if (llmPolishEnabled && !llmApiKey && !current.hasLlmApiKey) {
    return { ok: false, error: 'KI-Politur aktiviert, aber kein Groq-Key eingegeben.' };
  }

  // Neuen Hotkey ZUERST testregistrieren, BEVOR er in die Config geschrieben wird —
  // sonst wuerde ein von Windows blockierter Hotkey trotzdem gespeichert und beim
  // naechsten Start (mit dann leerem registeredHotkey) erneut fehlschlagen: kein
  // Hotkey mehr aktiv, obwohl vorher einer funktionierte.
  let hotkeyToSave = current.hotkey;
  let hotkeyError = null;
  if (hotkey && hotkey !== current.hotkey) {
    if (hotkey === registeredHotkey || globalShortcut.register(hotkey, toggleDictation)) {
      if (registeredHotkey && registeredHotkey !== hotkey) globalShortcut.unregister(registeredHotkey);
      registeredHotkey = hotkey;
      hotkeyToSave = hotkey;
    } else {
      hotkeyError = `"${hotkey}" ist von Windows belegt — bisheriger Hotkey (${hotkeyLabel()}) bleibt aktiv.`;
    }
  }

  settings.saveSettings({ elevenLabsKey, llmPolishEnabled, llmApiKey, silenceMs, hotkey: hotkeyToSave });
  updateTray();
  notifyWidget();
  if (hotkeyError) return { ok: false, error: `Restliche Einstellungen gespeichert, aber ${hotkeyError}` };
  return { ok: true };
});

ipcMain.on('settings:close', () => {
  if (settingsWin) settingsWin.close();
});

ipcMain.on('widget:open-settings', () => openSettingsWindow());

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

    // Status-Icon unten rechts (immer sichtbar)
    createWidgetWindow();
    widgetWin.webContents.once('did-finish-load', () => notifyWidget());

    // Global Hotkey
    registerHotkey();

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
