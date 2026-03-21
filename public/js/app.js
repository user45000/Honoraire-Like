/**
 * App — Navigation, état global, chargement des tarifs
 */
const App = (() => {
  let currentTab = 'consultation';

  async function init() {
    // Charger les paramètres
    loadSettings();

    // Charger les tarifs
    await loadTarifs();

    // Initialiser les modules
    Consultation.init();
    Visite.init();
    CCAM.init();

    // Navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab);
      });
    });

    // Paramètres
    initParams();

    // Modal
    initModal();

    // Afficher l'onglet initial
    Consultation.onShow();
  }

  async function loadTarifs() {
    try {
      const basePath = getBasePath();
      const res = await fetch(`${basePath}api/tarifs`);
      const data = await res.json();
      Engine.setTarifs(data);
      CCAM.setActes(data.ccam || []);
    } catch (err) {
      console.error('Erreur chargement tarifs:', err);
    }
  }

  function getBasePath() {
    // Détecte si on est derrière un reverse proxy
    const path = window.location.pathname;
    const match = path.match(/^(\/[^/]+\/)/);
    if (match && match[1] !== '/') return match[1];
    return '/';
  }

  function switchTab(tabName) {
    currentTab = tabName;

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    const target = document.getElementById(`tab-${tabName}`);
    if (target) target.classList.add('active');

    // Update nav
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.nav-btn[data-tab="${tabName}"]`)?.classList.add('active');

    // Show/hide result bar (visible aussi sur CCAM si actes sélectionnés)
    const resultBar = document.getElementById('result-bar');
    if (tabName === 'consultation' || tabName === 'visite') {
      resultBar.style.display = '';
      if (tabName === 'consultation') Consultation.onShow();
      else Visite.onShow();
    } else if (tabName === 'ccam') {
      CCAM.onShow();
      // Afficher la barre si des actes sont sélectionnés
      const sel = CCAM.getSelectedActes();
      resultBar.style.display = sel.length > 0 ? '' : 'none';
    } else {
      resultBar.style.display = 'none';
    }
  }

  function updateResult(result) {
    const codesEl = document.getElementById('result-codes');
    const totalEl = document.getElementById('result-total');
    const amoAmcEl = document.getElementById('result-amo-amc');

    codesEl.textContent = result.codes.join(' + ');
    totalEl.textContent = result.total.toFixed(2).replace('.', ',') + '€';

    if (amoAmcEl && result.amo !== undefined) {
      const amoStr = result.amo.toFixed(2).replace('.', ',');
      const amcStr = result.amc.toFixed(2).replace('.', ',');
      amoAmcEl.textContent = `AMO ${amoStr}€ | AMC ${amcStr}€`;
    }
  }

  // === Paramètres ===
  function initParams() {
    // Secteur
    initToggleParam('secteur', 'hon_secteur', 's1');
    // Zone tarification
    initToggleParam('zone', 'hon_zone', 'metro', onZoneChange);
    // Géo
    initToggleParam('geo', 'hon_geo', 'plaine', onGeoChange);
  }

  function initToggleParam(field, storageKey, defaultVal, onChange) {
    const group = document.querySelector(`#tab-params .toggle-group[data-field="${field}"]`);
    if (!group) return;

    const saved = localStorage.getItem(storageKey) || defaultVal;

    // Restore saved state
    group.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = group.querySelector(`[data-value="${saved}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    group.addEventListener('click', (e) => {
      const btn = e.target.closest('.toggle-btn');
      if (!btn) return;
      group.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      localStorage.setItem(storageKey, btn.dataset.value);
      if (onChange) onChange(btn.dataset.value);
    });
  }

  function loadSettings() {
    // S'assurer que les défauts sont en place
    if (!localStorage.getItem('hon_secteur')) localStorage.setItem('hon_secteur', 's1');
    if (!localStorage.getItem('hon_zone')) localStorage.setItem('hon_zone', 'metro');
    if (!localStorage.getItem('hon_geo')) localStorage.setItem('hon_geo', 'plaine');
  }

  function onZoneChange() {
    // Recalculer les prix affichés
    Consultation.updateActePrices();
    Visite.updateActePrices();
    Visite.updateDeplacementPrices();
  }

  function onGeoChange() {
    Visite.updateDeplacementPrices();
  }

  // === Modal info ===
  function initModal() {
    const overlay = document.getElementById('modal-overlay');
    const closeBtn = document.getElementById('modal-close');

    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.remove('active');
  }

  /**
   * Appelé quand la sélection CCAM change
   * Recalcule sur l'onglet consultation ou visite actif
   */
  function onCCAMChanged() {
    const sel = CCAM.getSelectedActes();
    const resultBar = document.getElementById('result-bar');

    if (currentTab === 'ccam') {
      resultBar.style.display = sel.length > 0 ? '' : 'none';
    }

    // Toujours recalculer la consultation ou visite active
    if (currentTab === 'consultation' || currentTab === 'ccam') {
      Consultation.recalculate();
    } else if (currentTab === 'visite') {
      Visite.recalculate();
    }
  }

  function getCurrentTab() {
    return currentTab;
  }

  return { init, updateResult, switchTab, getBasePath, onCCAMChanged, getCurrentTab };
})();

/**
 * Affiche une modale d'info pour un acte (GL1, GL2, GL3)
 */
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showActeInfo(code) {
  const tarifs = Engine.getTarifs();
  if (!tarifs) return;

  const acte = tarifs.consultations[code];
  if (!acte || !acte.description) return;

  const zone = Engine.getZone();
  const prix = acte.tarifs[zone] || acte.tarifs.metro || 0;

  document.getElementById('modal-title').textContent = `${code} — ${acte.label}`;
  const body = document.getElementById('modal-body');
  body.innerHTML = '';
  const pTarif = document.createElement('p');
  pTarif.className = 'majo-detail-tarif';
  pTarif.textContent = prix.toFixed(2).replace('.', ',') + '€';
  const pDesc = document.createElement('p');
  pDesc.textContent = acte.description;
  body.appendChild(pTarif);
  body.appendChild(pDesc);
  document.getElementById('modal-overlay').classList.add('active');
}

/**
 * Affiche une modale d'info pour une majoration
 */
function showMajoInfo(code) {
  const tarifs = Engine.getTarifs();
  if (!tarifs) return;

  const majo = tarifs.majorations[code];
  if (!majo) return;

  document.getElementById('modal-title').textContent = `${code} — ${majo.label}`;
  const body = document.getElementById('modal-body');
  body.innerHTML = '';

  const pTarif = document.createElement('p');
  pTarif.className = 'majo-detail-tarif';
  pTarif.textContent = '+' + majo.tarif.toFixed(2).replace('.', ',') + '€';
  body.appendChild(pTarif);

  if (majo.description) {
    const pDesc = document.createElement('p');
    pDesc.textContent = majo.description;
    body.appendChild(pDesc);
  }

  if (majo.exclusifs) {
    const pExcl = document.createElement('p');
    pExcl.style.cssText = 'margin-top:8px;font-size:12px;color:#e74c3c';
    pExcl.textContent = 'Non cumulable avec : ' + majo.exclusifs.join(', ');
    body.appendChild(pExcl);
  }

  if (majo.applicableTo) {
    const pAppl = document.createElement('p');
    pAppl.style.cssText = 'margin-top:4px;font-size:12px;color:#5a6070';
    pAppl.textContent = 'Applicable à : ' + majo.applicableTo.join(', ');
    body.appendChild(pAppl);
  }

  document.getElementById('modal-overlay').classList.add('active');
}

// Démarrage
document.addEventListener('DOMContentLoaded', () => App.init());
