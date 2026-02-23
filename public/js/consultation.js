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
      // Auto-toggle MEG
      handleAgeChange();
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
      updateMajoAvailability();
      recalculate();
    });

    // Majorations
    const majoGrid = document.getElementById('consult-majo-grid');
    majoGrid.addEventListener('click', (e) => {
      // Info icon click
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
        recalculate();
      });
    }

    updateActePrices();
  }

  function handleAgeChange() {
    const majoGrid = document.getElementById('consult-majo-grid');
    const megBtn = majoGrid.querySelector('[data-majo="MEG"]');
    if (state.age === 'enfant') {
      // Auto-check MEG
      if (!state.majorations.includes('MEG')) {
        state.majorations.push('MEG');
        megBtn.classList.add('active');
      }
      megBtn.classList.remove('disabled');
    } else {
      // Remove MEG
      state.majorations = state.majorations.filter(m => m !== 'MEG');
      megBtn.classList.remove('active');
      megBtn.classList.add('disabled');
    }
  }

  function toggleMajoration(code, btn) {
    const isActive = btn.classList.contains('active');

    if (isActive) {
      // Décocher
      state.majorations = state.majorations.filter(m => m !== code);
      btn.classList.remove('active');
      // Réactiver les exclus
      updateMajoExclusions();
    } else {
      // Cocher — désactiver les exclusifs
      const excluded = Engine.getExcludedBy(code);
      for (const ex of excluded) {
        state.majorations = state.majorations.filter(m => m !== ex);
        const exBtn = document.querySelector(`#consult-majo-grid [data-majo="${ex}"]`);
        if (exBtn) exBtn.classList.remove('active');
      }
      state.majorations.push(code);
      btn.classList.add('active');
      updateMajoExclusions();
    }
  }

  function updateMajoExclusions() {
    const majoGrid = document.getElementById('consult-majo-grid');
    const allBtns = majoGrid.querySelectorAll('.majo-btn');

    allBtns.forEach(btn => {
      const code = btn.dataset.majo;
      if (code === 'MEG' && state.age !== 'enfant') {
        btn.classList.add('disabled');
        return;
      }
      // Check if this majo is excluded by any active one
      let isExcluded = false;
      for (const activeCode of state.majorations) {
        if (activeCode !== code && Engine.areExclusive(activeCode, code)) {
          isExcluded = true;
          break;
        }
      }
      if (isExcluded && !state.majorations.includes(code)) {
        btn.classList.add('disabled');
      } else {
        btn.classList.remove('disabled');
      }
    });
  }

  function updateMajoAvailability() {
    const tarifs = Engine.getTarifs();
    if (!tarifs) return;

    const majoGrid = document.getElementById('consult-majo-grid');
    majoGrid.querySelectorAll('.majo-btn').forEach(btn => {
      const code = btn.dataset.majo;
      const majo = tarifs.majorations[code];
      if (majo && majo.applicableTo && !majo.applicableTo.includes(state.acte)) {
        btn.classList.add('disabled');
        btn.classList.remove('active');
        state.majorations = state.majorations.filter(m => m !== code);
      } else if (code === 'MEG' && state.age !== 'enfant') {
        btn.classList.add('disabled');
      } else {
        btn.classList.remove('disabled');
      }
    });
    updateMajoExclusions();
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
      isVisite: false
    });
    App.updateResult(result);
  }

  function onShow() {
    updateActePrices();
    recalculate();
  }

  function getState() {
    return state;
  }

  return { init, onShow, recalculate, getState, updateActePrices };
})();
