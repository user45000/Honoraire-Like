/**
 * Génère les icônes PWA et favicon — logo brand Honoraires MG
 * Croix médicale + stéthoscope sur fond dégradé bleu
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

function makeSvg(size) {
  const r = Math.round(size * 0.222); // border-radius proportionnel
  const s = size;
  return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0" y1="0" x2="${s}" y2="${s}" gradientUnits="userSpaceOnUse">
      <stop stop-color="#60A5FA"/>
      <stop offset="1" stop-color="#1B2D4F"/>
    </linearGradient>
  </defs>
  <rect width="${s}" height="${s}" rx="${r}" fill="url(#grad)"/>
  <!-- Croix médicale -->
  <rect x="${s*0.40}" y="${s*0.20}" width="${s*0.20}" height="${s*0.46}" rx="${s*0.04}" fill="white"/>
  <rect x="${s*0.27}" y="${s*0.33}" width="${s*0.46}" height="${s*0.20}" rx="${s*0.04}" fill="white"/>
  <!-- Arc stéthoscope -->
  <path d="M${s*0.50} ${s*0.66} C${s*0.50} ${s*0.80} ${s*0.70} ${s*0.80} ${s*0.70} ${s*0.72}"
    stroke="white" stroke-width="${s*0.045}" stroke-linecap="round" fill="none" opacity="0.75"/>
  <!-- Embout stéthoscope -->
  <circle cx="${s*0.70}" cy="${s*0.705}" r="${s*0.055}" fill="white" opacity="0.75"/>
</svg>`;
}

const iconsDir = path.join(__dirname, 'public', 'icons');
const publicDir = path.join(__dirname, 'public');

async function generate() {
  fs.mkdirSync(iconsDir, { recursive: true });

  const icons = [
    { file: 'icon-180.png', size: 180, dir: iconsDir },
    { file: 'icon-192.png', size: 192, dir: iconsDir },
    { file: 'icon-512.png', size: 512, dir: iconsDir },
    { file: 'favicon-32.png', size: 32,  dir: publicDir },
    { file: 'favicon-16.png', size: 16,  dir: publicDir },
  ];

  for (const { file, size, dir } of icons) {
    const svg = Buffer.from(makeSvg(size));
    await sharp(svg).png().toFile(path.join(dir, file));
    console.log(`✓ ${file} (${size}x${size})`);
  }

  // Favicon SVG pour navigateurs modernes (Chrome, Firefox, Safari)
  fs.writeFileSync(path.join(publicDir, 'favicon.svg'), makeSvg(64));
  console.log('✓ favicon.svg');

  console.log('Done.');
}

generate().catch(console.error);
