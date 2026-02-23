/**
 * Onglet CCAM — recherche et favoris
 */
const CCAM = (() => {
  let allActes = [];
  let favorites = [];

  function init() {
    // Charger les favoris depuis localStorage
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

  function render(query) {
    const listEl = document.getElementById('ccam-list');
    const favSection = document.getElementById('ccam-favorites');
    const favListEl = document.getElementById('ccam-fav-list');

    const q = query.toLowerCase();

    // Filtrer
    let filtered = allActes;
    if (q) {
      filtered = allActes.filter(a =>
        a.code.toLowerCase().includes(q) || a.label.toLowerCase().includes(q)
      );
    }

    // Rendu liste principale
    listEl.innerHTML = filtered.map(a => renderItem(a)).join('');

    // Rendu favoris
    const favActes = allActes.filter(a => favorites.includes(a.code));
    if (favActes.length > 0 && !q) {
      favSection.style.display = '';
      favListEl.innerHTML = favActes.map(a => renderItem(a)).join('');
    } else {
      favSection.style.display = 'none';
    }

    // Event delegation pour favoris
    bindFavClicks(listEl);
    bindFavClicks(favListEl);
  }

  function renderItem(acte) {
    const isFav = favorites.includes(acte.code);
    const cumulClass = acte.cumulG ? 'yes' : '';
    const cumulText = acte.cumulG ? '+ G' : 'seul';
    return `
      <div class="ccam-item">
        <button class="ccam-fav-btn ${isFav ? 'favorited' : ''}" data-code="${acte.code}">
          ${isFav ? '&#9733;' : '&#9734;'}
        </button>
        <span class="ccam-code">${acte.code}</span>
        <span class="ccam-label">${acte.label}</span>
        <span class="ccam-tarif">${acte.tarif.toFixed(2).replace('.', ',')}€</span>
        <span class="ccam-cumul ${cumulClass}">${cumulText}</span>
      </div>
    `;
  }

  function bindFavClicks(container) {
    container.querySelectorAll('.ccam-fav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const code = btn.dataset.code;
        toggleFavorite(code);
        const searchInput = document.getElementById('ccam-search');
        render(searchInput.value.trim());
      });
    });
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

  function onShow() {
    render(document.getElementById('ccam-search').value.trim());
  }

  return { init, setActes, onShow };
})();
