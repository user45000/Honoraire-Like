const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');

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
    stripe_subscription_id TEXT,
    accepted_terms INTEGER DEFAULT 0
  )
`);
// Migration : ajouter les colonnes si elles n'existent pas
try { db.exec('ALTER TABLE users ADD COLUMN accepted_terms INTEGER DEFAULT 0'); } catch (e) {}

// === Email (Gmail SMTP — affiché comme contact@honorairesmg.fr) ===
const emailTransporter = process.env.GMAIL_APP_PASSWORD
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
    })
  : null;

async function sendEmail(to, subject, html) {
  if (!emailTransporter) return;
  try {
    await emailTransporter.sendMail({
      from: '"Honoraires MG" <contact@honorairesmg.fr>',
      to, subject, html
    });
  } catch (e) {
    console.error('Email error:', e.message);
  }
}

// === Stripe (webhook DOIT être avant express.json) ===
const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeKey ? require('stripe')(stripeKey) : null;

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) return res.status(500).json({ error: 'Stripe non configuré' });

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], webhookSecret);
  } catch (e) {
    console.error('Webhook signature error:', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      let userId = session.metadata?.userId ? parseInt(session.metadata.userId) : null;

      // Guest checkout : créer le compte automatiquement
      if (!userId && session.customer_details?.email) {
        const guestEmail = session.customer_details.email.toLowerCase().trim();
        let existing = db.prepare('SELECT id FROM users WHERE email = ?').get(guestEmail);
        if (!existing) {
          const tempPass = crypto.randomBytes(12).toString('hex');
          const hash = bcrypt.hashSync(tempPass, 10);
          const r = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(guestEmail, hash);
          existing = { id: r.lastInsertRowid };
          sendEmail(guestEmail, 'Votre compte Honoraires MG', `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
              <h2 style="color:#1B2D4F">Bienvenue sur Honoraires MG !</h2>
              <p>Votre abonnement est actif. Un compte a été créé automatiquement :</p>
              <p><strong>Email :</strong> ${guestEmail}<br>
              <strong>Mot de passe temporaire :</strong> ${tempPass}</p>
              <p>Connectez-vous depuis l'onglet <strong>Compte</strong> et changez votre mot de passe.</p>
              <p style="margin-top:24px;color:#64748B;font-size:12px">
                Honoraires MG — <a href="https://honorairesmg.fr" style="color:#2563EB">honorairesmg.fr</a><br>
                Pour toute question : <a href="mailto:contact@honorairesmg.fr" style="color:#2563EB">contact@honorairesmg.fr</a>
              </p>
            </div>`);
        }
        userId = existing.id;
      }

      if (!userId) break;
      db.prepare(`UPDATE users SET
        stripe_customer_id = ?,
        stripe_subscription_id = ?,
        subscription_status = 'active'
        WHERE id = ?`
      ).run(session.customer, session.subscription, userId);
      const paidUser = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
      if (paidUser) sendEmail(paidUser.email, 'Abonnement Honoraires MG activé', `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#1B2D4F">Merci pour votre abonnement !</h2>
          <p>Votre accès illimité à Honoraires MG est maintenant actif.</p>
          <p>Pour gérer ou annuler votre abonnement, rendez-vous dans l'onglet <strong>Compte</strong> de l'application.</p>
          <p style="margin-top:24px;color:#64748B;font-size:12px">
            Honoraires MG — <a href="https://honorairesmg.fr" style="color:#2563EB">honorairesmg.fr</a><br>
            Pour toute question : <a href="mailto:contact@honorairesmg.fr" style="color:#2563EB">contact@honorairesmg.fr</a>
          </p>
        </div>`);
      break;
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const user = db.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').get(sub.customer);
      if (user) {
        const status = sub.status === 'active' ? 'active' : 'expired';
        const end = new Date(sub.current_period_end * 1000).toISOString();
        db.prepare('UPDATE users SET subscription_status = ?, subscription_end = ? WHERE id = ?')
          .run(status, end, user.id);
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const user = db.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').get(sub.customer);
      if (user) {
        db.prepare('UPDATE users SET subscription_status = ?, subscription_end = NULL WHERE id = ?')
          .run('expired', user.id);
      }
      break;
    }
  }
  res.json({ received: true });
});

// === Middleware ===
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'hon-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
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
  const { email, password, acceptedTerms } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe minimum 6 caractères' });
  if (!acceptedTerms) return res.status(400).json({ error: 'Vous devez accepter les CGU/CGV' });
  const emailClean = email.toLowerCase().trim();
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (email, password_hash, accepted_terms) VALUES (?, ?, 1)').run(emailClean, hash);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    req.session.userId = user.id;
    sendEmail(emailClean, 'Bienvenue sur Honoraires MG', `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#1B2D4F">Bienvenue sur Honoraires MG</h2>
        <p>Votre compte a été créé avec succès.</p>
        <p>Vous bénéficiez de 3 utilisations gratuites. Pour un accès illimité, abonnez-vous depuis l'onglet <strong>Compte</strong> de l'application.</p>
        <p style="margin-top:24px;color:#64748B;font-size:12px">
          Honoraires MG — <a href="https://honorairesmg.fr" style="color:#2563EB">honorairesmg.fr</a><br>
          Pour toute question : <a href="mailto:contact@honorairesmg.fr" style="color:#2563EB">contact@honorairesmg.fr</a>
        </p>
      </div>`);
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

// Suppression de compte (RGPD)
app.delete('/api/auth/account', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  try {
    db.prepare('DELETE FROM users WHERE id = ?').run(req.session.userId);
    req.session.destroy(() => res.json({ ok: true }));
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// === API Stripe ===
app.post('/api/stripe/create-checkout-session', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  if (!stripe) return res.status(500).json({ error: 'Stripe non configuré' });

  const { plan } = req.body;
  const priceId = plan === 'year'
    ? process.env.STRIPE_PRICE_YEAR
    : process.env.STRIPE_PRICE_MONTH;
  if (!priceId) return res.status(500).json({ error: 'Price ID Stripe manquant' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Utilisateur introuvable' });

  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;

  try {
    const params = {
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { userId: user.id.toString() },
      success_url: `${appUrl}/?payment=success`,
      cancel_url: `${appUrl}/?payment=cancel`,
    };
    // Réutiliser le customer Stripe existant si possible
    if (user.stripe_customer_id) {
      params.customer = user.stripe_customer_id;
    } else {
      params.customer_email = user.email;
    }
    const session = await stripe.checkout.sessions.create(params);
    res.json({ url: session.url });
  } catch (e) {
    console.error('Stripe checkout error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Portail client Stripe (gérer / annuler l'abonnement)
app.post('/api/stripe/customer-portal', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  if (!stripe) return res.status(500).json({ error: 'Stripe non configuré' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user?.stripe_customer_id) return res.status(400).json({ error: 'Aucun abonnement actif' });

  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: appUrl,
    });
    res.json({ url: portal.url });
  } catch (e) {
    console.error('Stripe portal error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Guest checkout — pas d'auth requise, Stripe collecte l'email
app.post('/api/stripe/guest-checkout', async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe non configuré' });
  const { plan } = req.body;
  const priceId = plan === 'year' ? process.env.STRIPE_PRICE_YEAR : process.env.STRIPE_PRICE_MONTH;
  if (!priceId) return res.status(500).json({ error: 'Price ID Stripe manquant' });
  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/?payment=success`,
      cancel_url: `${appUrl}/?payment=cancel`,
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error('Guest checkout error:', e);
    res.status(500).json({ error: e.message });
  }
});

// === Admin ===
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'Admin non configuré' });
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Non autorisé' });
  next();
}

app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'Admin non configuré' });
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Mot de passe incorrect' });
  req.session.isAdmin = true;
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.isAdmin = false;
  res.json({ ok: true });
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  const active = db.prepare("SELECT COUNT(*) as n FROM users WHERE subscription_status = 'active'").get().n;
  const trial = db.prepare("SELECT COUNT(*) as n FROM users WHERE subscription_status = 'trial'").get().n;
  const expired = db.prepare("SELECT COUNT(*) as n FROM users WHERE subscription_status = 'expired'").get().n;
  res.json({ total, active, trial, expired });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = db.prepare(
    'SELECT id, email, created_at, subscription_status, subscription_end, stripe_customer_id FROM users ORDER BY created_at DESC'
  ).all();
  res.json(users);
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(parseInt(req.params.id));
  res.json({ ok: true });
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// === SPA fallback ===
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Honoraire Like running on http://localhost:${PORT}`);
  if (!stripe) console.warn('⚠ Stripe non configuré (STRIPE_SECRET_KEY manquant)');
});
