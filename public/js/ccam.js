/**
 * Onglet CCAM — recherche, favoris, sélection d'actes
 */
const CCAM = (() => {
  let allActes = [];
  let favorites = [];
  let selectedActes = []; // Max 2 actes sélectionnés

  function init() {
    try {
      favorites = JSON.parse(localStorage.getItem('hon_ccam_favs') || '[]');
    } catch { favorites = []; }

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
  }

  function renderItem(acte) {
    const isFav = favorites.includes(acte.code);
    const isSelected = selectedActes.some(a => a.code === acte.code);
    const cumul = acte.cumulG || 'non';

    const esc = escapeHTML;
    let cumulBadge = '';
    if (cumul === 'oui') {
      cumulBadge = '<span class="ccam-cumul yes">+ G</span>';
    } else if (cumul === '50%') {
      cumulBadge = '<span class="ccam-cumul half">50% + G</span>';
    } else {
      cumulBadge = '<span class="ccam-cumul no">isolé</span>';
    }

    return `
      <div class="ccam-item ${isSelected ? 'selected' : ''}" data-code="${esc(acte.code)}">
        <button class="ccam-fav-btn ${isFav ? 'favorited' : ''}" data-fav="${esc(acte.code)}">
          ${isFav ? '&#9733;' : '&#9734;'}
        </button>
        <div class="ccam-info">
          <div class="ccam-top-row">
            <span class="ccam-code">${esc(acte.code)}</span>
            ${cumulBadge}
          </div>
          <span class="ccam-label">${esc(acte.label)}</span>
        </div>
        <span class="ccam-tarif">${acte.tarif.toFixed(2).replace('.', ',')}€</span>
        <button class="ccam-add-btn ${isSelected ? 'active' : ''}" data-add="${esc(acte.code)}" title="${isSelected ? 'Retirer' : 'Ajouter au calcul'}">
          ${isSelected ? '✓' : '+'}
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
      if (selectedActes.length >= 2) {
        // Max 2 actes CCAM — retirer le premier
        selectedActes.shift();
      }
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
      ccamTab.insertBefore(banner, ccamTab.firstChild);
    }

    banner.style.display = '';
    const esc = escapeHTML;
    const acteLines = selectedActes.map(a => {
      const cumul = a.cumulG || 'non';
      let ruleText = '';
      if (cumul === 'oui') ruleText = 'cumulable à 100% avec G';
      else if (cumul === '50%') ruleText = 'cumulable à 50% avec G';
      else ruleText = 'non cumulable — le plus rémunérateur sera facturé';
      return `<div class="ccam-sel-item">
        <strong>${esc(a.code)}</strong> ${a.tarif.toFixed(2).replace('.', ',')}€
        <span class="ccam-sel-rule">${esc(ruleText)}</span>
        <button class="ccam-sel-remove" data-remove="${esc(a.code)}">&times;</button>
      </div>`;
    }).join('');

    banner.innerHTML = `
      <div class="ccam-sel-header">Actes CCAM sélectionnés</div>
      ${acteLines}
    `;

    banner.querySelectorAll('.ccam-sel-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        toggleSelection(btn.dataset.remove);
      });
    });
  }

  function onShow() {
    render(document.getElementById('ccam-search').value.trim());
  }

  return { init, setActes, onShow, getSelectedActes, clearSelection };
})();
