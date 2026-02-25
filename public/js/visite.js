/**
 * Onglet Visite — logique domicile + déplacement + IK
 */
const Visite = (() => {
  let state = {
    age: 'adulte',
    acte: 'VG',
    majorations: [],
    periode: 'jour',
    mode: 'nonregule',
    deplacement: 'MD',
    ikEnabled: false,
    ikKm: 5,
    heure: null
  };

  function init() {
    // Âge patient
    const ageGroup = document.querySelector('#tab-visite .toggle-group[data-field="age-visite"]');
    ageGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('.toggle-btn');
      if (!btn) return;
      ageGroup.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.age = btn.dataset.value;
      handleAgeChange();
      updateAllMajoStates();
      recalculate();
    });

    // Type de visite
    const acteGrid = document.getElementById('visite-acte-grid');
    acteGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('.acte-btn');
      if (!btn) return;
      acteGrid.querySelectorAll('.acte-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.acte = btn.dataset.acte;
      updateAllMajoStates();
      recalculate();
    });

    // Majorations
    const majoGrid = document.getElementById('visite-majo-grid');
    majoGrid.addEventListener('click', (e) => {
      const infoIcon = e.target.closest('.info-icon');
      if (infoIcon) {
        e.stopPropagation();
        showMajoInfo(infoIcon.dataset.info);
        return;
      }
      const btn = e.target.closest('.majo-btn');
      if (!btn || btn.classList.contains('disabled')) return;
      const code = btn.dataset.majo;
      toggleMajoration(code, btn);
      updateAllMajoStates();
      recalculate();
    });

    // Déplacement
    const depGroup = document.querySelector('#tab-visite .toggle-group[data-field="deplacement"]');
    depGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('.toggle-btn');
      if (!btn) return;
      depGroup.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.deplacement = btn.dataset.value;
      updateAllMajoStates();
      recalculate();
    });

    // IK toggle
    const ikCheckbox = document.getElementById('ik-enabled');
    const ikControls = document.getElementById('ik-controls');
    ikCheckbox.addEventListener('change', () => {
      state.ikEnabled = ikCheckbox.checked;
      ikControls.style.display = state.ikEnabled ? '' : 'none';
      if (state.ikEnabled) updateIKInfo();
      recalculate();
    });

    // IK km input
    const ikInput = document.getElementById('ik-km');
    ikInput.addEventListener('input', () => {
      state.ikKm = Math.max(0, parseInt(ikInput.value) || 0);
      updateIKInfo();
      recalculate();
    });

    document.getElementById('ik-minus').addEventListener('click', () => {
      state.ikKm = Math.max(0, state.ikKm - 1);
      ikInput.value = state.ikKm;
      updateIKInfo();
      recalculate();
    });

    document.getElementById('ik-plus').addEventListener('click', () => {
      state.ikKm = Math.min(200, state.ikKm + 1);
      ikInput.value = state.ikKm;
      updateIKInfo();
      recalculate();
    });

    // IK géolocalisation
    document.getElementById('ik-geolocate').addEventListener('click', handleGeolocate);

    updateActePrices();
    updateDeplacementPrices();
    updateAllMajoStates();
  }

  function handleAgeChange() {
    const majoGrid = document.getElementById('visite-majo-grid');
    const megBtn = majoGrid.querySelector('[data-majo="MEG"]');

    // MEG : auto-activer pour enfant 0-6 ans seulement
    if (state.age === 'enfant') {
      if (!state.majorations.includes('MEG')) {
        state.majorations.push('MEG');
        megBtn.classList.add('active');
      }
      megBtn.classList.remove('disabled');
    } else {
      state.majorations = state.majorations.filter(m => m !== 'MEG');
      megBtn.classList.remove('active');
      megBtn.classList.add('disabled');
    }
  }

  function toggleMajoration(code, btn) {
    const isActive = btn.classList.contains('active');
    if (isActive) {
      state.majorations = state.majorations.filter(m => m !== code);
      btn.classList.remove('active');
    } else {
      const excluded = Engine.getExcludedBy(code);
      for (const ex of excluded) {
        state.majorations = state.majorations.filter(m => m !== ex);
        const exBtn = document.querySelector(`#visite-majo-grid [data-majo="${ex}"]`);
        if (exBtn) exBtn.classList.remove('active');
      }
      // Vérifier les exclusions inverses
      const tarifs = Engine.getTarifs();
      if (tarifs) {
        for (const m of [...state.majorations]) {
          const majo = tarifs.majorations[m];
          if (majo?.exclusifs?.includes(code)) {
            state.majorations = state.majorations.filter(x => x !== m);
            const mBtn = document.querySelector(`#visite-majo-grid [data-majo="${m}"]`);
            if (mBtn) mBtn.classList.remove('active');
          }
        }
      }
      state.majorations.push(code);
      btn.classList.add('active');
    }
  }

  /**
   * Met à jour la disponibilité de TOUTES les majorations
   */
  function updateAllMajoStates() {
    const availability = Engine.getAvailableMajos(
      state.acte, state.age, state.periode, state.mode, true, state.deplacement, state.majorations, state.heure
    );
    const majoGrid = document.getElementById('visite-majo-grid');

    majoGrid.querySelectorAll('.majo-btn').forEach(btn => {
      const code = btn.dataset.majo;
      const info = availability[code];
      if (!info) return;

      if (!info.available && !state.majorations.includes(code)) {
        btn.classList.add('disabled');
        btn.title = info.reason || '';
      } else if (!info.available && state.majorations.includes(code)) {
        // Majo active mais plus valide : la retirer
        state.majorations = state.majorations.filter(m => m !== code);
        btn.classList.remove('active');
        btn.classList.add('disabled');
        btn.title = info.reason || '';
      } else {
        btn.classList.remove('disabled');
        btn.title = '';
      }
    });
  }

  function updateModeVisibility() {
    if (state.periode === 'jour') {
      state.mode = 'nonregule';
      App.updateModeBar(false, state.mode);
    } else {
      App.updateModeBar(true, state.mode);
    }
  }

  /**
   * Masque la section déplacement si mode régulé PDSA (art. 22-3)
   */
  function updateDeplacementVisibility() {
    const depSection = document.querySelector('#tab-visite .toggle-group[data-field="deplacement"]')?.closest('.section-card');
    if (!depSection) return;

    if (state.mode === 'regule') {
      depSection.style.opacity = '0.4';
      depSection.style.pointerEvents = 'none';
      depSection.title = 'Non cumulable avec majorations PDSA régulées (art. 22-3)';
    } else {
      depSection.style.opacity = '';
      depSection.style.pointerEvents = '';
      depSection.title = '';
    }
  }

  /**
   * Auto-sélectionne le déplacement cohérent avec la période
   */
  function updateDeplacementForPeriode() {
    const depGroup = document.querySelector('#tab-visite .toggle-group[data-field="deplacement"]');
    let targetDep = 'MD';

    if (state.periode === 'dimferie') targetDep = 'MDD';
    else if (state.periode === 'nuit') targetDep = 'MDN';
    else if (state.periode === 'nuitprofonde') targetDep = 'MDI';
    else {
      const geo = Engine.getGeo();
      targetDep = geo === 'montagne' ? 'MDM' : 'MD';
    }

    depGroup.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    const targetBtn = depGroup.querySelector(`[data-value="${targetDep}"]`);
    if (targetBtn) targetBtn.classList.add('active');
    state.deplacement = targetDep;
  }

  function updateActePrices() {
    const grid = document.getElementById('visite-acte-grid');
    grid.querySelectorAll('.acte-btn').forEach(btn => {
      const code = btn.dataset.acte;
      const tarif = Engine.getActeTarif(code);
      const priceEl = btn.querySelector('.acte-price');
      if (priceEl) priceEl.textContent = tarif + '€';
    });
  }

  function updateDeplacementPrices() {
    const tarifs = Engine.getTarifs();
    if (!tarifs) return;
    const zone = Engine.getZone();
    const depGroup = document.querySelector('#tab-visite .toggle-group[data-field="deplacement"]');
    depGroup.querySelectorAll('.toggle-btn').forEach(btn => {
      const code = btn.dataset.value;
      const dep = tarifs.deplacement[code];
      if (dep) {
        const price = dep.tarifs[zone] || dep.tarifs.metro || 0;
        const priceEl = btn.querySelector('.toggle-price');
        if (priceEl) priceEl.textContent = price.toFixed(2).replace('.', ',') + '€';
      }
    });
  }

  function updateIKInfo() {
    const infoEl = document.getElementById('ik-info');
    if (!state.ikEnabled) {
      infoEl.textContent = '';
      return;
    }
    const ik = Engine.calculateIK(state.ikKm);
    const geo = Engine.getGeo();
    const geoLabel = geo === 'montagne' ? 'montagne' : 'plaine';
    infoEl.textContent = `${geoLabel} — franchise ${ik.franchise} km — ${ik.kmFactures} km × ${ik.tarifKm.toFixed(2).replace('.', ',')}€ = ${ik.montant.toFixed(2).replace('.', ',')}€`;
  }

  function recalculate() {
    const result = Engine.calculate({
      acte: state.acte,
      age: state.age,
      majorations: state.majorations,
      periode: state.periode,
      mode: state.mode,
      isVisite: true,
      deplacement: state.deplacement,
      ikEnabled: state.ikEnabled,
      ikKm: state.ikKm,
      heure: state.heure,
      ccamActes: CCAM.getSelectedActes()
    });
    App.updateResult(result);
  }

  function onShow() {
    updateActePrices();
    updateDeplacementPrices();
    updateDeplacementVisibility();
    updateIKInfo();
    updateAllMajoStates();
    App.updateModeBar(state.periode !== 'jour', state.mode);
    recalculate();
  }

  function setMode(value) {
    state.mode = value;
    updateDeplacementVisibility();
    updateAllMajoStates();
    recalculate();
  }

  function setPeriode(value) {
    state.periode = value;
    updateModeVisibility();
    updateDeplacementForPeriode();
    updateDeplacementVisibility();
    updateAllMajoStates();
    recalculate();
  }

  function setHeure(value) {
    state.heure = value;
    updateAllMajoStates();
    recalculate();
  }

  // === Géolocalisation IK ===
  async function handleGeolocate() {
    const btn = document.getElementById('ik-geolocate');
    const status = document.getElementById('ik-geo-status');

    const cabinetAddr = localStorage.getItem('hon_cabinet_address') || '';
    if (!cabinetAddr.trim()) {
      status.textContent = '⚠️ Renseignez l\'adresse du cabinet dans Paramètres';
      status.className = 'ik-geo-status warn';
      return;
    }

    btn.disabled = true;
    status.textContent = '📡 Géolocalisation en cours…';
    status.className = 'ik-geo-status';

    try {
      // 1. Position GPS actuelle (= chez le patient)
      const pos = await getGeolocation();
      const patLat = pos.coords.latitude;
      const patLng = pos.coords.longitude;

      // 2. Géocodage de l'adresse du cabinet
      status.textContent = '📍 Localisation du cabinet…';
      const cab = await geocodeAddress(cabinetAddr);
      if (!cab) {
        status.textContent = '⚠️ Cabinet introuvable — vérifiez l\'adresse dans Paramètres';
        status.className = 'ik-geo-status warn';
        btn.disabled = false;
        return;
      }

      // 3. Calcul de l'itinéraire routier (OSRM)
      status.textContent = '🗺️ Calcul de l\'itinéraire…';
      const distKm = await getRouteDistance(cab.lng, cab.lat, patLng, patLat);
      if (distKm === null) {
        status.textContent = '⚠️ Itinéraire introuvable';
        status.className = 'ik-geo-status warn';
        btn.disabled = false;
        return;
      }

      // 4. Remplir le champ km (aller simple, franchise gérée par le moteur)
      const km = Math.round(distKm);
      state.ikKm = km;
      document.getElementById('ik-km').value = km;
      updateIKInfo();
      recalculate();
      status.textContent = `✅ ${distKm.toFixed(1)} km (aller) — franchise déduite automatiquement`;
      status.className = 'ik-geo-status ok';
    } catch (e) {
      status.textContent = '❌ ' + (e.message || 'Erreur');
      status.className = 'ik-geo-status warn';
    }

    btn.disabled = false;
  }

  function getGeolocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Géolocalisation non supportée par ce navigateur'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, () => {
        reject(new Error('Accès à la position refusé ou indisponible'));
      }, { timeout: 12000, maximumAge: 0, enableHighAccuracy: true });
    });
  }

  async function geocodeAddress(address) {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(address)}&limit=1`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.features || data.features.length === 0) return null;
    const [lng, lat] = data.features[0].geometry.coordinates;
    return { lat, lng };
  }

  async function getRouteDistance(lng1, lat1, lng2, lat2) {
    const url = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=false`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) return null;
    return data.routes[0].distance / 1000;
  }

  return { init, onShow, recalculate, updateActePrices, updateDeplacementPrices, setPeriode, setMode, setHeure };
})();
