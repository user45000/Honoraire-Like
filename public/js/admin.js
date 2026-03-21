let allUsers = [];

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
    await loadUsers();
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
    tr.innerHTML = `
      <td style="color:#94a3b8">${safeId}</td>
      <td>${safeEmail}</td>
      <td>${badge}</td>
      <td>${created}</td>
      <td id="end-${safeId}">${end}</td>
      <td><div class="action-cell">
        <button class="ext-btn" data-id="${safeId}" data-months="1">+1 mois</button>
        <button class="ext-btn" data-id="${safeId}" data-months="3">+3 mois</button>
        <button class="del-btn" data-id="${safeId}">Supprimer</button>
      </div></td>
    `;
    tbody.appendChild(tr);
  });
}

document.getElementById('users-tbody').addEventListener('click', async (e) => {
  const delBtn = e.target.closest('.del-btn');
  if (delBtn) {
    const id = delBtn.dataset.id;
    const user = allUsers.find(u => u.id == id);
    if (!user) return;
    if (!confirm(`Supprimer le compte de ${user.email} ?\nCette action est irréversible.`)) return;
    const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
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
    extBtn.textContent = '…';
    const res = await fetch(`/api/admin/users/${id}/extend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ months })
    });
    if (res.ok) {
      const data = await res.json();
      user.subscription_status = 'active';
      user.subscription_end = data.subscription_end;
      const cell = document.getElementById(`end-${parseInt(id)}`);
      if (cell) cell.textContent = new Date(data.subscription_end).toLocaleDateString('fr-FR');
      await loadStats();
    } else {
      alert('Erreur lors de l\'extension');
    }
    extBtn.disabled = false;
    extBtn.textContent = `+${months} mois`;
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

tryLoadDashboard();
