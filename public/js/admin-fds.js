// ════════════════════════════════════════════
// DÉFINITION DES ZONES
// ════════════════════════════════════════════
const GROUPS = [
  { title: 'Date consultation (haut droite)', zones: [
    { id:'DATE_TOP_Y', label:'Y',          type:'y',     def: 5.58 },
    { id:'DATE_TOP_X', label:'X (8 cases)',type:'arr_x', sz:8,
      def:[77.55,79.89,81.94,84.28,86.79,89.12,91.45,93.88] },
  ]},
  { title: 'Lignes d\'actes — Y', zones: [
    { id:'FDS_ROWS_Y', label:'Y des 4 lignes', type:'arr_y', sz:4,
      def:[72.35,75.14,77.94,80.73] },
  ]},
  { title: 'Date dans lignes', zones: [
    { id:'DATE_BOX_X', label:'X (8 cases)', type:'arr_x', sz:8,
      def:[5.91,7.66,9.13,10.88,12.81,14.56,16.31,18.06] },
  ]},
  { title: 'Codes actes', zones: [
    { id:'CCAM_BOX_X',    label:'CCAM X (7 chars)', type:'arr_x', sz:7,
      def:[19.71,22.06,24.54,26.94,29.42,31.89,34.4] },
    { id:'COL_ACTIVITE',  label:'Activité bord droit X',    type:'xr', def:37.5  },
    { id:'NGAP_RIGHT_X',  label:'NGAP code bord droit X',   type:'xr', def:44.9  },
    { id:'AUTRES_RIGHT_X',label:'Autres actes bord droit X',type:'xr', def:56.0  },
  ]},
  { title: 'Montants dans lignes', zones: [
    { id:'MT_RIGHT_X',   label:'Honoraires bord droit X',       type:'xr', def:70.99 },
    { id:'DEPL_CODE_X',  label:'Dépl. code X gauche',           type:'xl', def:76.5  },
    { id:'DEPL_RIGHT_X', label:'Dépl. montant bord droit X',    type:'xr', def:83.5  },
    { id:'IK_NBRE_X',    label:'IK nbre X gauche',              type:'xl', def:86.15 },
    { id:'IK_RIGHT_X',   label:'IK montant bord droit X',       type:'xr', def:93.15 },
  ]},
  { title: 'Total', zones: [
    { id:'TOT_RIGHT_X', label:'Total bord droit X', type:'xr', def:66.41 },
    { id:'TOT_Y',       label:'Total Y',            type:'y',  def:84.5  },
  ]},
  { title: 'Identification médecin', zones: [
    { id:'MED_LEFT_X',    label:'Tampon X gauche',            type:'xl', def:5.5  },
    { id:'MED_TOP_Y',     label:'Tampon Y',                   type:'y',  def:28.0 },
    { id:'REMP_NOM_LEFT', label:'Remplaçant nom X gauche',    type:'xl', def:14.5 },
    { id:'REMP_NOM_Y',    label:'Remplaçant nom Y',           type:'y',  def:37.0 },
    { id:'REMP_ID_LEFT',  label:'Remplaçant id X gauche',     type:'xl', def:13.0 },
    { id:'REMP_ID_Y',     label:'Remplaçant id Y',            type:'y',  def:38.7 },
  ]},
  { title: 'Cases à cocher', zones: [
    { id:'MALADIE_X', label:'Maladie ✓ X', type:'xl', def:6.0  },
    { id:'MALADIE_Y', label:'Maladie ✓ Y', type:'y',  def:43.2 },
    { id:'ACCES_X',   label:'Accès ✓ X',   type:'xl', def:93.2 },
    { id:'ACCES_Y',   label:'Accès ✓ Y',   type:'y',  def:61.5 },
  ]},
];

// ════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════
const SK = 'fds_calib_v3';
let S = {};
let activeId = null;
let arrIdx = 0;

function loadState() {
  try { const raw = localStorage.getItem(SK); if (raw) S = JSON.parse(raw); } catch(e){}
  GROUPS.forEach(g => g.zones.forEach(z => {
    if (!(z.id in S)) S[z.id] = Array.isArray(z.def) ? [...z.def] : z.def;
  }));
}
function save() { try { localStorage.setItem(SK, JSON.stringify(S)); } catch(e){} }

function resetAll() {
  if (!confirm('Remettre les valeurs par défaut ?')) return;
  localStorage.removeItem(SK); location.reload();
}

function findZone(id) {
  for (const g of GROUPS) for (const z of g.zones) if (z.id === id) return z;
  return null;
}

function allZones() {
  const out = [];
  GROUPS.forEach(g => g.zones.forEach(z => out.push(z)));
  return out;
}

// ════════════════════════════════════════════
// PANEL
// ════════════════════════════════════════════
function buildPanel() {
  const panel = document.getElementById('zones-panel');
  panel.innerHTML = '';
  GROUPS.forEach(g => {
    const t = document.createElement('div');
    t.className = 'grp-title';
    t.textContent = g.title;
    panel.appendChild(t);
    g.zones.forEach(z => panel.appendChild(buildRow(z)));
  });
}

function buildRow(z) {
  const row = document.createElement('div');
  row.className = 'zone-row';
  row.id = 'row-' + z.id;
  row.addEventListener('click', () => activate(z.id));

  const nm = document.createElement('div');
  nm.className = 'zone-name';
  nm.textContent = z.label;
  row.appendChild(nm);

  const cur = document.createElement('div');
  cur.className = 'zone-cur';
  cur.id = 'cur-' + z.id;
  row.appendChild(cur);

  const inps = document.createElement('div');
  inps.className = 'zone-inps';
  inps.addEventListener('click', e => e.stopPropagation());

  const v = S[z.id];
  if (Array.isArray(v)) {
    v.forEach((val, i) => {
      const w = document.createElement('div'); w.className = 'zi';
      const l = document.createElement('label'); l.textContent = i;
      const inp = document.createElement('input');
      inp.type = 'number'; inp.step = '0.01'; inp.value = (+val).toFixed(2);
      inp.id = 'inp-' + z.id + '-' + i;
      inp.addEventListener('change', () => {
        S[z.id][i] = +inp.value; save(); refreshCur(z); render();
      });
      w.appendChild(l); w.appendChild(inp); inps.appendChild(w);
    });
  } else {
    const w = document.createElement('div'); w.className = 'zi';
    const inp = document.createElement('input');
    inp.type = 'number'; inp.step = '0.01'; inp.value = (+v).toFixed(2);
    inp.id = 'inp-' + z.id;
    inp.addEventListener('change', () => {
      S[z.id] = +inp.value; save(); refreshCur(z); render();
    });
    w.appendChild(inp); inps.appendChild(w);
  }

  row.appendChild(inps);
  refreshCur(z);
  return row;
}

function refreshCur(z) {
  const el = document.getElementById('cur-' + z.id);
  if (!el) return;
  const v = S[z.id];
  el.textContent = Array.isArray(v)
    ? v.map(n => (+n).toFixed(1)).join(' · ')
    : (+v).toFixed(2) + '%';
}

function setInp(zid, idx, val) {
  const id = idx !== null ? ('inp-' + zid + '-' + idx) : ('inp-' + zid);
  const el = document.getElementById(id);
  if (el) el.value = (+val).toFixed(2);
}

// ════════════════════════════════════════════
// ACTIVATE
// ════════════════════════════════════════════
function activate(id) {
  if (activeId) document.getElementById('row-' + activeId)?.classList.remove('active');
  activeId = id; arrIdx = 0;
  const row = document.getElementById('row-' + id);
  if (row) { row.classList.add('active'); row.scrollIntoView({ block: 'nearest' }); }
  updateHint();
  render();
}

function updateHint() {
  const el = document.getElementById('active-hint');
  if (!activeId) { el.textContent = '\u2190 S\u00e9lectionne une zone puis clique l\'image'; return; }
  const z = findZone(activeId);
  const v = S[activeId];
  if (Array.isArray(v)) el.textContent = z.label + ' \u2014 clic ' + (arrIdx+1) + '/' + v.length;
  else el.textContent = z.label + ' \u2014 cliquer pour placer (' + (z.type === 'y' ? 'Y' : 'X') + ')';
}

// ════════════════════════════════════════════
// IMAGE EVENTS
// ════════════════════════════════════════════
function getCoords(e) {
  const r = document.getElementById('form-img').getBoundingClientRect();
  return {
    x: parseFloat(((e.clientX - r.left) / r.width  * 100).toFixed(2)),
    y: parseFloat(((e.clientY - r.top)  / r.height * 100).toFixed(2))
  };
}

function initImageEvents() {
  const wrap = document.getElementById('form-wrap');

  wrap.addEventListener('mousemove', function(e) {
    const { x, y } = getCoords(e);
    document.getElementById('coords-live').textContent = 'X:' + x.toFixed(2) + '%  Y:' + y.toFixed(2) + '%';
    const r = this.getBoundingClientRect();
    document.getElementById('ch').style.cssText = 'top:' + (e.clientY - r.top) + 'px;opacity:1';
    document.getElementById('cv').style.cssText = 'left:' + (e.clientX - r.left) + 'px;opacity:1';
  });

  wrap.addEventListener('mouseleave', function() {
    document.getElementById('ch').style.opacity = '0';
    document.getElementById('cv').style.opacity = '0';
  });

  wrap.addEventListener('click', function(e) {
    const { x, y } = getCoords(e);
    if (!activeId) return;
    const z = findZone(activeId);
    const v = S[activeId];

    if (Array.isArray(v)) {
      const coord = z.type === 'arr_y' ? y : x;
      v[arrIdx] = coord;
      setInp(activeId, arrIdx, coord);
      arrIdx = (arrIdx + 1) % v.length;
    } else if (z.type === 'y') {
      S[activeId] = y; setInp(activeId, null, y);
    } else {
      S[activeId] = x; setInp(activeId, null, x);
    }

    save(); refreshCur(z); updateHint(); render();
  });
}

// ════════════════════════════════════════════
// PREVIEW
// ════════════════════════════════════════════
function mkDiv(cls, style, html) {
  return '<div class="fds-fill ' + cls + '" style="' + style + '">' + html + '</div>';
}
function L(x)  { return 'left:'  + (+x).toFixed(2) + '%;'; }
function R(x)  { return 'right:' + (100 - (+x)).toFixed(2) + '%;'; }
function T(y)  { return 'top:'   + (+y).toFixed(2) + '%;'; }
function RT()  { return 'text-align:right;'; }

const DATE8 = ['2','7','0','3','2','0','2','6'];

function renderPreview() {
  const layer = document.getElementById('preview-layer');
  const img = document.getElementById('form-img');
  layer.style.setProperty('--fds-scale', (img.offsetWidth / 617.5).toFixed(3));

  let h = '';

  // Date consultation haut droite
  DATE8.forEach((c, i) => {
    const x = S.DATE_TOP_X && S.DATE_TOP_X[i];
    if (x != null) h += mkDiv('fd-digit', L(x) + T(S.DATE_TOP_Y), c);
  });

  const rows = S.FDS_ROWS_Y || [];

  // Ligne 1 : CCAM + déplacement + IK
  if (rows[0] != null) {
    const y = rows[0];
    DATE8.forEach((c, i) => {
      const x = S.DATE_BOX_X && S.DATE_BOX_X[i];
      if (x != null) h += mkDiv('fd-digit', L(x) + T(y), c);
    });
    ['Q','Z','G','A','0','1','0'].forEach((c, j) => {
      const x = S.CCAM_BOX_X && S.CCAM_BOX_X[j];
      if (x != null) h += mkDiv('fd-digit', L(x) + T(y), c);
    });
    if (S.COL_ACTIVITE != null) h += mkDiv('fd-digit', R(S.COL_ACTIVITE) + T(y) + RT(), '1');
    if (S.MT_RIGHT_X   != null) h += mkDiv('fd-digit', R(S.MT_RIGHT_X)   + T(y) + RT(), '25,00');
    if (S.DEPL_CODE_X  != null) h += mkDiv('fd-code',  L(S.DEPL_CODE_X)  + T(y), 'ID');
    if (S.DEPL_RIGHT_X != null) h += mkDiv('fd-digit', R(S.DEPL_RIGHT_X) + T(y) + RT(), '3,50');
    if (S.IK_NBRE_X    != null) h += mkDiv('fd-digit', L(S.IK_NBRE_X)    + T(y), '12');
    if (S.IK_RIGHT_X   != null) h += mkDiv('fd-digit', R(S.IK_RIGHT_X)   + T(y) + RT(), '4,20');
  }

  // Ligne 2 : NGAP G
  if (rows[1] != null) {
    const y = rows[1];
    DATE8.forEach((c, i) => {
      const x = S.DATE_BOX_X && S.DATE_BOX_X[i];
      if (x != null) h += mkDiv('fd-digit', L(x) + T(y), c);
    });
    if (S.NGAP_RIGHT_X != null) h += mkDiv('fd-code',  R(S.NGAP_RIGHT_X) + T(y) + RT(), 'G');
    if (S.MT_RIGHT_X   != null) h += mkDiv('fd-digit', R(S.MT_RIGHT_X)   + T(y) + RT(), '30,00');
  }

  // Ligne 3 : autre acte MPC
  if (rows[2] != null) {
    const y = rows[2];
    DATE8.forEach((c, i) => {
      const x = S.DATE_BOX_X && S.DATE_BOX_X[i];
      if (x != null) h += mkDiv('fd-digit', L(x) + T(y), c);
    });
    if (S.AUTRES_RIGHT_X != null) h += mkDiv('fd-code',  R(S.AUTRES_RIGHT_X) + T(y) + RT(), 'MPC');
    if (S.MT_RIGHT_X     != null) h += mkDiv('fd-digit', R(S.MT_RIGHT_X)     + T(y) + RT(), '5,00');
  }

  // Total
  if (S.TOT_RIGHT_X != null && S.TOT_Y != null)
    h += mkDiv('fd-digit', R(S.TOT_RIGHT_X) + T(S.TOT_Y) + RT() + 'font-weight:900;', '55,00');

  // Médecin tampon
  if (S.MED_LEFT_X != null && S.MED_TOP_Y != null)
    h += mkDiv('fd-med', L(S.MED_LEFT_X) + T(S.MED_TOP_Y), 'Dr Dupont Jean<br>123 rue de la Paix 75001');

  // Remplaçant
  if (S.REMP_NOM_LEFT != null && S.REMP_NOM_Y != null)
    h += mkDiv('fd-med', L(S.REMP_NOM_LEFT) + T(S.REMP_NOM_Y), 'Dr Martin Sophie');
  if (S.REMP_ID_LEFT != null && S.REMP_ID_Y != null)
    h += mkDiv('fd-med', L(S.REMP_ID_LEFT) + T(S.REMP_ID_Y), '10012345678');

  // Cases
  if (S.MALADIE_X != null && S.MALADIE_Y != null)
    h += mkDiv('fd-check', L(S.MALADIE_X) + T(S.MALADIE_Y), '\u2713');
  if (S.ACCES_X != null && S.ACCES_Y != null)
    h += mkDiv('fd-check', L(S.ACCES_X) + T(S.ACCES_Y), '\u2713');

  layer.innerHTML = h;
}

// ════════════════════════════════════════════
// MARKERS
// ════════════════════════════════════════════
const MC = { xl:'#fb923c', xr:'#34d399', y:'#60a5fa', arr_x:'#f472b6', arr_y:'#a78bfa' };

function renderMarkers() {
  const layer = document.getElementById('markers-layer');
  if (!document.getElementById('chk-markers').checked) { layer.innerHTML = ''; return; }
  let h = '';

  allZones().forEach(z => {
    const v = S[z.id];
    const act = z.id === activeId;
    const col = act ? '#fbbf24' : (MC[z.type] || '#94a3b8');
    const op  = act ? 0.85 : 0.3;
    const lw  = act ? 1.5 : 0.8;

    if (Array.isArray(v)) {
      const ry = refY(z.id);
      v.forEach((val, i) => {
        if (z.type === 'arr_y') {
          h += mkLine(0, +val, 100, +val, col, op, lw);
          if (act) h += mkLbl(1, +val, i + ': ' + (+val).toFixed(1) + '%', col, true);
        } else {
          h += mkDot(+val, ry, col, act && i === arrIdx);
          if (act) h += mkLbl(+val, ry - 2, i + ':' + (+val).toFixed(1), col, false);
        }
      });
    } else if (z.type === 'y') {
      h += mkLine(0, +v, 100, +v, col, op, lw);
      if (act) h += mkLbl(1, +v, z.id + ' ' + (+v).toFixed(2) + '%', col, true);
    } else {
      h += mkLine(+v, 0, +v, 100, col, op, lw);
      if (act) h += mkLbl(+v, 2, z.id + ' ' + (+v).toFixed(2) + '%', col, false);
    }
  });

  layer.innerHTML = h;
}

function refY(zid) {
  if (zid === 'DATE_TOP_X') return S.DATE_TOP_Y || 5.58;
  if (zid === 'DATE_BOX_X' || zid === 'CCAM_BOX_X') return (S.FDS_ROWS_Y && S.FDS_ROWS_Y[0]) || 72;
  return 50;
}

function mkLine(x1, y1, x2, y2, col, op, w) {
  if (x1 === x2) return '<div style="position:absolute;left:' + x1 + '%;top:0;bottom:0;width:' + w + 'px;background:' + col + ';opacity:' + op + '"></div>';
  return '<div style="position:absolute;top:' + y1 + '%;left:0;right:0;height:' + w + 'px;background:' + col + ';opacity:' + op + '"></div>';
}
function mkDot(x, y, col, big) {
  const s = big ? 9 : 5;
  return '<div style="position:absolute;left:' + x + '%;top:' + y + '%;width:' + s + 'px;height:' + s + 'px;border-radius:50%;background:' + col + ';border:1px solid white;transform:translate(-50%,-50%)"></div>';
}
function mkLbl(x, y, txt, col, rt) {
  const tr = rt ? 'translate(3px,-50%)' : 'translate(-50%,3px)';
  return '<div style="position:absolute;left:' + x + '%;top:' + y + '%;font-size:8px;font-family:monospace;background:rgba(0,0,0,.85);color:' + col + ';padding:1px 3px;transform:' + tr + ';white-space:nowrap;border-radius:2px">' + txt + '</div>';
}

function render() { renderPreview(); renderMarkers(); }

// ════════════════════════════════════════════
// EXPORT
// ════════════════════════════════════════════
function fv(v) {
  if (Array.isArray(v)) return '[' + v.map(n => (+n).toFixed(2)).join(', ') + ']';
  return (+v).toFixed(2);
}

function openExport() {
  document.getElementById('export-pre').textContent = [
    '// \u2500\u2500 Constantes FDS calibr\u00e9es \u2014 coller dans app.js \u2500\u2500',
    '',
    'const DATE_TOP_Y      = ' + fv(S.DATE_TOP_Y) + ';',
    'const DATE_TOP_X      = ' + fv(S.DATE_TOP_X) + ';',
    'const FDS_ROWS_Y      = ' + fv(S.FDS_ROWS_Y) + ';',
    'const DATE_BOX_X      = ' + fv(S.DATE_BOX_X) + ';',
    'const CCAM_BOX_X      = ' + fv(S.CCAM_BOX_X) + ';',
    'const COL_ACTIVITE    = ' + fv(S.COL_ACTIVITE) + ';',
    'const NGAP_RIGHT_X    = ' + fv(S.NGAP_RIGHT_X) + ';',
    'const AUTRES_RIGHT_X  = ' + fv(S.AUTRES_RIGHT_X) + ';',
    'const MT_RIGHT_X      = ' + fv(S.MT_RIGHT_X) + ';',
    'const DEPL_CODE_X     = ' + fv(S.DEPL_CODE_X) + ';',
    'const DEPL_RIGHT_X    = ' + fv(S.DEPL_RIGHT_X) + ';',
    'const IK_NBRE_X       = ' + fv(S.IK_NBRE_X) + ';',
    'const IK_RIGHT_X      = ' + fv(S.IK_RIGHT_X) + ';',
    'const TOT_RIGHT_X     = ' + fv(S.TOT_RIGHT_X) + ';',
    'const TOT_Y           = ' + fv(S.TOT_Y) + ';',
    '',
    '// Dans openFDS() \u2014 positions m\u00e9decin :',
    '// Tampon      left:' + fv(S.MED_LEFT_X) + '%    top:' + fv(S.MED_TOP_Y) + '%',
    '// Remp. nom   left:' + fv(S.REMP_NOM_LEFT) + '%   top:' + fv(S.REMP_NOM_Y) + '%',
    '// Remp. id    left:' + fv(S.REMP_ID_LEFT) + '%   top:' + fv(S.REMP_ID_Y) + '%',
    '',
    '// Cases \u00e0 cocher :',
    '// Maladie     x:' + fv(S.MALADIE_X) + '  y:' + fv(S.MALADIE_Y),
    '// Acc\u00e8s       x:' + fv(S.ACCES_X) + '  y:' + fv(S.ACCES_Y),
  ].join('\n');
  document.getElementById('modal').style.display = 'block';
  document.getElementById('modal-bg').style.display = 'block';
  document.getElementById('copy-ok').style.display = 'none';
}

function closeExport() {
  document.getElementById('modal').style.display = 'none';
  document.getElementById('modal-bg').style.display = 'none';
}

function copyExport() {
  navigator.clipboard.writeText(document.getElementById('export-pre').textContent).then(() => {
    document.getElementById('copy-ok').style.display = 'inline';
  });
}

// ════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  loadState();
  buildPanel();
  initImageEvents();

  document.getElementById('btn-reset').addEventListener('click', resetAll);
  document.getElementById('btn-export').addEventListener('click', openExport);
  document.getElementById('btn-close-modal').addEventListener('click', closeExport);
  document.getElementById('btn-copy').addEventListener('click', copyExport);
  document.getElementById('modal-bg').addEventListener('click', closeExport);
  document.getElementById('chk-markers').addEventListener('change', render);

  const img = document.getElementById('form-img');
  if (img.complete && img.naturalWidth > 0) {
    render();
  } else {
    img.addEventListener('load', render);
  }

  new ResizeObserver(render).observe(img);
});
