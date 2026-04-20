// Flit backend — now supports Blinkit, Zepto, and Instamart token-vault pilots alongside legacy routes.
// Existing APIs remain available while v2 routes introduce per-user connections.

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
import { optionalAuthUser } from './middleware/auth.js';
import { optionalUserContext, requireUserContext } from './middleware/userContext.js';
import authRoutes from './routes/auth.js';
import platformRoutes from './routes/platforms.js';
import {
  disconnectBlinkit,
  disconnectInstamart,
  getBlinkitConnectionStatus,
  getBlinkitCookieSession,
  getInstamartConnectionStatus,
  getInstamartCookieSession,
  getPlatformSession,
  disconnectZepto,
  getZeptoConnectionStatus,
  getZeptoCookieSession,
  getTokenVaultMode,
  isTokenVaultAvailable,
  listConnections,
  markBlinkitReconnectRequired,
  markInstamartReconnectRequired,
  markPlatformReconnectRequired,
  markZeptoReconnectRequired,
  storePlatformSession,
  storeBlinkitCookieSession,
  storeInstamartCookieSession,
  storeZeptoCookieSession,
} from './tokenVault.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 3001;
const cache = new Cache(300_000); // 5-minute TTL
const alerts = new AlertManager();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STALE_CACHE_FILE = path.join(__dirname, 'cache', 'staleSearch.json');
const STALE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function ensureStaleCacheDir() {
  try {
    fs.mkdirSync(path.dirname(STALE_CACHE_FILE), { recursive: true });
  } catch {
    // Best effort.
  }
}

function loadPersistentStaleCache() {
  try {
    ensureStaleCacheDir();
    if (!fs.existsSync(STALE_CACHE_FILE)) {
      return {};
    }

    const raw = fs.readFileSync(STALE_CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function savePersistentStaleCache(store) {
  try {
    ensureStaleCacheDir();
    fs.writeFileSync(STALE_CACHE_FILE, JSON.stringify(store), 'utf8');
  } catch {
    // Best effort.
  }
}

const persistentStaleCacheStore = loadPersistentStaleCache();

function readPersistentStaleSnapshot(cacheKey) {
  const key = String(cacheKey ?? '').trim();
  if (!key) return null;

  const entry = persistentStaleCacheStore[key];
  if (!entry || typeof entry !== 'object') return null;

  const updatedAt = Number(entry.updatedAt ?? 0);
  if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > STALE_CACHE_TTL_MS) {
    delete persistentStaleCacheStore[key];
    return null;
  }

  const results = Array.isArray(entry.results) ? entry.results : [];
  if (results.length === 0) return null;

  return {
    results,
  };
}

function writePersistentStaleSnapshot(cacheKey, response) {
  const key = String(cacheKey ?? '').trim();
  if (!key) return;

  const results = Array.isArray(response?.results) ? response.results : [];
  if (results.length === 0) return;

  persistentStaleCacheStore[key] = {
    updatedAt: Date.now(),
    results,
  };

  savePersistentStaleCache(persistentStaleCacheStore);
}

const PLATFORM_BLINKIT = 'blinkit';
const PLATFORM_ZEPTO = 'zepto';
const PLATFORM_INSTAMART = 'instamart';
const PLATFORM_BIGBASKET = 'bigbasket';
const PLATFORM_JIOMART = 'jiomart';
const PLATFORM_ALL = [
  PLATFORM_BLINKIT,
  PLATFORM_ZEPTO,
  PLATFORM_INSTAMART,
  PLATFORM_BIGBASKET,
  PLATFORM_JIOMART,
];
const PLATFORM_PILOT = [
  PLATFORM_BLINKIT,
  PLATFORM_ZEPTO,
  PLATFORM_INSTAMART,
];

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
app.use(optionalAuthUser);

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

async function markReconnectRequiredByPlatform(userId, platform, reason) {
  if (!isSessionInvalidError(reason)) return;

  if (platform === PLATFORM_BLINKIT) {
    await markBlinkitReconnectRequired(userId, reason).catch(() => {});
    return;
  }

  if (platform === PLATFORM_ZEPTO) {
    await markZeptoReconnectRequired(userId, reason).catch(() => {});
    return;
  }

  if (platform === PLATFORM_INSTAMART) {
    await markInstamartReconnectRequired(userId, reason).catch(() => {});
    return;
  }

  await markPlatformReconnectRequired(userId, platform, reason).catch(() => {});
}

const ENABLE_SYNTHETIC_FALLBACK = String(process.env.ENABLE_SYNTHETIC_FALLBACK ?? '').toLowerCase() === 'true';
const ENABLE_JWT_HEADER_BRIDGE = String(process.env.ENABLE_JWT_HEADER_BRIDGE ?? 'true').toLowerCase() === 'true';

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

function normalizeRequestedPlatforms(platforms) {
  if (!Array.isArray(platforms) || platforms.length === 0) {
    return [...PLATFORM_ALL];
  }

  return [...new Set(platforms.map((platform) => String(platform ?? '').trim().toLowerCase()))]
    .filter((platform) => PLATFORM_ALL.includes(platform));
}

function createStringPlatformMap(platforms, defaultValue = 'none') {
  return Object.fromEntries(platforms.map((platform) => [platform, defaultValue]));
}

function createBooleanPlatformMap(platforms, defaultValue = false) {
  return Object.fromEntries(platforms.map((platform) => [platform, defaultValue]));
}

function buildConnectionHints({ requestedPlatforms, sessionSourceByPlatform, reconnectRequiredByPlatform }) {
  return {
    sessionSourceByPlatform,
    reconnectRequiredByPlatform,
    blinkit: sessionSourceByPlatform[PLATFORM_BLINKIT] ?? 'none',
    zepto: sessionSourceByPlatform[PLATFORM_ZEPTO] ?? 'none',
    instamart: sessionSourceByPlatform[PLATFORM_INSTAMART] ?? 'none',
    blinkitReconnectRequired: Boolean(reconnectRequiredByPlatform[PLATFORM_BLINKIT]),
    zeptoReconnectRequired: Boolean(reconnectRequiredByPlatform[PLATFORM_ZEPTO]),
    instamartReconnectRequired: Boolean(reconnectRequiredByPlatform[PLATFORM_INSTAMART]),
    requestedPlatforms,
  };
}

function buildSearchDiagnostics({
  authScope,
  authUser,
  headerUserId,
  effectiveUserId,
  identityMismatch,
  authError,
  requestedPlatforms,
  sessionDiagnostics,
  platformStatus,
}) {
  const failedPlatforms = Object.entries(platformStatus ?? {})
    .filter(([, status]) => typeof status === 'string' && status.startsWith('error:'))
    .map(([platform, status]) => ({
      platform,
      reason: String(status).replace(/^error:\s*/i, ''),
    }));

  return {
    authScope,
    authUserId: String(authUser?.id ?? '').trim() || null,
    authEmail: String(authUser?.email ?? '').trim() || null,
    headerUserId: headerUserId || null,
    effectiveUserId: effectiveUserId || null,
    identityMismatch,
    authError: authError || null,
    requestedPlatforms,
    failedPlatforms,
    sessionDiagnostics,
  };
}

function buildSearchResponse({
  query,
  requestedPlatforms,
  results,
  platformStatus,
  fallbackUsed,
  fallbackReason,
  connectionHints,
  searchDiagnostics,
}) {
  return {
    type: 'SERVER_RESULTS',
    query,
    resolvedAt: new Date().toISOString(),
    results,
    platformStatus,
    totalPlatforms: requestedPlatforms.length,
    resolved: requestedPlatforms.length,
    fallbackUsed,
    fallbackReason,
    connectionHints,
    searchDiagnostics,
  };
}

function buildCookieHeaderFromSession(session) {
  const cookies = session?.cookies && typeof session.cookies === 'object'
    ? session.cookies
    : {};

  const entries = Object.entries(cookies)
    .map(([key, value]) => [String(key ?? '').trim(), String(value ?? '').trim()])
    .filter(([key, value]) => key && value);

  if (entries.length > 0) {
    return entries.map(([key, value]) => `${key}=${value}`).join('; ');
  }

  const fromHeaders = String(session?.headers?.Cookie ?? session?.headers?.cookie ?? '').trim();
  return fromHeaders;
}

async function getBestSessionInputForPlatform(userId, platform, loadCookieSession) {
  const fullSession = await getPlatformSession(userId, platform).catch(() => null);
  if (fullSession && typeof fullSession === 'object') {
    const cookieCount = Object.keys(fullSession.cookies ?? {}).length;
    const headerCount = Object.keys(fullSession.headers ?? {}).length;
    if (cookieCount > 0 || headerCount > 0) {
      return {
        sessionInput: fullSession,
        source: 'full_session',
      };
    }
  }

  const cookieSession = await loadCookieSession(userId).catch(() => null);
  if (cookieSession?.cookieHeader) {
    return {
      sessionInput: cookieSession.cookieHeader,
      source: 'cookie_header',
    };
  }

  return {
    sessionInput: null,
    source: 'none',
  };
}

function deriveLegacyDeviceUserIdFromEmail(email) {
  const safeEmail = String(email ?? '').trim().toLowerCase();
  const match = safeEmail.match(/^device\.([a-z0-9]{32})@flit\.local$/i);
  if (!match) return null;

  const compact = match[1];
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20, 32)}`;
}

function toSessionPayload(session) {
  return {
    cookies: session?.cookies && typeof session.cookies === 'object' ? session.cookies : {},
    headers: session?.headers && typeof session.headers === 'object' ? session.headers : {},
    extra: session?.extra && typeof session.extra === 'object' ? session.extra : {},
  };
}

async function getSessionForJwtSearch({ authUser, platform, fallbackUserId = null }) {
  const authUserId = String(authUser?.id ?? '').trim();
  if (!authUserId) {
    return {
      session: null,
      source: 'missing_auth_user',
      userId: null,
      migrated: false,
    };
  }

  const directSession = await getPlatformSession(authUserId, platform);
  if (directSession) {
    return {
      session: directSession,
      source: 'jwt_user',
      userId: authUserId,
      migrated: false,
    };
  }

  const rawFallbackUserId = String(fallbackUserId ?? '').trim();
  const headerFallbackUserId = ENABLE_JWT_HEADER_BRIDGE ? rawFallbackUserId : '';
  if (headerFallbackUserId && headerFallbackUserId !== authUserId) {
    const fallbackSession = await getPlatformSession(headerFallbackUserId, platform);
    if (fallbackSession) {
      let source = 'header_bridge';
      let migrated = false;

      await storePlatformSession({
        userId: authUserId,
        platform,
        session: toSessionPayload(fallbackSession),
        expiresAt: fallbackSession?.expiresAt ?? null,
      })
        .then(() => {
          source = 'header_bridge_migrated';
          migrated = true;
        })
        .catch((err) => {
          source = 'header_bridge_migration_failed';
          console.warn(`[Search JWT] Could not migrate ${platform} header-fallback session:`, err.message);
        });

      return {
        session: fallbackSession,
        source,
        userId: authUserId,
        fallbackUserId: headerFallbackUserId,
        migrated,
      };
    }
  }

  const legacyUserId = deriveLegacyDeviceUserIdFromEmail(authUser?.email);
  if (!legacyUserId || legacyUserId === authUserId) {
    return {
      session: null,
      source: 'not_found',
      userId: authUserId,
      fallbackUserId: headerFallbackUserId || null,
      migrated: false,
    };
  }

  const legacySession = await getPlatformSession(legacyUserId, platform);
  if (!legacySession) {
    return {
      session: null,
      source: 'not_found',
      userId: authUserId,
      fallbackUserId: headerFallbackUserId || null,
      legacyUserId,
      migrated: false,
    };
  }

  // One-time bridge: hydrate JWT user context from legacy device-id sessions.
  let source = 'legacy_bridge';
  let migrated = false;

  await storePlatformSession({
    userId: authUserId,
    platform,
    session: toSessionPayload(legacySession),
    expiresAt: legacySession?.expiresAt ?? null,
  })
    .then(() => {
      source = 'legacy_bridge_migrated';
      migrated = true;
    })
    .catch((err) => {
      source = 'legacy_bridge_migration_failed';
      console.warn(`[Search JWT] Could not migrate ${platform} legacy session:`, err.message);
    });

  return {
    session: legacySession,
    source,
    userId: authUserId,
    fallbackUserId: headerFallbackUserId || null,
    legacyUserId,
    migrated,
  };
}

function createPlatformSearchTask({ platform, query, latitude, longitude, sessionInput }) {
  if (platform === PLATFORM_BLINKIT) {
    return {
      platform,
      promise: searchBlinkit(query, latitude, longitude, sessionInput),
    };
  }

  if (platform === PLATFORM_ZEPTO) {
    return {
      platform,
      promise: searchZepto(query, latitude, longitude, sessionInput),
    };
  }

  if (platform === PLATFORM_INSTAMART) {
    return {
      platform,
      promise: searchInstamart(query, latitude, longitude, sessionInput),
    };
  }

  if (platform === PLATFORM_BIGBASKET) {
    return {
      platform,
      promise: searchBigBasket(query, sessionInput),
    };
  }

  if (platform === PLATFORM_JIOMART) {
    return {
      platform,
      promise: searchJioMart(query, sessionInput),
    };
  }

  return null;
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
      jwtHeaderBridgeEnabled: ENABLE_JWT_HEADER_BRIDGE,
      message: 'Flit server running. App-first token-vault flow active with Blinkit + Zepto + Instamart pilots.',
  });
});

// ─── SPEC ROUTES (JWT) ─────────────────────────────────────────────────────

app.use('/api/auth', authRoutes);
app.use('/api/platforms', platformRoutes);

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

    const sessionLookup = await getBestSessionInputForPlatform(
      req.userId,
      PLATFORM_BLINKIT,
      getBlinkitCookieSession
    );
    if (!sessionLookup.sessionInput) {
      return res.status(412).json({
        error: 'blinkit_not_connected',
        reconnectRequired: true,
        platform: PLATFORM_BLINKIT,
      });
    }

    const latitude = lat ?? 28.4595;
    const longitude = lon ?? 77.0266;

    const result = await searchBlinkit(query.trim(), latitude, longitude, sessionLookup.sessionInput);

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

    const sessionLookup = await getBestSessionInputForPlatform(
      req.userId,
      PLATFORM_ZEPTO,
      getZeptoCookieSession
    );
    if (!sessionLookup.sessionInput) {
      return res.status(412).json({
        error: 'zepto_not_connected',
        reconnectRequired: true,
        platform: PLATFORM_ZEPTO,
      });
    }

    const latitude = lat ?? 28.4595;
    const longitude = lon ?? 77.0266;

    const result = await searchZepto(query.trim(), latitude, longitude, sessionLookup.sessionInput);

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

    const sessionLookup = await getBestSessionInputForPlatform(
      req.userId,
      PLATFORM_INSTAMART,
      getInstamartCookieSession
    );
    if (!sessionLookup.sessionInput) {
      return res.status(412).json({
        error: 'instamart_not_connected',
        reconnectRequired: true,
        platform: PLATFORM_INSTAMART,
      });
    }

    const latitude = lat ?? 28.4595;
    const longitude = lon ?? 77.0266;

    const result = await searchInstamart(query.trim(), latitude, longitude, sessionLookup.sessionInput);

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
    const hasAuthorizationHeader = Boolean(
      String(req.get('Authorization') ?? req.get('authorization') ?? '').trim()
    );

    const headerUserId = String(req.get('x-flit-user-id') ?? '').trim() || null;
    const requestUserId = String(req.userId ?? '').trim() || null;
    const authUserId = String(req.authUser?.id ?? '').trim() || null;
    const effectiveUserId = authUserId || requestUserId || headerUserId;
    const identityMismatch = Boolean(authUserId && headerUserId && authUserId !== headerUserId);
    const authScope = hasAuthorizationHeader && req.authUser ? 'jwt' : 'legacy';

    if (identityMismatch) {
      if (ENABLE_JWT_HEADER_BRIDGE) {
        console.warn(`[Search] Identity mismatch: jwt=${authUserId}, header=${headerUserId}`);
      } else {
        console.warn(`[Search] Identity mismatch ignored (header bridge disabled): jwt=${authUserId}, header=${headerUserId}`);
      }
    }

    if (hasAuthorizationHeader && req.authError) {
      console.warn(`[Search] Auth error for request: ${req.authError}, userId header: ${headerUserId ?? 'none'}`);
      // Don't block — fall through to legacy path if we have a userId from header
      if (!effectiveUserId) {
        return res.status(401).json({ error: req.authError });
      }
    }

    if (hasAuthorizationHeader && !req.authUser && !effectiveUserId) {
      return res.status(401).json({ error: 'invalid_token' });
    }

    const { query, lat, lon, platforms } = req.body ?? {};
    if (!query || !query.trim()) {
      return res.status(400).json({ error: 'query is required' });
    }

    const trimmedQuery = query.trim();
    const latitude = lat ?? 28.4595;
    const longitude = lon ?? 77.0266;
    const requestedPlatforms = normalizeRequestedPlatforms(platforms);
    const platformStatus = Object.fromEntries(requestedPlatforms.map((platform) => [platform, 'not_connected']));
    const sessionSourceByPlatform = createStringPlatformMap(requestedPlatforms, 'none');
    const reconnectRequiredByPlatform = createBooleanPlatformMap(requestedPlatforms, false);
    const sessionDiagnostics = {};
    const platformTasks = [];
    let cacheKey = null;

    if (authScope === 'jwt') {
      console.log(`[Search JWT] User: ${authUserId}, email: ${req.authUser?.email ?? 'none'}, platforms: [${requestedPlatforms.join(', ')}]`);
      const jwtFallbackUserId = ENABLE_JWT_HEADER_BRIDGE ? headerUserId : null;

      for (const platform of requestedPlatforms) {
        try {
          const lookup = await getSessionForJwtSearch({
            authUser: req.authUser,
            platform,
            fallbackUserId: jwtFallbackUserId,
          });

          sessionSourceByPlatform[platform] = lookup?.source ?? 'not_found';

          if (!lookup?.session) {
            sessionDiagnostics[platform] = {
              source: sessionSourceByPlatform[platform],
              sessionFound: false,
            };
            continue;
          }

          const session = lookup.session;
          const cookieHeader = buildCookieHeaderFromSession(session);
          const headerCount = Object.keys(session?.headers ?? {}).length;
          const hasSessionHeaders = headerCount > 0;

          sessionDiagnostics[platform] = {
            source: sessionSourceByPlatform[platform],
            sessionFound: true,
            cookieLength: cookieHeader?.length ?? 0,
            headerCount,
            extraCount: Object.keys(session?.extra ?? {}).length,
          };

          if ((!cookieHeader || !cookieHeader.includes('=')) && !hasSessionHeaders) {
            console.warn(`[Search JWT] ${platform}: session exists but has no usable cookies or headers — skipping`);
            sessionDiagnostics[platform].skipped = 'no_usable_cookie_or_header';
            continue;
          }

          const task = createPlatformSearchTask({
            platform,
            query: trimmedQuery,
            latitude,
            longitude,
            sessionInput: session,
          });

          if (!task) {
            platformStatus[platform] = 'error: unsupported_platform';
            continue;
          }

          platformTasks.push(task);
        } catch (err) {
          platformStatus[platform] = 'error: session_load_failed';
          sessionDiagnostics[platform] = {
            source: sessionSourceByPlatform[platform] ?? 'lookup_failed',
            sessionFound: false,
            error: err.message,
          };
          console.warn(`[Search JWT] ${platform} session load failed:`, err.message);
        }
      }
    } else {
      const sessionInputByPlatform = {
        [PLATFORM_BLINKIT]: null,
        [PLATFORM_ZEPTO]: null,
        [PLATFORM_INSTAMART]: null,
      };

      if (isTokenVaultAvailable() && effectiveUserId) {
        const requestedPilotPlatforms = requestedPlatforms.filter((platform) => PLATFORM_PILOT.includes(platform));
        const cookieSessionLoaders = {
          [PLATFORM_BLINKIT]: getBlinkitCookieSession,
          [PLATFORM_ZEPTO]: getZeptoCookieSession,
          [PLATFORM_INSTAMART]: getInstamartCookieSession,
        };

        for (const platform of requestedPilotPlatforms) {
          try {
            const lookup = await getBestSessionInputForPlatform(
              effectiveUserId,
              platform,
              cookieSessionLoaders[platform]
            );

            if (!lookup.sessionInput) {
              continue;
            }

            sessionInputByPlatform[platform] = lookup.sessionInput;
            sessionSourceByPlatform[platform] = lookup.source === 'full_session'
              ? 'token_vault_session'
              : 'token_vault';
          } catch (err) {
            console.warn(`[Server Search] Could not read ${platform} token vault session:`, err.message);
          }
        }
      }

      for (const platform of requestedPlatforms) {
        const sessionInput = sessionInputByPlatform[platform] ?? null;

        if (PLATFORM_PILOT.includes(platform) && !sessionInput) {
          sessionDiagnostics[platform] = {
            source: sessionSourceByPlatform[platform],
            sessionFound: false,
          };
          platformStatus[platform] = 'not_connected';
          continue;
        }

        if (!sessionSourceByPlatform[platform] || sessionSourceByPlatform[platform] === 'none') {
          sessionSourceByPlatform[platform] = PLATFORM_PILOT.includes(platform)
            ? 'none'
            : 'public_endpoint';
        }

        const isObjectSessionInput = Boolean(sessionInput && typeof sessionInput === 'object');
        const cookieLength = isObjectSessionInput
          ? buildCookieHeaderFromSession(sessionInput).length
          : (sessionInput ? String(sessionInput).length : 0);
        const headerCount = isObjectSessionInput
          ? Object.keys(sessionInput.headers ?? {}).length
          : 0;

        sessionDiagnostics[platform] = {
          source: sessionSourceByPlatform[platform],
          sessionFound: Boolean(sessionInput),
          sessionInputType: isObjectSessionInput ? 'session_object' : (sessionInput ? 'cookie_header' : 'none'),
          cookieLength,
          headerCount,
        };

        const task = createPlatformSearchTask({
          platform,
          query: trimmedQuery,
          latitude,
          longitude,
          sessionInput,
        });

        if (!task) {
          platformStatus[platform] = 'error: unsupported_platform';
          continue;
        }

        platformTasks.push(task);
      }

      const cacheUserScope = effectiveUserId ? `user:${effectiveUserId}` : 'anon';
      const sessionScope = requestedPlatforms
        .map((platform) => `${platform}:${sessionSourceByPlatform[platform] ?? 'none'}`)
        .join('|');
      cacheKey = `search:v2:${authScope}:${cacheUserScope}:${trimmedQuery.toLowerCase()}:${latitude}:${longitude}:platforms=${requestedPlatforms.join(',')}:sessions=${sessionScope}`;

      // Live-only mode: always fetch fresh platform data for each search request.

      console.log(
        `[Server Search] Searching "${query}" at ${latitude},${longitude} | effectiveUserId: ${effectiveUserId ?? 'none'} | scope: ${authScope} | sessions: ${sessionScope}`
      );
    }

    const settled = await Promise.allSettled(platformTasks.map((task) => task.promise));
    const allProducts = [];

    for (let index = 0; index < settled.length; index += 1) {
      const outcome = settled[index];
      const task = platformTasks[index];
      const platform = task.platform;

      if (outcome.status !== 'fulfilled') {
        platformStatus[platform] = 'error: exception';
        continue;
      }

      const result = outcome.value;
      if (result.error) {
        platformStatus[platform] = `error: ${result.error}`;
        reconnectRequiredByPlatform[platform] = isSessionInvalidError(result.error);

        if (reconnectRequiredByPlatform[platform] && isTokenVaultAvailable() && effectiveUserId) {
          await markReconnectRequiredByPlatform(effectiveUserId, platform, result.error);
        }
        continue;
      }

      const statusHint = String(result?.status ?? '').trim();
      platformStatus[platform] = statusHint || 'ok';
      reconnectRequiredByPlatform[platform] = false;
      allProducts.push(...(result.products ?? []));
    }

    const hasConnectedSessionContext = requestedPlatforms.some((platform) => {
      const source = String(sessionSourceByPlatform[platform] ?? '').trim().toLowerCase();
      return source && source !== 'none';
    });

    const syntheticFallbackUsed = false;
    const fallbackReason = 'none';
    const connectionHints = buildConnectionHints({
      requestedPlatforms,
      sessionSourceByPlatform,
      reconnectRequiredByPlatform,
    });
    const searchDiagnostics = buildSearchDiagnostics({
      authScope,
      authUser: req.authUser,
      headerUserId,
      effectiveUserId,
      identityMismatch,
      authError: req.authError,
      requestedPlatforms,
      sessionDiagnostics,
      platformStatus,
    });

    let response = buildSearchResponse({
      query: trimmedQuery,
      requestedPlatforms,
      results: allProducts,
      platformStatus,
      fallbackUsed: syntheticFallbackUsed,
      fallbackReason,
      connectionHints,
      searchDiagnostics,
    });

    // Live-only mode: do not cache /api/search responses.

    console.log(
      `[Server Search] Done: ${allProducts.length} products from ${platformTasks.filter((task, idx) => settled[idx]?.status === 'fulfilled' && !settled[idx].value?.error).length}/${requestedPlatforms.length} platforms | scope=${authScope}`
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
  console.log('  POST /api/auth/register');
  console.log('  POST /api/auth/login');
  console.log('  POST /api/auth/refresh');
  console.log('  POST /api/platforms/connect');
  console.log('  GET  /api/platforms/status');
  console.log('  DELETE /api/platforms/:platform');
  console.log('  POST /api/platforms/:platform/verify');
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