/**
 * Onglet CCAM — recherche, favoris, sélection d'actes
 */
const CCAM = (() => {
  let allActes = [];
  let favorites = [];
  let selectedActes = []; // Max 2 actes sélectionnés
  let activeModificateurs = []; // Modificateurs CCAM actifs (M/P/S/F)

  function init() {
    try {
      favorites = JSON.parse(localStorage.getItem('hon_ccam_favs') || '[]');
    } catch { favorites = []; }

    // Modificateurs CCAM
    const modifToggles = document.getElementById('ccam-modif-toggles');
    if (modifToggles) {
      modifToggles.addEventListener('click', (e) => {
        const btn = e.target.closest('.ccam-modif-btn');
        if (!btn) return;
        const code = btn.dataset.modif;
        const idx = activeModificateurs.indexOf(code);
        // P/S/F sont mutuellement exclusifs (temps de nuit); M est indépendant
        if (idx >= 0) {
          activeModificateurs.splice(idx, 1);
          btn.classList.remove('active');
        } else {
          if (['P','S','F'].includes(code)) {
            // Retirer les autres P/S/F
            activeModificateurs = activeModificateurs.filter(m => !['P','S','F'].includes(m));
            modifToggles.querySelectorAll('[data-modif="P"],[data-modif="S"],[data-modif="F"]').forEach(b => b.classList.remove('active'));
          }
          activeModificateurs.push(code);
          btn.classList.add('active');
        }
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

    const q = query.toLowerCase();

    let filtered = allActes;
    if (q) {
      filtered = allActes.filter(a =>
        a.code.toLowerCase().includes(q) || a.label.toLowerCase().includes(q)
      );
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
    if (modifCard) modifCard.style.display = selectedActes.length > 0 ? '' : 'none';
  }

  function renderItem(acte) {
    const isFav = favorites.includes(acte.code);
    const isSelected = selectedActes.some(a => a.code === acte.code);
    const maxReached = selectedActes.length >= 2 && !isSelected;
    const cumul = acte.cumulG || 'non';

    let cumulBadge = '';
    if (cumul === 'oui') {
      cumulBadge = '<span class="ccam-cumul yes">+ G</span>';
    } else if (cumul === '50%') {
      cumulBadge = '<span class="ccam-cumul half">50% + G</span>';
    } else {
      cumulBadge = '<span class="ccam-cumul no">isolé</span>';
    }

    // Badge de rang quand 2 actes sont sélectionnés
    let rankBadge = '';
    if (isSelected && selectedActes.length === 2) {
      const sorted = [...selectedActes].sort((a, b) => b.tarif - a.tarif);
      const rank = sorted.findIndex(a => a.code === acte.code);
      rankBadge = rank === 0
        ? '<span class="ccam-rank rank-primary">① principal</span>'
        : '<span class="ccam-rank rank-secondary">② 50%</span>';
    }

    const esc = escapeHTML;
    return `
      <div class="ccam-item ${isSelected ? 'selected' : ''} ${maxReached ? 'dimmed' : ''}" data-code="${esc(acte.code)}">
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
        <span class="ccam-tarif">${acte.tarif.toFixed(2).replace('.', ',')}€</span>
        <button class="ccam-add-btn ${isSelected ? 'active' : ''}" data-add="${esc(acte.code)}"
          title="${isSelected ? 'Retirer' : maxReached ? '2 actes maximum' : 'Ajouter au calcul'}">
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
      if (selectedActes.length >= 2) return; // Max 2 actes — bloqué
      const acte = allActes.find(a => a.code === code);
      if (acte) selectedActes.push(acte);
    }
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

    // Trier par tarif décroissant pour afficher ① principal puis ② 50%
    const sorted = [...selectedActes].sort((a, b) => b.tarif - a.tarif);
    const has2 = selectedActes.length === 2;

    const esc = escapeHTML;
    const acteLines = sorted.map((a, idx) => {
      const rankIcon = has2 ? (idx === 0 ? '① ' : '② ') : '';
      let tauxLabel = '';
      let tauxClass = '';
      if (has2) {
        tauxLabel = idx === 0 ? '100%' : '50%';
        tauxClass = idx === 0 ? 'taux-full' : 'taux-half';
      } else {
        const cumul = a.cumulG || 'non';
        if (cumul === 'oui') { tauxLabel = '+ G'; tauxClass = 'taux-full'; }
        else if (cumul === '50%') { tauxLabel = '50% + G'; tauxClass = 'taux-half'; }
        else { tauxLabel = 'remplace G si + rémunérateur'; tauxClass = ''; }
      }
      return `<div class="ccam-sel-item">
        <strong>${rankIcon}${esc(a.code)}</strong> ${a.tarif.toFixed(2).replace('.', ',')}€
        <span class="ccam-sel-taux ${esc(tauxClass)}">${esc(tauxLabel)}</span>
        <button class="ccam-sel-remove" data-remove="${esc(a.code)}">&times;</button>
      </div>`;
    }).join('');

    const limitMsg = has2
      ? '<div class="ccam-sel-limit">2/2 — retirer un acte pour en ajouter un autre</div>'
      : '';

    banner.innerHTML = `${acteLines}${limitMsg}`;

    banner.querySelectorAll('.ccam-sel-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        toggleSelection(btn.dataset.remove);
      });
    });
  }

  function updateModifFromPeriode(periode) {
    // Auto-détecter P/S/F depuis la période courante (sans écraser M)
    activeModificateurs = activeModificateurs.filter(m => m === 'M');
    const modifToggles = document.getElementById('ccam-modif-toggles');
    if (modifToggles) {
      modifToggles.querySelectorAll('[data-modif="P"],[data-modif="S"],[data-modif="F"]').forEach(b => b.classList.remove('active'));
      let autoCode = null;
      if (periode === 'nuitprofonde') autoCode = 'S';
      else if (periode === 'nuit') autoCode = 'P';
      else if (periode === 'dimferie' || periode === 'samediAM') autoCode = 'F';
      if (autoCode) {
        activeModificateurs.push(autoCode);
        const btn = modifToggles.querySelector('[data-modif="' + autoCode + '"]');
        if (btn) btn.classList.add('active');
      }
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

  return { init, setActes, onShow, getSelectedActes, clearSelection, getActe, getModificateurs, updateModifFromPeriode };
})();
