/**
 * Génère les icônes PNG pour la PWA Honoraires MG
 * Design : dégradé navy diagonal + € en blanc avec anti-aliasing SDF
 */
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── PNG utils ──────────────────────────────────────────────────────────────
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; }
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([u32(data.length), t, data, crc]);
}

// ── Math helpers ───────────────────────────────────────────────────────────
const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const lerp   = (a, b, t) => a + (b - a) * clamp(t);
const smooth = (lo, hi, x) => { const t = clamp((x-lo)/(hi-lo)); return t*t*(3-2*t); };

// SDF : distance point → segment (donne une capsule arrondie)
function sdSeg(px, py, ax, ay, bx, by) {
  const dx = bx-ax, dy = by-ay, d2 = dx*dx+dy*dy;
  const t  = d2 > 0 ? clamp(((px-ax)*dx+(py-ay)*dy)/d2) : 0;
  return Math.hypot(ax+t*dx-px, ay+t*dy-py);
}

// ── SDF du symbole € ───────────────────────────────────────────────────────
// Coordonnées normalisées : centre = (0,0), plage ≈ [-1, 1]
function sdfEuro(x, y) {
  const R      = 0.40;   // rayon de l'arc
  const sw     = 0.095;  // demi-épaisseur de l'arc
  const barSw  = 0.060;  // demi-hauteur des barres
  const openA  = 0.72;   // demi-angle d'ouverture à droite (~41°)

  // Arc (cercle masqué dans l'ouverture droite)
  const r   = Math.hypot(x, y);
  const ang = Math.atan2(y, x);
  const arcD = Math.abs(ang) < openA ? Infinity : Math.abs(r - R) - sw;

  // Barres horizontales (capsules)
  const bLeft  = -(R + sw + 0.03);
  const bRight =  R * Math.cos(openA) + 0.01;
  const b1D = sdSeg(x, y, bLeft, -0.108, bRight, -0.108) - barSw;
  const b2D = sdSeg(x, y, bLeft,  0.122, bRight,  0.122) - barSw;

  return Math.min(arcD, b1D, b2D);
}

// ── Dégradé diagonal ────────────────────────────────────────────────────────
// top-left #4a6fa5  →  bottom-right #1a2847
function gradient(nx, ny) {
  const t = ((nx + 1) + (ny + 1)) / 4; // 0 = top-left, 1 = bottom-right
  return [lerp(0x4a, 0x1a, t), lerp(0x6f, 0x28, t), lerp(0xa5, 0x47, t)];
}

// ── Rendu d'un pixel ────────────────────────────────────────────────────────
function renderPixel(x, y, size) {
  // Coordonnées normalisées centrées [-1, 1]
  const nx = (x / size) * 2 - 1;
  const ny = (y / size) * 2 - 1;

  const [bgR, bgG, bgB] = gradient(nx, ny);

  // Décalage léger du € vers la gauche pour équilibre visuel
  const d = sdfEuro(nx + 0.03, ny);

  // Anti-aliasing : ~1.8 px de fondu
  const aa    = (2.0 / size) * 1.8;
  const alpha = 1 - smooth(-aa, aa, d);

  return [
    Math.round(lerp(bgR, 255, alpha)),
    Math.round(lerp(bgG, 255, alpha)),
    Math.round(lerp(bgB, 255, alpha)),
  ];
}

// ── Construction PNG ────────────────────────────────────────────────────────
function makePNG(size) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = [0]; // filtre PNG : None
    for (let x = 0; x < size; x++) row.push(...renderPixel(x, y, size));
    rows.push(...row);
  }
  const raw  = Buffer.from(rows);
  const sig  = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = chunk('IHDR', Buffer.concat([u32(size), u32(size), Buffer.from([8,2,0,0,0])]));
  const idat = chunk('IDAT', zlib.deflateSync(raw));
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

// ── Génération ──────────────────────────────────────────────────────────────
const iconsDir = path.join(__dirname, 'public', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

for (const size of [180, 192, 512]) {
  fs.writeFileSync(path.join(iconsDir, `icon-${size}.png`), makePNG(size));
  console.log(`✓ icon-${size}.png`);
}
console.log('Icônes générées dans public/icons/');
