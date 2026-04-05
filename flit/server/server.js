// Flit slim backend — Express server
// The heavy lifting (API calls) now happens in the browser extension.
// This server only handles:
//   GET  /api/health          — health check
//   GET  /api/extension/id    — returns the known extension ID (from .env)
//   POST /api/alerts/check    — compares current prices against stored alerts
//   POST /api/alerts/save     — persists alert to in-memory store
//   DELETE /api/alerts/:id    — removes an alert

import express from 'express';
import cors    from 'cors';
import dotenv  from 'dotenv';
import { Cache }        from './cache.js';
import { AlertManager } from './alertManager.js';

dotenv.config();

const app   = express();
const PORT  = process.env.PORT ?? 3001;
const cache = new Cache(300_000); // 5-minute TTL
const alerts = new AlertManager();

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────

app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://flit.app',
    'https://www.flit.app',
  ],
  methods: ['GET', 'POST', 'DELETE'],
}));
app.use(express.json());

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({
    status:      'ok',
    version:     '2.0',
    extensionRequired: true,
    message:     'Flit server running. Extension handles API calls.',
  });
});

// ─── EXTENSION ID ─────────────────────────────────────────────────────────────
// The frontend can call this to get the known extension ID.
// During development you paste your unpacked extension ID in .env.
// In production this is the published Chrome Web Store ID.

app.get('/api/extension/id', (_req, res) => {
  const id = process.env.FLIT_EXTENSION_ID ?? null;
  res.json({ extensionId: id });
});

// ─── PRICE ALERTS ─────────────────────────────────────────────────────────────

// Save a new alert
app.post('/api/alerts/save', (req, res) => {
  const { productId, productName, platform, currentPrice, alertBelow } = req.body ?? {};

  if (!productId || !productName || !platform || !currentPrice || !alertBelow) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (typeof alertBelow !== 'number' || alertBelow <= 0) {
    return res.status(400).json({ error: 'alertBelow must be a positive number' });
  }

  const alert = alerts.save({ productId, productName, platform, currentPrice, alertBelow });
  res.json({ success: true, alert });
});

// Delete an alert
app.delete('/api/alerts/:productId', (req, res) => {
  const { productId } = req.params;
  const removed = alerts.remove(productId);
  res.json({ success: removed });
});

// Check which alerts have been triggered
// The frontend sends current prices; we check against stored thresholds.
app.post('/api/alerts/check', (req, res) => {
  const { prices } = req.body ?? {};
  // prices: [{ productId, currentPrice }]
  if (!Array.isArray(prices)) {
    return res.status(400).json({ error: 'prices must be an array' });
  }

  const triggered = alerts.check(prices);
  res.json({ triggered });
});

// Get all stored alerts
app.get('/api/alerts', (_req, res) => {
  res.json({ alerts: alerts.getAll() });
});

// ─── CACHE STATS (dev only) ───────────────────────────────────────────────────

if (process.env.NODE_ENV !== 'production') {
  app.get('/api/dev/cache', (_req, res) => {
    res.json(cache.stats());
  });
}

// ─── GLOBAL ERROR HANDLER ─────────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ error: err.message ?? 'Internal server error' });
});

// ─── START ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🚀 Flit server — http://localhost:${PORT}`);
  console.log('Routes:');
  console.log('  GET  /api/health');
  console.log('  GET  /api/extension/id');
  console.log('  POST /api/alerts/save');
  console.log('  POST /api/alerts/check');
  console.log('  GET  /api/alerts');
  console.log('  DELETE /api/alerts/:productId\n');
  console.log('ℹ️  Platform API calls are handled by the browser extension — not this server.\n');
});
