// clean.js — regelbasierte Bereinigung des Scribe-Transkripts (kostenlos, instant).
// Entfernt Füll-Laute/Wörter (äh/ähm/also/sagen wir mal …), kollabiert Wortwiederholungen,
// räumt Satzzeichen-Leerzeichen auf. KEINE Grammatik/Stotter-Reparatur (ak-akustisch -> akustisch) — das macht LLM.
// Unicode-Grenzen via \p{L}-Lookarounds (JS \b versagt an Umlauten, auch mit u-Flag in Node 24).

const FILLER_PHRASES = [
  'ä+h+', 'äh+m+', 'eh+m+', 'eh+', 'mh+m+', 'hm+', 'tja', 'naja', 'na ja',
  'sozusagen', 'gewissermaßen', 'sagen wir mal', 'sagen wir', 'weißt du', 'weiste',
  'nicht wahr', 'mhm', 'aeh+', 'aehm+',
];
// (?<!\p{L}) … (?!\p{L}) als Unicode-Wortgrenze; optionales folgendes Satzzeichen wird mit entfernt.
const FILLER_RE = new RegExp('(?<!\\p{L})(?:' + FILLER_PHRASES.join('|') + ')(?!\\p{L})[,.!?]?', 'giu');

function cleanTranscript(raw) {
  if (!raw) return '';
  let text = ' ' + raw + ' ';

  // 1) "also" nur am Satzanfang als Filler entfernen (mitten im Satz = Bedeutungswechsel).
  text = text.replace(/(^|[.!?]\s+)\s*also(?!\p{L})[,.!?]?/giu, '$1');

  // 2) Füller-Phrasen entfernen.
  text = text.replace(FILLER_RE, ' ');

  // 3) Wortwiederholung direkt hintereinander kollabieren ("die die" -> "die").
  let prev;
  do {
    prev = text;
    text = text.replace(/(?<!\p{L})(\p{L}[\p{L}'-]*?)\s+\1(?!\p{L})/giu, '$1');
  } while (text !== prev);

  // 4) Satzzeichen-Leerzeichen korrigieren.
  text = text.replace(/\s+([,.;:!?])/g, '$1');
  text = text.replace(/([,.;:!?])(?=[^\s])/g, '$1 ');
  text = text.replace(/([.!?])\1+/g, '$1');
  text = text.replace(/(,)\1+/g, ',');

  // 5) Mehrfach-Leerzeichen final.
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

module.exports = { cleanTranscript };