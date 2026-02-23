/**
 * Onglet Consultation — logique UI et binding avec le moteur de calcul
 */
const Consultation = (() => {
  let state = {
    age: 'adulte',
    acte: 'G',
    majorations: [],
    periode: 'jour',
    mode: 'nonregule'
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

    // Type d'acte
    const acteGrid = document.getElementById('consult-acte-grid');
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

    // Période horaire
    const periodeGroup = document.querySelector('#tab-consultation .toggle-group[data-field="periode"]');
    periodeGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('.toggle-btn');
      if (!btn) return;
      periodeGroup.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.periode = btn.dataset.value;
      updateModeVisibility();
      updateAllMajoStates();
      recalculate();
    });

    // Mode de garde
    const modeGroup = document.querySelector('#tab-consultation .toggle-group[data-field="mode"]');
    if (modeGroup) {
      modeGroup.addEventListener('click', (e) => {
        const btn = e.target.closest('.toggle-btn');
        if (!btn) return;
        modeGroup.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.mode = btn.dataset.value;
        updateAllMajoStates();
        recalculate();
      });
    }

    updateActePrices();
    updateAllMajoStates();
  }

  function handleAgeChange() {
    const majoGrid = document.getElementById('consult-majo-grid');
    const megBtn = majoGrid.querySelector('[data-majo="MEG"]');
    if (state.age === 'enfant') {
      if (!state.majorations.includes('MEG')) {
        state.majorations.push('MEG');
        megBtn.classList.add('active');
      }
    } else {
      state.majorations = state.majorations.filter(m => m !== 'MEG');
      megBtn.classList.remove('active');
    }
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
        const exBtn = document.querySelector(`#consult-majo-grid [data-majo="${ex}"]`);
        if (exBtn) exBtn.classList.remove('active');
      }
      // Vérifier aussi les exclusions inverses
      const tarifs = Engine.getTarifs();
      if (tarifs) {
        for (const m of [...state.majorations]) {
          const majo = tarifs.majorations[m];
          if (majo?.exclusifs?.includes(code)) {
            state.majorations = state.majorations.filter(x => x !== m);
            const mBtn = document.querySelector(`#consult-majo-grid [data-majo="${m}"]`);
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
      state.acte, state.age, state.periode, state.mode, false, null, state.majorations
    );
    const majoGrid = document.getElementById('consult-majo-grid');

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
    const section = document.getElementById('consult-mode-section');
    if (state.periode === 'jour') {
      section.style.display = 'none';
      state.mode = 'nonregule';
    } else {
      section.style.display = '';
    }
  }

  function updateActePrices() {
    const grid = document.getElementById('consult-acte-grid');
    grid.querySelectorAll('.acte-btn').forEach(btn => {
      const code = btn.dataset.acte;
      const tarif = Engine.getActeTarif(code);
      const priceEl = btn.querySelector('.acte-price');
      if (priceEl) priceEl.textContent = tarif + '€';
    });
  }

  function recalculate() {
    const result = Engine.calculate({
      acte: state.acte,
      age: state.age,
      majorations: state.majorations,
      periode: state.periode,
      mode: state.mode,
      isVisite: false,
      ccamActes: CCAM.getSelectedActes()
    });
    App.updateResult(result);
  }

  function onShow() {
    updateActePrices();
    updateAllMajoStates();
    recalculate();
  }

  function getState() {
    return state;
  }

  return { init, onShow, recalculate, getState, updateActePrices };
})();
