/**
 * App — Navigation, état global, chargement des tarifs
 */
const App = (() => {
  let currentTab = 'consultation';
  let currentRelation = 'mt';
  let ccamContext = 'consultation'; // dernier onglet consultation/visite avant CCAM
  let ccamIK = { enabled: false, km: 5, geoOverride: null }; // IK propre au contexte CCAM "En visite"

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

    // Tap sur barre résultat → détail expandé
    document.getElementById('result-bar').addEventListener('click', () => toggleResultDetail());
    document.getElementById('result-detail-backdrop').addEventListener('click', () => closeResultDetail());
    document.getElementById('result-detail').addEventListener('click', () => closeResultDetail());

    // Info périodes → modal bottom-sheet (même pattern que les autres i)
    document.getElementById('periode-info-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('modal-title').textContent = 'Périodes de garde';
      const gs = localStorage.getItem('hon_garde_samedi') || '14';
      document.getElementById('modal-body').innerHTML = `
        <div class="pinfo-row"><span class="pinfo-chip">Jour</span><span class="pinfo-detail">Lun–Ven 8h–20h · Sam 8h–${gs}h</span></div>
        <div class="pinfo-row"><span class="pinfo-chip">WE/Férié</span><span class="pinfo-detail">Sam ${gs}h–20h · Dim &amp; fériés 8h–20h</span></div>
        <div class="pinfo-row"><span class="pinfo-chip">Nuit</span><span class="pinfo-detail">Tous jours 6h–8h et 20h–0h</span></div>
        <div class="pinfo-row"><span class="pinfo-chip">Nuit prof.</span><span class="pinfo-detail">Tous jours 0h–6h</span></div>
      `;
      document.getElementById('modal-overlay').classList.add('active');
    });

    // Identification médecin
    ['praticien-nom', 'praticien-prenom', 'praticien-rpps', 'remplace-nom', 'remplace-prenom'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = localStorage.getItem('hon_' + id.replace(/-/g, '_')) || '';
      el.addEventListener('blur', () => {
        localStorage.setItem('hon_' + id.replace(/-/g, '_'), el.value.trim());
      });
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter') el.blur();
      });
    });

    // Médecin remplaçant — toggle + affichage champs
    const remplacantCb = document.getElementById('praticien-remplacant');
    const remplaceFields = document.getElementById('remplace-fields');
    if (remplacantCb && remplaceFields) {
      remplacantCb.checked = localStorage.getItem('hon_praticien_remplacant') === 'true';
      remplaceFields.style.display = remplacantCb.checked ? '' : 'none';
      remplacantCb.addEventListener('change', () => {
        localStorage.setItem('hon_praticien_remplacant', remplacantCb.checked);
        remplaceFields.style.display = remplacantCb.checked ? '' : 'none';
      });
    }

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

    // Feuille de soin
    initFDS();

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

    // IK CCAM (section visible uniquement en visite)
    document.getElementById('ccam-ik-enabled')?.addEventListener('change', (e) => {
      ccamIK.enabled = e.target.checked;
      document.getElementById('ccam-ik-controls').style.display = ccamIK.enabled ? '' : 'none';
      document.getElementById('ccam-ik-geolocate').style.display = ccamIK.enabled ? '' : 'none';
      updateCCAMIKInfo();
      onCCAMChanged();
    });
    document.getElementById('ccam-ik-km')?.addEventListener('input', (e) => {
      ccamIK.km = Math.max(0, parseInt(e.target.value) || 0);
      updateCCAMIKInfo();
      onCCAMChanged();
    });
    document.getElementById('ccam-ik-minus')?.addEventListener('click', () => {
      ccamIK.km = Math.max(0, ccamIK.km - 1);
      document.getElementById('ccam-ik-km').value = ccamIK.km;
      updateCCAMIKInfo();
      onCCAMChanged();
    });
    document.getElementById('ccam-ik-plus')?.addEventListener('click', () => {
      ccamIK.km = Math.min(200, ccamIK.km + 1);
      document.getElementById('ccam-ik-km').value = ccamIK.km;
      updateCCAMIKInfo();
      onCCAMChanged();
    });
    document.getElementById('ccam-ik-geolocate')?.addEventListener('click', handleCCAMGeolocate);

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
    fetch('/api/analytics/tab', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tab: tabName }) }).catch(() => {});

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
      onCCAMChanged();
    } else {
      resultBar.style.display = 'none';
      periodeBar.style.display = 'none';
      document.getElementById('mode-bar').classList.remove('visible');
      if (tabName === 'compte') Account.onShow();
    }
  }

  let lastResult = null;

  function updateResult(result) {
    lastResult = result;
    const codesEl = document.getElementById('result-codes');
    const totalEl = document.getElementById('result-total');
    const amoAmcEl = document.getElementById('result-amo-amc');
    const fdsBtn = document.getElementById('fds-open-btn');

    // Fermer le détail quand le résultat change
    closeResultDetail();

    // En onglet CCAM : afficher tous les codes du résultat (G + DEQP003, ou acte isolé seul)
    if (currentTab === 'ccam') {
      const ccamSel = CCAM.getSelectedActes();
      if (ccamSel.length === 0) {
        codesEl.textContent = '';
        totalEl.textContent = '0,00€';
        if (amoAmcEl) amoAmcEl.textContent = '';
        if (fdsBtn) fdsBtn.style.display = 'none';
        lastResult = null;
      } else {
        codesEl.textContent = result.codes.filter(c => !c.startsWith('(')).join(' + ');
        totalEl.textContent = result.total.toFixed(2).replace('.', ',') + '€';
        if (amoAmcEl) {
          amoAmcEl.textContent = result.amo !== undefined
            ? `AMO ${result.amo.toFixed(2).replace('.', ',')}€ | AMC ${result.amc.toFixed(2).replace('.', ',')}€`
            : '';
        }
        if (fdsBtn) fdsBtn.style.display = '';
      }
      return;
    }

    codesEl.textContent = result.codes.filter(c => !c.startsWith('(')).join(' + ');
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
    if (fdsBtn) fdsBtn.style.display = '';
  }

  function toggleResultDetail() {
    const panel = document.getElementById('result-detail');
    const backdrop = document.getElementById('result-detail-backdrop');
    if (!panel || !lastResult || !lastResult.details || lastResult.details.length === 0) return;
    const isOpen = panel.classList.contains('open');
    if (isOpen) {
      closeResultDetail();
    } else {
      let html = '';
      const billed    = lastResult.details.filter(d => d.montant > 0);
      const nonBilled = lastResult.details.filter(d => d.montant === 0);

      for (const d of billed) {
        const montant = d.montant.toFixed(2).replace('.', ',') + ' €';
        html += '<div class="result-detail-row">' +
          '<span class="result-detail-code">' + d.code + '</span>' +
          '<span class="result-detail-label">' + d.label + '</span>' +
          '<span class="result-detail-amount">' + montant + '</span>' +
        '</div>';
      }

      if (nonBilled.length > 0) {
        html += '<div class="result-detail-separator">Non retenus</div>';
        for (const d of nonBilled) {
          // Nettoyer le code : retirer les parenthèses pour l'affichage
          const code = d.code.replace(/^\(|\)$/g, '');
          // Raccourcir le label : retirer la partie "(non facturé — ...)"
          const label = d.label.replace(/\s*\(non facturé[^)]*\)/g, '').replace(/\s*\(non facturé.*$/i, '');
          html += '<div class="result-detail-row result-detail-row--excluded">' +
            '<span class="result-detail-code">' + code + '</span>' +
            '<span class="result-detail-label">' + label + '</span>' +
            '<span class="result-detail-amount">—</span>' +
          '</div>';
        }
      }
      html += '<div class="result-detail-total">' +
        '<span>Total</span>' +
        '<span>' + lastResult.total.toFixed(2).replace('.', ',') + ' €</span>' +
      '</div>';
      if (lastResult.amo !== undefined) {
        html += '<div class="result-detail-amo">AMO ' +
          lastResult.amo.toFixed(2).replace('.', ',') + ' € | AMC ' +
          lastResult.amc.toFixed(2).replace('.', ',') + ' €</div>';
      }
      html += '<div class="result-detail-close">Toucher pour fermer</div>';
      panel.innerHTML = html;
      panel.classList.add('open');
      backdrop.classList.add('open');
      document.getElementById('result-bar').classList.add('detail-open');
    }
  }

  function closeResultDetail() {
    const panel = document.getElementById('result-detail');
    const backdrop = document.getElementById('result-detail-backdrop');
    if (panel) panel.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    document.getElementById('result-bar')?.classList.remove('detail-open');
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
    initToggleParam('secteur', 'hon_secteur', 's1', onSecteurChange);
    // Zone tarification
    initToggleParam('zone', 'hon_zone', 'metro', onZoneChange);
    // Géo
    initToggleParam('geo', 'hon_geo', 'plaine', onGeoChange);
    // Début de garde samedi
    initToggleParam('garde_samedi', 'hon_garde_samedi', '14', onGardeSamediChange);
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
    if (!localStorage.getItem('hon_garde_samedi')) localStorage.setItem('hon_garde_samedi', '14');
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
          const citycode = f.properties.citycode || '';
          localStorage.setItem('hon_cabinet_citycode', citycode);
          checkCabinetAutoZone(citycode);
        });
        listEl.appendChild(li);
      });
      listEl.hidden = false;
    } catch (_) { listEl.hidden = true; }
  }

  // === Détection automatique zone géographique depuis l'adresse cabinet ===

  function getDepartementCode(citycode) {
    if (!citycode) return null;
    if (citycode.startsWith('2A') || citycode.startsWith('2B')) return citycode.substring(0, 2);
    if (citycode.length >= 3 && citycode.startsWith('97')) return citycode.substring(0, 3);
    return citycode.substring(0, 2);
  }

  function isZoneMontagne(citycode) {
    if (!citycode) return false;
    if (citycode.startsWith('2A') || citycode.startsWith('2B')) return true; // Corse = montagne depuis jan 2026
    return typeof COMMUNES_MONTAGNE !== 'undefined' && COMMUNES_MONTAGNE.has(citycode);
  }

  function checkCabinetAutoZone(citycode) {
    const suggestions = [];
    const dep = getDepartementCode(citycode);

    // Zone tarifaire outre-mer
    let zoneTarget = null, zoneEmoji = '', zoneNom = '', zoneQuestion = '';
    if (dep === '971' || dep === '972') {
      zoneTarget = 'antilles'; zoneEmoji = '🌴';
      zoneNom = dep === '971' ? 'Guadeloupe' : 'Martinique';
      zoneQuestion = 'Appliquer la zone tarifaire Antilles ?';
    } else if (dep === '973' || dep === '974' || dep === '976') {
      zoneTarget = 'reunion'; zoneEmoji = '🌴';
      zoneNom = dep === '973' ? 'Guyane' : dep === '976' ? 'Mayotte' : 'La Réunion';
      zoneQuestion = 'Appliquer la zone tarifaire Réunion/Guyane/Mayotte ?';
    }

    if (zoneTarget && (localStorage.getItem('hon_zone') || 'metro') !== zoneTarget) {
      suggestions.push({
        type: 'outremer', emoji: zoneEmoji,
        nom: zoneNom, question: zoneQuestion,
        action: () => { applyCabinetZone('zone', zoneTarget); }
      });
    }

    // Zone géographique montagne
    if (isZoneMontagne(citycode) && (localStorage.getItem('hon_geo') || 'plaine') !== 'montagne') {
      suggestions.push({
        type: 'montagne', emoji: '🏔️',
        nom: 'Zone montagne (Loi 1985)',
        question: 'Basculer en IK montagne ?',
        action: () => { applyCabinetZone('geo', 'montagne'); }
      });
    }

    renderCabinetZoneSuggest(suggestions);
  }

  function applyCabinetZone(param, value) {
    localStorage.setItem('hon_' + param, value);
    document.querySelectorAll(`#tab-params .toggle-group[data-field="${param}"] .toggle-btn`).forEach(b => {
      b.classList.toggle('active', b.dataset.value === value);
    });
    if (param === 'zone') onZoneChange();
    if (param === 'geo') onGeoChange();
    // Relancer la vérification pour retirer la suggestion appliquée
    checkCabinetAutoZone(localStorage.getItem('hon_cabinet_citycode') || '');
  }

  function renderCabinetZoneSuggest(suggestions) {
    const el = document.getElementById('cabinet-zone-suggest');
    if (!el) return;
    if (suggestions.length === 0) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = '';
    el.innerHTML = suggestions.map((s, i) => `
      <div class="cz-suggest-item${s.type === 'outremer' ? ' cz-outremer' : ''}" data-cz="${i}">
        <span class="cz-emoji">${s.emoji}</span>
        <span class="cz-text"><strong>${s.nom}</strong>${s.question}</span>
        <button class="cz-apply" data-cz="${i}">Basculer</button>
        <button class="cz-dismiss" data-cz="${i}" aria-label="Ignorer">✕</button>
      </div>
    `).join('');
    el._suggestions = [...suggestions];
    el.querySelectorAll('.cz-apply').forEach(btn => {
      btn.addEventListener('click', () => el._suggestions[+btn.dataset.cz]?.action());
    });
    el.querySelectorAll('.cz-dismiss').forEach(btn => {
      btn.addEventListener('click', () => {
        el._suggestions.splice(+btn.dataset.cz, 1);
        renderCabinetZoneSuggest(el._suggestions);
      });
    });
  }

  function onSecteurChange() {
    // Le secteur change les tarifs CCAM (OPTAM / non-OPTAM)
    // Recalculer l'onglet actif
    if (currentTab === 'consultation') Consultation.recalculate();
    else if (currentTab === 'visite') Visite.recalculate();
    else if (currentTab === 'ccam') onCCAMChanged();
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

  function onGardeSamediChange() {
    // Recalculer la période si on est sur le jour/heure auto
    const jourEl = document.getElementById('jour-input');
    if (jourEl && parseInt(jourEl.value, 10) === 5) {
      applyAutoPeriode();
    }
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
    if (ccamContext === 'visite') {
      // ID = déplacement standard pour acte CCAM à domicile (sans VG)
      const vs = Visite.getState();
      const result = Engine.calculate({
        acte: null,
        age: vs.age,
        majorations: [],
        periode: vs.periode,
        mode: vs.mode,
        isVisite: true,
        deplacement: 'ID',
        ikEnabled: ccamIK.enabled,
        ikKm: ccamIK.km,
        ikGeoOverride: ccamIK.geoOverride || null,
        heure: vs.heure,
        ccamModificateurs: CCAM.getModificateurs ? CCAM.getModificateurs() : [],
        ccamActes: CCAM.getSelectedActes()
      });
      updateResult(result);
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
    const gardeSamedi = parseInt(localStorage.getItem('hon_garde_samedi') || '14', 10);
    if (jour === 5 && heure >= gardeSamedi) return 'samediAM'; // Samedi garde → PDSA (CRS/VRS)
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

    // Chips : en visite → "ID · 3,50€" ; au cabinet → acte + majorations
    const COURANT_LABELS = { 'DEQP003': 'ECG', 'JKHD001': 'Frottis' };
    const chips = document.getElementById('ccam-ctx-chips');
    if (chips) {
      let html;
      if (isVisite) {
        html = `<span class="ccam-ctx-chip chip-acte chip-visite">ID · 3,50€</span>`;
      } else {
        html = `<span class="ccam-ctx-chip chip-acte">${state.acte}</span>`;
        (state.majorations || []).forEach(m => {
          html += `<span class="ccam-ctx-chip chip-majo">${m}</span>`;
        });
        (state.actesCourants || []).forEach(code => {
          const lbl = COURANT_LABELS[code] || code;
          html += `<span class="ccam-ctx-chip chip-courant">${lbl}</span>`;
        });
      }
      chips.innerHTML = html;
    }

    // Section IK : visible uniquement en visite
    const ikSection = document.getElementById('ccam-ik-section');
    if (ikSection) ikSection.style.display = isVisite ? '' : 'none';
    if (isVisite) updateCCAMIKInfo();
  }

  function updateCCAMIKInfo() {
    const infoEl = document.getElementById('ccam-ik-info');
    if (!infoEl) return;
    if (!ccamIK.enabled) { infoEl.textContent = ''; return; }
    const ik = Engine.calculateIK(ccamIK.km, null);
    const geoLabel = Engine.getGeo() === 'montagne' ? 'montagne' : 'plaine';
    infoEl.textContent = `${geoLabel} — franchise ${ik.franchise} km — ${ik.kmFactures} km × ${ik.tarifKm.toFixed(2).replace('.', ',')}€ = ${ik.montant.toFixed(2).replace('.', ',')}€`;
  }

  async function handleCCAMGeolocate() {
    const btn = document.getElementById('ccam-ik-geolocate');
    const status = document.getElementById('ccam-ik-geo-status');
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
      const pos = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) reject(new Error('Géolocalisation non supportée'));
        navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error('Position refusée')), { timeout: 12000, maximumAge: 0, enableHighAccuracy: true });
      });
      const patLat = pos.coords.latitude;
      const patLng = pos.coords.longitude;
      status.textContent = '📍 Localisation du cabinet…';
      const cabRes = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(cabinetAddr)}&limit=1`);
      const cabData = await cabRes.json();
      if (!cabData.features?.length) {
        status.textContent = '⚠️ Cabinet introuvable — vérifiez l\'adresse dans Paramètres';
        status.className = 'ik-geo-status warn'; btn.disabled = false; return;
      }
      const [cabLng, cabLat] = cabData.features[0].geometry.coordinates;
      status.textContent = '🗺️ Calcul de l\'itinéraire…';
      const routeRes = await fetch(`https://router.project-osrm.org/route/v1/driving/${cabLng},${cabLat};${patLng},${patLat}?overview=false`);
      const routeData = await routeRes.json();
      if (routeData.code !== 'Ok' || !routeData.routes?.length) {
        status.textContent = '⚠️ Itinéraire introuvable';
        status.className = 'ik-geo-status warn'; btn.disabled = false; return;
      }
      const km = Math.round(routeData.routes[0].distance / 1000);
      // Détection zone montagne
      try {
        const revRes = await fetch(`https://api-adresse.data.gouv.fr/reverse/?lon=${patLng}&lat=${patLat}&limit=1`);
        const revData = await revRes.json();
        const citycode = revData.features?.[0]?.properties?.citycode;
        ccamIK.geoOverride = (citycode && (citycode.startsWith('2A') || citycode.startsWith('2B') || (typeof COMMUNES_MONTAGNE !== 'undefined' && COMMUNES_MONTAGNE.has(citycode)))) ? 'montagne' : null;
      } catch { ccamIK.geoOverride = null; }
      ccamIK.km = km;
      document.getElementById('ccam-ik-km').value = km;
      updateCCAMIKInfo();
      onCCAMChanged();
      status.textContent = `✅ ${(routeData.routes[0].distance / 1000).toFixed(1)} km (aller) — franchise déduite automatiquement` + (ccamIK.geoOverride === 'montagne' ? ' — 🏔️ zone montagne' : '');
      status.className = 'ik-geo-status ok';
    } catch (e) {
      status.textContent = '❌ ' + (e.message || 'Erreur');
      status.className = 'ik-geo-status warn';
    }
    btn.disabled = false;
  }

  function getCCAMContext() { return ccamContext; }

  // === Feuille de soin ===
  // Carte case-par-case du PDF officiel S3110 ameli.fr (617.5 x 858.9 pts)

  // ── Date dans lignes d'actes : 8 positions individuelles (J J M M A A A A) ──
  const DATE_BOX_X = [5.91, 7.66, 9.13, 10.88, 12.81, 14.56, 16.31, 18.06];

  // ── Date haut-droite (date de consultation) : 8 cases ──
  const DATE_TOP_X = [77.55, 79.89, 81.94, 84.28, 86.79, 89.12, 91.45, 93.88];
  const DATE_TOP_Y = 5.58;

  // ── Y des 4 lignes d'actes (baseline PDF - 6pts = top du div CSS) ──
  const FDS_ROWS_Y = [72.35, 75.14, 77.94, 80.73];

  // ── Colonnes dans les lignes d'actes (vérifiées sur séparateurs PDF) ──
  // "Code principal" CCAM : 6 cases (19.41–34.07%) + overflow 7e char
  const CCAM_BOX_X   = [19.71, 22.06, 24.54, 26.94, 29.42, 31.89, 34.4];
  const COL_ACTIVITE = 36.15;  // centre col "activités" (34.07–38.23%)
  const COL_NGAP     = 40.44;  // col "C,CS/V,VS" lettre-clé NGAP
  const COL_AUTRES   = 48.2;   // col "autres actes / modificateurs" NGAP

  // ── Cases montant honoraires : 4 cases × 2.33% entre 61.67% et 70.99% ──
  const MT_CELL_W  = 2.33;
  const MT_RIGHT_X = 70.99;   // bord droit col montant honoraires

  // ── Frais de déplacement ID/MD : colonne 70.99%–83.82% ──
  const DEPL_CODE_X  = 76.5;  // "I.D."=77.22%, "M.D."=78.49%
  const DEPL_RIGHT_X = 83.5;  // bord droit zone ID/MD montant

  // ── IK nbre : colonne 83.82%–88.48%, centre 86.15% ──
  const IK_NBRE_X    = 86.15;
  // ── IK montant : colonne 88.48%–93.15% ──
  const IK_RIGHT_X   = 93.15;

  // ── Cases montant TOTAL dans value-box (47.84%–71.16%) ──
  //    7 séparateurs internes → bord droit à 66.41%
  const TOT_RIGHT_X = 66.41;
  const TOT_Y       = 84.5;

  const DEPL_CODES = ['MD', 'MDN', 'MDI', 'MDD', 'ID', 'VD'];

  function fdsOverlay(x, y, text, cls = '') {
    return `<div class="fds-fill ${cls}" style="left:${x}%;top:${y}%">${text}</div>`;
  }

  // Place un montant aligné à droite dans ses cases (bord droit = rightX, cellW = largeur case)
  function fdsCells(amount, rightX, cellW, y) {
    return amount.split('').map((c, i, arr) => {
      const x = rightX - (arr.length - i - 0.15) * cellW;
      return fdsOverlay(x, y, c, 'fds-fill-digit');
    }).join('');
  }

  function openFDS() {
    if (!lastResult || !lastResult.details || lastResult.details.length === 0) return;

    const isMT = getRelation() === 'mt';
    const today = new Date();
    const dd = String(today.getDate()).padStart(2,'0');
    const mm = String(today.getMonth()+1).padStart(2,'0');
    const yyyy = today.getFullYear();

    // Séparer les détails
    const details = lastResult.details;
    const deplItem = details.find(d => DEPL_CODES.some(c => d.code === c || d.code.startsWith(c)));
    const ikItem   = details.find(d => d.code === 'IK' || d.label.toLowerCase().includes('kilométr'));
    const acteRows = details.filter(d => d !== deplItem && d !== ikItem);

    // Construire les overlays
    let html = '';

    // Helper : place chaque chiffre de DDMMYYYY dans sa case individuelle
    const dateStr = `${dd}${mm}${yyyy}`; // 8 chars
    function fdsDate(boxXArr, y, cls = '') {
      return dateStr.split('').map((c, i) =>
        fdsOverlay(boxXArr[i], y, c, 'fds-fill-digit' + cls)
      ).join('');
    }

    // ── Date consultation : cases haut-droite (J J M M A A A A) ──
    html += fdsDate(DATE_TOP_X, DATE_TOP_Y);

    // ── Identification médecin ──
    const medNom        = localStorage.getItem('hon_praticien_nom') || '';
    const medPrenom     = localStorage.getItem('hon_praticien_prenom') || '';
    const medRpps       = localStorage.getItem('hon_praticien_rpps') || '';
    const medAddr       = localStorage.getItem('hon_cabinet_address') || '';
    const isRemplacant  = localStorage.getItem('hon_praticien_remplacant') === 'true';
    const remplaceNom   = localStorage.getItem('hon_remplace_nom') || '';
    const remplacePrenom= localStorage.getItem('hon_remplace_prenom') || '';

    if (isRemplacant) {
      // Zone tampon principale (33.5–39.6%) → médecin remplacé
      if (remplaceNom || remplacePrenom) {
        const remLines = [`Dr ${remplacePrenom} ${remplaceNom}`.trim()];
        if (medAddr) remLines.push(medAddr);
        html += `<div class="fds-fill fds-fill-med" style="left:2%;top:34.5%">${remLines.join('<br>')}</div>`;
      }
      // Section MEDECIN REMPLACANT : nom et prénom à y≈41.3% (après le label imprimé, x≈13%)
      if (medNom || medPrenom) {
        html += `<div class="fds-fill fds-fill-med" style="left:13%;top:41.3%">${`Dr ${medPrenom} ${medNom}`.trim()}</div>`;
      }
      // Identifiant (RPPS) à y≈42.4% (après le label "identifiant", x≈9%)
      if (medRpps) {
        html += `<div class="fds-fill fds-fill-med" style="left:9%;top:42.4%">${medRpps}</div>`;
      }
    } else {
      // Zone tampon principale (33.5–39.6%) → médecin habituel
      if (medNom || medPrenom || medRpps) {
        const lines = [];
        if (medNom || medPrenom) lines.push(`Dr ${medPrenom} ${medNom}`.trim());
        if (medRpps) lines.push(`RPPS : ${medRpps}`);
        if (medAddr) lines.push(medAddr);
        html += `<div class="fds-fill fds-fill-med" style="left:2%;top:34.5%">${lines.join('<br>')}</div>`;
      }
    }

    // ── MALADIE ✓ (centre de la case à 6.88%, 43.74%) ──
    html += fdsOverlay(6.0, 43.2, '✓', 'fds-fill-check');

    // ── Accès hors coordination ✓ (case droite, centre 94.0%, 62.0%) ──
    if (!isMT) {
      html += fdsOverlay(93.2, 61.5, '✓', 'fds-fill-check');
    }

    // ── Lignes d'actes (actes à montant > 0 uniquement) ──
    acteRows.filter(d => d.montant > 0).slice(0, 4).forEach((d, i) => {
      const y = FDS_ROWS_Y[i];
      const amt = d.montant.toFixed(2).replace('.', ',');

      // Date : 8 chiffres individuels dans leurs cases J/J/M/M/A/A/A/A
      html += fdsDate(DATE_BOX_X, y);

      // Code acte :
      //  CCAM (4 lettres + 3 alphanums) → col "éléments tarification CCAM" (44.5%)
      //       + activité "1" centré dans col "activités" (36.15%)
      //  NGAP lettre-clé → col "C,CS/V,VS" (40.44%)
      //  Majorations NGAP → col "autres actes" (48.2%)
      const isCCAM = /^[A-Z]{4}[A-Z0-9]{3}$/.test(d.code);
      const isNGAPLettre = /^(G|VG|V|C|CS|TC|CO|GL|IM|AP|CP|CC|EP|MS|MP|AS)$/.test(d.code);
      if (isCCAM) {
        // Code principal : chaque char dans sa case (19.41–34.07%)
        d.code.split('').forEach((c, j) => {
          html += fdsOverlay(CCAM_BOX_X[j], y, c, 'fds-fill-digit');
        });
        // Code activité centré dans sa case (34.07–38.23%)
        html += fdsOverlay(COL_ACTIVITE, y, '1', 'fds-fill-digit');
      } else {
        html += fdsOverlay(isNGAPLettre ? COL_NGAP : COL_AUTRES, y, d.code, 'fds-fill-code');
      }

      // Montant honoraires : aligné à droite dans ses cases (61.67%–70.99%)
      html += fdsCells(amt, MT_RIGHT_X, MT_CELL_W, y);

      // Frais de déplacement et IK — sur la 1ère ligne d'acte seulement
      if (i === 0) {
        if (deplItem && deplItem.montant > 0) {
          // Code ID/MD dans col "frais déplacement" (76.5%), montant right-aligné à 83.5%
          html += fdsOverlay(DEPL_CODE_X, y, deplItem.code, 'fds-fill-code');
          html += fdsCells(deplItem.montant.toFixed(2).replace('.', ','), DEPL_RIGHT_X, MT_CELL_W, y);
        }
        if (ikItem && ikItem.montant > 0) {
          // IK nbre (km) centré à 86.15%, IK montant right-aligné à 93.15%
          const kmMatch = ikItem.label.match(/(\d+)\s*km/i);
          if (kmMatch) html += fdsOverlay(IK_NBRE_X - 0.5, y, kmMatch[1], 'fds-fill-digit');
          html += fdsCells(ikItem.montant.toFixed(2).replace('.', ','), IK_RIGHT_X, MT_CELL_W, y);
        }
      }
    });

    // ── MONTANT TOTAL : cases 52.42%–66.41%, bord droit 66.41%, y=84.5% ──
    html += fdsCells(lastResult.total.toFixed(2).replace('.', ','), TOT_RIGHT_X, MT_CELL_W, TOT_Y);

    document.getElementById('fds-body').innerHTML = `
      <div class="fds-beta-banner">🧪 <strong>BÊTA</strong> — Informations indicatives. Vérifiez les règles en vigueur. En cas de doute, consultez votre CPAM.</div>
      <div class="fds-overlay-container" id="fds-overlay-container">
        <img src="/images/fds_form.png" class="fds-form-image" alt="Feuille de soins S3116 cerfa 12541">
        ${html}
      </div>`;

    // Calcul du facteur d'échelle pour les tailles de police
    requestAnimationFrame(() => {
      const c = document.getElementById('fds-overlay-container');
      if (c) c.style.setProperty('--fds-scale', c.offsetWidth / 617.5);
    });

    document.getElementById('fds-modal').style.display = 'flex';
  }

  function closeFDS() {
    document.getElementById('fds-modal').style.display = 'none';
  }

  function initFDS() {
    document.getElementById('fds-open-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openFDS();
    });
    document.getElementById('fds-close')?.addEventListener('click', closeFDS);
    document.getElementById('fds-backdrop')?.addEventListener('click', closeFDS);
  }

  return { init, updateResult, switchTab, getBasePath, onCCAMChanged, getCurrentTab, getCCAMContext, updateCCAMContextBar, updateModeBar, getRelation };
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
