/**
 * Account — Gestion du compte utilisateur + Stripe
 */
const Account = (() => {
  let currentUser = null;
  let selectedPlan = 'month';

  async function init() {
    try {
      const basePath = App.getBasePath();
      const res = await fetch(`${basePath}api/auth/me`);
      const data = await res.json();
      currentUser = data.user;
    } catch (e) {
      currentUser = null;
    }
    attachListeners();
    handlePaymentReturn();
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
      // Recharger le statut utilisateur depuis le serveur
      setTimeout(async () => {
        try {
          const basePath = App.getBasePath();
          const res = await fetch(`${basePath}api/auth/me`);
          const data = await res.json();
          currentUser = data.user;
        } catch (e) {}
        App.switchTab('compte');
        render();
        showBanner('Abonnement activé — merci !', 'success');
      }, 1000);
    } else if (payment === 'cancel') {
      App.switchTab('compte');
    }
  }

  function render() {
    const authPanel = document.getElementById('auth-panel');
    const accountPanel = document.getElementById('account-panel');
    if (!authPanel || !accountPanel) return;

    if (currentUser) {
      authPanel.style.display = 'none';
      accountPanel.style.display = 'block';

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
      if (status === 'active') {
        subBtn.textContent = 'Gérer mon abonnement';
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
  }

  function showLoginForm() {
    const loginEl = document.getElementById('auth-login');
    const registerEl = document.getElementById('auth-register');
    if (loginEl) loginEl.style.display = 'block';
    if (registerEl) registerEl.style.display = 'none';
    const errEl = document.getElementById('login-error');
    if (errEl) errEl.textContent = '';
  }

  function showRegisterForm() {
    const loginEl = document.getElementById('auth-login');
    const registerEl = document.getElementById('auth-register');
    if (loginEl) loginEl.style.display = 'none';
    if (registerEl) registerEl.style.display = 'block';
    const errEl = document.getElementById('register-error');
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

    // Sélection du plan
    document.querySelectorAll('.subscribe-plan-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.subscribe-plan-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedPlan = btn.dataset.plan;
      });
    });

    document.getElementById('login-submit')?.addEventListener('click', async () => {
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      const errEl = document.getElementById('login-error');
      errEl.textContent = '';
      if (!email || !password) { errEl.textContent = 'Remplissez tous les champs'; return; }
      try {
        const basePath = App.getBasePath();
        const res = await fetch(`${basePath}api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) { errEl.textContent = data.error; return; }
        currentUser = data.user;
        render();
      } catch (e) {
        errEl.textContent = 'Erreur de connexion';
      }
    });

    document.getElementById('register-submit')?.addEventListener('click', async () => {
      const email = document.getElementById('register-email').value.trim();
      const password = document.getElementById('register-password').value;
      const errEl = document.getElementById('register-error');
      errEl.textContent = '';
      if (!email || !password) { errEl.textContent = 'Remplissez tous les champs'; return; }
      try {
        const basePath = App.getBasePath();
        const res = await fetch(`${basePath}api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) { errEl.textContent = data.error; return; }
        currentUser = data.user;
        render();
      } catch (e) {
        errEl.textContent = 'Erreur lors de la création du compte';
      }
    });

    document.getElementById('logout-btn')?.addEventListener('click', async () => {
      try {
        const basePath = App.getBasePath();
        await fetch(`${basePath}api/auth/logout`, { method: 'POST' });
      } catch (e) {}
      currentUser = null;
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
  }

  function getUser() { return currentUser; }

  return { init, onShow, getUser };
})();
