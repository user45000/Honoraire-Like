/**
 * Account — Gestion du compte utilisateur + Stripe
 */
const Account = (() => {
  let currentUser = null;
  let selectedPlan = 'month';

  function syncSubStatus() {
    const status = currentUser?.subscription_status || '';
    if (status === 'active') {
      localStorage.setItem('hon_sub_status', 'active');
      document.documentElement.classList.add('hmg-sub');
    } else {
      localStorage.removeItem('hon_sub_status');
      document.documentElement.classList.remove('hmg-sub');
    }
  }

  const PREF_KEYS = ['hon_secteur','hon_zone','hon_geo','hon_garde_samedi','hon_startup_mode','hon_relation','hon_default_relation','hon_cabinet_address','hon_cabinet_citycode','hon_cabinets','hon_cabinet_active','hon_ccam_favs','hon_praticien_nom','hon_praticien_prenom','hon_praticien_rpps','hon_praticien_remplacant','hon_remplace_nom','hon_remplace_prenom'];
  let prefsSaving = false;

  // Charge les préférences depuis le serveur → localStorage
  function loadPrefsFromServer() {
    if (!currentUser?.preferences) return;
    const prefs = currentUser.preferences;
    let changed = false;
    for (const key of PREF_KEYS) {
      if (prefs[key] !== undefined && prefs[key] !== null) {
        const current = localStorage.getItem(key);
        const serverVal = String(prefs[key]);
        if (current !== serverVal) {
          localStorage.setItem(key, serverVal);
          changed = true;
        }
      }
    }
    if (changed) App.applyPreferences(); // appliquer les préférences sans rechargement
  }

  // Sauvegarde les préférences localStorage → serveur (debounced)
  let saveTimer = null;
  function savePrefsToServer() {
    if (!currentUser) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const prefs = {};
      for (const key of PREF_KEYS) {
        const val = localStorage.getItem(key);
        if (val !== null) prefs[key] = val;
      }
      try {
        const basePath = App.getBasePath();
        await fetch(`${basePath}api/preferences`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(prefs)
        });
      } catch (e) { /* silencieux */ }
    }, 1000);
  }

  // Écouter les changements localStorage pour sync auto
  window.addEventListener('storage', (e) => {
    if (PREF_KEYS.includes(e.key)) savePrefsToServer();
  });

  // Patch localStorage.setItem pour détecter les changements dans le même onglet
  const _origSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function(key, value) {
    _origSetItem(key, value);
    if (PREF_KEYS.includes(key) && currentUser && !prefsSaving) {
      savePrefsToServer();
    }
  };

  async function init() {
    try {
      const basePath = App.getBasePath();
      const res = await fetch(`${basePath}api/auth/me`);
      const data = await res.json();
      currentUser = data.user;
    } catch (e) {
      currentUser = null;
    }
    syncSubStatus();
    if (currentUser) loadPrefsFromServer();
    attachListeners();
    handlePaymentReturn();
    initPaywall();

    // Détection token de reset dans l'URL (?reset=TOKEN)
    const resetToken = new URLSearchParams(window.location.search).get('reset');
    if (resetToken) {
      App.switchTab('compte');
      showResetForm();
      document.getElementById('reset-submit')?._setToken?.(resetToken);
      window._resetToken = resetToken;
      // Nettoyer l'URL
      history.replaceState(null, '', window.location.pathname);
    }
  }

  // === Paywall ===
  const PAYWALL_KEY = 'hon_visit_count';
  const PAYWALL_RESET_KEY = 'hon_visit_month';
  const THRESHOLD_ANON = 5;
  const THRESHOLD_TRIAL = 20;
  let paywallPlan = 'month';

  function getPaywallCount() {
    const currentMonth = new Date().toISOString().slice(0, 7); // "2026-03"
    const storedMonth = localStorage.getItem(PAYWALL_RESET_KEY);
    if (storedMonth !== currentMonth) {
      localStorage.setItem(PAYWALL_RESET_KEY, currentMonth);
      localStorage.setItem(PAYWALL_KEY, '0');
    }
    return parseInt(localStorage.getItem(PAYWALL_KEY) || '0');
  }

  function initPaywall() {
    const overlay = document.getElementById('paywall-overlay');
    if (!overlay) return;

    // Abonné actif ou admin → pas de paywall
    if (currentUser && (currentUser.subscription_status === 'active' || currentUser.isAdmin)) {
      overlay.classList.remove('visible');
      if (window.showCookieBannerIfNeeded) window.showCookieBannerIfNeeded();
      return;
    }

    const threshold = (currentUser && currentUser.subscription_status === 'trial') ? THRESHOLD_TRIAL : THRESHOLD_ANON;
    const count = getPaywallCount() + 1;
    localStorage.setItem(PAYWALL_KEY, count.toString());
    if (count < threshold) {
      // Pas encore de paywall
      overlay.classList.remove('visible');
      if (window.showCookieBannerIfNeeded) window.showCookieBannerIfNeeded();
      return;
    }

    // Paywall nécessaire → afficher
    overlay.classList.add('visible');
    if (window.showCookieBannerIfNeeded) window.showCookieBannerIfNeeded();

    // Sélection du plan
    overlay.querySelectorAll('.paywall-plan').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.paywall-plan').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        paywallPlan = btn.dataset.plan;
        const subBtn = document.getElementById('paywall-subscribe-btn');
        if (subBtn) subBtn.textContent = 'S\'abonner — ' + btn.dataset.price;
      });
    });

    document.getElementById('paywall-skip-btn')?.addEventListener('click', () => {
      overlay.classList.remove('visible');
      if (window.showCookieBannerIfNeeded) window.showCookieBannerIfNeeded();
    });

    // Toggle formulaire login sur le paywall
    document.getElementById('paywall-login-toggle')?.addEventListener('click', () => {
      const form = document.getElementById('paywall-login-form');
      if (form) form.style.display = form.style.display === 'none' ? 'flex' : 'none';
    });

    // Login depuis le paywall
    document.getElementById('paywall-login-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('paywall-login-email').value.trim();
      const password = document.getElementById('paywall-login-password').value;
      const errEl = document.getElementById('paywall-login-error');
      errEl.textContent = '';
      if (!email || !password) { errEl.textContent = 'Remplissez tous les champs'; return; }
      try {
        const basePath = App.getBasePath();
        const res = await fetch(`${basePath}api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, rememberMe: true })
        });
        const data = await res.json();
        if (!res.ok) { errEl.textContent = data.error || 'Erreur'; return; }
        currentUser = data.user;
        syncSubStatus();
        loadPrefsFromServer();
        overlay.classList.remove('visible');
        if (window.showCookieBannerIfNeeded) window.showCookieBannerIfNeeded();
        render();
      } catch (err) {
        errEl.textContent = 'Erreur de connexion';
      }
    });

    document.getElementById('paywall-subscribe-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('paywall-subscribe-btn');
      const errEl = document.getElementById('paywall-sub-error');
      if (errEl) errEl.textContent = '';
      btn.textContent = 'Chargement…';
      btn.disabled = true;
      try {
        const basePath = App.getBasePath();
        // Guest checkout si non connecté, sinon checkout authentifié
        const route = currentUser
          ? `${basePath}api/stripe/create-checkout-session`
          : `${basePath}api/stripe/guest-checkout`;
        const res = await fetch(route, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: paywallPlan })
        });
        const data = await res.json();
        if (data.url) {
          window.location.href = data.url;
        } else {
          btn.textContent = 'S\'abonner';
          btn.disabled = false;
          if (errEl) errEl.textContent = data.error || 'Erreur — veuillez réessayer';
        }
      } catch (e) {
        btn.textContent = 'S\'abonner';
        btn.disabled = false;
        if (errEl) errEl.textContent = 'Erreur de connexion';
      }
    });
  }

  function onShow() {
    render();
  }

  // Gère le retour depuis Stripe Checkout (?payment=success ou ?payment=cancel)
  function handlePaymentReturn() {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    if (!payment) return;

    // Nettoyer l'URL sans recharger
    window.history.replaceState({}, '', window.location.pathname);

    if (payment === 'success') {
      const sessionId = params.get('session_id');
      // Cacher le paywall tout de suite pour éviter le flash
      const overlay = document.getElementById('paywall-overlay');
      if (overlay) overlay.classList.remove('visible');
      // Auto-login via Stripe session si pas déjà connecté
      setTimeout(async () => {
        try {
          const basePath = App.getBasePath();
          if (!currentUser && sessionId) {
            const loginRes = await fetch(`${basePath}api/auth/login-by-stripe`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId })
            });
            const loginData = await loginRes.json();
            if (loginData.user) currentUser = loginData.user;
          }
          if (!currentUser) {
            const res = await fetch(`${basePath}api/auth/me`);
            const data = await res.json();
            currentUser = data.user;
          }
        } catch (e) {}
        syncSubStatus();
        // Cacher le paywall immédiatement
        const overlay = document.getElementById('paywall-overlay');
        if (overlay) overlay.classList.remove('visible');
        App.switchTab('compte');
        render();
        showBanner('Abonnement activé — merci !', 'success');
      }, 1500);
    } else if (payment === 'cancel') {
      App.switchTab('compte');
    }
  }

  function render() {
    const authPanel = document.getElementById('auth-panel');
    const accountPanel = document.getElementById('account-panel');
    if (!authPanel || !accountPanel) return;

    // Badge abonné sur le bouton nav
    const navCompte = document.querySelector('.nav-btn[data-tab="compte"]');
    if (navCompte) {
      navCompte.classList.toggle('nav-subscribed', !!(currentUser && currentUser.subscription_status === 'active'));
    }

    if (currentUser) {
      const wasLogin = authPanel.style.display !== 'none';
      authPanel.style.display = 'none';
      accountPanel.style.display = 'block';
      if (wasLogin) {
        accountPanel.classList.add('login-anim');
        accountPanel.addEventListener('animationend', () => accountPanel.classList.remove('login-anim'), { once: true });
      }

      document.getElementById('account-email-val').textContent = currentUser.email;

      const status = currentUser.subscription_status || 'trial';
      const statusEl = document.getElementById('account-status-badge');
      const labels = { active: 'Abonné', trial: 'Essai gratuit', expired: 'Expiré' };
      statusEl.textContent = labels[status] || status;
      statusEl.className = 'account-status-badge status-' + status;

      const endRow = document.getElementById('account-end-row');
      if (currentUser.subscription_end) {
        const d = new Date(currentUser.subscription_end);
        document.getElementById('account-end-val').textContent = d.toLocaleDateString('fr-FR');
        endRow.style.display = 'flex';
      } else {
        endRow.style.display = 'none';
      }

      // Bouton abonnement
      const subBtn = document.getElementById('subscribe-btn');
      const planPicker = document.getElementById('subscribe-plan-picker');
      if (status === 'active' || currentUser.isAdmin) {
        subBtn.textContent = currentUser.isAdmin ? 'Compte admin' : 'Gérer mon abonnement';
        subBtn.disabled = !!currentUser.isAdmin;
        if (planPicker) planPicker.style.display = 'none';
      } else {
        subBtn.textContent = 'S\'abonner';
        if (planPicker) planPicker.style.display = 'block';
      }
    } else {
      authPanel.style.display = 'block';
      accountPanel.style.display = 'none';
      showLoginForm();
    }
    renderParamsAccount();
  }

  function hideAllAuthForms() {
    ['auth-login', 'auth-register', 'auth-forgot', 'auth-reset'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  function showLoginForm() {
    hideAllAuthForms();
    const loginEl = document.getElementById('auth-login');
    if (loginEl) loginEl.style.display = 'block';
    const errEl = document.getElementById('login-error');
    if (errEl) errEl.textContent = '';
  }

  function showRegisterForm() {
    hideAllAuthForms();
    const registerEl = document.getElementById('auth-register');
    if (registerEl) registerEl.style.display = 'block';
    const errEl = document.getElementById('register-error');
    if (errEl) errEl.textContent = '';
  }

  function showForgotForm() {
    hideAllAuthForms();
    const el = document.getElementById('auth-forgot');
    if (el) el.style.display = 'block';
    const errEl = document.getElementById('forgot-error');
    if (errEl) errEl.textContent = '';
    document.getElementById('forgot-success')?.style.setProperty('display', 'none');
  }

  function showResetForm() {
    hideAllAuthForms();
    const el = document.getElementById('auth-reset');
    if (el) el.style.display = 'block';
    const errEl = document.getElementById('reset-error');
    if (errEl) errEl.textContent = '';
  }

  function showBanner(message, type) {
    let banner = document.getElementById('account-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'account-banner';
      document.getElementById('account-panel')?.prepend(banner);
    }
    banner.textContent = message;
    banner.className = 'account-banner banner-' + type;
    setTimeout(() => { if (banner) banner.remove(); }, 4000);
  }

  function attachListeners() {
    document.getElementById('show-register')?.addEventListener('click', showRegisterForm);
    document.getElementById('show-login')?.addEventListener('click', showLoginForm);
    document.getElementById('show-forgot')?.addEventListener('click', showForgotForm);
    document.getElementById('back-to-login')?.addEventListener('click', showLoginForm);

    // Mot de passe oublié
    document.getElementById('forgot-submit')?.addEventListener('click', async () => {
      const email = document.getElementById('forgot-email').value.trim();
      const errEl = document.getElementById('forgot-error');
      const successEl = document.getElementById('forgot-success');
      errEl.textContent = '';
      successEl.style.display = 'none';
      if (!email) { errEl.textContent = 'Email requis'; return; }
      try {
        const basePath = App.getBasePath();
        await fetch(`${basePath}api/auth/forgot-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        successEl.style.display = 'block';
        document.getElementById('forgot-submit').style.display = 'none';
      } catch (e) {
        errEl.textContent = 'Erreur de connexion';
      }
    });

    // Réinitialisation mot de passe (token URL)
    document.getElementById('reset-submit')?.addEventListener('click', async () => {
      const password = document.getElementById('reset-password').value;
      const errEl = document.getElementById('reset-error');
      errEl.textContent = '';
      if (!password) { errEl.textContent = 'Mot de passe requis'; return; }
      const token = window._resetToken;
      if (!token) { errEl.textContent = 'Token manquant'; return; }
      try {
        const basePath = App.getBasePath();
        const res = await fetch(`${basePath}api/auth/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password })
        });
        const data = await res.json();
        if (!res.ok) { errEl.textContent = data.error; return; }
        window._resetToken = null;
        showLoginForm();
        const loginErrEl = document.getElementById('login-error');
        if (loginErrEl) { loginErrEl.style.color = 'var(--success)'; loginErrEl.textContent = 'Mot de passe modifié. Connectez-vous.'; }
      } catch (e) {
        errEl.textContent = 'Erreur de connexion';
      }
    });

    // Sélection du plan
    document.querySelectorAll('.subscribe-plan-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.subscribe-plan-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedPlan = btn.dataset.plan;
      });
    });

    document.getElementById('login-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      const rememberMe = document.getElementById('login-remember')?.checked || false;
      const errEl = document.getElementById('login-error');
      errEl.textContent = '';
      if (!email || !password) { errEl.textContent = 'Remplissez tous les champs'; return; }
      try {
        const basePath = App.getBasePath();
        const res = await fetch(`${basePath}api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, rememberMe })
        });
        const data = await res.json();
        if (!res.ok) { errEl.textContent = data.error; return; }
        currentUser = data.user;
        syncSubStatus();
        loadPrefsFromServer();
        const btn = document.getElementById('login-submit');
        btn.textContent = '✓';
        btn.classList.add('login-success');
        setTimeout(() => { btn.textContent = 'Se connecter'; btn.classList.remove('login-success'); render(); }, 500);
      } catch (e) {
        errEl.textContent = 'Erreur de connexion';
      }
    });

    document.getElementById('register-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('register-email').value.trim();
      const password = document.getElementById('register-password').value;
      const acceptedTerms = document.getElementById('register-terms')?.checked;
      const errEl = document.getElementById('register-error');
      errEl.textContent = '';
      if (!email || !password) { errEl.textContent = 'Remplissez tous les champs'; return; }
      if (!acceptedTerms) { errEl.textContent = 'Vous devez accepter les CGU/CGV'; return; }
      try {
        const basePath = App.getBasePath();
        const res = await fetch(`${basePath}api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, acceptedTerms: true })
        });
        const data = await res.json();
        if (!res.ok) { errEl.textContent = data.error; return; }
        currentUser = data.user;
        syncSubStatus();
        savePrefsToServer();
        render();
      } catch (e) {
        errEl.textContent = 'Erreur lors de la création du compte';
      }
    });

    document.getElementById('delete-account-btn')?.addEventListener('click', async () => {
      if (!confirm('Supprimer définitivement votre compte ?\nToutes vos données seront effacées. Cette action est irréversible.')) return;
      try {
        const basePath = App.getBasePath();
        const res = await fetch(`${basePath}api/auth/account`, { method: 'DELETE' });
        if (res.ok) {
          currentUser = null;
          render();
        }
      } catch (e) {}
    });

    document.getElementById('logout-btn')?.addEventListener('click', async () => {
      try {
        const basePath = App.getBasePath();
        await fetch(`${basePath}api/auth/logout`, { method: 'POST' });
      } catch (e) {}
      currentUser = null;
      syncSubStatus();
      render();
    });

    document.getElementById('subscribe-btn')?.addEventListener('click', async () => {
      const status = currentUser?.subscription_status;
      const basePath = App.getBasePath();

      // Si abonné → portail Stripe pour gérer
      if (status === 'active') {
        try {
          const res = await fetch(`${basePath}api/stripe/customer-portal`, { method: 'POST' });
          const data = await res.json();
          if (data.url) { window.location.href = data.url; return; }
          if (data.error) showBanner(data.error, 'error');
        } catch (e) {
          showBanner('Erreur lors de l\'ouverture du portail', 'error');
        }
        return;
      }

      // Sinon → checkout Stripe
      const btn = document.getElementById('subscribe-btn');
      btn.textContent = 'Chargement…';
      btn.disabled = true;
      try {
        const res = await fetch(`${basePath}api/stripe/create-checkout-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: selectedPlan })
        });
        const data = await res.json();
        if (data.url) {
          window.location.href = data.url;
        } else {
          showBanner(data.error || 'Erreur Stripe', 'error');
          btn.textContent = 'S\'abonner';
          btn.disabled = false;
        }
      } catch (e) {
        showBanner('Erreur de connexion', 'error');
        btn.textContent = 'S\'abonner';
        btn.disabled = false;
      }
    });

    // Params — changer mot de passe
    document.getElementById('params-change-pw-btn')?.addEventListener('click', () => {
      document.getElementById('params-change-pw-form').style.display = 'block';
      document.getElementById('params-change-pw-btn').style.display = 'none';
      document.getElementById('params-pw-success')?.style.setProperty('display', 'none');
    });
    document.getElementById('params-pw-cancel')?.addEventListener('click', () => {
      document.getElementById('params-change-pw-form').style.display = 'none';
      document.getElementById('params-change-pw-btn').style.display = 'block';
      document.getElementById('params-new-password').value = '';
      document.getElementById('params-pw-error').textContent = '';
    });
    document.getElementById('params-pw-save')?.addEventListener('click', async () => {
      const password = document.getElementById('params-new-password').value;
      const errEl = document.getElementById('params-pw-error');
      const successEl = document.getElementById('params-pw-success');
      errEl.textContent = '';
      if (!password) { errEl.textContent = 'Mot de passe requis'; return; }
      try {
        const basePath = App.getBasePath();
        const res = await fetch(`${basePath}api/auth/change-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        const data = await res.json();
        if (!res.ok) { errEl.textContent = data.error; return; }
        document.getElementById('params-new-password').value = '';
        document.getElementById('params-change-pw-form').style.display = 'none';
        document.getElementById('params-change-pw-btn').style.display = 'block';
        successEl.style.display = 'block';
        setTimeout(() => { successEl.style.display = 'none'; }, 3000);
      } catch (e) {
        errEl.textContent = 'Erreur de connexion';
      }
    });

    // Params — déconnexion
    document.getElementById('params-logout-btn')?.addEventListener('click', async () => {
      try {
        const basePath = App.getBasePath();
        await fetch(`${basePath}api/auth/logout`, { method: 'POST' });
      } catch (e) {}
      currentUser = null;
      syncSubStatus();
      render();
    });

    // Params — supprimer compte
    document.getElementById('params-delete-btn')?.addEventListener('click', async () => {
      if (!confirm('Supprimer définitivement votre compte ?\nToutes vos données seront effacées. Cette action est irréversible.')) return;
      try {
        const basePath = App.getBasePath();
        const res = await fetch(`${basePath}api/auth/account`, { method: 'DELETE' });
        if (res.ok) { currentUser = null; syncSubStatus(); render(); }
      } catch (e) {}
    });

    // Params — lien "Connectez-vous"
    document.getElementById('params-go-compte')?.addEventListener('click', (e) => {
      e.preventDefault();
      App.switchTab('compte');
    });
  } // fin attachListeners

  function renderParamsAccount() {
    const section = document.getElementById('params-account-section');
    const hint = document.getElementById('params-account-hint');
    if (!section || !hint) return;
    if (currentUser) {
      section.style.display = 'block';
      hint.style.display = 'none';
      document.getElementById('params-account-email').textContent = currentUser.email;
      const status = currentUser.subscription_status || 'trial';
      const labels = { active: 'Abonné', trial: 'Essai gratuit', expired: 'Expiré' };
      const statusEl = document.getElementById('params-account-status');
      statusEl.textContent = labels[status] || status;
      statusEl.className = 'account-status-badge status-' + status;
    } else {
      section.style.display = 'none';
      hint.style.display = 'block';
    }
  }

  function getUser() { return currentUser; }

  return { init, onShow, getUser };
})();
