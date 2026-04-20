import express from 'express';
import { z } from 'zod';

import { requireAuthUser } from '../middleware/auth.js';
import {
  disconnectPlatform,
  getPlatformSession,
  isTokenVaultAvailable,
  listConnections,
  markPlatformReconnectRequired,
  storePlatformSession,
} from '../tokenVault.js';
import {
  searchBigBasket,
  searchBlinkit,
  searchInstamart,
  searchJioMart,
  searchZepto,
} from '../platforms.js';

const router = express.Router();

const PLATFORM_ALL = ['blinkit', 'zepto', 'instamart', 'bigbasket', 'jiomart'];
const REQUIRED_HEADERS_BY_PLATFORM = {
  blinkit: ['authorization', 'x-device-id'],
  zepto: ['authorization', 'x-device-id', 'x-session-id', 'x-unique-browser-id', 'platform', 'app-version'],
  // Instamart, BigBasket and JioMart can run from cookie sessions alone.
  // Keep required headers empty to avoid false reconnect warnings.
  instamart: [],
  bigbasket: [],
  jiomart: [],
};

const connectSchema = z.object({
  platform: z.enum(PLATFORM_ALL),
  session: z.object({
    cookies: z.record(z.string(), z.string()).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    extra: z.record(z.string(), z.string()).optional(),
  }),
  expiresAt: z.string().datetime().optional().nullable(),
});

function toCookieHeader(session) {
  const cookieEntries = Object.entries(session?.cookies ?? {})
    .map(([key, value]) => [String(key ?? '').trim(), String(value ?? '').trim()])
    .filter(([key, value]) => key && value);

  if (cookieEntries.length > 0) {
    return cookieEntries.map(([key, value]) => `${key}=${value}`).join('; ');
  }

  const cookieHeader = String(session?.headers?.Cookie ?? session?.headers?.cookie ?? '').trim();
  return cookieHeader;
}

function mapConnectionStatus(status) {
  if (status === 'connected') return 'connected';
  if (status === 'expired' || status === 'reconnect_required') return 'expired';
  return 'disconnected';
}

function normaliseStringMap(value) {
  if (!value || typeof value !== 'object') return {};

  const out = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = String(rawKey ?? '').trim();
    const stringValue = String(rawValue ?? '').trim();
    if (!key || !stringValue) continue;
    out[key] = stringValue;
  }

  return out;
}

function getCookieValueIgnoreCase(cookies, candidateNames) {
  if (!cookies || typeof cookies !== 'object') return '';

  const candidates = Array.isArray(candidateNames)
    ? candidateNames
    : [candidateNames];

  for (const candidate of candidates) {
    const name = String(candidate ?? '').trim().toLowerCase();
    if (!name) continue;

    for (const [rawKey, rawValue] of Object.entries(cookies)) {
      const key = String(rawKey ?? '').trim().toLowerCase();
      if (key !== name) continue;

      const value = String(rawValue ?? '').trim();
      if (value) return value;
    }
  }

  return '';
}

function isRequiredHeaderSatisfied(platform, headerName, headerKeySet, cookies) {
  const name = String(headerName ?? '').trim().toLowerCase();
  if (!name) return false;

  if (headerKeySet.has(name)) {
    return true;
  }

  switch (name) {
    case 'authorization':
      return Boolean(getCookieValueIgnoreCase(cookies, ['accessToken', 'gr_1_accessToken', 'auth_token', 'token']));
    case 'x-device-id':
      return Boolean(getCookieValueIgnoreCase(cookies, ['device_id', 'gr_1_deviceId', 'gr_1_device_id', '_device_id', 'deviceId']));
    case 'x-session-id':
      return Boolean(getCookieValueIgnoreCase(cookies, ['session_id', 'gr_1_session_id', 'gr_1_sessionId', '_session_tid', 'session_count']));
    case 'x-unique-browser-id':
      return Boolean(getCookieValueIgnoreCase(cookies, ['unique_browser_id', 'gr_1_unique_browser_id', 'gr_1_uniqueBrowserId', '_swuid']));
    case 'platform':
      return platform === 'zepto';
    case 'app-version':
      return platform === 'zepto';
    default:
      return false;
  }
}

function buildSessionDiagnostics(platform, session) {
  const cookies = normaliseStringMap(session?.cookies);
  const headers = normaliseStringMap(session?.headers);

  const cookieKeys = Object.keys(cookies).sort((a, b) => a.localeCompare(b));
  const headerKeys = Object.keys(headers).sort((a, b) => a.localeCompare(b));
  const headerKeySet = new Set(headerKeys.map((key) => key.toLowerCase()));

  const requiredHeaders = (REQUIRED_HEADERS_BY_PLATFORM[platform] ?? []).map((name) =>
    String(name).toLowerCase()
  );
  const presentRequiredHeaders = requiredHeaders.filter((name) =>
    isRequiredHeaderSatisfied(platform, name, headerKeySet, cookies)
  );
  const missingRequiredHeaders = requiredHeaders.filter((name) =>
    !isRequiredHeaderSatisfied(platform, name, headerKeySet, cookies)
  );
  const derivedRequiredHeaders = presentRequiredHeaders.filter((name) => !headerKeySet.has(name));

  const cookieHeader = toCookieHeader({ cookies, headers });

  return {
    hasSession: Boolean(session),
    cookieCount: cookieKeys.length,
    cookieKeys,
    cookieHeaderLength: cookieHeader.length,
    headerCount: headerKeys.length,
    headerKeys,
    requiredHeaders,
    presentRequiredHeaders,
    derivedRequiredHeaders,
    missingRequiredHeaders,
  };
}

async function verifySession(platform, query, session) {
  if (platform === 'blinkit') {
    return searchBlinkit(query, 28.4595, 77.0266, session);
  }

  if (platform === 'zepto') {
    return searchZepto(query, 28.4595, 77.0266, session);
  }

  if (platform === 'instamart') {
    return searchInstamart(query, 28.4595, 77.0266, session);
  }

  if (platform === 'bigbasket') {
    return searchBigBasket(query, session);
  }

  if (platform === 'jiomart') {
    return searchJioMart(query, session);
  }

  return { platform, products: [], error: 'unsupported_platform' };
}

router.use(requireAuthUser);

router.post('/connect', async (req, res) => {
  try {
    if (!isTokenVaultAvailable()) {
      return res.status(503).json({ error: 'token_vault_unavailable' });
    }

    const body = connectSchema.parse(req.body ?? {});

    const cookieHeader = toCookieHeader(body.session);
    if (!cookieHeader || !cookieHeader.includes('=')) {
      return res.status(400).json({ error: 'session_cookie_required' });
    }

    await storePlatformSession({
      userId: req.authUser.id,
      platform: body.platform,
      session: body.session,
      expiresAt: body.expiresAt ?? null,
    });

    return res.json({
      connected: true,
      platform: body.platform,
      diagnostics: buildSessionDiagnostics(body.platform, body.session),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        error: 'invalid_request',
        issues: err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    return res.status(500).json({ error: err?.message ?? 'connect_failed' });
  }
});

router.get('/status', async (req, res) => {
  try {
    if (!isTokenVaultAvailable()) {
      return res.status(503).json({ error: 'token_vault_unavailable' });
    }

    const connections = await listConnections(req.authUser.id);
    const statusMap = Object.fromEntries(PLATFORM_ALL.map((platform) => [platform, 'disconnected']));

    for (const connection of connections) {
      const platform = String(connection.platform ?? '').toLowerCase();
      if (!PLATFORM_ALL.includes(platform)) continue;

      statusMap[platform] = mapConnectionStatus(connection.status);
    }

    return res.json({ platforms: statusMap });
  } catch (err) {
    return res.status(500).json({ error: err?.message ?? 'status_failed' });
  }
});

router.delete('/:platform', async (req, res) => {
  try {
    if (!isTokenVaultAvailable()) {
      return res.status(503).json({ error: 'token_vault_unavailable' });
    }

    const platform = String(req.params.platform ?? '').trim().toLowerCase();
    if (!PLATFORM_ALL.includes(platform)) {
      return res.status(400).json({ error: 'invalid_platform' });
    }

    await disconnectPlatform(req.authUser.id, platform, 'user_disconnect');
    return res.json({ disconnected: true });
  } catch (err) {
    return res.status(500).json({ error: err?.message ?? 'disconnect_failed' });
  }
});

router.post('/:platform/verify', async (req, res) => {
  try {
    if (!isTokenVaultAvailable()) {
      return res.status(503).json({ error: 'token_vault_unavailable' });
    }

    const platform = String(req.params.platform ?? '').trim().toLowerCase();
    if (!PLATFORM_ALL.includes(platform)) {
      return res.status(400).json({ error: 'invalid_platform' });
    }

    const session = await getPlatformSession(req.authUser.id, platform);
    if (!session) {
      return res.json({
        valid: false,
        reason: 'not_connected',
        diagnostics: buildSessionDiagnostics(platform, null),
      });
    }

    const cookieHeader = toCookieHeader(session);
    const diagnostics = buildSessionDiagnostics(platform, session);

    if (!cookieHeader) {
      return res.json({
        valid: false,
        reason: 'session_cookie_missing',
        diagnostics,
      });
    }

    const probeResult = await verifySession(platform, 'milk', session);
    if (!probeResult.error) {
      return res.json({ valid: true, diagnostics });
    }

    if (probeResult.error === 'session_invalid' || probeResult.error === 'HTTP 401' || probeResult.error === 'HTTP 403') {
      await markPlatformReconnectRequired(req.authUser.id, platform, probeResult.error).catch(() => {});
    }

    return res.json({
      valid: false,
      reason: probeResult.error,
      diagnostics,
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message ?? 'verify_failed' });
  }
});

export default router;
