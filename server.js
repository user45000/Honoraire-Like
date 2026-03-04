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

// === Store de session SQLite (persist across restarts) ===
db.exec(`CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expired INTEGER NOT NULL
)`);
// Nettoyage des sessions expirées au démarrage
db.prepare('DELETE FROM sessions WHERE expired < ?').run(Date.now());

// === Tokens de réinitialisation de mot de passe ===
db.exec(`CREATE TABLE IF NOT EXISTS password_resets (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires INTEGER NOT NULL
)`);
db.prepare('DELETE FROM password_resets WHERE expires < ?').run(Date.now());

class SQLiteSessionStore extends session.Store {
  get(sid, cb) {
    const row = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expired > ?').get(sid, Date.now());
    cb(null, row ? JSON.parse(row.sess) : null);
  }
  set(sid, sess, cb) {
    const maxAge = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 24 * 60 * 60 * 1000;
    const expired = Date.now() + maxAge;
    db.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)').run(sid, JSON.stringify(sess), expired);
    cb(null);
  }
  destroy(sid, cb) {
    db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
    cb(null);
  }
  touch(sid, sess, cb) {
    const maxAge = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 24 * 60 * 60 * 1000;
    db.prepare('UPDATE sessions SET expired = ? WHERE sid = ?').run(Date.now() + maxAge, sid);
    if (cb) cb(null);
  }
}

// === Email (OVH MX Plan SMTP) ===
const emailTransporter = process.env.OVH_EMAIL_PASS
  ? nodemailer.createTransport({
      host: 'ssl0.ovh.net',
      port: 465,
      secure: true,
      auth: { user: 'contact@honorairesmg.fr', pass: process.env.OVH_EMAIL_PASS }
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

// Enveloppe HTML email — compatible Gmail / Apple Mail / Outlook
function buildEmail(content) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
</head>
<body style="margin:0;padding:0;background-color:#F0F5FF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background-color:#F0F5FF">
  <tr><td align="center" style="padding:36px 16px">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="max-width:560px">

      <!-- EN-TÊTE -->
      <tr>
        <td style="background-color:#1B2D4F;border-radius:16px 16px 0 0;padding:32px 40px;text-align:center">
          <img src="https://honorairesmg.fr/icons/icon-192.png" width="60" height="60" alt="" style="display:block;margin:0 auto 16px;border-radius:15px">
          <div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.025em">Honoraires MG</div>
          <div style="color:#93c5fd;font-size:13px;margin-top:3px">Calcul d'honoraires pour médecins généralistes</div>
        </td>
      </tr>

      <!-- CORPS -->
      <tr>
        <td style="background-color:#ffffff;padding:40px 40px 36px">
          ${content}
        </td>
      </tr>

      <!-- PIED DE PAGE -->
      <tr>
        <td style="background-color:#F0F5FF;border-radius:0 0 16px 16px;border-top:1px solid #e2e8f0;padding:20px 40px 32px;text-align:center">
          <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.8">
            RiBang Studio &nbsp;·&nbsp;
            <a href="https://honorairesmg.fr" style="color:#60A5FA;text-decoration:none">honorairesmg.fr</a>
            &nbsp;·&nbsp;
            <a href="mailto:contact@honorairesmg.fr" style="color:#60A5FA;text-decoration:none">contact@honorairesmg.fr</a><br>
            <span style="font-size:11px">Vous recevez cet email car vous avez créé un compte sur honorairesmg.fr</span>
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
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
          const r = db.prepare('INSERT INTO users (email, password_hash, accepted_terms) VALUES (?, ?, 1)').run(guestEmail, hash);
          existing = { id: r.lastInsertRowid };
          sendEmail(guestEmail, 'Votre accès Honoraires MG est actif', buildEmail(`
            <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-bottom:28px">
              <tr><td align="center">
                <table cellpadding="0" cellspacing="0" border="0" role="presentation">
                  <tr>
                    <td width="68" height="68" style="background-color:#2563EB;border-radius:34px;text-align:center;vertical-align:middle">
                      <span style="color:#ffffff;font-size:30px;line-height:68px;display:block">&#10003;</span>
                    </td>
                  </tr>
                </table>
              </td></tr>
            </table>

            <h1 style="margin:0 0 6px;font-size:26px;font-weight:700;color:#1B2D4F;letter-spacing:-0.03em;text-align:center">Votre accès est actif !</h1>
            <p style="margin:0 0 32px;font-size:15px;color:#64748b;text-align:center">Merci pour votre abonnement.</p>

            <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.65">
              Un compte a été créé automatiquement pour vous. Voici vos identifiants&nbsp;:
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-bottom:20px">
              <tr>
                <td style="background-color:#F0F5FF;border-radius:12px;padding:20px 24px">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
                    <tr>
                      <td style="padding-bottom:10px;border-bottom:1px solid #e2e8f0">
                        <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px">Email</div>
                        <div style="font-size:15px;font-weight:500;color:#1B2D4F">${guestEmail}</div>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding-top:10px">
                        <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px">Mot de passe temporaire</div>
                        <div style="font-size:15px;font-weight:500;color:#1B2D4F;font-family:monospace,Courier">${tempPass}</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-bottom:28px">
              <tr>
                <td style="background-color:#fffbeb;border-radius:10px;border-left:4px solid #f59e0b;padding:14px 18px">
                  <div style="font-size:13px;color:#92400e;line-height:1.5">
                    <strong>Changez votre mot de passe</strong> dès votre premi&egrave;re connexion depuis l'onglet <strong>Compte</strong>.
                  </div>
                </td>
              </tr>
            </table>

            <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-bottom:20px">
              <tr>
                <td align="center">
                  <a href="https://honorairesmg.fr" style="display:inline-block;background-color:#2563EB;color:#ffffff;font-size:15px;font-weight:600;padding:14px 38px;border-radius:10px;text-decoration:none">Se connecter &rarr;</a>
                </td>
              </tr>
            </table>

            <p style="margin:0;font-size:13px;color:#94a3b8;text-align:center">Une question&nbsp;? Écrivez-nous à <a href="mailto:contact@honorairesmg.fr" style="color:#2563EB;text-decoration:none">contact@honorairesmg.fr</a></p>
          `));
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
      if (paidUser) sendEmail(paidUser.email, 'Votre abonnement Honoraires MG est actif', buildEmail(`
        <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-bottom:28px">
          <tr><td align="center">
            <table cellpadding="0" cellspacing="0" border="0" role="presentation">
              <tr>
                <td width="68" height="68" style="background-color:#2563EB;border-radius:34px;text-align:center;vertical-align:middle">
                  <span style="color:#ffffff;font-size:30px;line-height:68px;display:block">&#10003;</span>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>

        <h1 style="margin:0 0 6px;font-size:26px;font-weight:700;color:#1B2D4F;letter-spacing:-0.03em;text-align:center">Abonnement actif !</h1>
        <p style="margin:0 0 32px;font-size:15px;color:#64748b;text-align:center">Merci pour votre confiance et votre soutien.</p>

        <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.65">
          Votre accès illimité à Honoraires MG est maintenant actif. Calculez vos honoraires sans limite, à tout moment.
        </p>

        <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background-color:#F0F5FF;border-radius:12px;margin-bottom:32px">
          <tr>
            <td style="padding:20px 24px">
              <div style="font-size:13px;color:#334155;line-height:2.1">
                <div>&#10003;&nbsp; <strong>Calcul illimité</strong> &mdash; consultations, visites, actes CCAM</div>
                <div>&#10003;&nbsp; <strong>Tous secteurs</strong> &mdash; S1, S2 OPTAM, S2 hors OPTAM</div>
                <div>&#10003;&nbsp; <strong>Toutes périodes</strong> &mdash; jour, nuit, week-end, jours fériés</div>
                <div>&#10003;&nbsp; <strong>IK automatiques</strong> &mdash; calcul depuis votre adresse cabinet</div>
              </div>
            </td>
          </tr>
        </table>

        <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-bottom:20px">
          <tr>
            <td align="center">
              <a href="https://honorairesmg.fr" style="display:inline-block;background-color:#2563EB;color:#ffffff;font-size:15px;font-weight:600;padding:14px 38px;border-radius:10px;text-decoration:none">Accéder à l'application &rarr;</a>
            </td>
          </tr>
        </table>

        <p style="margin:0;font-size:13px;color:#94a3b8;text-align:center">Pour gérer ou annuler votre abonnement&nbsp;: onglet&nbsp;<strong>Compte</strong>&nbsp;&rarr;&nbsp;<strong>Gérer mon abonnement</strong></p>
      `));
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

// En-têtes de sécurité HTTP
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self' https://api-adresse.data.gouv.fr https://router.project-osrm.org https://api.stripe.com; " +
    "frame-src https://js.stripe.com https://hooks.stripe.com; " +
    "object-src 'none';"
  );
  next();
});

// Rate limiter en mémoire (pas de dépendance externe)
const _rl = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = (req.ip || '') + req.path;
    const now = Date.now();
    const hits = (_rl.get(key) || []).filter(t => now - t < windowMs);
    if (hits.length >= max) {
      return res.status(429).json({ error: 'Trop de tentatives, réessayez plus tard' });
    }
    hits.push(now);
    _rl.set(key, hits);
    next();
  };
}

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  console.error('FATAL: SESSION_SECRET non défini. Définissez une valeur forte dans .env.stripe');
  process.exit(1);
}
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  store: new SQLiteSessionStore(),
  cookie: { httpOnly: true, sameSite: 'strict' }
}));

// === Tarifs ===
const tarifsPath = path.join(__dirname, 'data', 'tarifs.json');
let tarifs = JSON.parse(fs.readFileSync(tarifsPath, 'utf8'));

app.use(express.static(path.join(__dirname, 'public')));

// === API Tarifs ===
app.get('/api/tarifs', rateLimit(60, 60000), (req, res) => res.json(tarifs));

app.get('/api/ccam', rateLimit(60, 60000), (req, res) => {
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

// Validation email simple
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// === API Auth ===
app.post('/api/auth/register', rateLimit(10, 15 * 60 * 1000), (req, res) => {
  const { email, password, acceptedTerms } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
  const emailClean = email.toLowerCase().trim();
  if (!emailRegex.test(emailClean)) return res.status(400).json({ error: 'Email invalide' });
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe minimum 6 caractères' });
  if (!acceptedTerms) return res.status(400).json({ error: 'Vous devez accepter les CGU/CGV' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (email, password_hash, accepted_terms) VALUES (?, ?, 1)').run(emailClean, hash);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    req.session.userId = user.id;
    sendEmail(emailClean, 'Bienvenue sur Honoraires MG', buildEmail(`
      <h1 style="margin:0 0 6px;font-size:26px;font-weight:700;color:#1B2D4F;letter-spacing:-0.03em">Bienvenue !</h1>
      <p style="margin:0 0 28px;font-size:15px;color:#64748b">Votre compte Honoraires MG est prêt.</p>

      <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.65">
        Honoraires MG vous aide à calculer en quelques secondes vos honoraires de médecin généraliste — consultations, visites à domicile, actes CCAM — selon les tarifs de la convention médicale 2024-2029.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-bottom:32px">
        <tr>
          <td style="background-color:#F0F5FF;border-radius:12px;border-left:4px solid #2563EB;padding:18px 22px">
            <div style="font-size:14px;font-weight:600;color:#2563EB;margin-bottom:5px">Accès illimité à partir de 0,99&nbsp;€/mois</div>
            <div style="font-size:13px;color:#64748b;line-height:1.5">Abonnez-vous depuis l'onglet <strong>Compte</strong> de l'application pour calculer vos honoraires sans limite.</div>
          </td>
        </tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-bottom:28px">
        <tr>
          <td align="center">
            <a href="https://honorairesmg.fr" style="display:inline-block;background-color:#2563EB;color:#ffffff;font-size:15px;font-weight:600;padding:14px 38px;border-radius:10px;text-decoration:none;letter-spacing:-0.01em">Ouvrir l'application &rarr;</a>
          </td>
        </tr>
      </table>

      <p style="margin:0;font-size:13px;color:#94a3b8;text-align:center">Une question&nbsp;? Répondez à cet email ou écrivez-nous à <a href="mailto:contact@honorairesmg.fr" style="color:#2563EB;text-decoration:none">contact@honorairesmg.fr</a></p>
    `));
    res.json({ user: safeUser(user) });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Email déjà utilisé' });
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/auth/login', rateLimit(10, 15 * 60 * 1000), (req, res) => {
  const { email, password, rememberMe } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Identifiants invalides' });
  }
  req.session.userId = user.id;
  if (rememberMe) {
    req.session.cookie.maxAge = 180 * 24 * 60 * 60 * 1000; // 6 mois (renouvelé à chaque visite)
  }
  // else : cookie de session (expire à la fermeture du navigateur)
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

// Mot de passe oublié — envoie un lien de réinitialisation
app.post('/api/auth/forgot-password', rateLimit(5, 15 * 60 * 1000), (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email requis' });
  const emailClean = email.toLowerCase().trim();
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(emailClean);
  res.json({ ok: true }); // toujours succès (ne pas révéler si l'email existe)
  if (!user) return;
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT OR REPLACE INTO password_resets (token, user_id, expires) VALUES (?, ?, ?)').run(token, user.id, Date.now() + 15 * 60 * 1000);
  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  sendEmail(emailClean, 'Réinitialisation de votre mot de passe — Honoraires MG', buildEmail(`
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1B2D4F;letter-spacing:-0.03em">Réinitialiser votre mot de passe</h1>
    <p style="margin:0 0 24px;font-size:15px;color:#64748b">Vous avez demandé la réinitialisation de votre mot de passe Honoraires MG. Ce lien est valable <strong>15 minutes</strong>.</p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-bottom:24px">
      <tr><td align="center">
        <a href="${appUrl}/?reset=${token}" style="display:inline-block;background:#2563EB;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 32px;border-radius:8px">Réinitialiser mon mot de passe</a>
      </td></tr>
    </table>
    <p style="margin:0;font-size:13px;color:#94a3b8">Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.</p>
  `));
});

// Réinitialisation du mot de passe avec token
app.post('/api/auth/reset-password', rateLimit(10, 15 * 60 * 1000), (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Données manquantes' });
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe minimum 6 caractères' });
  const reset = db.prepare('SELECT * FROM password_resets WHERE token = ? AND expires > ?').get(token, Date.now());
  if (!reset) return res.status(400).json({ error: 'Lien invalide ou expiré' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), reset.user_id);
  db.prepare('DELETE FROM password_resets WHERE token = ?').run(token);
  res.json({ ok: true });
});

// Changement de mot de passe (connecté)
app.post('/api/auth/change-password', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  const { password } = req.body || {};
  if (!password || password.length < 6) return res.status(400).json({ error: 'Mot de passe minimum 6 caractères' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), req.session.userId);
  res.json({ ok: true });
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
    res.status(500).json({ error: 'Erreur lors de la création du paiement' });
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
    res.status(500).json({ error: 'Erreur lors de l\'accès au portail' });
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
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();

function requireAdmin(req, res, next) {
  if (!ADMIN_EMAIL) return res.status(503).json({ error: 'Admin non configuré' });
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(req.session.userId);
  if (!user || user.email.toLowerCase() !== ADMIN_EMAIL) return res.status(403).json({ error: 'Accès non autorisé' });
  next();
}

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

app.post('/api/admin/users/:id/extend', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const months = Math.max(1, Math.min(24, parseInt(req.body.months) || 1));
  const user = db.prepare('SELECT subscription_end FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const base = user.subscription_end && new Date(user.subscription_end) > new Date()
    ? new Date(user.subscription_end)
    : new Date();
  base.setMonth(base.getMonth() + months);
  const newEnd = base.toISOString();
  db.prepare("UPDATE users SET subscription_status = 'active', subscription_end = ? WHERE id = ?").run(newEnd, id);
  res.json({ ok: true, subscription_end: newEnd });
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
