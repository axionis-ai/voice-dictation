// make-icon.js — erzeugt src/icon.png (256x256) und build/icon.ico ohne externe Tools.
// Design: Axionis-Branding "Obsidian & Ember" (axionisconsulting.com/css/tokens.css) —
// dunkle abgerundete Kachel (Obsidian/Coal) mit dem Ember-Blitz aus dem Website-Logo
// (identisches Heroicons-Bolt-Polygon, Farbe #FF5A36).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 256;
const img = Buffer.alloc(S * S * 4);

// Website-Farbtokens (axionisconsulting.com/css/tokens.css)
const OBSIDIAN = [0x0e, 0x0f, 0x12];
const COAL2 = [0x1c, 0x1d, 0x28];
const EMBER = [0xff, 0x5a, 0x36];

function roundedRect(x, y, cx, cy, w, h, r) {
  const dx = Math.max(Math.abs(x - cx) - (w / 2 - r), 0);
  const dy = Math.max(Math.abs(y - cy) - (h / 2 - r), 0);
  return Math.hypot(dx, dy) - r;
}

// Bolt-Polygon: Eckpunkte des Heroicons-"BoltIcon"-Pfads (24x24 viewBox), die kleinen
// .75-Eck-Verrundungen sind bei dieser Größe nicht sichtbar und werden als scharfe
// Ecken übernommen (identische Silhouette wie im Website-Logo).
const BOLT = [
  [14.615, 1.595],
  [12.982, 9.75],
  [20.25, 9.75],
  [10.298, 22.262],
  [11.018, 14.25],
  [3.75, 14.25],
  [13.702, 1.738],
];

function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = (yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Bolt in ein zentriertes Quadrat (18x18 von 24) einpassen, damit Rand zur Kachel bleibt.
const BOLT_SCALE = (S * 0.62) / 24;
const BOLT_OFFSET_X = S / 2 - (12 * BOLT_SCALE); // 12 = horizontale Mitte des 24er viewBox
const BOLT_OFFSET_Y = S / 2 - (12 * BOLT_SCALE);
const boltScaled = BOLT.map(([x, y]) => [x * BOLT_SCALE + BOLT_OFFSET_X, y * BOLT_SCALE + BOLT_OFFSET_Y]);

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    let r = 0, g = 0, b = 0, a = 0;

    // Hintergrund-Kachel: abgerundetes Quadrat, dezenter Obsidian->Coal-Diagonalverlauf.
    if (roundedRect(x + 0.5, y + 0.5, S / 2, S / 2, S - 16, S - 16, 56) < 0) {
      const t = (x + y) / (2 * S);
      r = Math.round(OBSIDIAN[0] + t * (COAL2[0] - OBSIDIAN[0]));
      g = Math.round(OBSIDIAN[1] + t * (COAL2[1] - OBSIDIAN[1]));
      b = Math.round(OBSIDIAN[2] + t * (COAL2[2] - OBSIDIAN[2]));
      a = 255;
    }

    // Ember-Blitz darüber.
    if (a > 0 && pointInPolygon(x + 0.5, y + 0.5, boltScaled)) {
      r = EMBER[0]; g = EMBER[1]; b = EMBER[2]; a = 255;
    }

    img[i] = r; img[i + 1] = g; img[i + 2] = b; img[i + 3] = a;
  }
}

// --- PNG-Encoder (RGBA, Filter 0) ---
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(pixels, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function downscale(pixels, srcSize, dstSize) {
  const out = Buffer.alloc(dstSize * dstSize * 4);
  for (let y = 0; y < dstSize; y++) {
    for (let x = 0; x < dstSize; x++) {
      const sx = Math.min(srcSize - 1, Math.floor((x + 0.5) * (srcSize / dstSize)));
      const sy = Math.min(srcSize - 1, Math.floor((y + 0.5) * (srcSize / dstSize)));
      const si = (sy * srcSize + sx) * 4;
      const di = (y * dstSize + x) * 4;
      pixels.copy(out, di, si, si + 4);
    }
  }
  return out;
}

const png256 = encodePng(img, S);

// --- ICO mit mehreren Größen (256, 48, 32, 16) für scharfe Darstellung in Taskleiste/Tray/Installer ---
const sizes = [256, 48, 32, 16];
const entries = sizes.map((sz) => ({ sz, png: sz === S ? png256 : encodePng(downscale(img, S, sz), sz) }));

const ICONDIR = Buffer.concat([Buffer.from([0, 0, 1, 0]), (() => { const b = Buffer.alloc(2); b.writeUInt16LE(entries.length); return b; })()]);
let offset = 6 + entries.length * 16;
const dirEntries = [];
const dataBufs = [];
for (const { sz, png } of entries) {
  const entry = Buffer.alloc(16);
  entry[0] = sz === 256 ? 0 : sz; // 0 = 256px laut ICO-Spec
  entry[1] = sz === 256 ? 0 : sz;
  entry[2] = 0; entry[3] = 0;
  entry.writeUInt16LE(1, 4);  // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  dirEntries.push(entry);
  dataBufs.push(png);
  offset += png.length;
}
const ico = Buffer.concat([ICONDIR, ...dirEntries, ...dataBufs]);

const root = path.join(__dirname, '..');
fs.writeFileSync(path.join(root, 'src', 'icon.png'), png256);
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico);
console.log(`OK src/icon.png=${png256.length}B build/icon.ico=${ico.length}B (${sizes.join(',')})`);
