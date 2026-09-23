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

async function transcribe(audioBuffer, { ext = 'webm', mime = 'audio/webm' } = {}) {
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

module.exports = { transcribe, ENDPOINT, MODEL_ID };