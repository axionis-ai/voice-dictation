// main.js — Electron Hauptprozess.
// - Tray-Icon mit Status (idle/recording/transcribing/error)
// - globalShortcut Super+J toggelt Aufnahme
// - hidden BrowserWindow für Recorder (getUserMedia + MediaRecorder)
// - IPC: recorder:recording -> scribe.transcribe -> inserter.insert
// - Einstellungsfenster für ElevenLabs-/Groq-Key (ersetzt .env)
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, screen, Notification } = require('electron');
const path = require('path');
const scribe = require('./scribe');
const inserter = require('./inserter');
const clean = require('./clean');
const polish = require('./polish');
const voiceCommands = require('./voiceCommands');
const settings = require('./settings');
const autostart = require('./autostart');

const APP_NAME = 'Axionis Dictate';
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
let state = 'idle'; // idle | recording | transcribing | polishing | success | error
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

// Kurzer Erfolgs-Zustand direkt nach dem Einfuegen: das Status-Icon bestaetigt sichtbar,
// dass der Text angekommen ist, statt wortlos auf Ruhe zurueckzuspringen. Danach zurueck
// auf idle — aber nur, wenn inzwischen keine neue Aufnahme gestartet wurde (sonst wuerde
// der Timer eine laufende Aufnahme faelschlich auf idle zuruecksetzen).
const SUCCESS_MS = 900;
let successTimer = null;
function flashSuccess() {
  setStatus('success');
  clearTimeout(successTimer);
  successTimer = setTimeout(() => {
    if (state === 'success') setStatus('idle');
  }, SUCCESS_MS);
}

// Schickt den aktuellen Status ans immer sichtbare Status-Icon (unten rechts) —
// separat von updateTray(), damit auch reine Lock-Mode-Wechsel (kein setStatus-Aufruf)
// das Icon aktualisieren koennen.
function notifyWidget() {
  if (!widgetWin) return;
  widgetWin.webContents.send('widget:state', {
    state,
    hasElevenLabsKey: settings.getSettings().isReady,
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

// --- Auto-Update (electron-updater gegen unsere eigene Domain) ---
//
// Frueher liefen die Updates ueber oeffentliche GitHub-Releases. Das hiess: Das Repo
// MUSSTE oeffentlich bleiben, sonst konnte sich keine installierte Kopie mehr
// aktualisieren. Eine Produktentscheidung (Quellcode zeigen oder nicht) war damit an
// eine technische Abhaengigkeit gekettet — falsch herum.
//
// Jetzt liegt latest.yml unter axionisconsulting.com/voice/updates/, genau wie es die
// Android-Fassung schon macht. Der Quellcode kann damit privat sein, ohne dass
// irgendetwas kaputtgeht.
// Bewusst zurueckhaltend: still pruefen, EINMAL kurz per System-Benachrichtigung Bescheid
// geben und den dauerhaften Weg ins Tray-Menue legen. Nie ungefragt installieren, nie ein
// Fenster in den Vordergrund draengen — das Tool wuerde sonst mitten im Diktieren stoeren.
const { autoUpdater } = require('electron-updater');
const eventlog = require('./eventlog');
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // falls die App tagelang durchlaeuft
let availableUpdate = null; // Versionsnummer, sobald eine neuere gefunden wurde
let updateReady = false;    // true = fertig heruntergeladen, Installation per Klick moeglich

// Zustand der Aktualisierung, damit die Einstellungsmaske ihn ANZEIGEN kann. Vorher gab
// es nur den Tray-Eintrag, der erst nach dem Herunterladen erschien — wer dort nicht
// hinsah, hatte keinerlei Anhaltspunkt und keinen Weg, selbst zu pruefen.
let updateState = { phase: 'idle', version: null, percent: 0, error: null };

function setUpdateState(patch) {
  updateState = Object.assign({}, updateState, patch);
  if (settingsWin && !settingsWin.isDestroyed()) {
    try { settingsWin.webContents.send('update:state', updateState); } catch { /* ignore */ }
  }
}

autoUpdater.autoDownload = true;
// Beim Beenden NICHT heimlich installieren — die Installation passiert nur auf Klick.
autoUpdater.autoInstallOnAppQuit = false;

autoUpdater.on('update-not-available', () => {
  setUpdateState({ phase: 'none', version: null, error: null });
});

autoUpdater.on('download-progress', (p) => {
  setUpdateState({ phase: 'downloading', percent: Math.round((p && p.percent) || 0) });
});

autoUpdater.on('update-available', (info) => {
  availableUpdate = (info && info.version) || null;
  setUpdateState({ phase: 'downloading', version: availableUpdate, percent: 0, error: null });
  updateTray(); // Menue zeigt "wird geladen", der Eintrag zum Installieren kommt erst danach
});

autoUpdater.on('update-downloaded', (info) => {
  availableUpdate = (info && info.version) || availableUpdate;
  updateReady = true;
  setUpdateState({ phase: 'ready', version: availableUpdate, percent: 100, error: null });
  updateTray();
  // Erst JETZT benachrichtigen, nicht schon bei 'update-available': vorher waere die
  // Installation noch gar nicht moeglich und der Hinweis liefe ins Leere.
  if (Notification.isSupported()) {
    new Notification({
      title: `Axionis Dictate ${availableUpdate} ist bereit`,
      body: 'Zum Installieren auf das Symbol in der Taskleiste klicken.',
      silent: true,
    }).show();
  }
});

// Ein fehlgeschlagener Update-Check (kein Netz, GitHub down) darf das Diktieren niemals
// stoeren — nur protokollieren, sonst passiert nichts.
autoUpdater.on('error', (err) => {
  const msg = (err && err.message) || String(err);
  console.error('[update] Pruefung fehlgeschlagen:', msg);
  // Weiterhin NICHT stoerend: kein Fenster, kein Ton. Aber in der Maske sichtbar —
  // ein stiller Fehlschlag sieht sonst genauso aus wie "alles aktuell".
  eventlog.trace(`Update-Prüfung fehlgeschlagen: ${msg}`);
  setUpdateState({ phase: 'error', error: msg });
});

function checkForUpdates() {
  if (!app.isPackaged) {
    // Im Dev-Betrieb gibt es kein Release zum Vergleichen. Das ehrlich sagen, statt
    // wortlos nichts zu tun.
    setUpdateState({ phase: 'dev', error: null });
    return;
  }
  setUpdateState({ phase: 'checking', error: null });
  autoUpdater.checkForUpdates().catch((e) => {
    const msg = (e && e.message) || String(e);
    console.error('[update] checkForUpdates:', msg);
    setUpdateState({ phase: 'error', error: msg });
  });
}

ipcMain.handle('update:check', () => { checkForUpdates(); return updateState; });
ipcMain.handle('update:state', () => updateState);
ipcMain.handle('log:read', (_e, includeTech) => eventlog.snapshot(!!includeTech));

/**
 * Schickt das Protokoll an unseren Endpunkt. Nur auf Klick, nie von selbst.
 *
 * Der Inhalt enthaelt per Bauart nichts Diktiertes — das Protokoll haelt ausschliesslich
 * Zeichenzahlen, Dauern, Anbieternamen und Fehlermeldungen fest. Zusaetzlich gehen
 * Version, Betriebssystem und die gewaehlten Einstellungen mit, aber KEINE Schluessel.
 */
ipcMain.handle('log:send', async () => {
  const s = settings.getSettings();
  const kopf = [
    `App:         Axionis Dictate ${app.getVersion()} (Windows)`,
    `System:      ${process.platform} ${process.arch}, Electron ${process.versions.electron}`,
    `Erkennung:   ${s.sttProvider}`,
    `Politur:     ${s.llmPolishEnabled ? s.llmModel : 'aus'}`,
    `Pause:       ${s.silenceMs} ms | max. Aufnahme: ${Math.round(s.maxRecordMs / 60000)} min`,
    `Schlüssel:   ElevenLabs ${s.hasElevenLabsKey ? 'gesetzt' : 'fehlt'}, Groq ${s.hasLlmApiKey ? 'gesetzt' : 'fehlt'}`,
    `Diktate:     ${s.stats.dictations}`,
  ].join('\n');
  const body = kopf + '\n' + '-'.repeat(60) + '\n' + eventlog.snapshot(true).join('\n');

  try {
    const res = await fetch('https://axionisconsulting.com/voice/report.php', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body,
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    eventlog.trace(`Fehlerbericht gesendet, Kennung ${data.id}`);
    return { ok: true, id: data.id };
  } catch (e) {
    eventlog.trace(`Fehlerbericht konnte nicht gesendet werden: ${e.message}`);
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('update:install', () => {
  if (!updateReady) return { ok: false };
  autoUpdater.quitAndInstall();
  return { ok: true };
});

function stateLabel() {
  if (!settings.getSettings().isReady) return 'Nicht eingerichtet — Klick für Einstellungen';
  switch (state) {
    case 'recording': return lockMode
      ? `● REC (Feststelltaste) — ${hotkeyLabel()} zum Stoppen`
      : `● REC — nochmal ${hotkeyLabel()} zum Stoppen`;
    case 'transcribing': return '… transkribiere (Scribe)';
    case 'polishing': return '… poliere (Groq)';
    case 'success': return '✓ Text eingefügt';
    case 'error': return `⚠ Fehler: ${lastError}`;
    default: return `${hotkeyLabel()} = Diktat starten`;
  }
}

function updateTray() {
  if (!tray) return;
  tray.setToolTip(`${APP_NAME} — ${stateLabel()}`);

  // Update-Hinweis ganz oben, damit er auffaellt — aber nur als anklickbarer Eintrag,
  // wenn das Paket auch wirklich schon heruntergeladen ist.
  const updateItems = [];
  if (updateReady) {
    updateItems.push({
      label: `Update auf ${availableUpdate} — jetzt installieren`,
      click: () => autoUpdater.quitAndInstall(),
    });
    updateItems.push({ type: 'separator' });
  } else if (availableUpdate) {
    updateItems.push({ label: `Update ${availableUpdate} wird geladen...`, enabled: false });
    updateItems.push({ type: 'separator' });
  }

  // Gescheiterte Aufnahme ganz oben anbieten. Ohne diesen Eintrag waere sie nur eine
  // Zeile im Protokoll — der gesprochene Text bliebe verloren.
  const wiederholItems = [];
  if (letzteAufnahme) {
    const sek = Math.round(letzteAufnahme.recordedMs / 1000);
    wiederholItems.push({ label: `Letztes Diktat (${sek} s) erneut senden`, click: () => erneutSenden() });
    wiederholItems.push({ type: 'separator' });
  }

  const menu = Menu.buildFromTemplate([
    ...wiederholItems,
    ...updateItems,
    { label: stateLabel(), enabled: false },
    { type: 'separator' },
    { label: `Hotkey: ${hotkeyLabel()}`, enabled: false },
    { label: 'Einstellungen...', click: () => openSettingsWindow() },
    { type: 'separator' },
    {
      label: 'Test-Paste (Clipboard "Test")',
      click: async () => {
        try { await inserter.insert('Axionis-Dictate-Test ✓'); } catch (e) { setStatus('error', e.message); }
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

// Immer sichtbares Status-Icon — zeigt live, ob das Tool aktiv/am Aufnehmen ist,
// Klick oeffnet die Einstellungen als zweiter Weg neben dem Tray-Menue.
const WIDGET_W = 120, WIDGET_H = 76, WIDGET_MARGIN = 12;

// Liefert eine sinnvolle Fensterposition: gespeicherte Position, falls vorhanden UND
// noch auf einem angeschlossenen Bildschirm sichtbar — sonst die Standardposition.
// Der Sichtbarkeits-Check verhindert ein "verlorenes" Icon, wenn seit dem letzten Mal
// ein Monitor abgehaengt wurde.
function widgetPosition() {
  const s = settings.getSettings();
  if (Number.isFinite(s.widgetX) && Number.isFinite(s.widgetY)) {
    const onScreen = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return s.widgetX >= a.x - WIDGET_W && s.widgetX <= a.x + a.width
        && s.widgetY >= a.y - WIDGET_H && s.widgetY <= a.y + a.height;
    });
    if (onScreen) return { x: Math.round(s.widgetX), y: Math.round(s.widgetY) };
  }
  // Standard seit 0.15.0: horizontal mittig, knapp ueber der Taskleiste. Vorher unten
  // rechts — dort lag es im Infobereich, wo Windows-Benachrichtigungen aufpoppen und es
  // regelmaessig verdeckt haben.
  const workArea = screen.getPrimaryDisplay().workArea;
  return {
    x: workArea.x + Math.round((workArea.width - WIDGET_W) / 2),
    y: workArea.y + workArea.height - WIDGET_H - WIDGET_MARGIN,
  };
}

function createWidgetWindow() {
  // Fenster deutlich groesser als der sichtbare Inhalt (grosszuegiges CSS-Padding in
  // widget.html) — sonst schneidet die Fensterkante weiche box-shadow/Glow-Raender hart ab.
  const pos = widgetPosition();
  widgetWin = new BrowserWindow({
    width: WIDGET_W,
    height: WIDGET_H,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  widgetWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // HINWEIS: Hier stand in 0.15.0 ein Ticker, der alle 10s setAlwaysOnTop + moveTop()
  // aufrief, damit das Icon nicht hinter andere Fenster rutscht. Das hat das Einfuegen
  // zerstoert: moveTop() reisst unter Windows die Fensterreihenfolge an sich und stoert
  // genau den Moment, in dem inserter.js Strg+V ins Zielfenster simuliert — der Text
  // blieb liegen und die alte Zwischenablage wurde zurueckgeschrieben.
  // Ein sichtbares Icon ist Kosmetik, funktionierendes Diktieren ist der Zweck der App.
  // Deshalb zurueck auf das schlichte alwaysOnTop aus den Fensteroptionen.
  widgetWin.loadFile(path.join(__dirname, 'widget.html'));

  widgetWin.on('closed', () => { widgetWin = null; });

  // Position nach dem Ziehen speichern (entprellt — 'moved' feuert mehrfach waehrend
  // des Ziehens auf Windows, nicht erst am Ende). Die ersten 1.5s nach dem Erzeugen
  // ignorieren wir: Windows feuert direkt beim Erstellen selbst oft schon ein 'moved'
  // (DPI-/Positions-Finalisierung) — das ist kein echtes Ziehen und wuerde sonst eine
  // falsche/zufaellige Position dauerhaft speichern.
  const createdAt = Date.now();
  let saveTimer = null;
  widgetWin.on('moved', () => {
    if (Date.now() - createdAt < 1500) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!widgetWin) return;
      const [x, y] = widgetWin.getPosition();
      settings.saveSettings({ widgetX: x, widgetY: y });
    }, 400);
  });
}

function openSettingsWindow() {
  if (settingsWin) { settingsWin.show(); settingsWin.focus(); return; }
  // Die Maske ist inhaltlich laenger als ein 1080p-Bildschirm hergibt (gemessen ~1430px
  // Inhalt gegen ~820px nutzbare Hoehe), sie wird also ohnehin gescrollt. Deshalb die
  // Wunschhoehe am tatsaechlichen Arbeitsbereich kappen statt einen Wert zu setzen, den
  // Windows stillschweigend zurechtstutzt — und resizable lassen, damit auf grossen
  // Bildschirmen mehr auf einmal sichtbar gemacht werden kann.
  const desiredHeight = settings.getSettings().llmPolishEnabled ? 985 : 885;
  const availableHeight = screen.getPrimaryDisplay().workArea.height - 40;
  settingsWin = new BrowserWindow({
    width: 420,
    height: Math.min(desiredHeight, availableHeight),
    resizable: true,
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
  if (!settings.getSettings().isReady) {
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
  } else if (state === 'idle' || state === 'error' || state === 'success') {
    // Start — 'success' ist nur ein kurzer Bestaetigungs-Zustand nach dem Einfuegen und
    // darf eine sofort folgende neue Aufnahme nicht blockieren.
    setStatus('recording');
    lockMode = false;
    recordingStartedAt = Date.now();
    recorderWin.webContents.send('recorder:start', { silenceMs: settings.getSettings().silenceMs, maxRecordMs: settings.getSettings().maxRecordMs });
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

// Live-Lautstaerke vom VAD-Loop ans Status-Icon durchreichen, damit die Soundwave
// waehrend der Aufnahme mit der echten Stimme atmet statt fest animiert zu laufen.
// Bewusst ohne Logging: das feuert 10x pro Sekunde.
ipcMain.on('recorder:level', (_e, level) => {
  if (widgetWin) widgetWin.webContents.send('widget:level', level);
});

ipcMain.on('recorder:error', (_e, msg) => {
  console.error('[rend] FEHLER:', msg);
  setStatus('error', msg);
});

/**
 * Packt aus, was Node hinter "fetch failed" versteckt.
 *
 * undici wirft bei jedem Netzproblem dieselbe nichtssagende Meldung; der eigentliche
 * Grund (DNS, Zeitablauf, abgerissene Verbindung, Zertifikat) steht in err.cause. Genau
 * das fehlte im Fehlerbericht vom 25.09.2026: Dort stand nur "FEHLER: fetch failed",
 * und damit liess sich der Absturz nicht einordnen.
 */
function beschreibeFehler(err) {
  if (!err) return 'unbekannter Fehler';
  const teile = [err.message || String(err)];
  let c = err.cause;
  let tiefe = 0;
  while (c && tiefe < 3) {
    const text = c.code ? `${c.code}${c.message ? ': ' + c.message : ''}` : (c.message || String(c));
    if (text && !teile.includes(text)) teile.push(text);
    c = c.cause;
    tiefe++;
  }
  return teile.join(' — ');
}

/** Sieht der Fehler nach Netz aus? Dann lohnt ein zweiter Versuch. */
function lohntWiederholung(err) {
  const t = beschreibeFehler(err).toLowerCase();
  if (t.includes('401') || t.includes('403')) return false;
  return t.includes('fetch failed') || t.includes('timeout') || t.includes('abort')
    || t.includes('econn') || t.includes('enotfound') || t.includes('etimedout')
    || t.includes('socket') || t.includes('network')
    || t.includes('http 5') || t.includes('http 429');
}

/**
 * Letzte Aufnahme, die nicht verarbeitet werden konnte. null = nichts offen.
 *
 * Vorher wurde eine gescheiterte Aufnahme einfach verworfen. Im Bericht vom 25.09. steht
 * eine 66-Sekunden-Aufnahme, die an "fetch failed" scheiterte — eine gute Minute
 * gesprochener Text, unwiederbringlich weg. Die Android-Fassung haelt sie seit 0.22.0
 * fest; hier fehlte das.
 */
let letzteAufnahme = null;

ipcMain.on('recorder:recording', async (_e, arrayBuffer, meta) => {
  console.log(`[vd] recorder:recording eingangen bytes=${arrayBuffer && arrayBuffer.byteLength} meta=${JSON.stringify(meta)}`);
  // Aufnahmedauer fuer die Ersparnis-Anzeige: Hotkey-Druck bis zum Eintreffen der Audio-
  // Daten. Hier festhalten, BEVOR Transkription/Politur laufen — danach waere die Spanne
  // um deren Verarbeitungszeit zu gross.
  const recordedMs = recordingStartedAt ? Date.now() - recordingStartedAt : 0;
  verarbeiteAufnahme(Buffer.from(arrayBuffer), meta, recordedMs, false);
});

/** Schickt die zuletzt gescheiterte Aufnahme noch einmal durch. */
function erneutSenden() {
  const a = letzteAufnahme;
  if (!a) return;
  letzteAufnahme = null;
  updateTray();
  eventlog.note('Gesicherte Aufnahme wird erneut gesendet');
  verarbeiteAufnahme(a.buf, a.meta, a.recordedMs, true);
}

/**
 * Die eigentliche Verarbeitung. Getrennt vom Empfang, damit dieselbe Aufnahme ein
 * zweites Mal durchlaufen kann, ohne dass neu gesprochen werden muss.
 */
async function verarbeiteAufnahme(buf, meta, recordedMs, istWiederholung) {
  setStatus('transcribing');
  eventlog.trace(`Aufnahme ${istWiederholung ? 'erneut gesendet' : 'fertig'}: ${Math.round(recordedMs / 1000)} s, ${buf.length} Bytes`);
  try {
    const anbieter = settings.getSettings().sttProvider === 'groq' ? 'Groq' : 'ElevenLabs';

    let scribed;
    try {
      scribed = await scribe.transcribe(buf, { ext: meta.ext, mime: meta.mime });
    } catch (e1) {
      // Ein automatischer zweiter Versuch. Die haeufigste Ursache fuer einen
      // Fehlschlag ist ein kurzer Netzaussetzer; den merkt man sonst nur daran, dass
      // das Diktat verschwindet.
      if (!lohntWiederholung(e1)) throw e1;
      eventlog.note(`Verbindungsproblem, zweiter Versuch: ${beschreibeFehler(e1)}`);
      await new Promise((r) => setTimeout(r, 1500));
      scribed = await scribe.transcribe(buf, { ext: meta.ext, mime: meta.mime });
    }

    let text = scribed.text;
    const languageCode = scribed.languageCode;
    console.log(`[vd] scribe rohtext laenge=${text.length} sprache=${languageCode || '?'}`);
    eventlog.note(`Erkannt über ${anbieter}: ${text.length} Zeichen, Sprache ${languageCode || 'unbekannt'}`);
    text = clean.cleanTranscript(text); // regelbasiert (kostenlos, instant)

    if (settings.getSettings().llmPolishEnabled) {
      setStatus('polishing');
      try {
        text = await polish.polish(text, { timeoutMs: 8000, languageCode });
        eventlog.trace(`Politur angewendet (${languageCode || '?'})`);
      } catch (e) {
        // Politur fehlgeschlagen/Timeout -> regelbasiert bereinigter Text bleibt, Paste
        // nicht blockieren. Sichtbar machen statt still den Rohtext nehmen: Sonst sieht
        // es aus, als poliere die App "mal so, mal so".
        setStatus('transcribing');
        console.error('[vd] Politur-Fallback:', e.message);
        eventlog.note(`Politur fehlgeschlagen, unbereinigter Text eingefügt: ${e.message}`);
      }
    }

    text = voiceCommands.applyCommands(text);
    await inserter.insert(text);
    eventlog.note(`Eingefügt: ${text.length} Zeichen`);
    settings.addDictation({ chars: text.length, recordedMs });
    letzteAufnahme = null;
    updateTray();
    flashSuccess();
  } catch (err) {
    console.error('[vd] PIPELINE-FEHLER:', err && err.stack ? err.stack : err);
    const grund = beschreibeFehler(err);
    eventlog.note(`FEHLER: ${grund}`);
    // Aufnahme BEHALTEN. Sie ist gesprochene Arbeit und hat bei der Erkennung Geld
    // gekostet; sie wegzuwerfen, weil das Netz kurz weg war, ist der eigentliche Aerger.
    letzteAufnahme = { buf, meta, recordedMs, zeit: Date.now() };
    updateTray();
    setStatus('error', grund);
  }
}


// --- Settings-IPC ---
ipcMain.handle('settings:load', () => {
  const s = settings.getSettings();
  return {
    hasElevenLabsKey: s.hasElevenLabsKey,
    isReady: s.isReady,
    sttProvider: s.sttProvider,
    sttModel: s.sttModel,
    hasLlmApiKey: s.hasLlmApiKey,
    llmPolishEnabled: s.llmPolishEnabled,
    silenceMs: s.silenceMs,
    maxRecordMs: s.maxRecordMs,
    hotkey: s.hotkey,
    showWidget: s.showWidget,
    glossary: s.glossary,
    llmModel: s.llmModel,
    stats: s.stats,
    appVersion: app.getVersion(), // fuer die Versionsanzeige im Footer der Maske
  };
});

ipcMain.handle('settings:save', (_e, { elevenLabsKey, llmPolishEnabled, llmApiKey, llmModel, sttProvider, sttModel, silenceMs, hotkey, showWidget, glossary, maxRecordMs }) => {
  const current = settings.getSettings();
  // Je nach gewaehltem Anbieter ist ein ANDERER Schluessel Pflicht. Wer Groq fuer die
  // Erkennung nutzt, braucht gar keinen ElevenLabs-Key mehr.
  if (sttProvider === 'groq') {
    if (!llmApiKey && !current.hasLlmApiKey) {
      return { ok: false, error: 'Groq als Erkennung gewählt, aber kein Groq-Key eingegeben.' };
    }
  } else if (!elevenLabsKey && !current.hasElevenLabsKey) {
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

  settings.saveSettings({ elevenLabsKey, llmPolishEnabled, llmApiKey, silenceMs, hotkey: hotkeyToSave, showWidget, glossary, maxRecordMs });
  if (showWidget === false && widgetWin) { widgetWin.close(); }
  else if (showWidget !== false && !widgetWin) { createWidgetWindow(); widgetWin.webContents.once('did-finish-load', () => notifyWidget()); }
  updateTray();
  notifyWidget();
  if (hotkeyError) return { ok: false, error: `Restliche Einstellungen gespeichert, aber ${hotkeyError}` };
  return { ok: true };
});

ipcMain.on('settings:close', () => {
  if (settingsWin) settingsWin.close();
});

ipcMain.on('widget:open-settings', () => openSettingsWindow());

// Manuelles Ziehen (statt -webkit-app-region:drag, das auf demselben Element auch
// normale Klicks mitgeschluckt hat): Renderer fragt die Startposition ab, berechnet
// den Versatz selbst per Mausbewegung und schickt die Zielposition.
ipcMain.handle('widget:get-position', () => {
  if (!widgetWin) return { x: 0, y: 0 };
  const [x, y] = widgetWin.getPosition();
  return { x, y };
});

ipcMain.on('widget:drag-to', (_e, { x, y }) => {
  if (widgetWin) widgetWin.setPosition(Math.round(x), Math.round(y));
});

ipcMain.handle('widget:reset-position', () => {
  settings.saveSettings({ widgetX: null, widgetY: null });
  if (widgetWin) {
    const pos = widgetPosition();
    widgetWin.setPosition(pos.x, pos.y);
  }
  return { ok: true };
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
  eventlog.trimFile();
  eventlog.note(`Axionis Dictate ${app.getVersion()} gestartet`);
    // Tray
    const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    tray.on('click', () => {
      if (!settings.getSettings().isReady) openSettingsWindow();
    });
    updateTray();

    // Recorder window (hidden)
    createRecorderWindow();

    // Status-Icon unten rechts (per Einstellung abschaltbar)
    if (settings.getSettings().showWidget) {
      createWidgetWindow();
      widgetWin.webContents.once('did-finish-load', () => notifyWidget());
    }

    // Global Hotkey
    registerHotkey();

    // Erststart ohne Key: Einstellungen direkt zeigen statt stumm zu warten.
    if (!settings.getSettings().isReady) {
      openSettingsWindow();
    }

    // Update-Pruefung verzoegert, damit sie den Start nicht ausbremst; danach in Ruhe
    // wiederholen, weil die App per Autostart oft wochenlang durchlaeuft und sonst nie
    // wieder nachsehen wuerde.
    setTimeout(checkForUpdates, 8000);
    setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS);
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  // Tray-only app: nicht beenden, wenn alle Fenster geschlossen.
  app.on('window-all-closed', (e) => { /* nothing — tray stays */ });
}
