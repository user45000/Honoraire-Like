#!/usr/bin/env node
/**
 * Réapplique les valeurs calibrées de fds-calib.json dans app.js.
 * Appelé automatiquement après chaque git pull (via deploy.sh).
 */
const fs = require('fs');
const path = require('path');

const ROOT       = path.join(__dirname, '..');
const CALIB_FILE = path.join(ROOT, 'data', 'fds-calib.json');
const APP_JS     = path.join(ROOT, 'public', 'js', 'app.js');

const SCALAR = [
  'DATE_TOP_Y','COL_ACTIVITE','NGAP_RIGHT_X','AUTRES_RIGHT_X',
  'MT_RIGHT_X','DEPL_CODE_X','DEPL_RIGHT_X','IK_NBRE_X','IK_RIGHT_X',
  'TOT_RIGHT_X','TOT_Y',
  'MED_LEFT_X','MED_TOP_Y','REMP_NOM_LEFT','REMP_NOM_Y','REMP_ID_LEFT','REMP_ID_Y',
  'MALADIE_X','MALADIE_Y','ACCES_X','ACCES_Y',
  'APC_MT_X','APC_MT_Y',
];
const ARRAY = ['DATE_TOP_X','FDS_ROWS_Y','DATE_BOX_X','CCAM_BOX_X'];

if (!fs.existsSync(CALIB_FILE)) {
  console.log('Pas de fds-calib.json — valeurs par défaut conservées.');
  process.exit(0);
}

const vals = JSON.parse(fs.readFileSync(CALIB_FILE, 'utf8')).values;
let content = fs.readFileSync(APP_JS, 'utf8');

SCALAR.forEach(name => {
  if (!(name in vals)) return;
  content = content.replace(
    new RegExp('(const ' + name + '\\s*=\\s*)[\\d.]+'),
    '$1' + (+vals[name]).toFixed(2)
  );
});
ARRAY.forEach(name => {
  if (!(name in vals) || !Array.isArray(vals[name])) return;
  content = content.replace(
    new RegExp('(const ' + name + '\\s*=\\s*)\\[[^\\]]+\\]'),
    '$1[' + vals[name].map(v => (+v).toFixed(2)).join(', ') + ']'
  );
});

fs.writeFileSync(APP_JS, content);
console.log('Calibration FDS restaurée depuis fds-calib.json');
