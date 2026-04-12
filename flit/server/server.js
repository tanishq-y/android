// Flit backend — now supports Blinkit, Zepto, and Instamart token-vault pilots alongside legacy routes.
// Existing APIs remain available while v2 routes introduce per-user connections.

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import { Cache } from './cache.js';
import { AlertManager } from './alertManager.js';
import {
  searchBlinkit,
  searchZepto,
  searchInstamart,
  searchBigBasket,
  searchJioMart,
} from './platforms.js';

import { pingDb } from './db.js';
import { optionalUserContext, requireUserContext } from './middleware/userContext.js';
import {
  disconnectBlinkit,
  disconnectInstamart,
  getBlinkitConnectionStatus,
  getBlinkitCookieSession,
  getInstamartConnectionStatus,
  getInstamartCookieSession,
  disconnectZepto,
  getZeptoConnectionStatus,
  getZeptoCookieSession,
  getTokenVaultMode,
  isTokenVaultAvailable,
  listConnections,
  markBlinkitReconnectRequired,
  markInstamartReconnectRequired,
  markZeptoReconnectRequired,
  storeBlinkitCookieSession,
  storeInstamartCookieSession,
  storeZeptoCookieSession,
} from './tokenVault.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 3001;
const cache = new Cache(300_000); // 5-minute TTL
const alerts = new AlertManager();

const PLATFORM_BLINKIT = 'blinkit';
const PLATFORM_ZEPTO = 'zepto';
const PLATFORM_INSTAMART = 'instamart';

const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://localhost',
  'https://localhost',
  'http://127.0.0.1',
  'https://127.0.0.1',
  'capacitor://localhost',
  'ionic://localhost',
  'https://flit.app',
  'https://www.flit.app',
]);

function isLocalhostOrigin(origin) {
  return /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|capacitor:\/\/localhost|ionic:\/\/localhost)$/i.test(origin);
}

function isPrivateLanOrigin(origin) {
  return /^https?:\/\/(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/i.test(origin);
}

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  return allowedOrigins.has(origin) || isLocalhostOrigin(origin) || isPrivateLanOrigin(origin);
}

// ─── MIDDLEWARE ─────────────────────────────────────────────────────────────

const corsOptions = {
  origin: (origin, callback) => {
    if (isAllowedCorsOrigin(origin)) {
      callback(null, true);
      return;
    }

    console.warn(`[CORS] blocked origin: ${origin}`);
    callback(null, false);
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-flit-user-id', 'Authorization'],
  optionsSuccessStatus: 204,
};

// Android WebView can send private-network preflight headers for LAN targets.
app.use((req, res, next) => {
  if (req.headers['access-control-request-private-network'] === 'true') {
    res.header('Access-Control-Allow-Private-Network', 'true');
  }
  next();
});

app.use(cors(corsOptions));

app.use(express.json());
app.use(optionalUserContext);

function respondTokenVaultUnavailable(res) {
  const mode = getTokenVaultMode();
  return res.status(503).json({
    error: 'Token vault unavailable. Configure DATABASE_URL or set ENABLE_DEV_FILE_VAULT=true for development fallback.',
    tokenVaultMode: mode,
  });
}

function isSessionInvalidError(error) {
  return error === 'session_invalid' || error === 'HTTP 401' || error === 'HTTP 403';
}

const ENABLE_SYNTHETIC_FALLBACK = String(process.env.ENABLE_SYNTHETIC_FALLBACK ?? '').toLowerCase() === 'true';

function buildSyntheticFallbackResults(query) {
  const clean = String(query ?? '').trim();
  if (!clean) return [];

  const templates = [
    { platform: 'blinkit', color: '#0C831F', eta: '10 mins', fee: 0, base: 58 },
    { platform: 'zepto', color: '#8025FB', eta: '12 mins', fee: 0, base: 61 },
    { platform: 'instamart', color: '#FC8019', eta: '20 mins', fee: 0, base: 63 },
  ];

  const variants = ['500 ml', '1 L', '1 kg'];
  const results = [];

  templates.forEach((tpl) => {
    variants.forEach((variant, idx) => {
      const price = tpl.base + (idx * 14);
      const mrp = price + 9;

      results.push({
        id: `fallback:${tpl.platform}:${clean.toLowerCase().replace(/\s+/g, '-')}:${idx}`,
        platform: tpl.platform,
        name: `${clean} ${variant}`,
        brand: 'Flit Select',
        image: null,
        price,
        mrp,
        discount: Math.max(0, Math.round(((mrp - price) / mrp) * 100)),
        quantity: variant,
        unitPrice: null,
        deliveryFee: tpl.fee,
        deliveryEta: tpl.eta,
        inStock: true,
        deepLink: '',
        platformColor: tpl.color,
      });
    });
  });

  return results;
}

function shouldUseSyntheticFallback(products, platformStatus) {
  if (Array.isArray(products) && products.length > 0) {
    return false;
  }

  const statuses = Object.values(platformStatus ?? {});
  if (!statuses.length) {
    return false;
  }

  return statuses.every((status) => typeof status === 'string' && status.startsWith('error:'));
}

function isAllPlatformsError(platformStatus) {
  const statuses = Object.values(platformStatus ?? {});
  if (!statuses.length) {
    return false;
  }

  return statuses.every((status) => typeof status === 'string' && status.startsWith('error:'));
}

// ─── HEALTH CHECK ───────────────────────────────────────────────────────────

app.get('/api/health', async (_req, res) => {
  const db = await pingDb();
  const tokenVaultMode = getTokenVaultMode();
  res.json({
    status: 'ok',
    version: '2.1',
    appMode: 'app-first',
    tokenProxyPilot: ['blinkit', 'zepto', 'instamart'],
    db,
    tokenVault: {
      mode: tokenVaultMode,
      available: tokenVaultMode !== 'unavailable',
    },
    syntheticFallbackEnabled: ENABLE_SYNTHETIC_FALLBACK,
    message: 'Flit server running. App-first token-vault flow active with Blinkit + Zepto + Instamart pilots.',
  });
});

// ─── V2 CONNECTION ROUTES (TOKEN-VAULT PILOTS) ─────────────────────────────

app.get('/api/v2/connections', requireUserContext, async (req, res) => {
  try {
    if (!isTokenVaultAvailable()) return respondTokenVaultUnavailable(res);

    const connections = await listConnections(req.userId);
    return res.json({ userId: req.userId, connections });
  } catch (err) {
    console.error('[Connections] list failed:', err.message);
    return res.status(500).json({ error: err.message ?? 'Failed to list connections' });
  }
});

app.get('/api/v2/connections/blinkit', requireUserContext, async (req, res) => {
  try {
    if (!isTokenVaultAvailable()) return respondTokenVaultUnavailable(res);

    const status = await getBlinkitConnectionStatus(req.userId);
    return res.json({ userId: req.userId, ...status });
  } catch (err) {
    console.error('[Connections] blinkit status failed:', err.message);
    return res.status(500).json({ error: err.message ?? 'Failed to read Blinkit connection' });
  }
});

app.post('/api/v2/connections/blinkit/session', requireUserContext, async (req, res) => {
  try {
    if (!isTokenVaultAvailable()) return respondTokenVaultUnavailable(res);

    const { cookieHeader, expiresAt } = req.body ?? {};

    if (!cookieHeader || typeof cookieHeader !== 'string' || !cookieHeader.includes('=')) {
      return res.status(400).json({ error: 'cookieHeader is required and must contain cookie key/value pairs' });
    }

    const saved = await storeBlinkitCookieSession({
      userId: req.userId,
      cookieHeader,
      expiresAt: expiresAt ?? null,
    });

    return res.json({ success: true, userId: req.userId, connection: saved });
  } catch (err) {
    console.error('[Connections] blinkit store failed:', err.message);
    return res.status(500).json({ error: err.message ?? 'Failed to save Blinkit session' });
  }
});

app.delete('/api/v2/connections/blinkit', requireUserContext, async (req, res) => {
  try {
    if (!isTokenVaultAvailable()) return respondTokenVaultUnavailable(res);

    await disconnectBlinkit(req.userId);
    return res.json({ success: true, userId: req.userId, platform: PLATFORM_BLINKIT, status: 'disconnected' });
  } catch (err) {
    console.error('[Connections] blinkit disconnect failed:', err.message);
    return res.status(500).json({ error: err.message ?? 'Failed to disconnect Blinkit' });
  }
});

app.get('/api/v2/connections/zepto', requireUserContext, async (req, res) => {
  try {
    if (!isTokenVaultAvailable()) return respondTokenVaultUnavailable(res);

    const status = await getZeptoConnectionStatus(req.userId);
    return res.json({ userId: req.userId, ...status });
  } catch (err) {
    console.error('[Connections] zepto status failed:', err.message);
    return res.status(500).json({ error: err.message ?? 'Failed to read Zepto connection' });
  }
});

app.post('/api/v2/connections/zepto/session', requireUserContext, async (req, res) => {
  try {
    if (!isTokenVaultAvailable()) return respondTokenVaultUnavailable(res);

    const { cookieHeader, expiresAt } = req.body ?? {};

    if (!cookieHeader || typeof cookieHeader !== 'string' || !cookieHeader.includes('=')) {
      return res.status(400).json({ error: 'cookieHeader is required and must contain cookie key/value pairs' });
    }

    const saved = await storeZeptoCookieSession({
      userId: req.userId,
      cookieHeader,
      expiresAt: expiresAt ?? null,
    });

    return res.json({ success: true, userId: req.userId, connection: saved });
  } catch (err) {
    console.error('[Connections] zepto store failed:', err.message);
    return res.status(500).json({ error: err.message ?? 'Failed to save Zepto session' });
  }
});

app.delete('/api/v2/connections/zepto', requireUserContext, async (req, res) => {
  try {
    if (!isTokenVaultAvailable()) return respondTokenVaultUnavailable(res);

    await disconnectZepto(req.userId);
    return res.json({ success: true, userId: req.userId, platform: PLATFORM_ZEPTO, status: 'disconnected' });
  } catch (err) {
    console.error('[Connections] zepto disconnect failed:', err.message);
    return res.status(500).json({ error: err.message ?? 'Failed to disconnect Zepto' });
  }
});

app.get('/api/v2/connections/instamart', requireUserContext, async (req, res) => {
  try {
    if (!isTokenVaultAvailable()) return respondTokenVaultUnavailable(res);

    const status = await getInstamartConnectionStatus(req.userId);
    return res.json({ userId: req.userId, ...status });
  } catch (err) {
    console.error('[Connections] instamart status failed:', err.message);
    return res.status(500).json({ error: err.message ?? 'Failed to read Instamart connection' });
  }
});

app.post('/api/v2/connections/instamart/session', requireUserContext, async (req, res) => {
  try {
    if (!isTokenVaultAvailable()) return respondTokenVaultUnavailable(res);

    const { cookieHeader, expiresAt } = req.body ?? {};

    if (!cookieHeader || typeof cookieHeader !== 'string' || !cookieHeader.includes('=')) {
      return res.status(400).json({ error: 'cookieHeader is required and must contain cookie key/value pairs' });
    }

    const saved = await storeInstamartCookieSession({
      userId: req.userId,
      cookieHeader,
      expiresAt: expiresAt ?? null,
    });

    return res.json({ success: true, userId: req.userId, connection: saved });
  } catch (err) {
    console.error('[Connections] instamart store failed:', err.message);
    return res.status(500).json({ error: err.message ?? 'Failed to save Instamart session' });
  }
});

app.delete('/api/v2/connections/instamart', requireUserContext, async (req, res) => {
  try {
    if (!isTokenVaultAvailable()) return respondTokenVaultUnavailable(res);

    await disconnectInstamart(req.userId);
    return res.json({ success: true, userId: req.userId, platform: PLATFORM_INSTAMART, status: 'disconnected' });
  } catch (err) {
    console.error('[Connections] instamart disconnect failed:', err.message);
    return res.status(500).json({ error: err.message ?? 'Failed to disconnect Instamart' });
  }
});

app.post('/api/v2/search/blinkit', requireUserContext, async (req, res) => {
  try {
    if (!isTokenVaultAvailable()) return respondTokenVaultUnavailable(res);

    const { query, lat, lon } = req.body ?? {};
    if (!query || !query.trim()) {
      return res.status(400).json({ error: 'query is required' });
    }

    const session = await getBlinkitCookieSession(req.userId);
    if (!session?.cookieHeader) {
      return res.status(412).json({
        error: 'blinkit_not_connected',
        reconnectRequired: true,
        platform: PLATFORM_BLINKIT,
      });
    }

    const latitude = lat ?? 28.4595;
    const longitude = lon ?? 77.0266;

    const result = await searchBlinkit(query.trim(), latitude, longitude, session.cookieHeader);

    if (result.error) {
      if (isSessionInvalidError(result.error)) {
        await markBlinkitReconnectRequired(req.userId, result.error).catch(() => {});
      }
      return res.status(502).json({
        error: result.error,
        platform: PLATFORM_BLINKIT,
        reconnectRequired: isSessionInvalidError(result.error),
      });
    }

    return res.json({
      type: 'BLINKIT_SERVER_RESULTS',
      platform: PLATFORM_BLINKIT,
      results: result.products,
      totalPlatforms: 1,
      resolved: 1,
      platformStatus: { blinkit: 'ok' },
    });
  } catch (err) {
    console.error('[SearchV2] blinkit failed:', err.message);
    return res.status(500).json({ error: err.message ?? 'Blinkit search failed' });
  }
});

app.post('/api/v2/search/zepto', requireUserContext, async (req, res) => {
  try {
    if (!isTokenVaultAvailable()) return respondTokenVaultUnavailable(res);

    const { query, lat, lon } = req.body ?? {};
    if (!query || !query.trim()) {
      return res.status(400).json({ error: 'query is required' });
    }

    const session = await getZeptoCookieSession(req.userId);
    if (!session?.cookieHeader) {
      return res.status(412).json({
        error: 'zepto_not_connected',
        reconnectRequired: true,
        platform: PLATFORM_ZEPTO,
      });
    }

    const latitude = lat ?? 28.4595;
    const longitude = lon ?? 77.0266;

    const result = await searchZepto(query.trim(), latitude, longitude, session.cookieHeader);

    if (result.error) {
      if (isSessionInvalidError(result.error)) {
        await markZeptoReconnectRequired(req.userId, result.error).catch(() => {});
      }
      return res.status(502).json({
        error: result.error,
        platform: PLATFORM_ZEPTO,
        reconnectRequired: isSessionInvalidError(result.error),
      });
    }

    return res.json({
      type: 'ZEPTO_SERVER_RESULTS',
      platform: PLATFORM_ZEPTO,
      results: result.products,
      totalPlatforms: 1,
      resolved: 1,
      platformStatus: { zepto: 'ok' },
    });
  } catch (err) {
    console.error('[SearchV2] zepto failed:', err.message);
    return res.status(500).json({ error: err.message ?? 'Zepto search failed' });
  }
});

app.post('/api/v2/search/instamart', requireUserContext, async (req, res) => {
  try {
    if (!isTokenVaultAvailable()) return respondTokenVaultUnavailable(res);

    const { query, lat, lon } = req.body ?? {};
    if (!query || !query.trim()) {
      return res.status(400).json({ error: 'query is required' });
    }

    const session = await getInstamartCookieSession(req.userId);
    if (!session?.cookieHeader) {
      return res.status(412).json({
        error: 'instamart_not_connected',
        reconnectRequired: true,
        platform: PLATFORM_INSTAMART,
      });
    }

    const latitude = lat ?? 28.4595;
    const longitude = lon ?? 77.0266;

    const result = await searchInstamart(query.trim(), latitude, longitude, session.cookieHeader);

    if (result.error) {
      if (isSessionInvalidError(result.error)) {
        await markInstamartReconnectRequired(req.userId, result.error).catch(() => {});
      }
      return res.status(502).json({
        error: result.error,
        platform: PLATFORM_INSTAMART,
        reconnectRequired: isSessionInvalidError(result.error),
      });
    }

    return res.json({
      type: 'INSTAMART_SERVER_RESULTS',
      platform: PLATFORM_INSTAMART,
      results: result.products,
      totalPlatforms: 1,
      resolved: 1,
      platformStatus: { instamart: 'ok' },
    });
  } catch (err) {
    console.error('[SearchV2] instamart failed:', err.message);
    return res.status(500).json({ error: err.message ?? 'Instamart search failed' });
  }
});

// ─── LEGACY SERVER FALLBACK SEARCH ──────────────────────────────────────────
// POST /api/search { query, lat, lon }
// This route now optionally uses user-scoped Blinkit and Zepto sessions from token vault.

app.post('/api/search', async (req, res) => {
  try {
    const { query, lat, lon } = req.body ?? {};
    if (!query || !query.trim()) {
      return res.status(400).json({ error: 'query is required' });
    }

    const latitude = lat ?? 28.4595;
    const longitude = lon ?? 77.0266;

    let blinkitCookieHeader = null;
    let blinkitSessionSource = 'none';
    let zeptoCookieHeader = null;
    let zeptoSessionSource = 'none';
    let instamartCookieHeader = null;
    let instamartSessionSource = 'none';

    if (isTokenVaultAvailable() && req.userId) {
      try {
        const blinkitSession = await getBlinkitCookieSession(req.userId);
        if (blinkitSession?.cookieHeader) {
          blinkitCookieHeader = blinkitSession.cookieHeader;
          blinkitSessionSource = 'token_vault';
        }
      } catch (err) {
        console.warn('[Server Search] Could not read Blinkit token vault session:', err.message);
      }

      try {
        const zeptoSession = await getZeptoCookieSession(req.userId);
        if (zeptoSession?.cookieHeader) {
          zeptoCookieHeader = zeptoSession.cookieHeader;
          zeptoSessionSource = 'token_vault';
        }
      } catch (err) {
        console.warn('[Server Search] Could not read Zepto token vault session:', err.message);
      }

      try {
        const instamartSession = await getInstamartCookieSession(req.userId);
        if (instamartSession?.cookieHeader) {
          instamartCookieHeader = instamartSession.cookieHeader;
          instamartSessionSource = 'token_vault';
        }
      } catch (err) {
        console.warn('[Server Search] Could not read Instamart token vault session:', err.message);
      }
    }

    // Search output is user-contextual (session-backed), so cache must be scoped per user.
    const cacheUserScope = req.userId ? `user:${req.userId}` : 'anon';
    const cacheKey = `search:${cacheUserScope}:${query.trim().toLowerCase()}:${latitude}:${longitude}:blinkit=${blinkitSessionSource}:zepto=${zeptoSessionSource}:instamart=${instamartSessionSource}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log(`[Server Search] Cache hit for "${query}"`);
      return res.json(cached);
    }

    console.log(
      `[Server Search] Searching "${query}" at ${latitude},${longitude} (blinkit session: ${blinkitSessionSource}, zepto session: ${zeptoSessionSource}, instamart session: ${instamartSessionSource})`
    );

    const settled = await Promise.allSettled([
      searchBlinkit(query.trim(), latitude, longitude, blinkitCookieHeader),
      searchZepto(query.trim(), latitude, longitude, zeptoCookieHeader),
      searchInstamart(query.trim(), latitude, longitude, instamartCookieHeader),
      searchBigBasket(query.trim()),
      searchJioMart(query.trim()),
    ]);

    const platformOrder = ['blinkit', 'zepto', 'instamart', 'bigbasket', 'jiomart'];
    const results = settled.map((outcome, idx) => {
      if (outcome.status === 'fulfilled') return outcome.value;
      return {
        platform: platformOrder[idx],
        products: [],
        error: outcome.reason?.message ?? 'exception',
      };
    });

    const allProducts = [];
    const platformStatus = {};
    for (const r of results) {
      platformStatus[r.platform] = r.error ? `error: ${r.error}` : 'ok';
      allProducts.push(...(r.products ?? []));
    }

    const blinkitResult = results.find((r) => r.platform === PLATFORM_BLINKIT);
    const zeptoResult = results.find((r) => r.platform === PLATFORM_ZEPTO);
    const instamartResult = results.find((r) => r.platform === PLATFORM_INSTAMART);
    const blinkitReconnectRequired = Boolean(blinkitResult?.error && isSessionInvalidError(blinkitResult.error));
    const zeptoReconnectRequired = Boolean(zeptoResult?.error && isSessionInvalidError(zeptoResult.error));
    const instamartReconnectRequired = Boolean(instamartResult?.error && isSessionInvalidError(instamartResult.error));

    if (blinkitReconnectRequired && isTokenVaultAvailable() && req.userId) {
      await markBlinkitReconnectRequired(req.userId, blinkitResult.error).catch(() => {});
    }

    if (zeptoReconnectRequired && isTokenVaultAvailable() && req.userId) {
      await markZeptoReconnectRequired(req.userId, zeptoResult.error).catch(() => {});
    }

    if (instamartReconnectRequired && isTokenVaultAvailable() && req.userId) {
      await markInstamartReconnectRequired(req.userId, instamartResult.error).catch(() => {});
    }

    const syntheticFallbackUsed =
      ENABLE_SYNTHETIC_FALLBACK && shouldUseSyntheticFallback(allProducts, platformStatus);
    if (syntheticFallbackUsed) {
      allProducts.push(...buildSyntheticFallbackResults(query.trim()));
      platformStatus.synthetic_fallback = 'ok';
    }

    const response = {
      type: 'SERVER_RESULTS',
      results: allProducts,
      platformStatus,
      totalPlatforms: 5,
      resolved: results.length,
      fallbackUsed: syntheticFallbackUsed,
      connectionHints: {
        blinkit: blinkitSessionSource,
        zepto: zeptoSessionSource,
        instamart: instamartSessionSource,
        blinkitReconnectRequired,
        zeptoReconnectRequired,
        instamartReconnectRequired,
      },
    };

    const totalFailure = response.results.length === 0 && isAllPlatformsError(platformStatus);
    if (!totalFailure) {
      cache.set(cacheKey, response);
    }
    console.log(
      `[Server Search] Done: ${allProducts.length} products from ${results.filter((r) => !r.error).length}/5 platforms`
    );

    return res.json(response);
  } catch (err) {
    console.error('[Server Search] Failed:', err.message);
    return res.status(500).json({ error: err.message ?? 'Server search failed' });
  }
});

// ─── PRICE ALERTS ───────────────────────────────────────────────────────────

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

app.delete('/api/alerts/:productId', (req, res) => {
  const { productId } = req.params;
  const removed = alerts.remove(productId);
  res.json({ success: removed });
});

app.post('/api/alerts/check', (req, res) => {
  const { prices } = req.body ?? {};
  if (!Array.isArray(prices)) {
    return res.status(400).json({ error: 'prices must be an array' });
  }

  const triggered = alerts.check(prices);
  res.json({ triggered });
});

app.get('/api/alerts', (_req, res) => {
  res.json({ alerts: alerts.getAll() });
});

// ─── CACHE STATS (dev only) ─────────────────────────────────────────────────

if (process.env.NODE_ENV !== 'production') {
  app.get('/api/dev/cache', (_req, res) => {
    res.json(cache.stats());
  });
}

// ─── GLOBAL ERROR HANDLER ───────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ error: err.message ?? 'Internal server error' });
});

// ─── START ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🚀 Flit server — http://localhost:${PORT}`);
  console.log('Routes:');
  console.log('  GET  /api/health');
  console.log('  POST /api/search');
  console.log('  POST /api/alerts/save');
  console.log('  POST /api/alerts/check');
  console.log('  GET  /api/alerts');
  console.log('  DELETE /api/alerts/:productId');
  console.log('  GET  /api/v2/connections');
  console.log('  GET  /api/v2/connections/blinkit');
  console.log('  POST /api/v2/connections/blinkit/session');
  console.log('  DELETE /api/v2/connections/blinkit');
  console.log('  POST /api/v2/search/blinkit\n');
  console.log('  GET  /api/v2/connections/zepto');
  console.log('  POST /api/v2/connections/zepto/session');
  console.log('  DELETE /api/v2/connections/zepto');
  console.log('  POST /api/v2/search/zepto\n');
  console.log('  GET  /api/v2/connections/instamart');
  console.log('  POST /api/v2/connections/instamart/session');
  console.log('  DELETE /api/v2/connections/instamart');
  console.log('  POST /api/v2/search/instamart\n');
  console.log('ℹ️  App-first flow active. Blinkit + Zepto + Instamart token-vault routes run via v2 APIs.\n');
});