// scribe.js — ElevenLabs Scribe Batch STT.
// POST https://api.elevenlabs.io/v1/speech-to-text
// multipart: file (audio), model_id=scribe_v1, language_code=de
// Header: xi-api-key
// Zero-dependency: multipart body von Hand als Buffer mit Boundary.
const { getSettings } = require('./settings');

const ENDPOINT = 'https://api.elevenlabs.io/v1/speech-to-text';
const MODEL_ID = 'scribe_v1';
const LANGUAGE_CODE = 'de'; // primär Deutsch; Scribe auto-detectet sonst

function buildMultipart(fields, file) {
  // fields: { model_id, language_code } ; file: { name, mime, buffer }
  const boundary = '----freeflowlevion' + Math.random().toString(16).slice(2) + Date.now().toString(16);
  const parts = [];
  const enc = (s) => Buffer.from(s, 'utf8');

  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    parts.push(enc(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
      `${value}\r\n`
    ));
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

async function transcribe(audioBuffer, { ext = 'webm', mime = 'audio/webm', languageCode = LANGUAGE_CODE } = {}) {
  const key = getSettings().elevenLabsKey;
  if (!key) throw new Error('ElevenLabs-Key fehlt — in den Einstellungen eintragen');

  const { body, contentType } = buildMultipart(
    { model_id: MODEL_ID, language_code: languageCode },
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
  // Scribe-Antwort: { text, language_code, ... }
  if (!data || typeof data.text !== 'string') {
    throw new Error(`Scribe-Antwort ohne text-Feld: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.text;
}

module.exports = { transcribe, ENDPOINT, MODEL_ID };