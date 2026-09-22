// recorder-renderer.js — hidden BrowserWindow.
// getUserMedia + MediaRecorder (audio/webm;codecs=opus).
// Features:
//  - Start-/Stop-Beep (Web Audio) als akustisches Feedback.
//  - VAD Auto-Stop: wenn nach erfolgter Sprache SILENCE_MS Ruhe herrscht -> automatisch stoppen.
//  - manueller Stop via IPC 'recorder:stop' bleibt moeglich (Win+Y Toggle).
// IPC: 'recorder:start' / 'recorder:stop'; sendet 'recorder:recording' (arrayBuffer, meta),
//      'recorder:state' (recording|idle), 'recorder:error'.
const { ipcRenderer } = require('electron');

// --- VAD/Beep Konfiguration ---
let silenceMs = 1800;             // Ruhe nach Sprache -> Auto-Stop (vom Main-Prozess pro Start gesetzt, aus den Einstellungen)
let maxRecordMs = 30 * 60 * 1000; // Sicherheits-Hardstop, konfigurierbar (vom Main-Prozess pro Start gesetzt) — gilt auch im Lock-Modus
const SPEECH_THRESHOLD = 8;       // max Abweichung von 128 (0-255 Skala) als "Sprache"
const MIN_SPEECH_MS = 250;        // mind. so lange Sprache erkannt, bevor SILENCE scharf schaltet
const BEEP_START_FREQ = 880;      // hoher Ton = Aufnahme startet
const BEEP_STOP_FREQ = 440;       // tiefer Ton = Aufnahme stoppt

let mediaStream = null;
let mediaRecorder = null;
let chunks = [];
let audioCtx = null;              // fuer Beeps (UI-Sound)
let analyser = null;
let vadTimer = null;
let recordStart = 0;
let hasSpoken = false;
let lastSpeechAt = 0;
let stopping = false;
let peakDev = 0;                  // lauteste gemessene Abweichung im laufenden Take (Diagnose: Mikro stumm?)
let lockMode = false;            // Feststelltaste: true = kein Silence-Auto-Stop, läuft bis manuell gestoppt

// Renderer-Logs in den Main-Prozess spiegeln (hidden window hat keine sichtbare Konsole).
function rlog(...a) { try { ipcRenderer.send('recorder:log', a.join(' ')); } catch { /* ignore */ } }

function beep(freq, ms) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = freq;
    o.type = 'sine';
    g.gain.value = 0.15;
    o.connect(g); g.connect(audioCtx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + ms / 1000);
    o.stop(audioCtx.currentTime + ms / 1000);
  } catch (e) { /* beep optional */ }
}

function startVAD() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaStreamSource(mediaStream);
  analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  src.connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);
  vadTimer = setInterval(() => {
    if (!analyser || stopping) return;
    analyser.getByteTimeDomainData(buf);
    let maxDev = 0;
    for (let i = 0; i < buf.length; i++) { const d = Math.abs(buf[i] - 128); if (d > maxDev) maxDev = d; }
    if (maxDev > peakDev) peakDev = maxDev;
    if (maxDev > SPEECH_THRESHOLD) {
      if (!hasSpoken && Date.now() - recordStart > 0) {
        // Sprache erkannt - SILENCE scharf schalten nach MIN_SPEECH
        if (Date.now() - recordStart >= MIN_SPEECH_MS || maxDev > SPEECH_THRESHOLD * 2) hasSpoken = true;
      }
      lastSpeechAt = Date.now();
    }
    // Auto-Stop: im Lock-Modus (Feststelltaste) KEIN Silence-Stopp, nur der Hardstop.
    // Normal: nach Sprache + SILENCE_MS Ruhe, oder derselbe konfigurierbare Hardstop.
    if (lockMode) {
      if (Date.now() - recordStart > maxRecordMs) stop();
    } else if ((hasSpoken && Date.now() - lastSpeechAt > silenceMs) || Date.now() - recordStart > maxRecordMs) {
      stop(); // Auto-Stop
    }
  }, 100);
}

async function start(opts = {}) {
  try {
    if (Number.isFinite(opts.silenceMs)) silenceMs = opts.silenceMs;
    if (Number.isFinite(opts.maxRecordMs)) maxRecordMs = opts.maxRecordMs;
    if (mediaRecorder && mediaRecorder.state === 'recording') return;
    beep(BEEP_START_FREQ, 140); // Start-Feedback VOR Aufnahme (nicht aufs Band)
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    chunks = [];
    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) { mimeType = 'audio/webm'; if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = ''; }
    mediaRecorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mediaRecorder.start();
    recordStart = Date.now(); hasSpoken = false; lastSpeechAt = Date.now(); stopping = false; lockMode = false; peakDev = 0;
    const track = mediaStream.getAudioTracks()[0];
    rlog(`start mic="${track && track.label}" muted=${track && track.muted} enabled=${track && track.enabled} mime="${mediaRecorder.mimeType}"`);
    startVAD();
    ipcRenderer.send('recorder:state', 'recording');
  } catch (err) {
    ipcRenderer.send('recorder:error', String(err && err.message ? err.message : err));
  }
}

function stop() {
  if (stopping) return;
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    ipcRenderer.send('recorder:state', 'idle'); return;
  }
  stopping = true;
  if (vadTimer) { clearInterval(vadTimer); vadTimer = null; }
  mediaRecorder.onstop = async () => {
    beep(BEEP_STOP_FREQ, 160); // Stop-Feedback nach Aufnahme-Ende
    try {
      const type = mediaRecorder.mimeType || 'audio/webm';
      const blob = new Blob(chunks, { type });
      const arrayBuffer = await blob.arrayBuffer();
      const ext = type.includes('webm') ? 'webm' : (type.includes('ogg') ? 'ogg' : 'webm');
      rlog(`stop dauer=${Date.now() - recordStart}ms chunks=${chunks.length} bytes=${arrayBuffer.byteLength} peakDev=${peakDev} hasSpoken=${hasSpoken}`);
      ipcRenderer.send('recorder:recording', arrayBuffer, { ext, mime: type });
    } catch (err) {
      ipcRenderer.send('recorder:error', String(err && err.message ? err.message : err));
    } finally {
      if (mediaStream) { mediaStream.getTracks().forEach((t) => t.stop()); mediaStream = null; }
      mediaRecorder = null; chunks = []; analyser = null; lockMode = false;
      ipcRenderer.send('recorder:state', 'idle');
    }
  };
  mediaRecorder.stop();
}

ipcRenderer.on('recorder:start', (_e, opts) => start(opts));
ipcRenderer.on('recorder:stop', () => stop());
// Feststelltaste aktiviert: Auto-Stop aus, Bestätigung durch zwei hohe Töne.
ipcRenderer.on('recorder:lock', () => {
  lockMode = true;
  beep(1040, 90);
  setTimeout(() => beep(1040, 90), 130);
});