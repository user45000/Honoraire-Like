/**
 * Onglet Consultation — logique UI et binding avec le moteur de calcul
 */
const Consultation = (() => {
  let state = {
    age: 'adulte',
    acte: 'G',
    majorations: [],
    actesCourants: [],
    periode: 'jour',
    mode: 'nonregule',
    heure: null,
    relation: 'mt'
  };

  function init() {
    // Âge du patient
    const ageGroup = document.querySelector('#tab-consultation .toggle-group[data-field="age"]');
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

    // Type d'acte (grille principale)
    const acteGrid = document.getElementById('consult-acte-grid');
    acteGrid.addEventListener('click', (e) => {
      const infoIcon = e.target.closest('.info-icon');
      if (infoIcon) {
        e.stopPropagation();
        showActeInfo(infoIcon.dataset.info);
        return;
      }
      const btn = e.target.closest('.acte-btn');
      if (!btn || btn.classList.contains('disabled')) return;
      document.querySelectorAll('#tab-consultation .acte-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.acte = btn.dataset.acte;
      updateAllMajoStates();
      recalculate();
    });

    // Majorations (grille principale)
    const majoGrid = document.getElementById('consult-majo-grid');
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

    // Coordination numérique (TE2 acte + RQD majoration)
    const coordCard = document.getElementById('consult-coord-card');
    coordCard.addEventListener('click', (e) => {
      const infoIcon = e.target.closest('.info-icon');
      if (infoIcon) {
        e.stopPropagation();
        if (e.target.closest('.acte-btn')) showActeInfo(infoIcon.dataset.info);
        else showMajoInfo(infoIcon.dataset.info);
        return;
      }
      const acteBtn = e.target.closest('.acte-btn');
      if (acteBtn && !acteBtn.classList.contains('disabled')) {
        document.querySelectorAll('#tab-consultation .acte-btn').forEach(b => b.classList.remove('active'));
        acteBtn.classList.add('active');
        state.acte = acteBtn.dataset.acte;
        updateAllMajoStates();
        recalculate();
        return;
      }
      const majoBtn = e.target.closest('.majo-btn');
      if (majoBtn && !majoBtn.classList.contains('disabled')) {
        toggleMajoration(majoBtn.dataset.majo, majoBtn);
        updateAllMajoStates();
        recalculate();
      }
    });

    // Actes courants (ECG, Frottis) — synchronisés avec l'onglet CCAM
    const courantsGrid = document.getElementById('consult-courants-grid');
    courantsGrid.addEventListener('click', (e) => {
      const infoBtn = e.target.closest('[data-courant-info]');
      if (infoBtn) {
        e.stopPropagation();
        const acte = CCAM.getActe(infoBtn.dataset.courantInfo);
        if (acte) {
          document.getElementById('modal-title').textContent = `${acte.code} — ${acte.label}`;
          const _body = document.getElementById('modal-body');
          _body.innerHTML = '';
          const _pT = document.createElement('p'); _pT.className = 'majo-detail-tarif'; _pT.textContent = Engine.getCCAMTarif(acte).toFixed(2).replace('.', ',') + '€'; _body.appendChild(_pT);
          const _pN = document.createElement('p'); _pN.textContent = acte.note || ''; _body.appendChild(_pN);
          document.getElementById('modal-overlay').classList.add('active');
        }
        return;
      }
      const btn = e.target.closest('.majo-btn[data-courant]');
      if (!btn || btn.classList.contains('disabled')) return;
      const code = btn.dataset.courant;
      const idx = state.actesCourants.indexOf(code);
      if (idx >= 0) {
        state.actesCourants.splice(idx, 1);
        btn.classList.remove('active');
      } else {
        state.actesCourants.push(code);
        btn.classList.add('active');
      }
      // Sync avec l'onglet CCAM
      CCAM.syncFromCourant(code, state.actesCourants.includes(code));
      // Sync visite aussi
      Visite.syncCourantUI(code, state.actesCourants.includes(code));
      recalculate();
    });

    updateActePrices();
    updateActeStates();
    updateAllMajoStates();
  }

  function handleAgeChange() {
    const majoGrid = document.getElementById('consult-majo-grid');
    const megBtn = majoGrid.querySelector('[data-majo="MEG"]');
    const acteGrid = document.getElementById('consult-acte-grid');

    // MEG : auto-activer pour enfant 0-6 ans seulement
    if (state.age === 'enfant') {
      if (!state.majorations.includes('MEG')) {
        state.majorations.push('MEG');
        megBtn.classList.add('active');
      }
    } else {
      state.majorations = state.majorations.filter(m => m !== 'MEG');
      megBtn.classList.remove('active');
    }

    // Réinitialiser l'acte s'il n'est plus valide pour le nouvel âge
    const isActeEnfant = Engine.ACTES_ENFANT.includes(state.acte);
    const isActeJeune = Engine.ACTES_JEUNE.includes(state.acte);
    const isActeSenior = Engine.ACTES_SENIOR.includes(state.acte);
    if (
      (isActeEnfant && state.age !== 'enfant') ||
      (isActeJeune && state.age !== 'jeune') ||
      (isActeSenior && state.age !== 'senior')
    ) {
      state.acte = 'G';
      document.querySelectorAll('#tab-consultation .acte-btn').forEach(b => b.classList.remove('active'));
      document.querySelector('#tab-consultation [data-acte="G"]').classList.add('active');
    }
    updateActeStates();
  }

  function toggleMajoration(code, btn) {
    const isActive = btn.classList.contains('active');
    if (isActive) {
      state.majorations = state.majorations.filter(m => m !== code);
      btn.classList.remove('active');
    } else {
      // Désactiver les exclusifs
      const excluded = Engine.getExcludedBy(code);
      for (const ex of excluded) {
        state.majorations = state.majorations.filter(m => m !== ex);
        const exBtn = document.querySelector(`#tab-consultation [data-majo="${ex}"]`);
        if (exBtn) exBtn.classList.remove('active');
      }
      // Vérifier aussi les exclusions inverses
      const tarifs = Engine.getTarifs();
      if (tarifs) {
        for (const m of [...state.majorations]) {
          const majo = tarifs.majorations[m];
          if (majo?.exclusifs?.includes(code)) {
            state.majorations = state.majorations.filter(x => x !== m);
            const mBtn = document.querySelector(`#tab-consultation [data-majo="${m}"]`);
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
   * en utilisant Engine.getAvailableMajos avec le contexte complet
   */
  function updateAllMajoStates() {
    const availability = Engine.getAvailableMajos(
      state.acte, state.age, state.periode, state.mode, false, null, state.majorations, state.heure, state.relation
    );

    document.querySelectorAll('#tab-consultation .majo-btn').forEach(btn => {
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

  /**
   * Grise/dégrise les actes selon l'âge du patient
   */
  function updateActeStates() {
    const acteGrid = document.getElementById('consult-acte-grid');

    // Actes enfant (COE, COD) : visibles uniquement pour 0-6 ans
    for (const code of Engine.ACTES_ENFANT) {
      const btn = acteGrid.querySelector(`[data-acte="${code}"]`);
      if (!btn) continue;
      btn.style.display = state.age === 'enfant' ? '' : 'none';
    }

    // Actes jeune (COB, CCP) : visibles uniquement pour 6-25 ans
    for (const code of Engine.ACTES_JEUNE) {
      const btn = acteGrid.querySelector(`[data-acte="${code}"]`);
      if (!btn) continue;
      btn.style.display = state.age === 'jeune' ? '' : 'none';
    }

    // Actes senior (GL1/GL2/GL3) : visibles uniquement pour >80 ans ET médecin traitant
    for (const code of Engine.ACTES_SENIOR) {
      const btn = acteGrid.querySelector(`[data-acte="${code}"]`);
      if (!btn) continue;
      btn.style.display = (state.age === 'senior' && state.relation === 'mt') ? '' : 'none';
    }

    // Actes non disponibles en PDSA / nuit (COE, COD, APC)
    const isHorsJour = state.periode !== 'jour';
    for (const code of ['COE', 'COD', 'APC']) {
      const btn = acteGrid.querySelector(`[data-acte="${code}"]`);
      if (!btn) continue;
      btn.classList.toggle('disabled', isHorsJour);
    }

    // Frottis : non disponible en PDSA / nuit
    const frottisBtn = document.querySelector('#consult-courants-grid [data-courant="JKHD001"]');
    if (frottisBtn) {
      frottisBtn.classList.toggle('disabled', isHorsJour);
      if (isHorsJour) {
        state.actesCourants = state.actesCourants.filter(c => c !== 'JKHD001');
        frottisBtn.classList.remove('active');
      }
    }
  }

  function updateModeVisibility() {
    if (state.periode === 'jour') {
      state.mode = 'nonregule';
      App.updateModeBar(false, state.mode);
    } else {
      App.updateModeBar(true, state.mode);
    }
  }

  function updateActePrices() {
    document.querySelectorAll('#tab-consultation .acte-btn').forEach(btn => {
      const code = btn.dataset.acte;
      const tarif = Engine.getActeTarif(code);
      const priceEl = btn.querySelector('.acte-price');
      if (priceEl) priceEl.textContent = tarif + '€';
    });
  }

  function recalculate() {
    const courantObjects = state.actesCourants.map(c => CCAM.getActe(c)).filter(Boolean);
    // Dédupliquer par code (évite double DEQP003 si sélectionné en CCAM ET en actes courants)
    const seen = new Set();
    const ccamActes = [...CCAM.getSelectedActes(), ...courantObjects]
      .filter(a => seen.has(a.code) ? false : seen.add(a.code));
    const result = Engine.calculate({
      acte: state.acte,
      age: state.age,
      majorations: state.majorations,
      periode: state.periode,
      mode: state.mode,
      isVisite: false,
      heure: state.heure,
      ccamActes,
      ccamModificateurs: CCAM.getModificateurs ? CCAM.getModificateurs() : []
    });
    App.updateResult(result);
  }

  function onShow() {
    updateActePrices();
    updateActeStates();
    updateAllMajoStates();
    App.updateModeBar(state.periode !== 'jour', state.mode);
    recalculate();
  }

  function setRelation(value) {
    state.relation = value;
    // Si un acte MT-only était actif (GL1/2/3) → reset sur G
    if (value === 'hors' && Engine.ACTES_SENIOR.includes(state.acte)) {
      state.acte = 'G';
      document.querySelectorAll('#tab-consultation .acte-btn').forEach(b => b.classList.remove('active'));
      document.querySelector('#tab-consultation [data-acte="G"]').classList.add('active');
    }
    updateActeStates();
    updateAllMajoStates();
    if (App.getCurrentTab() === 'consultation') recalculate();
  }

  function setMode(value) {
    state.mode = value;
    updateAllMajoStates();
    if (App.getCurrentTab() === 'consultation') recalculate();
  }

  function getState() {
    return state;
  }

  function setPeriode(value) {
    state.periode = value;
    if (CCAM.updateModifFromPeriode) CCAM.updateModifFromPeriode(value);
    updateModeVisibility();
    updateActeStates();
    updateAllMajoStates();
    if (App.getCurrentTab() === 'consultation') recalculate();
  }

  function setHeure(value) {
    state.heure = value;
    updateAllMajoStates();
    recalculate();
  }

  // Sync UI des boutons courants depuis l'extérieur (CCAM ou Visite)
  function syncCourantUI(code, active) {
    const btn = document.querySelector('#consult-courants-grid [data-courant="' + code + '"]');
    if (!btn) return;
    if (active && !state.actesCourants.includes(code)) {
      state.actesCourants.push(code);
      btn.classList.add('active');
    } else if (!active && state.actesCourants.includes(code)) {
      state.actesCourants = state.actesCourants.filter(c => c !== code);
      btn.classList.remove('active');
    }
  }

  return { init, onShow, recalculate, getState, updateActePrices, setPeriode, setMode, setHeure, setRelation, syncCourantUI };
})();
