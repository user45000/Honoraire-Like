/**
 * App — Navigation, état global, chargement des tarifs
 */
const App = (() => {
  let currentTab = 'consultation';
  let currentRelation = 'mt';
  let ccamContext = 'consultation'; // dernier onglet consultation/visite avant CCAM

  async function init() {
    // Charger les paramètres
    loadSettings();

    // Charger les tarifs
    await loadTarifs();

    // Initialiser les modules
    Consultation.init();
    Visite.init();
    CCAM.init();
    await Account.init();

    // Navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab);
      });
    });

    // Période horaire partagée
    const periodeShared = document.getElementById('periode-shared');
    periodeShared.addEventListener('click', (e) => {
      const btn = e.target.closest('.toggle-btn');
      if (!btn) return;
      periodeShared.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const value = btn.dataset.value;
      Consultation.setPeriode(value);
      Visite.setPeriode(value);
      applyPDSAMode(value);
    });

    // Mode de garde partagé
    const modeBarGroup = document.getElementById('mode-bar-group');
    modeBarGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('.toggle-btn');
      if (!btn) return;
      modeBarGroup.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const value = btn.dataset.value;
      if (currentTab === 'consultation') {
        Consultation.setMode(value);
      } else if (currentTab === 'visite') {
        Visite.setMode(value);
      }
    });

    // Heure et jour partagés (auto-détection période + SHE)
    const heureInput = document.getElementById('heure-input');
    const jourInput = document.getElementById('jour-input');
    const nowBadge = document.getElementById('now-badge');
    const resetNowBtn = document.getElementById('reset-now-btn');

    function setNow() {
      const now = new Date();
      heureInput.value = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
      // JS getDay(): 0=dim,1=lun..6=sam → notre: 0=lun..5=sam,6=dim
      jourInput.value = (now.getDay() === 0 ? 6 : now.getDay() - 1).toString();
      Consultation.setHeure(now.getHours());
      Visite.setHeure(now.getHours());
      applyAutoPeriode();
    }

    function setManual() {
      nowBadge.style.display = 'none';
      resetNowBtn.style.display = '';
    }

    setNow();

    heureInput.addEventListener('change', () => {
      const parts = heureInput.value.split(':');
      const h = parts.length >= 1 ? parseInt(parts[0], 10) : null;
      Consultation.setHeure(h);
      Visite.setHeure(h);
      applyAutoPeriode();
      setManual();
    });
    jourInput.addEventListener('change', () => {
      applyAutoPeriode();
      setManual();
    });

    resetNowBtn.addEventListener('click', () => {
      setNow();
      resetNowBtn.style.display = 'none';
      nowBadge.style.display = '';
    });

    // Info périodes → modal bottom-sheet (même pattern que les autres i)
    document.getElementById('periode-info-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('modal-title').textContent = 'Périodes de garde';
      document.getElementById('modal-body').innerHTML = `
        <div class="pinfo-row"><span class="pinfo-chip">Jour</span><span class="pinfo-detail">Lun–Ven 8h–20h · Sam 8h–12h</span></div>
        <div class="pinfo-row"><span class="pinfo-chip">WE/Férié</span><span class="pinfo-detail">Sam 12h–20h · Dim &amp; fériés 8h–20h</span></div>
        <div class="pinfo-row"><span class="pinfo-chip">Nuit</span><span class="pinfo-detail">Tous jours 6h–8h et 20h–0h</span></div>
        <div class="pinfo-row"><span class="pinfo-chip">Nuit prof.</span><span class="pinfo-detail">Tous jours 0h–6h</span></div>
      `;
      document.getElementById('modal-overlay').classList.add('active');
    });

    // Adresse cabinet
    const cabinetInput = document.getElementById('cabinet-address');
    const cabinetSuggestions = document.getElementById('cabinet-suggestions');
    const cabinetSaved = document.getElementById('cabinet-saved');
    cabinetInput.value = localStorage.getItem('hon_cabinet_address') || '';

    let cabinetDebounce = null;
    cabinetInput.addEventListener('input', () => {
      clearTimeout(cabinetDebounce);
      const q = cabinetInput.value.trim();
      if (q.length < 3) { cabinetSuggestions.hidden = true; return; }
      cabinetDebounce = setTimeout(() => fetchAddressSuggestions(q, cabinetSuggestions, cabinetInput, cabinetSaved), 300);
    });

    cabinetInput.addEventListener('blur', () => {
      setTimeout(() => { cabinetSuggestions.hidden = true; }, 200);
      saveCabinetAddress(cabinetInput, cabinetSaved);
    });

    cabinetInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { cabinetSuggestions.hidden = true; saveCabinetAddress(cabinetInput, cabinetSaved); }
    });

    // Paramètres
    initParams();

    // Modal
    initModal();

    // Mode simple/complet
    initViewMode();

    // Patientèle (MT / hors patientèle)
    initRelation();

    // Barre contexte CCAM — clic pour basculer entre cabinet et visite
    document.getElementById('ccam-context-bar')?.addEventListener('click', () => {
      ccamContext = ccamContext === 'visite' ? 'consultation' : 'visite';
      updateCCAMContextBar();
      onCCAMChanged();
    });

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

  // ── Bannière installation PWA ────────────────────────────────────────────
  const _isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const _isInstalled = window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;

  function updateInstallBanner(tabName) {
    const banner = document.getElementById('pwa-install-banner');
    if (!banner) return;
    const dismissed = localStorage.getItem('hon_install_dismissed') === '1';
    const shouldShow = tabName === 'params' && _isIOS && !_isInstalled && !dismissed;
    banner.style.display = shouldShow ? 'flex' : 'none';
  }

  document.getElementById('pwa-install-close')?.addEventListener('click', () => {
    localStorage.setItem('hon_install_dismissed', '1');
    document.getElementById('pwa-install-banner').style.display = 'none';
  });

  function switchTab(tabName) {
    const prevTab = currentTab;
    currentTab = tabName;
    window.scrollTo(0, 0);

    // Mémoriser le contexte consultation/visite quand on entre dans CCAM
    if (tabName === 'ccam') {
      if (prevTab === 'consultation' || prevTab === 'visite') {
        ccamContext = prevTab;
      }
      updateCCAMContextBar();
    }
    updateInstallBanner(tabName);

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    const target = document.getElementById(`tab-${tabName}`);
    if (target) target.classList.add('active');

    // Update nav
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.nav-btn[data-tab="${tabName}"]`)?.classList.add('active');

    // Show/hide result bar + période/mode bars
    const resultBar = document.getElementById('result-bar');
    const periodeBar = document.querySelector('.periode-bar');
    if (tabName === 'consultation' || tabName === 'visite') {
      resultBar.style.display = '';
      periodeBar.style.display = '';
      if (tabName === 'consultation') Consultation.onShow();
      else Visite.onShow();
    } else if (tabName === 'ccam') {
      CCAM.onShow();
      periodeBar.style.display = 'none';
      document.getElementById('mode-bar').classList.remove('visible');
      resultBar.style.display = '';
    } else {
      resultBar.style.display = 'none';
      periodeBar.style.display = 'none';
      document.getElementById('mode-bar').classList.remove('visible');
      if (tabName === 'compte') Account.onShow();
    }
  }

  function updateResult(result) {
    const codesEl = document.getElementById('result-codes');
    const totalEl = document.getElementById('result-total');
    const amoAmcEl = document.getElementById('result-amo-amc');

    // En onglet CCAM : afficher tous les codes du résultat (G + DEQP003, ou acte isolé seul)
    if (currentTab === 'ccam') {
      const ccamSel = CCAM.getSelectedActes();
      if (ccamSel.length === 0) {
        codesEl.textContent = '';
        totalEl.textContent = '0,00€';
        if (amoAmcEl) amoAmcEl.textContent = '';
      } else {
        codesEl.textContent = result.codes.join(' + ');
        totalEl.textContent = result.total.toFixed(2).replace('.', ',') + '€';
        if (amoAmcEl) {
          amoAmcEl.textContent = result.amo !== undefined
            ? `AMO ${result.amo.toFixed(2).replace('.', ',')}€ | AMC ${result.amc.toFixed(2).replace('.', ',')}€`
            : '';
        }
      }
      return;
    }

    codesEl.textContent = result.codes.join(' + ');
    totalEl.textContent = result.total.toFixed(2).replace('.', ',') + '€';
    if (amoAmcEl) {
      if (result.amo !== undefined) {
        const amoStr = result.amo.toFixed(2).replace('.', ',');
        const amcStr = result.amc.toFixed(2).replace('.', ',');
        amoAmcEl.textContent = `AMO ${amoStr}€ | AMC ${amcStr}€`;
      } else {
        amoAmcEl.textContent = '';
      }
    }
  }

  function updateModeBar(visible, mode) {
    const modeBar = document.getElementById('mode-bar');
    const group = document.getElementById('mode-bar-group');
    if (visible) {
      group.querySelectorAll('.toggle-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.value === mode);
      });
      modeBar.classList.add('visible');
    } else {
      modeBar.classList.remove('visible');
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
    // Mode à l'ouverture
    initToggleParam('startup_mode', 'hon_startup_mode', 'simple');
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

  function saveCabinetAddress(input, savedEl) {
    const val = input.value.trim();
    if (!val) return;
    localStorage.setItem('hon_cabinet_address', val);
    savedEl.textContent = '✓ Adresse enregistrée';
    savedEl.classList.remove('fade');
    clearTimeout(savedEl._fadeTimer);
    savedEl._fadeTimer = setTimeout(() => {
      savedEl.classList.add('fade');
      setTimeout(() => { savedEl.textContent = ''; savedEl.classList.remove('fade'); }, 500);
    }, 2000);
  }

  async function fetchAddressSuggestions(q, listEl, input, savedEl) {
    try {
      const res = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=5`);
      const data = await res.json();
      listEl.innerHTML = '';
      if (!data.features || data.features.length === 0) { listEl.hidden = true; return; }
      data.features.forEach(f => {
        const li = document.createElement('li');
        li.textContent = f.properties.label;
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          input.value = f.properties.label;
          listEl.hidden = true;
          saveCabinetAddress(input, savedEl);
        });
        listEl.appendChild(li);
      });
      listEl.hidden = false;
    } catch (_) { listEl.hidden = true; }
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

  // === Patientèle (MT / hors patientèle) ===
  function initRelation() {
    const saved = localStorage.getItem('hon_relation') || 'mt';
    applyRelation(saved, true);

    // Écoute tous les [data-field="relation"] (consultation + visite)
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.toggle-btn');
      if (!btn) return;
      if (!btn.closest('[data-field="relation"]')) return;
      applyRelation(btn.dataset.value, true);
    });
  }

  function applyRelation(value, notify) {
    currentRelation = value;
    localStorage.setItem('hon_relation', value);
    // Sync tous les toggles relation (les deux onglets)
    document.querySelectorAll('[data-field="relation"] .toggle-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.value === value);
    });
    if (notify) {
      Consultation.setRelation(value);
      Visite.setRelation(value);
    }
  }

  function getRelation() {
    return currentRelation;
  }

  // === Mode simple / complet ===
  function initViewMode() {
    const toggle = document.querySelector('.app-header');
    // Toujours démarrer avec le mode configuré dans les paramètres (défaut : simple)
    const startMode = localStorage.getItem('hon_startup_mode') || 'simple';
    applyViewMode(startMode);
    toggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.vmt-btn');
      if (!btn) return;
      applyViewMode(btn.dataset.mode);
    });
    // Boutons fléchés dans les sections (bascule simple ↔ complet)
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.js-switch-complet');
      if (!btn) return;
      e.stopPropagation();
      const targetMode = document.body.classList.contains('mode-simple') ? 'complet' : 'simple';
      applyViewMode(targetMode);
    });
  }

  function applyViewMode(mode) {
    const isSimple = mode === 'simple';
    document.body.classList.toggle('mode-simple', isSimple);
    document.querySelectorAll('.vmt-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    // Si un acte avancé était sélectionné et qu'on passe en mode simple → reset sur G
    if (isSimple) {
      const activeActe = document.querySelector('#consult-acte-grid .acte-btn.active');
      if (activeActe && activeActe.dataset.advanced === 'true') {
        document.querySelector('#consult-acte-grid .acte-btn[data-acte="G"]').click();
      }
    }
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
    // Recalcul avec le contexte mémorisé (consultation ou visite)
    if (ccamContext === 'visite') {
      Visite.recalculate();
    } else {
      Consultation.recalculate();
    }
  }

  function getCurrentTab() {
    return currentTab;
  }

  // === Auto-détection période selon jour + heure (NGAP) ===
  function computePeriodeFromJourHeure(jour, heure) {
    // jour: 0=Lun..4=Ven, 5=Sam, 6=Dim, 7=Férié
    if (heure < 6) return 'nuitprofonde';             // 0h-6h → Nuit profonde (MM), tous les jours
    if (heure < 8 || heure >= 20) return 'nuit';      // 6h-8h ou 20h-24h → Nuit (MN), tous les jours
    if (jour >= 6) return 'dimferie';                 // Dimanche ou Jour férié (8h-20h)
    if (jour === 5 && heure >= 12) return 'samediAM';  // Samedi 12h-20h → PDSA (CRS/VRS)
    return 'jour';                                    // Reste → Jour
  }

  function applyPDSAMode(periode) {
    if (!['dimferie', 'samediAM', 'nuit', 'nuitprofonde'].includes(periode)) return;
    // WE/Férié, Nuit, Nuit profonde → Régulé PDSA + Hors patientèle
    const modeBarGroup = document.getElementById('mode-bar-group');
    if (modeBarGroup) {
      modeBarGroup.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      const reguleBtn = modeBarGroup.querySelector('.toggle-btn[data-value="regule"]');
      if (reguleBtn) reguleBtn.classList.add('active');
    }
    Consultation.setMode('regule');
    Visite.setMode('regule');
    applyRelation('hors', true);
  }

  function applyAutoPeriode() {
    const periodeEl = document.getElementById('periode-shared');
    const jourEl = document.getElementById('jour-input');
    const heureEl = document.getElementById('heure-input');
    const jour = parseInt(jourEl.value, 10);
    const h = parseInt((heureEl.value || '8').split(':')[0], 10);
    const periode = computePeriodeFromJourHeure(jour, h);
    // samediAM : bouton "WE/Fé" s'active mais période interne distincte pour CRS/VRS
    const displayPeriode = (periode === 'samediAM') ? 'dimferie' : periode;
    periodeEl.querySelectorAll('.toggle-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.value === displayPeriode);
    });
    Consultation.setPeriode(periode);
    Visite.setPeriode(periode);
    applyPDSAMode(periode);
  }

  function updateCCAMContextBar() {
    const bar = document.getElementById('ccam-context-bar');
    if (!bar) return;
    bar.style.display = '';

    const isVisite = ccamContext === 'visite';
    const state = isVisite ? Visite.getState() : Consultation.getState();

    // Classes couleur sur la barre
    bar.classList.toggle('ctx-visite', isVisite);
    bar.classList.toggle('ctx-cabinet', !isVisite);

    // Dot
    const dot = document.getElementById('ccam-ctx-dot');
    if (dot) dot.className = 'ccam-ctx-dot ' + (isVisite ? 'ctx-visite' : 'ctx-cabinet');

    // Label
    const label = document.getElementById('ccam-context-label');
    if (label) label.textContent = isVisite ? 'En visite' : 'Au cabinet';

    // Chips : acte + majorations actives + actes courants (ECG, Frottis…)
    const COURANT_LABELS = { 'DEQP003': 'ECG', 'JKHD001': 'Frottis' };
    const chips = document.getElementById('ccam-ctx-chips');
    if (chips) {
      const acteClass = 'ccam-ctx-chip chip-acte' + (isVisite ? ' chip-visite' : '');
      let html = `<span class="${acteClass}">${state.acte}</span>`;
      (state.majorations || []).forEach(m => {
        html += `<span class="ccam-ctx-chip chip-majo">${m}</span>`;
      });
      (state.actesCourants || []).forEach(code => {
        const label = COURANT_LABELS[code] || code;
        html += `<span class="ccam-ctx-chip chip-courant">${label}</span>`;
      });
      chips.innerHTML = html;
    }
  }

  function getCCAMContext() { return ccamContext; }

  return { init, updateResult, switchTab, getBasePath, onCCAMChanged, getCurrentTab, getCCAMContext, updateCCAMContextBar, updateModeBar, getRelation };
})();

/**
 * Affiche une modale d'info pour un acte (GL1, GL2, GL3)
 */
function showActeInfo(code) {
  const tarifs = Engine.getTarifs();
  if (!tarifs) return;

  const acte = tarifs.consultations[code];
  if (!acte || !acte.description) return;

  const zone = Engine.getZone();
  const prix = acte.tarifs[zone] || acte.tarifs.metro || 0;

  document.getElementById('modal-title').textContent = `${code} — ${acte.label}`;
  document.getElementById('modal-body').innerHTML = `
    <p class="majo-detail-tarif">${prix.toFixed(2).replace('.', ',')}€</p>
    <p>${acte.description}</p>
  `;
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
  document.getElementById('modal-body').innerHTML = `
    <p class="majo-detail-tarif">+${majo.tarif.toFixed(2).replace('.', ',')}€</p>
    <p>${majo.description || ''}</p>
    ${majo.exclusifs ? `<p style="margin-top:8px;font-size:12px;color:#e74c3c">Non cumulable avec : ${majo.exclusifs.join(', ')}</p>` : ''}
    ${majo.applicableTo ? `<p style="margin-top:4px;font-size:12px;color:#5a6070">Applicable à : ${majo.applicableTo.join(', ')}</p>` : ''}
  `;
  document.getElementById('modal-overlay').classList.add('active');
}

// Démarrage
document.addEventListener('DOMContentLoaded', () => App.init());
