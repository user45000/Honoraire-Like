/**
 * Account — Gestion du compte utilisateur
 */
const Account = (() => {
  let currentUser = null;

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
  }

  function onShow() {
    render();
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

      const subBtn = document.getElementById('subscribe-btn');
      subBtn.textContent = status === 'active' ? 'Gérer mon abonnement' : 'S\'abonner';
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

  function attachListeners() {
    document.getElementById('show-register')?.addEventListener('click', showRegisterForm);
    document.getElementById('show-login')?.addEventListener('click', showLoginForm);

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

    document.getElementById('subscribe-btn')?.addEventListener('click', () => {
      alert('Paiement bientôt disponible — intégration Stripe en cours');
    });
  }

  function getUser() { return currentUser; }

  return { init, onShow, getUser };
})();
