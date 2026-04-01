// === Admin Dashboard ===
let allUsers = [];
let chartPeriod = '7d';

// --- Auth check & init ---
async function tryLoadDashboard() {
  try {
    const res = await fetch('/api/admin/stats');
    if (!res.ok) return showUnauth();
    const data = await res.json();
    showDashboard();
    document.getElementById('stat-total').textContent = data.total;
    document.getElementById('stat-active').textContent = data.active;
    document.getElementById('stat-trial').textContent = data.trial;
    document.getElementById('stat-expired').textContent = data.expired;
    loadAnalytics();
    loadUsers();
  } catch (e) {
    console.error('Admin load error:', e);
    showUnauth();
  }
}

function showUnauth() {
  document.getElementById('unauth-screen').style.display = 'flex';
  document.getElementById('dashboard').style.display = 'none';
}

function showDashboard() {
  document.getElementById('unauth-screen').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
}

// --- Tab navigation ---
document.querySelectorAll('.admin-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + btn.dataset.panel).classList.add('active');
  });
});

// --- Analytics ---
async function loadAnalytics() {
  loadOverview();
  loadChart();
  loadTabs();
  loadDevices();
  loadPages();
}

async function loadOverview() {
  try {
    const res = await fetch('/api/admin/analytics/overview');
    const d = await res.json();

    function set(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

    // Table récapitulative
    set('kpi-views-today', d.viewsToday);
    set('kpi-views-month', d.viewsMonth);
    set('kpi-views-year', d.viewsYear);
    set('kpi-views-all', d.viewsAll);

    set('kpi-visitors-today', d.visitorsToday);
    set('kpi-visitors-month', d.visitorsMonth);
    set('kpi-visitors-year', d.visitorsYear);
    set('kpi-visitors-all', d.visitorsAll);

    set('kpi-dau', d.dau);
    set('kpi-users-month', d.usersMonth);
    set('kpi-users-year', d.usersYear);
    set('kpi-users-all', d.usersAll);

    set('kpi-signups-month', d.signupsMonth);
    set('kpi-signups-year', d.signupsYear);
    set('kpi-signups-total', d.totalUsers);

    // Quick stats
    set('kpi-wau', d.wau);
    set('kpi-mau', d.mau);
    set('kpi-conversion', d.conversionRate + '%');
  } catch (e) { console.error('Overview error:', e); }
}

async function loadChart() {
  try {
    const res = await fetch('/api/admin/analytics/chart?period=' + chartPeriod);
    const data = await res.json();
    renderBarChart(data);
  } catch (e) { console.error('Chart error:', e); }
}

function renderBarChart(data) {
  const container = document.getElementById('traffic-chart');
  if (!data.length) { container.innerHTML = '<div style="color:#94a3b8;font-size:13px;text-align:center;width:100%;align-self:center">Pas encore de données</div>'; return; }
  const maxVal = Math.max(1, ...data.map(d => Math.max(d.views, d.bots || 0)));
  // For 90d, show every 7th label; for 30d every 3rd
  const labelEvery = data.length > 60 ? 7 : data.length > 14 ? 3 : 1;
  container.innerHTML = data.map((d, i) => {
    const h1 = Math.max(2, (d.views / maxVal) * 100);
    const h2 = Math.max(2, (d.visitors / maxVal) * 100);
    const h3 = Math.max(2, ((d.bots || 0) / maxVal) * 100);
    const label = i % labelEvery === 0 ? d.day.slice(5) : '';
    return '<div class="bar-col">' +
      '<div class="bar-val">' + (d.views > 0 ? d.views : '') + '</div>' +
      '<div class="bar-bars">' +
        '<div class="bar" style="height:' + h1 + '%"></div>' +
        '<div class="bar secondary" style="height:' + h2 + '%"></div>' +
        ((d.bots || 0) > 0 ? '<div class="bar bot" style="height:' + h3 + '%"></div>' : '') +
      '</div>' +
      '<div class="bar-label">' + label + '</div>' +
    '</div>';
  }).join('');
}

// Chart period buttons
document.getElementById('chart-period').addEventListener('click', (e) => {
  const btn = e.target.closest('.period-btn');
  if (!btn) return;
  document.querySelectorAll('#chart-period .period-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  chartPeriod = btn.dataset.period;
  loadChart();
});

async function loadTabs() {
  try {
    const res = await fetch('/api/admin/analytics/tabs?period=7d');
    const data = await res.json();
    const container = document.getElementById('tab-bars');
    if (!data.length) { container.innerHTML = '<div style="color:#94a3b8;font-size:13px">Pas encore de données</div>'; return; }
    const max = Math.max(1, ...data.map(d => d.count));
    const colors = { consultation: '#2563EB', visite: '#059669', ccam: '#7c3aed', params: '#64748b', account: '#d97706' };
    const labels = { consultation: 'Consultation', visite: 'Visite', ccam: 'CCAM', params: 'Paramètres', account: 'Compte' };
    container.innerHTML = data.map(d => {
      const pct = Math.max(5, (d.count / max) * 100);
      const color = colors[d.tab_name] || '#94a3b8';
      return '<div class="h-bar-row">' +
        '<div class="h-bar-name">' + (labels[d.tab_name] || d.tab_name) + '</div>' +
        '<div class="h-bar-track"><div class="h-bar-fill" style="width:' + pct + '%;background:' + color + '">' + d.count + '</div></div>' +
      '</div>';
    }).join('');
  } catch (e) { console.error('Tabs error:', e); }
}

async function loadDevices() {
  try {
    const res = await fetch('/api/admin/analytics/devices?period=30');
    const data = await res.json();
    renderHBars('device-bars', data.devices, { mobile: '#2563EB', desktop: '#059669', tablet: '#7c3aed' }, { mobile: 'Mobile', desktop: 'Desktop', tablet: 'Tablette' });
    renderHBars('browser-bars', data.browsers, { Chrome: '#4285F4', Safari: '#000', Firefox: '#FF7139', Edge: '#0078D7', other: '#94a3b8' });
  } catch (e) { console.error('Devices error:', e); }
}

function renderHBars(containerId, data, colors, labels) {
  const container = document.getElementById(containerId);
  if (!data || !data.length) { container.innerHTML = '<div style="color:#94a3b8;font-size:13px">Pas de données</div>'; return; }
  const max = Math.max(1, ...data.map(d => d.n));
  container.innerHTML = data.map(d => {
    const pct = Math.max(5, (d.n / max) * 100);
    const color = (colors && colors[d.name]) || '#2563EB';
    const label = (labels && labels[d.name]) || d.name;
    return '<div class="h-bar-row">' +
      '<div class="h-bar-name">' + escHtml(label) + '</div>' +
      '<div class="h-bar-track"><div class="h-bar-fill" style="width:' + pct + '%;background:' + color + '">' + d.n + '</div></div>' +
    '</div>';
  }).join('');
}

async function loadPages() {
  try {
    const res = await fetch('/api/admin/analytics/pages?period=7');
    const data = await res.json();
    const container = document.getElementById('pages-list');
    if (!data.length) { container.innerHTML = '<div style="color:#94a3b8;font-size:13px;padding:12px 0">Pas encore de données</div>'; return; }
    container.innerHTML = data.map(d =>
      '<div class="page-row">' +
        '<span class="page-path">' + escHtml(d.path) + '</span>' +
        '<span class="page-views">' + d.views + '</span>' +
        '<span class="page-visitors">' + d.visitors + '</span>' +
      '</div>'
    ).join('');
  } catch (e) { console.error('Pages error:', e); }
}

// --- Users ---
async function loadStats() {
  const res = await fetch('/api/admin/stats');
  const data = await res.json();
  document.getElementById('stat-total').textContent = data.total;
  document.getElementById('stat-active').textContent = data.active;
  document.getElementById('stat-trial').textContent = data.trial;
  document.getElementById('stat-expired').textContent = data.expired;
}

async function loadUsers() {
  const res = await fetch('/api/admin/users');
  allUsers = await res.json();
  renderUsers(allUsers);
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderUsers(users) {
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = '';
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:24px">Aucun utilisateur</td></tr>';
    return;
  }
  users.forEach(u => {
    const safeId = parseInt(u.id, 10);
    const safeEmail = escHtml(u.email);
    const badge = {
      active: '<span class="badge badge-active">Abonné</span>',
      trial: '<span class="badge badge-trial">Essai</span>',
      expired: '<span class="badge badge-expired">Expiré</span>'
    }[u.subscription_status] || '<span class="badge">Inconnu</span>';
    const end = u.subscription_end
      ? new Date(u.subscription_end).toLocaleDateString('fr-FR')
      : '—';
    const created = new Date(u.created_at).toLocaleDateString('fr-FR');
    const tr = document.createElement('tr');
    tr.innerHTML = '<td style="color:#94a3b8">' + safeId + '</td>' +
      '<td>' + safeEmail + '</td>' +
      '<td>' + badge + '</td>' +
      '<td>' + created + '</td>' +
      '<td id="end-' + safeId + '">' + end + '</td>' +
      '<td><div class="action-cell">' +
        '<button class="ext-btn" data-id="' + safeId + '" data-months="1">+1 mois</button>' +
        '<button class="ext-btn" data-id="' + safeId + '" data-months="3">+3 mois</button>' +
        '<button class="del-btn" data-id="' + safeId + '">Supprimer</button>' +
      '</div></td>';
    tbody.appendChild(tr);
  });
}

document.getElementById('users-tbody').addEventListener('click', async (e) => {
  const delBtn = e.target.closest('.del-btn');
  if (delBtn) {
    const id = delBtn.dataset.id;
    const user = allUsers.find(u => u.id == id);
    if (!user) return;
    if (!confirm('Supprimer le compte de ' + user.email + ' ?\nCette action est irréversible.')) return;
    const res = await fetch('/api/admin/users/' + id, { method: 'DELETE' });
    if (res.ok) {
      allUsers = allUsers.filter(u => u.id != id);
      renderUsers(filterUsers());
      await loadStats();
    } else {
      alert('Erreur lors de la suppression');
    }
    return;
  }

  const extBtn = e.target.closest('.ext-btn');
  if (extBtn) {
    const id = extBtn.dataset.id;
    const months = parseInt(extBtn.dataset.months);
    const user = allUsers.find(u => u.id == id);
    if (!user) return;
    extBtn.disabled = true;
    extBtn.textContent = '...';
    const res = await fetch('/api/admin/users/' + id + '/extend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ months: months })
    });
    if (res.ok) {
      const data = await res.json();
      user.subscription_status = 'active';
      user.subscription_end = data.subscription_end;
      const cell = document.getElementById('end-' + parseInt(id));
      if (cell) cell.textContent = new Date(data.subscription_end).toLocaleDateString('fr-FR');
      await loadStats();
    } else {
      alert("Erreur lors de l'extension");
    }
    extBtn.disabled = false;
    extBtn.textContent = '+' + months + ' mois';
    return;
  }
});

document.getElementById('search-input').addEventListener('input', () => {
  renderUsers(filterUsers());
});

function filterUsers() {
  const q = document.getElementById('search-input').value.toLowerCase();
  return q ? allUsers.filter(u => u.email.toLowerCase().includes(q)) : allUsers;
}

document.getElementById('refresh-btn').addEventListener('click', async () => {
  await loadStats();
  await loadUsers();
});

// --- Login form ---
document.getElementById('admin-login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password })
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Erreur de connexion';
      errEl.style.display = 'block';
      return;
    }
    // Re-check admin access
    const adminRes = await fetch('/api/admin/stats');
    if (!adminRes.ok) {
      errEl.textContent = 'Ce compte n\'a pas accès à l\'admin.';
      errEl.style.display = 'block';
      return;
    }
    const stats = await adminRes.json();
    showDashboard();
    document.getElementById('stat-total').textContent = stats.total;
    document.getElementById('stat-active').textContent = stats.active;
    document.getElementById('stat-trial').textContent = stats.trial;
    document.getElementById('stat-expired').textContent = stats.expired;
    loadAnalytics();
    loadUsers();
  } catch (err) {
    errEl.textContent = 'Erreur réseau';
    errEl.style.display = 'block';
  }
});

// --- Init ---
tryLoadDashboard();
