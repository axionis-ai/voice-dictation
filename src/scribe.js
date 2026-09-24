// scribe.js — ElevenLabs Scribe Batch STT.
// POST https://api.elevenlabs.io/v1/speech-to-text
// multipart: file (audio), model_id=scribe_v1
// Header: xi-api-key
// Zero-dependency: multipart body von Hand als Buffer mit Boundary.
//
// language_code wird BEWUSST nicht gesendet: ohne den Parameter erkennt Scribe die
// gesprochene Sprache selbst. Frueher stand hier fest 'de' — der Parameter ist bei
// ElevenLabs allerdings nur ein Hinweis, keine Erzwingung, weshalb auch damals schon
// Englisch/Spanisch korrekt erkannt wurden. Weglassen macht das Verhalten ehrlich und
// nimmt dem Modell den Deutsch-Bias bei kurzen, mehrdeutigen Aeusserungen.
const { getSettings } = require('./settings');

const ENDPOINT = 'https://api.elevenlabs.io/v1/speech-to-text';
const MODEL_ID = 'scribe_v1';

function buildMultipart(fields, file) {
  // fields: { model_id, language_code, keyterms: [...] } ; file: { name, mime, buffer }
  // Werte, die ein Array sind, werden als mehrere Form-Data-Teile mit demselben
  // Feldnamen gesendet (so erwartet es ElevenLabs' "keyterms" — am echten Endpunkt
  // verifiziert: ein JSON-String in einem Feld wird als ein einzelner, zu langer
  // Keyterm abgelehnt ("invalid characters" wegen der eckigen Klammern).
  const boundary = '----freeflowlevion' + Math.random().toString(16).slice(2) + Date.now().toString(16);
  const parts = [];
  const enc = (s) => Buffer.from(s, 'utf8');

  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (v === undefined || v === null || v === '') continue;
      parts.push(enc(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
        `${v}\r\n`
      ));
    }
  }
  // File-Part
  parts.push(enc(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
    `Content-Type: ${file.mime}\r\n\r\n`
  ));
  parts.push(file.buffer);
  parts.push(enc(`\r\n--${boundary}--\r\n`));

  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

// ElevenLabs lehnt Keyterms mit < > { } [ ] \ ab und begrenzt auf 50 Zeichen/5 Woerter —
// lieber leise kuerzen als die ganze Transkription an einem falsch eingegebenen Glossar-
// Begriff scheitern zu lassen.
function sanitizeKeyterm(term) {
  return term.replace(/[<>{}[\]\\]/g, '').trim().slice(0, 50);
}

// --- Groq Whisper als kostenlose Alternative -------------------------------------
//
// Groq bietet Whisper ueber einen OpenAI-kompatiblen Endpunkt an. Fuer den Nutzer ist
// das die interessanteste Alternative, weil er den Groq-Key fuer die Politur ohnehin
// schon hat: EIN Schluessel fuer beides, 8 Stunden Audio pro Tag dauerhaft kostenlos.
//
// Zwei ehrliche Unterschiede zu Scribe, die auch auf der Webseite stehen:
//
//   1. KEIN echtes Glossar. Whisper kennt nur einen `prompt` (max. 224 Tokens), und der
//      ist ein Stil- und Kontexthinweis, keine harte Begriffsbindung. Wir schicken das
//      Glossar trotzdem mit — es hilft nachweislich bei Eigennamen, erzwingt sie aber
//      nicht. Genau dafuer bleibt Scribe die bessere Wahl.
//   2. Die Antwort enthaelt die erkannte Sprache nur im Format `verbose_json`. Wir
//      fordern das an, damit die Politur weiss, in welcher Sprache sie arbeiten soll;
//      fehlt das Feld trotzdem, geben wir null zurueck und die Politur arbeitet
//      sprachneutral weiter.
const GROQ_STT_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_STT_MODEL = 'whisper-large-v3-turbo';

async function transcribeWithGroq(audioBuffer, { ext, mime }) {
  const s = getSettings();
  const key = s.llmApiKey;
  if (!key) {
    throw new Error('Groq-Key fehlt — in den Einstellungen eintragen (er macht dann Erkennung UND Politur)');
  }

  const glossary = (s.glossary || []).map((t) => String(t).trim()).filter(Boolean);
  const fields = {
    model: s.sttModel || GROQ_STT_MODEL,
    response_format: 'verbose_json',
  };
  if (glossary.length) {
    // Als Satz formuliert, nicht als Liste: Whisper behandelt den prompt wie den Anfang
    // eines Transkripts, eine nackte Komma-Liste verwirrt ihn eher.
    fields.prompt = `Mögliche Eigennamen und Fachbegriffe: ${glossary.join(', ')}.`.slice(0, 800);
  }

  const { body, contentType } = buildMultipart(fields, { name: `dict.${ext}`, mime, buffer: audioBuffer });

  const res = await fetch(GROQ_STT_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': contentType },
    body,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Groq STT HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  if (!data || typeof data.text !== 'string') {
    throw new Error(`Groq-Antwort ohne text-Feld: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return { text: data.text, languageCode: data.language || null };
}

async function transcribe(audioBuffer, { ext = 'webm', mime = 'audio/webm' } = {}) {
  // Weiche nach Anbieter. Voreinstellung bleibt ElevenLabs: bessere Erkennung und
  // ein echtes Glossar. Groq ist die kostenlose Alternative fuer alle, die keinen
  // zweiten Anbieter wollen — der Schluessel fuer die Politur reicht dann fuer beides.
  if (getSettings().sttProvider === 'groq') {
    return transcribeWithGroq(audioBuffer, { ext, mime });
  }

  const key = getSettings().elevenLabsKey;
  if (!key) throw new Error('ElevenLabs-Key fehlt — in den Einstellungen eintragen');
  const glossary = (getSettings().glossary || []).map(sanitizeKeyterm).filter(Boolean);

  const { body, contentType } = buildMultipart(
    { model_id: MODEL_ID, keyterms: glossary.length ? glossary : undefined },
    { name: `dict.${ext}`, mime, buffer: audioBuffer }
  );

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'xi-api-key': key,
      'Content-Type': contentType,
    },
    body,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Scribe HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  // Scribe-Antwort: { text, language_code, ... } — language_code ist die ERKANNTE
  // Sprache und wird an die Politur weitergereicht, damit deren Prompt zur gesprochenen
  // Sprache passt (statt wie frueher fest Deutsch anzunehmen).
  if (!data || typeof data.text !== 'string') {
    throw new Error(`Scribe-Antwort ohne text-Feld: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return { text: data.text, languageCode: data.language_code || null };
}

module.exports = { transcribe, ENDPOINT, MODEL_ID, GROQ_STT_ENDPOINT, GROQ_STT_MODEL };