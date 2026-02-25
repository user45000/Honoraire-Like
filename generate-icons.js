/**
 * Icône PWA Honoraires MG — stéthoscope, vue frontale épurée
 *
 *    ╭────────╮   ← arc du binaural (ressort)
 *   ●          ●  ← embouts auriculaires
 *    \        /   ← tubes auriculaires
 *     \      /
 *      ╲    ╱
 *        \/
 *        |        ← tube principal
 *        |
 *      ( ● )      ← pavillon / diaphragme
 */
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── PNG utils ──────────────────────────────────────────────────────────────
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
function crc32(buf) {
  let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; }
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii'), crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([u32(data.length), t, data, crc]);
}

// ── Math ───────────────────────────────────────────────────────────────────
const clamp  = (x, lo=0, hi=1) => Math.max(lo, Math.min(hi, x));
const lerp   = (a, b, t) => a + (b - a) * clamp(t);
const smooth = (lo, hi, x) => { const t = clamp((x-lo)/(hi-lo)); return t*t*(3-2*t); };
function sdSeg(px, py, ax, ay, bx, by) {
  const dx = bx-ax, dy = by-ay, d2 = dx*dx+dy*dy;
  const t = d2 > 0 ? clamp(((px-ax)*dx+(py-ay)*dy)/d2) : 0;
  return Math.hypot(ax+t*dx-px, ay+t*dy-py);
}

// ── SDF stéthoscope ────────────────────────────────────────────────────────
function sdfStethoscope(x, y) {
  const sw    = 0.055; // demi-épaisseur tube
  const tipR  = 0.065; // rayon embouts

  // Positions clés
  const EX = 0.36, EY = -0.42;   // embouts (±EX, EY)
  const JY = -0.18;               // jonction (convergence des tubes)
  const BRY = EY - 0.01;         // centre de l'arc binaural (même hauteur que les embouts)

  // Arc binaural : relie les deux embouts par le dessus (∩)
  // Centre (0, BRY), rayon EX, visible uniquement pour la moitié supérieure (angle < 0)
  const bx = x, by = y - BRY;
  const bd = Math.hypot(bx, by);
  const ba = Math.atan2(by, bx);
  const binauralD = (ba < 0 || ba > Math.PI) // moitié haute = angles négatifs
    ? Math.abs(bd - EX) - sw
    : Infinity;

  // Embouts auriculaires (petites sphères aux extrémités de l'arc)
  const lTip = Math.hypot(x + EX, y - EY) - tipR;
  const rTip = Math.hypot(x - EX, y - EY) - tipR;

  // Tubes auriculaires : des embouts vers la jonction centrale
  const lTube = sdSeg(x, y, -EX, EY, 0, JY) - sw;
  const rTube = sdSeg(x, y,  EX, EY, 0, JY) - sw;

  // Jonction (adoucit le raccord)
  const jDot = Math.hypot(x, y - JY) - sw * 1.15;

  // Tube principal
  const mainTube = sdSeg(x, y, 0, JY, 0, 0.22) - sw * 0.85;

  // Pavillon / diaphragme
  const cpD = Math.hypot(x, y - 0.54) - 0.27;

  return Math.min(binauralD, lTip, rTip, lTube, rTube, jDot, mainTube, cpD);
}

// ── Fond : teal médical profond ────────────────────────────────────────────
function bgColor(nx, ny) {
  const t = clamp(((nx + 1) + (ny + 1)) / 4);
  return [
    Math.round(lerp(0x0D, 0x06, t)),
    Math.round(lerp(0x73, 0x3B, t)),
    Math.round(lerp(0x99, 0x55, t)),
  ];
}

// ── Rendu ──────────────────────────────────────────────────────────────────
function renderPixel(px, py, size) {
  const nx = (px / size) * 2 - 1;
  const ny = (py / size) * 2 - 1;
  const [bgR, bgG, bgB] = bgColor(nx, ny);
  const d = sdfStethoscope(nx, ny);
  const aa = (2.0 / size) * 1.8;
  const alpha = 1 - smooth(-aa, aa, d);
  return [
    Math.round(lerp(bgR, 255, alpha)),
    Math.round(lerp(bgG, 255, alpha)),
    Math.round(lerp(bgB, 255, alpha)),
  ];
}

function makePNG(size) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    rows.push(0);
    for (let x = 0; x < size; x++) rows.push(...renderPixel(x, y, size));
  }
  const raw = Buffer.from(rows);
  const sig  = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = chunk('IHDR', Buffer.concat([u32(size), u32(size), Buffer.from([8,2,0,0,0])]));
  const idat = chunk('IDAT', zlib.deflateSync(raw));
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

const iconsDir = path.join(__dirname, 'public', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });
for (const size of [180, 192, 512]) {
  fs.writeFileSync(path.join(iconsDir, `icon-${size}.png`), makePNG(size));
  console.log(`✓ icon-${size}.png`);
}
console.log('Done.');
