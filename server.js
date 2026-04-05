const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');

const app = express();
app.disable('x-powered-by');
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
try { db.exec('ALTER TABLE users ADD COLUMN preferences TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN fds_month_count INTEGER DEFAULT 0'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN fds_month_key TEXT DEFAULT \'\''); } catch (e) {}
try { db.exec('ALTER TABLE page_views ADD COLUMN is_bot INTEGER DEFAULT 0'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN last_login_at TEXT'); } catch (e) {}

// === Historique consultations ===
db.exec(`CREATE TABLE IF NOT EXISTS consult_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  tab TEXT,
  codes TEXT,
  total REAL,
  amo REAL,
  amc REAL,
  details TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_ch_user ON consult_history(user_id, created_at)`);

// === Historique IK ===
db.exec(`CREATE TABLE IF NOT EXISTS ik_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  from_addr TEXT,
  to_addr TEXT,
  km REAL,
  amount REAL,
  codes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_ikh_user ON ik_history(user_id, created_at)`);

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

// === Analytics ===
db.exec(`CREATE TABLE IF NOT EXISTS page_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  session_hash TEXT NOT NULL,
  path TEXT NOT NULL,
  method TEXT DEFAULT 'GET',
  device_type TEXT,
  os TEXT,
  browser TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_pv_created ON page_views(created_at)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_pv_session ON page_views(session_hash)`);

db.exec(`CREATE TABLE IF NOT EXISTS tab_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  session_hash TEXT NOT NULL,
  tab_name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_tu_created ON tab_usage(created_at)`);

try { db.exec('ALTER TABLE page_views ADD COLUMN visitor_id TEXT'); } catch (e) {}
db.exec('CREATE INDEX IF NOT EXISTS idx_pv_visitor ON page_views(visitor_id)');

// Purge analytics > 90 jours au démarrage
db.prepare("DELETE FROM page_views WHERE created_at < datetime('now', '-90 days')").run();
db.prepare("DELETE FROM tab_usage WHERE created_at < datetime('now', '-90 days')").run();

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
          <img src="https://www.honorairesmg.fr/icons/icon-192.png" width="60" height="60" alt="" style="display:block;margin:0 auto 16px;border-radius:15px">
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
            <a href="https://www.honorairesmg.fr" style="color:#60A5FA;text-decoration:none">honorairesmg.fr</a>
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

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
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
                  <a href="https://www.honorairesmg.fr" style="display:inline-block;background-color:#2563EB;color:#ffffff;font-size:15px;font-weight:600;padding:14px 38px;border-radius:10px;text-decoration:none">Se connecter &rarr;</a>
                </td>
              </tr>
            </table>

            <p style="margin:0;font-size:13px;color:#94a3b8;text-align:center">Une question&nbsp;? Écrivez-nous à <a href="mailto:contact@honorairesmg.fr" style="color:#2563EB;text-decoration:none">contact@honorairesmg.fr</a></p>
          `));
        }
        userId = existing.id;
      }

      if (!userId) break;
      let subscriptionEnd = null;
      if (session.subscription && stripe) {
        try {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          subscriptionEnd = new Date(sub.current_period_end * 1000).toISOString();
        } catch (e) {
          console.error('Erreur récupération subscription:', e.message);
        }
      }
      db.prepare(`UPDATE users SET
        stripe_customer_id = ?,
        stripe_subscription_id = ?,
        subscription_status = 'active',
        subscription_end = ?
        WHERE id = ?`
      ).run(session.customer, session.subscription, subscriptionEnd, userId);
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
              <a href="https://www.honorairesmg.fr" style="display:inline-block;background-color:#2563EB;color:#ffffff;font-size:15px;font-weight:600;padding:14px 38px;border-radius:10px;text-decoration:none">Accéder à l'application &rarr;</a>
            </td>
          </tr>
        </table>

        <p style="margin:0;font-size:13px;color:#94a3b8;text-align:center">Pour gérer ou annuler votre abonnement&nbsp;: onglet&nbsp;<strong>Compte</strong>&nbsp;&rarr;&nbsp;<strong>Gérer mon abonnement</strong></p>
      `));
      break;
    }
    case 'customer.subscription.created':
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
    case 'invoice.paid': {
      const invoice = event.data.object;
      if (!invoice.customer_email || !invoice.hosted_invoice_url) break;
      const amount = (invoice.amount_paid / 100).toFixed(2).replace('.', ',');
      const date = new Date(invoice.created * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
      sendEmail(invoice.customer_email, `Facture Honoraires MG — ${amount} €`, buildEmail(`
        <h1 style="margin:0 0 6px;font-size:24px;font-weight:700;color:#1B2D4F;letter-spacing:-0.03em;text-align:center">Votre facture</h1>
        <p style="margin:0 0 24px;font-size:15px;color:#64748b;text-align:center">${date}</p>

        <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-bottom:24px">
          <tr>
            <td style="background-color:#F0F5FF;border-radius:12px;padding:20px 24px;text-align:center">
              <div style="font-size:13px;color:#64748b;margin-bottom:6px">Montant pay&eacute;</div>
              <div style="font-size:28px;font-weight:700;color:#1B2D4F">${amount} &euro;</div>
              <div style="font-size:12px;color:#94a3b8;margin-top:4px">${invoice.lines?.data?.[0]?.description || 'Abonnement Honoraires MG'}</div>
            </td>
          </tr>
        </table>

        <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.65;text-align:center">
          Merci pour votre confiance et votre soutien.&nbsp;Votre abonnement nous permet de maintenir Honoraires&nbsp;MG &agrave; jour et de continuer &agrave; am&eacute;liorer l'outil au quotidien.
        </p>

        <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-bottom:20px">
          <tr><td align="center">
            <a href="${invoice.hosted_invoice_url}" style="display:inline-block;background-color:#2563EB;color:#ffffff;font-size:15px;font-weight:600;padding:14px 38px;border-radius:10px;text-decoration:none">Voir la facture &rarr;</a>
          </td></tr>
        </table>

        <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center">
          ${invoice.invoice_pdf ? '<a href="' + invoice.invoice_pdf + '" style="color:#2563EB;text-decoration:none">T&eacute;l&eacute;charger le PDF</a> &nbsp;·&nbsp;' : ''}
          Facture n&deg; ${invoice.number || '—'}
        </p>
      `));
      break;
    }
    case 'charge.refunded': {
      const charge = event.data.object;
      if (!charge.refunded) break; // remboursement partiel, on ignore
      const user = db.prepare('SELECT id, stripe_subscription_id FROM users WHERE stripe_customer_id = ?').get(charge.customer);
      if (user) {
        db.prepare('UPDATE users SET subscription_status = ?, subscription_end = NULL WHERE id = ?')
          .run('expired', user.id);
        // Annuler aussi l'abonnement Stripe pour éviter les futurs prélèvements
        if (user.stripe_subscription_id && stripe) {
          stripe.subscriptions.cancel(user.stripe_subscription_id).catch(e =>
            console.error('Erreur annulation sub après remboursement:', e.message)
          );
        }
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
    "img-src 'self' data:; " +
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

// === Analytics middleware ===
const BOT_UA_RE = /bot|crawler|spider|scraper|slurp|mediapartners|adsbot|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegram|discordbot|applebot|duckduckbot|baiduspider|yandex|sogou|exabot|ia_archiver|archive\.org|wget|curl|python-requests|go-http|java\/|httpclient|axios|node-fetch|undici|lighthouse|headlesschrome|phantomjs|selenium|puppeteer|playwright/i;

function isBot(ua) {
  if (!ua) return true; // pas d'UA = très probablement un bot
  return BOT_UA_RE.test(ua);
}

function parseUA(ua) {
  ua = ua || '';
  const device = /Mobi|Android/i.test(ua) ? 'mobile' : /Tablet|iPad/i.test(ua) ? 'tablet' : 'desktop';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Macintosh/.test(ua) ? 'macOS'
    : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'other';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari'
    : /Firefox\//.test(ua) ? 'Firefox' : 'other';
  return { device, os, browser };
}

const insertPageView = db.prepare('INSERT INTO page_views (user_id, session_hash, visitor_id, path, method, device_type, os, browser, is_bot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
const insertTabUsage = db.prepare('INSERT INTO tab_usage (user_id, session_hash, tab_name) VALUES (?, ?, ?)');

app.use((req, res, next) => {
  if (req.path.match(/\.(js|css|woff2?|png|jpg|ico|svg|json|webmanifest|map)$/) || req.path === '/api/stripe/webhook') return next();
  const bot = isBot(req.headers['user-agent']) ? 1 : 0;
  try {
    const sid = req.sessionID || '';
    const sessionHash = crypto.createHash('sha256').update(sid).digest('hex').slice(0, 16);
    // Cookie persistant pour visiteurs uniques (1 an)
    const cookies = {};
    (req.headers.cookie || '').split(';').forEach(c => { const [k, v] = c.trim().split('='); if (k) cookies[k] = v; });
    let visitorId = cookies.vid;
    if (!visitorId) {
      visitorId = crypto.randomBytes(12).toString('hex');
      res.cookie('vid', visitorId, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'strict' });
    }
    const { device, os, browser } = parseUA(req.headers['user-agent']);
    insertPageView.run(req.session?.userId || null, sessionHash, visitorId, req.path, req.method, device, os, browser, bot);
  } catch (e) { /* never block request */ }
  next();
});

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
  if (rest.preferences) {
    try { rest.preferences = JSON.parse(rest.preferences); } catch (e) { rest.preferences = null; }
  }
  rest.isAdmin = ADMIN_EMAILS.includes((user.email || '').toLowerCase());
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
            <a href="https://www.honorairesmg.fr" style="display:inline-block;background-color:#2563EB;color:#ffffff;font-size:15px;font-weight:600;padding:14px 38px;border-radius:10px;text-decoration:none;letter-spacing:-0.01em">Ouvrir l'application &rarr;</a>
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
  db.prepare('UPDATE users SET last_login_at = datetime(\'now\') WHERE id = ?').run(user.id);
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

// === Préférences utilisateur (sync localStorage ↔ serveur) ===
const PREF_KEYS = ['hon_secteur','hon_zone','hon_geo','hon_garde_samedi','hon_startup_mode','hon_relation','hon_default_relation','hon_cabinet_address','hon_cabinet_citycode','hon_cabinets','hon_cabinet_active','hon_ccam_favs','hon_praticien_nom','hon_praticien_prenom','hon_praticien_rpps','hon_praticien_remplacant','hon_remplace_nom','hon_remplace_prenom'];

app.get('/api/preferences', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  const user = db.prepare('SELECT preferences FROM users WHERE id = ?').get(req.session.userId);
  if (!user || !user.preferences) return res.json({});
  try { res.json(JSON.parse(user.preferences)); }
  catch (e) { res.json({}); }
});

app.put('/api/preferences', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  const prefs = req.body || {};
  // Ne garder que les clés autorisées
  const clean = {};
  for (const key of PREF_KEYS) {
    if (prefs[key] !== undefined) clean[key] = prefs[key];
  }
  db.prepare('UPDATE users SET preferences = ? WHERE id = ?').run(JSON.stringify(clean), req.session.userId);
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
      success_url: `${appUrl}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
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
      success_url: `${appUrl}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/?payment=cancel`,
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error('Guest checkout error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Auto-login après guest checkout via Stripe session_id
app.post('/api/auth/login-by-stripe', async (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId || !stripe) return res.status(400).json({ error: 'Paramètres manquants' });

  try {
    const stripeSession = await stripe.checkout.sessions.retrieve(sessionId);
    if (!stripeSession || stripeSession.payment_status !== 'paid') {
      return res.status(400).json({ error: 'Session de paiement invalide' });
    }
    const email = (stripeSession.customer_details?.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'Email non trouvé dans la session Stripe' });

    // Attendre que le webhook ait créé le compte (retry jusqu'à 10s)
    let user = null;
    for (let i = 0; i < 10; i++) {
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (user && user.subscription_status === 'active') break;
      user = null;
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!user) return res.status(404).json({ error: 'Compte en cours de création, réessayez' });

    req.session.userId = user.id;
    const { password_hash, ...safeU } = user;
    res.json({ user: safeU });
  } catch (e) {
    console.error('Login by Stripe error:', e);
    res.status(500).json({ error: 'Erreur de vérification' });
  }
});

// === Admin ===
const ADMIN_EMAILS = (process.env.ADMIN_EMAIL || '').toLowerCase().split(',').map(e => e.trim()).filter(Boolean);

function requireSubscription(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  const user = db.prepare('SELECT subscription_status FROM users WHERE id = ?').get(req.session.userId);
  if (!user || user.subscription_status !== 'active') return res.status(403).json({ error: 'Abonnement requis' });
  next();
}

function requireAdmin(req, res, next) {
  if (!ADMIN_EMAILS.length) return res.status(503).json({ error: 'Admin non configuré' });
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(req.session.userId);
  if (!user || !ADMIN_EMAILS.includes(user.email.toLowerCase())) return res.status(403).json({ error: 'Accès non autorisé' });
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
    'SELECT id, email, created_at, subscription_status, subscription_end, stripe_customer_id, last_login_at FROM users ORDER BY created_at DESC'
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
  const user = db.prepare('SELECT email, subscription_end FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const base = user.subscription_end && new Date(user.subscription_end) > new Date()
    ? new Date(user.subscription_end)
    : new Date();
  base.setMonth(base.getMonth() + months);
  const newEnd = base.toISOString();
  db.prepare("UPDATE users SET subscription_status = 'active', subscription_end = ? WHERE id = ?").run(newEnd, id);

  // Email de notification
  const endDate = new Date(newEnd).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const duree = months === 1 ? '1 mois' : months + ' mois';
  sendEmail(user.email, `${duree} offert${months > 1 ? 's' : ''} sur Honoraires MG`, buildEmail(`
    <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-bottom:28px">
      <tr><td align="center">
        <table cellpadding="0" cellspacing="0" border="0" role="presentation">
          <tr>
            <td width="68" height="68" style="background-color:#059669;border-radius:34px;text-align:center;vertical-align:middle">
              <span style="color:#ffffff;font-size:30px;line-height:68px;display:block">&#127873;</span>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>

    <h1 style="margin:0 0 6px;font-size:26px;font-weight:700;color:#1B2D4F;letter-spacing:-0.03em;text-align:center">${duree} offert${months > 1 ? 's' : ''} !</h1>
    <p style="margin:0 0 28px;font-size:15px;color:#64748b;text-align:center">Votre acc&egrave;s &agrave; Honoraires MG a &eacute;t&eacute; prolong&eacute;.</p>

    <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-bottom:28px">
      <tr>
        <td style="background-color:#F0F5FF;border-radius:12px;padding:20px 24px;text-align:center">
          <div style="font-size:13px;color:#64748b;margin-bottom:6px">Votre abonnement est actif jusqu'au</div>
          <div style="font-size:22px;font-weight:700;color:#1B2D4F">${endDate}</div>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.65;text-align:center">
      Profitez de l'acc&egrave;s illimit&eacute; pour calculer vos honoraires &mdash; consultations, visites, actes CCAM.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-bottom:20px">
      <tr>
        <td align="center">
          <a href="https://www.honorairesmg.fr" style="display:inline-block;background-color:#2563EB;color:#ffffff;font-size:15px;font-weight:600;padding:14px 38px;border-radius:10px;text-decoration:none">Ouvrir l'application &rarr;</a>
        </td>
      </tr>
    </table>
  `));

  res.json({ ok: true, subscription_end: newEnd });
});

// === Analytics tab tracking ===
app.post('/api/analytics/tab', (req, res) => {
  const { tab } = req.body || {};
  const validTabs = ['consultation', 'visite', 'ccam', 'params', 'account'];
  if (!tab || !validTabs.includes(tab)) return res.status(400).json({ error: 'Invalid tab' });
  try {
    const sid = req.sessionID || '';
    const sessionHash = crypto.createHash('sha256').update(sid).digest('hex').slice(0, 16);
    insertTabUsage.run(req.session?.userId || null, sessionHash, tab);
  } catch (e) { /* ignore */ }
  res.json({ ok: true });
});

// === Analytics admin endpoints ===
app.get('/api/admin/analytics/overview', requireAdmin, (req, res) => {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const d7 = new Date(now - 7 * 86400000).toISOString().slice(0, 10);
  const d30 = new Date(now - 30 * 86400000).toISOString().slice(0, 10);

  const dau = db.prepare("SELECT COUNT(DISTINCT CASE WHEN user_id IS NOT NULL THEN user_id END) as n FROM page_views WHERE is_bot=0 AND date(created_at) = ?").get(today).n;
  const wau = db.prepare("SELECT COUNT(DISTINCT CASE WHEN user_id IS NOT NULL THEN user_id END) as n FROM page_views WHERE is_bot=0 AND date(created_at) >= ?").get(d7).n;
  const mau = db.prepare("SELECT COUNT(DISTINCT CASE WHEN user_id IS NOT NULL THEN user_id END) as n FROM page_views WHERE is_bot=0 AND date(created_at) >= ?").get(d30).n;

  const viewsToday = db.prepare("SELECT COUNT(*) as n FROM page_views WHERE is_bot=0 AND date(created_at) = ?").get(today).n;
  const views7d = db.prepare("SELECT COUNT(*) as n FROM page_views WHERE is_bot=0 AND date(created_at) >= ?").get(d7).n;
  const views30d = db.prepare("SELECT COUNT(*) as n FROM page_views WHERE is_bot=0 AND date(created_at) >= ?").get(d30).n;

  const visitorsToday = db.prepare("SELECT COUNT(DISTINCT COALESCE(visitor_id, session_hash)) as n FROM page_views WHERE is_bot=0 AND date(created_at) = ?").get(today).n;
  const visitors7d = db.prepare("SELECT COUNT(DISTINCT COALESCE(visitor_id, session_hash)) as n FROM page_views WHERE is_bot=0 AND date(created_at) >= ?").get(d7).n;
  const visitors30d = db.prepare("SELECT COUNT(DISTINCT COALESCE(visitor_id, session_hash)) as n FROM page_views WHERE is_bot=0 AND date(created_at) >= ?").get(d30).n;

  const signups7d = db.prepare("SELECT COUNT(*) as n FROM users WHERE date(created_at) >= ?").get(d7).n;
  const signups30d = db.prepare("SELECT COUNT(*) as n FROM users WHERE date(created_at) >= ?").get(d30).n;

  // Mois en cours
  const monthStart = now.toISOString().slice(0, 7) + '-01';
  const viewsMonth = db.prepare("SELECT COUNT(*) as n FROM page_views WHERE is_bot=0 AND date(created_at) >= ?").get(monthStart).n;
  const visitorsMonth = db.prepare("SELECT COUNT(DISTINCT COALESCE(visitor_id, session_hash)) as n FROM page_views WHERE is_bot=0 AND date(created_at) >= ?").get(monthStart).n;
  const usersMonth = db.prepare("SELECT COUNT(DISTINCT CASE WHEN user_id IS NOT NULL THEN user_id END) as n FROM page_views WHERE is_bot=0 AND date(created_at) >= ?").get(monthStart).n;
  const signupsMonth = db.prepare("SELECT COUNT(*) as n FROM users WHERE date(created_at) >= ?").get(monthStart).n;

  // Année en cours
  const yearStart = now.getFullYear() + '-01-01';
  const viewsYear = db.prepare("SELECT COUNT(*) as n FROM page_views WHERE is_bot=0 AND date(created_at) >= ?").get(yearStart).n;
  const visitorsYear = db.prepare("SELECT COUNT(DISTINCT COALESCE(visitor_id, session_hash)) as n FROM page_views WHERE is_bot=0 AND date(created_at) >= ?").get(yearStart).n;
  const usersYear = db.prepare("SELECT COUNT(DISTINCT CASE WHEN user_id IS NOT NULL THEN user_id END) as n FROM page_views WHERE is_bot=0 AND date(created_at) >= ?").get(yearStart).n;
  const signupsYear = db.prepare("SELECT COUNT(*) as n FROM users WHERE date(created_at) >= ?").get(yearStart).n;

  // Tout temps
  const viewsAll = db.prepare("SELECT COUNT(*) as n FROM page_views WHERE is_bot=0").get().n;
  const visitorsAll = db.prepare("SELECT COUNT(DISTINCT COALESCE(visitor_id, session_hash)) as n FROM page_views WHERE is_bot=0").get().n;
  const usersAll = db.prepare("SELECT COUNT(DISTINCT CASE WHEN user_id IS NOT NULL THEN user_id END) as n FROM page_views WHERE is_bot=0 AND user_id IS NOT NULL").get().n;

  const totalUsers = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  const totalActive = db.prepare("SELECT COUNT(*) as n FROM users WHERE subscription_status = 'active'").get().n;
  const conversionRate = totalUsers > 0 ? Math.round((totalActive / totalUsers) * 100) : 0;

  res.json({
    dau, wau, mau, viewsToday, views7d, views30d, visitorsToday, visitors7d, visitors30d, signups7d, signups30d, conversionRate,
    viewsMonth, visitorsMonth, usersMonth, signupsMonth,
    viewsYear, visitorsYear, usersYear, signupsYear,
    viewsAll, visitorsAll, usersAll, totalUsers
  });
});

app.get('/api/admin/analytics/chart', requireAdmin, (req, res) => {
  const days = req.query.period === '90d' ? 90 : req.query.period === '30d' ? 30 : 7;
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT date(created_at) as day,
      SUM(CASE WHEN is_bot=0 THEN 1 ELSE 0 END) as views,
      COUNT(DISTINCT CASE WHEN is_bot=0 THEN COALESCE(visitor_id, session_hash) END) as visitors,
      COUNT(DISTINCT CASE WHEN is_bot=0 AND user_id IS NOT NULL THEN user_id END) as users,
      SUM(CASE WHEN is_bot=1 THEN 1 ELSE 0 END) as bots
    FROM page_views WHERE date(created_at) >= ? GROUP BY day ORDER BY day
  `).all(since);

  const signups = db.prepare("SELECT date(created_at) as day, COUNT(*) as n FROM users WHERE date(created_at) >= ? GROUP BY day ORDER BY day").all(since);
  const signupMap = {};
  signups.forEach(s => signupMap[s.day] = s.n);

  const result = [];
  const d = new Date(since);
  const end = new Date();
  while (d <= end) {
    const ds = d.toISOString().slice(0, 10);
    const row = rows.find(r => r.day === ds);
    result.push({ day: ds, views: row?.views || 0, visitors: row?.visitors || 0, users: row?.users || 0, signups: signupMap[ds] || 0, bots: row?.bots || 0 });
    d.setDate(d.getDate() + 1);
  }
  res.json(result);
});

app.get('/api/admin/analytics/tabs', requireAdmin, (req, res) => {
  const days = req.query.period === '30d' ? 30 : 7;
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const rows = db.prepare("SELECT tab_name, COUNT(*) as count FROM tab_usage WHERE date(created_at) >= ? GROUP BY tab_name ORDER BY count DESC").all(since);
  res.json(rows);
});

app.get('/api/admin/analytics/devices', requireAdmin, (req, res) => {
  const days = parseInt(req.query.period) || 30;
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const devices = db.prepare("SELECT device_type as name, COUNT(*) as n FROM page_views WHERE date(created_at) >= ? GROUP BY device_type ORDER BY n DESC").all(since);
  const browsers = db.prepare("SELECT browser as name, COUNT(*) as n FROM page_views WHERE date(created_at) >= ? GROUP BY browser ORDER BY n DESC").all(since);
  res.json({ devices, browsers });
});

app.get('/api/admin/analytics/pages', requireAdmin, (req, res) => {
  const days = parseInt(req.query.period) || 7;
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const rows = db.prepare("SELECT path, COUNT(*) as views, COUNT(DISTINCT COALESCE(visitor_id, session_hash)) as visitors FROM page_views WHERE date(created_at) >= ? GROUP BY path ORDER BY views DESC LIMIT 20").all(since);
  res.json(rows);
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin/fds', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-fds.html'));
});

// ── API calibration FDS ──
const FDS_BACKUP_DIR = path.join(__dirname, 'data', 'fds-backups');
const APP_JS_PATH    = path.join(__dirname, 'public', 'js', 'app.js');

const FDS_SCALAR_CONSTS = [
  'DATE_TOP_Y','COL_ACTIVITE','NGAP_RIGHT_X','AUTRES_RIGHT_X',
  'MT_RIGHT_X','DEPL_CODE_X','DEPL_RIGHT_X','IK_NBRE_X','IK_RIGHT_X',
  'TOT_RIGHT_X','TOT_Y',
  'MED_LEFT_X','MED_TOP_Y','REMP_NOM_LEFT','REMP_NOM_Y','REMP_ID_LEFT','REMP_ID_Y',
  'MALADIE_X','MALADIE_Y','ACCES_X','ACCES_Y',
  'APC_MT_X','APC_MT_Y',
];
const FDS_ARRAY_CONSTS = ['DATE_TOP_X','FDS_ROWS_Y','DATE_BOX_X','CCAM_BOX_X'];

app.post('/api/admin/fds-calib', requireAdmin, (req, res) => {
  try {
    const vals = req.body;
    if (!fs.existsSync(FDS_BACKUP_DIR)) fs.mkdirSync(FDS_BACKUP_DIR, { recursive: true });

    const ts = new Date().toISOString().replace(/:/g, '-').slice(0, 19);
    fs.writeFileSync(
      path.join(FDS_BACKUP_DIR, `calib-${ts}.json`),
      JSON.stringify({ timestamp: new Date().toISOString(), values: vals }, null, 2)
    );

    let content = fs.readFileSync(APP_JS_PATH, 'utf8');

    FDS_SCALAR_CONSTS.forEach(name => {
      if (!(name in vals)) return;
      content = content.replace(
        new RegExp('(const ' + name + '\\s*=\\s*)[\\d.]+'),
        '$1' + (+vals[name]).toFixed(2)
      );
    });

    FDS_ARRAY_CONSTS.forEach(name => {
      if (!(name in vals) || !Array.isArray(vals[name])) return;
      content = content.replace(
        new RegExp('(const ' + name + '\\s*=\\s*)\\[[^\\]]+\\]'),
        '$1[' + vals[name].map(v => (+v).toFixed(2)).join(', ') + ']'
      );
    });

    fs.writeFileSync(APP_JS_PATH, content);
    res.json({ ok: true, backup: `calib-${ts}.json` });
  } catch (e) {
    console.error('fds-calib save error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/fds-calib/backups', requireAdmin, (req, res) => {
  try {
    if (!fs.existsSync(FDS_BACKUP_DIR)) return res.json([]);
    const files = fs.readdirSync(FDS_BACKUP_DIR)
      .filter(f => f.startsWith('calib-') && f.endsWith('.json'))
      .sort().reverse().slice(0, 30)
      .map(f => {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(FDS_BACKUP_DIR, f), 'utf8'));
          return { file: f, timestamp: d.timestamp };
        } catch { return { file: f, timestamp: null }; }
      });
    res.json(files);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/fds-calib/restore/:file', requireAdmin, (req, res) => {
  const file = req.params.file;
  if (!/^calib-[\dT\-]+\.json$/.test(file)) return res.status(400).json({ error: 'Fichier invalide' });
  try {
    const d = JSON.parse(fs.readFileSync(path.join(FDS_BACKUP_DIR, file), 'utf8'));
    res.json({ ok: true, values: d.values });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// === robots.txt ===
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    'User-agent: *\n' +
    'Allow: /\n' +
    'Disallow: /api/\n' +
    'Disallow: /admin\n\n' +
    'Sitemap: https://www.honorairesmg.fr/sitemap.xml\n'
  );
});

// === sitemap.xml ===
app.get('/sitemap.xml', (req, res) => {
  const now = new Date().toISOString().slice(0, 10);
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.honorairesmg.fr/</loc>
    <lastmod>${now}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://www.honorairesmg.fr/legal</loc>
    <lastmod>${now}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.3</priority>
  </url>
</urlset>`);
});

// === security.txt ===
app.get('/.well-known/security.txt', (req, res) => {
  res.type('text/plain').send(
    'Contact: mailto:contact@honorairesmg.fr\n' +
    'Expires: 2027-01-01T00:00:00.000Z\n' +
    'Preferred-Languages: fr, en\n'
  );
});

// === FDS Quota ===
const FDS_LIMIT_TRIAL = 8; // utilisateurs avec compte (essai)
// premium (active) = illimité

app.get('/api/fds/quota', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  const user = db.prepare('SELECT email, subscription_status, fds_month_count, fds_month_key FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (user.subscription_status === 'active' || ADMIN_EMAILS.includes((user.email || '').toLowerCase())) return res.json({ unlimited: true });
  const monthKey = new Date().toISOString().slice(0, 7);
  const count = user.fds_month_key === monthKey ? (user.fds_month_count || 0) : 0;
  res.json({ count, limit: FDS_LIMIT_TRIAL, remaining: Math.max(0, FDS_LIMIT_TRIAL - count), monthKey });
});

app.post('/api/fds/consume', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  const user = db.prepare('SELECT email, subscription_status, fds_month_count, fds_month_key FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (user.subscription_status === 'active' || ADMIN_EMAILS.includes((user.email || '').toLowerCase())) return res.json({ ok: true, unlimited: true });
  const monthKey = new Date().toISOString().slice(0, 7);
  const count = user.fds_month_key === monthKey ? (user.fds_month_count || 0) : 0;
  if (count >= FDS_LIMIT_TRIAL) {
    return res.json({ ok: false, error: 'quota_exceeded', count, limit: FDS_LIMIT_TRIAL });
  }
  db.prepare('UPDATE users SET fds_month_count = ?, fds_month_key = ? WHERE id = ?').run(count + 1, monthKey, req.session.userId);
  res.json({ ok: true, count: count + 1, remaining: FDS_LIMIT_TRIAL - count - 1 });
});

// === Historique consultations ===
const HISTORY_TRIAL_LIMIT = 20;

function isUserPremium(userId) {
  const user = db.prepare('SELECT subscription_status, email FROM users WHERE id = ?').get(userId);
  if (!user) return false;
  return user.subscription_status === 'active' || ADMIN_EMAILS.includes((user.email || '').toLowerCase());
}

app.post('/api/history/consult', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  const { date, tab, codes, total, amo, amc, details } = req.body;
  if (!date || total === undefined) return res.status(400).json({ error: 'Données manquantes' });
  db.prepare('INSERT INTO consult_history (user_id, date, tab, codes, total, amo, amc, details) VALUES (?,?,?,?,?,?,?,?)').run(
    req.session.userId, date, tab || '', codes || '', total, amo ?? null, amc ?? null, JSON.stringify(details || [])
  );
  if (!isUserPremium(req.session.userId)) {
    const old = db.prepare('SELECT id FROM consult_history WHERE user_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET ?').all(req.session.userId, HISTORY_TRIAL_LIMIT);
    if (old.length > 0) {
      const idList = old.map(r => r.id).join(',');
      db.exec(`DELETE FROM consult_history WHERE id IN (${idList})`);
    }
  }
  res.json({ ok: true });
});

app.get('/api/history/consult', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  const isPremium = isUserPremium(req.session.userId);
  const limit = isPremium ? 500 : HISTORY_TRIAL_LIMIT;
  const rows = db.prepare('SELECT id, date, tab, codes, total, amo, amc, details, created_at FROM consult_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(req.session.userId, limit);
  res.json({ rows: rows.map(r => ({ ...r, details: JSON.parse(r.details || '[]') })), isPremium });
});

app.delete('/api/history/consult', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  db.prepare('DELETE FROM consult_history WHERE user_id = ?').run(req.session.userId);
  res.json({ ok: true });
});

// === Historique IK ===
app.post('/api/history/ik', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  const { date, from_addr, to_addr, km, amount, codes } = req.body;
  if (!date || km === undefined) return res.status(400).json({ error: 'Données manquantes' });
  if (!isUserPremium(req.session.userId)) return res.json({ ok: false, error: 'premium_required' });
  db.prepare('INSERT INTO ik_history (user_id, date, from_addr, to_addr, km, amount, codes) VALUES (?,?,?,?,?,?,?)').run(
    req.session.userId, date, from_addr || '', to_addr || '', km, amount ?? null, codes || ''
  );
  res.json({ ok: true });
});

app.get('/api/history/ik', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  const isPremium = isUserPremium(req.session.userId);
  if (!isPremium) return res.json({ rows: [], isPremium: false });
  const rows = db.prepare('SELECT id, date, from_addr, to_addr, km, amount, codes FROM ik_history WHERE user_id = ? ORDER BY date DESC LIMIT 500').all(req.session.userId);
  res.json({ rows, isPremium });
});

app.get('/api/history/ik/export.csv', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  if (!isUserPremium(req.session.userId)) return res.status(403).json({ error: 'Réservé aux abonnés Premium' });
  const rows = db.prepare('SELECT date, from_addr, to_addr, km, amount, codes FROM ik_history WHERE user_id = ? ORDER BY date ASC').all(req.session.userId);
  const lines = ['Date,Départ,Arrivée,Km (aller),Montant (€),Codes'];
  for (const r of rows) {
    lines.push([
      `"${r.date}"`,
      `"${(r.from_addr || '').replace(/"/g, '""')}"`,
      `"${(r.to_addr || '').replace(/"/g, '""')}"`,
      r.km ?? '',
      r.amount !== null ? r.amount.toFixed(2) : '',
      `"${(r.codes || '').replace(/"/g, '""')}"`
    ].join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="ik-honorairesmg.csv"');
  res.send('\uFEFF' + lines.join('\r\n'));
});

// === Statistiques mensuelles (premium) ===
app.get('/api/history/stats', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  const isPremium = isUserPremium(req.session.userId);
  if (!isPremium) return res.json({ isPremium: false });
  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', date) as month, COUNT(*) as count, SUM(total) as total
    FROM consult_history WHERE user_id = ?
    GROUP BY month ORDER BY month DESC LIMIT 24
  `).all(req.session.userId);
  const byTab = db.prepare(`
    SELECT tab, COUNT(*) as count, ROUND(AVG(total),2) as avg
    FROM consult_history WHERE user_id = ?
    GROUP BY tab ORDER BY count DESC
  `).all(req.session.userId);
  res.json({ isPremium: true, monthly, byTab });
});

// === SPA fallback (assets inexistants → 404, routes SPA → index.html) ===
app.get('*', (req, res) => {
  if (req.path.includes('.')) return res.status(404).send('Not found');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Honoraire Like running on http://localhost:${PORT}`);
  if (!stripe) console.warn('⚠ Stripe non configuré (STRIPE_SECRET_KEY manquant)');
});
