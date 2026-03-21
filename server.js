const express = require('express');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3001;

// --- Security headers ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// --- Rate limiting ---
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans une minute' }
});
app.use('/api/', apiLimiter);

// --- Tarifs API ---
const tarifsPath = path.join(__dirname, 'data', 'tarifs.json');
let tarifs = JSON.parse(fs.readFileSync(tarifsPath, 'utf8'));

app.use(express.json());

// Servir les fichiers statiques
app.use(express.static(path.join(__dirname, 'public')));

// API : récupérer les tarifs
app.get('/api/tarifs', (req, res) => {
  res.json(tarifs);
});

// API : recherche CCAM
app.get('/api/ccam', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.json(tarifs.ccam || []);
  const results = (tarifs.ccam || []).filter(a =>
    a.code.toLowerCase().includes(q) || a.label.toLowerCase().includes(q)
  );
  res.json(results);
});

// SPA fallback — uniquement les routes non-API
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Route introuvable' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Honoraire Like running on http://localhost:${PORT}`);
});
