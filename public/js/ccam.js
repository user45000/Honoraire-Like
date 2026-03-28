/**
 * Onglet CCAM — recherche, favoris, sélection d'actes
 */
const CCAM = (() => {
  let allActes = [];
  let favorites = [];
  let selectedActes = []; // Max 2 actes sélectionnés
  let activeModificateurs = []; // Modificateurs CCAM actifs (M/P/S/F)
  let fuseIndex = null;

  // Retourne la période du contexte actif (consultation ou visite)
  function getContextPeriode() {
    const ctx = App.getCCAMContext();
    const state = ctx === 'visite' ? Visite.getState() : Consultation.getState();
    return state.periode || 'jour';
  }

  // Retourne le modificateur horaire compatible avec la période
  function getTimeModifForPeriode(periode) {
    if (periode === 'nuit') return 'P';
    if (periode === 'nuitprofonde') return 'S';
    if (periode === 'dimferie' || periode === 'samediAM') return 'F';
    return null; // jour → aucun
  }

  // Vérifie si un modificateur est autorisé sur au moins un acte sélectionné
  function isModifAllowedByActs(modCode) {
    return selectedActes.some(a => a.modificateurs && a.modificateurs.includes(modCode));
  }

  // Calcule la disponibilité de chaque modificateur + raison si bloqué
  function getModifAvailability() {
    const periode = getContextPeriode();
    const validTimeModif = getTimeModifForPeriode(periode);
    const periodeLabels = {
      jour: 'en journée', nuit: 'de nuit', nuitprofonde: 'de nuit profonde',
      dimferie: 'dim/férié', samediAM: 'samedi après-midi'
    };
    const pLabel = periodeLabels[periode] || '';

    // Pas d'acte sélectionné
    if (selectedActes.length === 0) {
      const reason = 'Sélectionnez un acte CCAM d\'abord';
      return { M: { available: false, reason }, P: { available: false, reason }, S: { available: false, reason }, F: { available: false, reason } };
    }

    // Si hors horaires de jour, la consultation NGAP porte déjà une majoration horaire
    // → aucun modificateur CCAM ne peut s'ajouter (art. III-3)
    const hasNgapHoraire = periode !== 'jour';
    if (hasNgapHoraire) {
      const reason = 'Majoration horaire déjà sur la consultation NGAP (art. III-3)';
      return { M: { available: false, reason }, P: { available: false, reason }, S: { available: false, reason }, F: { available: false, reason } };
    }

    // M : autorisé si au moins un acte le permet ET contexte cabinet (pas visite)
    const isVisite = App.getCCAMContext() === 'visite';
    const mAllowed = isModifAllowedByActs('M') && !isVisite;
    const mResult = {
      available: mAllowed,
      reason: isVisite ? 'M réservé au cabinet (art. III-2 CCAM)'
        : !isModifAllowedByActs('M') ? 'Non autorisé pour cet acte'
        : ''
    };

    // P, S, F : en journée, pas de modificateur horaire
    function timeModifResult(code, label) {
      const actAllowed = isModifAllowedByActs(code);
      if (!actAllowed) return { available: false, reason: 'Non autorisé pour cet acte' };
      return { available: false, reason: 'Pas ' + label + ' en journée' };
    }

    return {
      M: mResult,
      P: timeModifResult('P', 'de nuit'),
      S: timeModifResult('S', 'de nuit profonde'),
      F: timeModifResult('F', 'de dim/férié')
    };
  }

  // Met à jour l'affichage enabled/disabled des boutons modificateurs
  function updateModifStates() {
    const modifToggles = document.getElementById('ccam-modif-toggles');
    if (!modifToggles) return;
    const avail = getModifAvailability();

    modifToggles.querySelectorAll('.ccam-modif-btn').forEach(btn => {
      const code = btn.dataset.modif;
      const info = avail[code];
      if (!info) return;

      if (!info.available) {
        btn.classList.add('disabled');
        // Si le modificateur était actif, le retirer
        if (activeModificateurs.includes(code)) {
          activeModificateurs = activeModificateurs.filter(m => m !== code);
          btn.classList.remove('active');
        }
      } else {
        btn.classList.remove('disabled');
      }
    });
  }

  // Animation shake + tooltip quand on clique sur un bouton désactivé
  let tooltipTimer = null;

  function shakeWithTooltip(btn, reason) {
    btn.classList.remove('shake');
    void btn.offsetWidth;
    btn.classList.add('shake');

    // Message bar under the buttons
    const toggles = document.getElementById('ccam-modif-toggles');
    let bar = toggles?.querySelector('.ccam-modif-tooltip-bar');
    if (!bar && toggles) {
      bar = document.createElement('div');
      bar.className = 'ccam-modif-tooltip-bar';
      toggles.appendChild(bar);
    }
    if (bar) {
      bar.textContent = reason;
      bar.classList.add('visible');
      clearTimeout(tooltipTimer);
      tooltipTimer = setTimeout(() => {
        bar.classList.remove('visible');
        btn.classList.remove('shake');
      }, 2500);
    } else {
      setTimeout(() => btn.classList.remove('shake'), 350);
    }
  }

  function init() {
    try {
      favorites = JSON.parse(localStorage.getItem('hon_ccam_favs') || '[]');
    } catch { favorites = []; }

    // Info modificateur M (urgence)
    document.getElementById('ccam-modif-m-info')?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('modal-title').textContent = 'Modificateur M — Urgence';
      document.getElementById('modal-body').innerHTML = `
        <div class="pinfo-row"><span class="pinfo-chip">Définition</span><span class="pinfo-detail">Majoration pour soins d'urgence faits <strong>au cabinet</strong> par un médecin généraliste, un pédiatre ou une sage-femme, après examen en urgence d'un patient.</span></div>
        <div class="pinfo-row"><span class="pinfo-chip">Exception</span><span class="pinfo-detail">Applicable aussi pour une <strong>suture de plaie en urgence au domicile</strong> du patient.</span></div>
        <div class="pinfo-row"><span class="pinfo-chip">Urgence ?</span><span class="pinfo-detail">La CCAM ne définit pas de liste de situations. C'est le <strong>jugement clinique du médecin</strong> : le patient devait être vu immédiatement, sans pouvoir attendre un rendez-vous ordinaire.</span></div>
        <div class="pinfo-row"><span class="pinfo-chip">Horaires</span><span class="pinfo-detail">Entre 8h et 20h en semaine, week-end et jours fériés inclus. Hors plages nuit (P/S) et hors dimanche/JF si F applicable.</span></div>
        <div class="pinfo-row" style="margin-top:4px"><span class="pinfo-detail" style="font-size:11px;color:#64748b">Incompatible avec P, S et F. Source : nomenclature CCAM, AMELI.</span></div>
      `;
      document.getElementById('modal-overlay').classList.add('active');
    });

    // Info modificateurs CCAM
    document.getElementById('ccam-modif-info-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('modal-title').textContent = 'Modificateurs CCAM';
      document.getElementById('modal-body').innerHTML = `
        <div class="pinfo-row"><span class="pinfo-chip">M</span><span class="pinfo-detail"><strong>Urgence</strong> (+26,88€)<br>Acte réalisé en urgence entre 8h et 20h, y compris le week-end et les jours fériés. Ne peut pas être cumulé avec P, S ou F.</span></div>
        <div class="pinfo-row"><span class="pinfo-chip">F</span><span class="pinfo-detail"><strong>Dimanche / Jour férié</strong> (+19,06€)<br>Acte réalisé entre 8h et 20h un dimanche ou un jour férié (hors plages nuit).</span></div>
        <div class="pinfo-row"><span class="pinfo-chip">P</span><span class="pinfo-detail"><strong>Nuit</strong> (+35,00€)<br>Acte réalisé entre 20h et 0h ou entre 6h et 8h, tous les jours.</span></div>
        <div class="pinfo-row"><span class="pinfo-chip">S</span><span class="pinfo-detail"><strong>Nuit profonde</strong> (+40,00€)<br>Acte réalisé entre 0h et 6h, tous les jours. Majoration la plus élevée.</span></div>
        <div class="pinfo-row" style="margin-top:8px"><span class="pinfo-detail" style="font-size:11px;color:#64748b">P, S et F sont mutuellement exclusifs. Le modificateur est applicable uniquement si l'acte CCAM l'autorise (champ « modificateurs » de la nomenclature).<br>Source : AMELI / nomenclature CCAM, livre III.</span></div>
      `;
      document.getElementById('modal-overlay').classList.add('active');
    });

    // Modificateurs CCAM
    const modifToggles = document.getElementById('ccam-modif-toggles');
    if (modifToggles) {
      modifToggles.addEventListener('click', (e) => {
        const btn = e.target.closest('.ccam-modif-btn');
        if (!btn) return;
        const code = btn.dataset.modif;
        const avail = getModifAvailability();

        // Clic sur bouton désactivé → feedback visuel
        if (avail[code] && !avail[code].available) {
          shakeWithTooltip(btn, avail[code].reason);
          return;
        }

        const idx = activeModificateurs.indexOf(code);
        if (idx >= 0) {
          // Décochage
          activeModificateurs.splice(idx, 1);
          btn.classList.remove('active');
        } else {
          // Cochage — P/S/F sont mutuellement exclusifs entre eux
          if (['P','S','F'].includes(code)) {
            activeModificateurs = activeModificateurs.filter(m => !['P','S','F'].includes(m));
            modifToggles.querySelectorAll('[data-modif="P"],[data-modif="S"],[data-modif="F"]').forEach(b => b.classList.remove('active'));
          }
          activeModificateurs.push(code);
          btn.classList.add('active');
        }
        updateModifStates();
        App.onCCAMChanged();
      });
    }

    const searchInput = document.getElementById('ccam-search');
    let debounceTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        render(searchInput.value.trim());
      }, 150);
    });
  }

  function setActes(actes) {
    allActes = actes || [];
    fuseIndex = new Fuse(allActes, {
      keys: [
        { name: 'code', weight: 3 },
        { name: 'label', weight: 2 },
        { name: 'keywords', weight: 1 }
      ],
      threshold: 0.35,
      ignoreLocation: true,
      minMatchCharLength: 2,
      includeScore: true
    });
    render('');
  }

  function getSelectedActes() {
    return selectedActes;
  }

  function clearSelection() {
    selectedActes = [];
    render(document.getElementById('ccam-search').value.trim());
  }

  function render(query) {
    const listEl = document.getElementById('ccam-list');
    const favSection = document.getElementById('ccam-favorites');
    const favListEl = document.getElementById('ccam-fav-list');

    const q = query.toLowerCase().trim();

    let filtered = allActes;
    if (q) {
      // Correspondance exacte en priorité (code ou label contient le terme)
      const exact = allActes.filter(a =>
        a.code.toLowerCase().includes(q) ||
        a.label.toLowerCase().includes(q) ||
        (a.keywords || []).some(k => k.toLowerCase().includes(q))
      );
      if (exact.length > 0) {
        filtered = exact;
      } else if (fuseIndex) {
        // Fuzzy search via Fuse.js (fautes de frappe, approximations)
        filtered = fuseIndex.search(q).map(r => r.item);
      } else {
        filtered = [];
      }
    }

    listEl.innerHTML = filtered.map(a => renderItem(a)).join('');

    const favActes = allActes.filter(a => favorites.includes(a.code));
    if (favActes.length > 0 && !q) {
      favSection.style.display = '';
      favListEl.innerHTML = favActes.map(a => renderItem(a)).join('');
    } else {
      favSection.style.display = 'none';
    }

    bindClicks(listEl);
    bindClicks(favListEl);

    updateSelectionBanner();
    const modifCard = document.getElementById('ccam-modif-card');
    if (modifCard) {
      // Toujours afficher les modificateurs
      modifCard.style.display = '';
      updateModifStates();
    }
  }

  function renderItem(acte) {
    const isFav = favorites.includes(acte.code);
    const isSelected = selectedActes.some(a => a.code === acte.code);
    const maxReached = selectedActes.length >= 5 && !isSelected;
    const softDimmed = selectedActes.length >= 2 && !isSelected && !maxReached;
    const cumul = acte.cumulG || 'non';

    let cumulBadge = '';
    if (cumul === 'oui') {
      cumulBadge = '<span class="ccam-cumul yes">+ G</span>';
    } else if (cumul === '50%') {
      cumulBadge = '<span class="ccam-cumul half">50% + G</span>';
    } else {
      cumulBadge = '<span class="ccam-cumul no">isolé</span>';
    }

    // Badge de rang selon la position dans le classement tarifaire
    let rankBadge = '';
    if (isSelected && selectedActes.length >= 1) {
      const sorted = [...selectedActes].sort((a, b) => Engine.getCCAMTarif(b) - Engine.getCCAMTarif(a));
      const rank = sorted.findIndex(a => a.code === acte.code);
      if (rank === 0) rankBadge = '<span class="ccam-rank rank-primary">① 100%</span>';
      else if (rank === 1) rankBadge = '<span class="ccam-rank rank-secondary">② 50%</span>';
      else rankBadge = '<span class="ccam-rank rank-excluded">hors cotation</span>';
    }

    const esc = escapeHTML;
    return `
      <div class="ccam-item ${isSelected ? 'selected' : ''} ${maxReached ? 'dimmed' : softDimmed ? 'soft-dimmed' : ''}" data-code="${esc(acte.code)}">
        <button class="ccam-fav-btn ${isFav ? 'favorited' : ''}" data-fav="${esc(acte.code)}">
          ${isFav ? '&#9733;' : '&#9734;'}
        </button>
        <div class="ccam-info">
          <div class="ccam-top-row">
            <span class="ccam-code">${esc(acte.code)}</span>
            ${cumulBadge}
            ${rankBadge}
          </div>
          <span class="ccam-label">${esc(acte.label)}</span>
        </div>
        <span class="ccam-tarif">${Engine.getCCAMTarif(acte).toFixed(2).replace('.', ',')}€</span>
        <button class="ccam-add-btn ${isSelected ? 'active' : ''}" data-add="${esc(acte.code)}"
          title="${isSelected ? 'Retirer' : maxReached ? '5 actes max' : 'Ajouter au calcul'}">
          ${isSelected ? '✓' : maxReached ? '–' : '+'}
        </button>
      </div>
    `;
  }

  function bindClicks(container) {
    container.querySelectorAll('.ccam-fav-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(btn.dataset.fav);
        render(document.getElementById('ccam-search').value.trim());
      });
    });

    container.querySelectorAll('.ccam-add-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSelection(btn.dataset.add);
      });
    });

    // Tap sur toute la ligne = ajouter/retirer
    container.querySelectorAll('.ccam-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.ccam-fav-btn')) return;
        toggleSelection(item.dataset.code);
      });
    });
  }

  function toggleSelection(code) {
    const idx = selectedActes.findIndex(a => a.code === code);
    if (idx >= 0) {
      selectedActes.splice(idx, 1);
    } else {
      if (selectedActes.length >= 5) return; // Soft limit : 5 actes max
      const acte = allActes.find(a => a.code === code);
      if (acte) selectedActes.push(acte);
    }
    const isNowSelected = selectedActes.some(a => a.code === code);
    // Sync les boutons courants dans consultation/visite
    syncToCourants(code, isNowSelected);
    render(document.getElementById('ccam-search').value.trim());
    // Recalculer sur l'onglet actif
    App.onCCAMChanged();
  }

  function toggleFavorite(code) {
    const idx = favorites.indexOf(code);
    if (idx >= 0) {
      favorites.splice(idx, 1);
    } else {
      favorites.push(code);
    }
    localStorage.setItem('hon_ccam_favs', JSON.stringify(favorites));
  }

  function updateSelectionBanner() {
    let banner = document.getElementById('ccam-selection-banner');
    if (selectedActes.length === 0) {
      if (banner) banner.style.display = 'none';
      return;
    }

    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'ccam-selection-banner';
      banner.className = 'ccam-selection-banner';
      const ccamTab = document.getElementById('tab-ccam');
      ccamTab.appendChild(banner);
    }

    banner.style.display = '';

    // Trier par tarif décroissant : top 2 cotés, reste hors cotation
    const sorted = [...selectedActes].sort((a, b) => Engine.getCCAMTarif(b) - Engine.getCCAMTarif(a));
    const n = selectedActes.length;

    const esc = escapeHTML;
    const acteLines = sorted.map((a, idx) => {
      let rankIcon, tauxLabel, tauxClass, rowClass;
      if (idx === 0) {
        rankIcon = '① '; tauxLabel = '100%'; tauxClass = 'taux-full'; rowClass = '';
      } else if (idx === 1) {
        rankIcon = '② '; tauxLabel = '50%'; tauxClass = 'taux-half'; rowClass = '';
      } else {
        rankIcon = ''; tauxLabel = 'hors cotation'; tauxClass = 'taux-excluded'; rowClass = 'ccam-sel-excluded';
      }
      // Cas 1 seul acte : pas de rang affiché, affiche règle cumul G
      if (n === 1) {
        rankIcon = '';
        const cumul = a.cumulG || 'non';
        if (cumul === 'oui') { tauxLabel = '+ G'; tauxClass = 'taux-full'; }
        else if (cumul === '50%') { tauxLabel = '50% + G'; tauxClass = 'taux-half'; }
        else { tauxLabel = 'remplace G si + rémunérateur'; tauxClass = ''; }
      }
      return `<div class="ccam-sel-item ${esc(rowClass)}">
        <strong>${rankIcon}${esc(a.code)}</strong> ${Engine.getCCAMTarif(a).toFixed(2).replace('.', ',')}€
        <span class="ccam-sel-taux ${esc(tauxClass)}">${esc(tauxLabel)}</span>
        <button class="ccam-sel-remove" data-remove="${esc(a.code)}">&times;</button>
      </div>`;
    }).join('');

    const infoMsg = n >= 2
      ? `<div class="ccam-sel-rule">Les 2 actes les plus rémunérateurs sont retenus · ${n}/5 sélectionnés</div>`
      : '';

    banner.innerHTML = `${acteLines}${infoMsg}`;

    banner.querySelectorAll('.ccam-sel-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        toggleSelection(btn.dataset.remove);
      });
    });
  }

  function updateModifFromPeriode(periode) {
    // Quand la période change, retirer P/S/F et remettre le bon si autorisé
    const hadTimeMod = activeModificateurs.some(m => ['P','S','F'].includes(m));
    activeModificateurs = activeModificateurs.filter(m => !['P','S','F'].includes(m));
    const modifToggles = document.getElementById('ccam-modif-toggles');
    if (modifToggles) {
      modifToggles.querySelectorAll('[data-modif="P"],[data-modif="S"],[data-modif="F"]').forEach(b => b.classList.remove('active'));
      // Auto-sélectionner le bon modificateur horaire si on avait un P/S/F avant
      if (hadTimeMod) {
        const autoCode = getTimeModifForPeriode(periode);
        if (autoCode && isModifAllowedByActs(autoCode)) {
          activeModificateurs.push(autoCode);
          const btn = modifToggles.querySelector('[data-modif="' + autoCode + '"]');
          if (btn) btn.classList.add('active');
        }
      }
      updateModifStates();
    }
  }

  function getModificateurs() {
    return [...activeModificateurs];
  }

  function onShow() {
    render(document.getElementById('ccam-search').value.trim());
  }

  function getActe(code) {
    return allActes.find(a => a.code === code) || null;
  }

  // Sync depuis un acte courant (consultation/visite) → sélection CCAM
  function syncFromCourant(code, active) {
    const isSelected = selectedActes.some(a => a.code === code);
    if (active && !isSelected) {
      if (selectedActes.length >= 5) return; // soft limit 5
      const acte = allActes.find(a => a.code === code);
      if (acte) selectedActes.push(acte);
    } else if (!active && isSelected) {
      selectedActes = selectedActes.filter(a => a.code !== code);
    }
    // Re-render l'onglet CCAM si visible
    render(document.getElementById('ccam-search')?.value?.trim() || '');
  }

  // Appelé quand un acte est togglé dans l'onglet CCAM → sync les courants
  function syncToCourants(code, active) {
    Consultation.syncCourantUI(code, active);
    Visite.syncCourantUI(code, active);
  }

  return { init, setActes, onShow, getSelectedActes, clearSelection, getActe, getModificateurs, updateModifFromPeriode, syncFromCourant };
})();
