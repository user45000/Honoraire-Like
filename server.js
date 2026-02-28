const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3001;

// === Base de données SQLite ===
const db = new Database(path.join(__dirname, 'data', 'honoraire.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    subscription_status TEXT DEFAULT 'trial',
    subscription_end TEXT,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT
  )
`);

// === Middleware ===
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'hon-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 jours
}));

// === Tarifs ===
const tarifsPath = path.join(__dirname, 'data', 'tarifs.json');
let tarifs = JSON.parse(fs.readFileSync(tarifsPath, 'utf8'));

app.use(express.static(path.join(__dirname, 'public')));

// === API Tarifs ===
app.get('/api/tarifs', (req, res) => res.json(tarifs));

app.get('/api/ccam', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.json(tarifs.ccam || []);
  const results = (tarifs.ccam || []).filter(a =>
    a.code.toLowerCase().includes(q) || a.label.toLowerCase().includes(q)
  );
  res.json(results);
});

// === Auth helper ===
function safeUser(user) {
  const { password_hash, ...rest } = user;
  return rest;
}

// === API Auth ===
app.post('/api/auth/register', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe minimum 6 caractères' });
  const emailClean = email.toLowerCase().trim();
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(emailClean, hash);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    req.session.userId = user.id;
    res.json({ user: safeUser(user) });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Email déjà utilisé' });
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  }
  req.session.userId = user.id;
  res.json({ user: safeUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.json({ user: null });
  res.json({ user: safeUser(user) });
});

// === SPA fallback ===
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Honoraire Like running on http://localhost:${PORT}`);
});
