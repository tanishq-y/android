import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { isDbConfigured, query, withTransaction } from './db.js';
import { encryptSecret, decryptSecret } from './security/tokenCrypto.js';

const PLATFORM_BLINKIT = 'blinkit';
const PLATFORM_ZEPTO = 'zepto';
const PLATFORM_INSTAMART = 'instamart';
const PLATFORM_BIGBASKET = 'bigbasket';
const PLATFORM_JIOMART = 'jiomart';
const TOKEN_TYPE_COOKIE = 'cookie_header';
const TOKEN_TYPE_SESSION_JSON = 'session_json';
const SUPPORTED_PLATFORMS = new Set([
  PLATFORM_BLINKIT,
  PLATFORM_ZEPTO,
  PLATFORM_INSTAMART,
  PLATFORM_BIGBASKET,
  PLATFORM_JIOMART,
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEV_FILE_VAULT_PATH = path.resolve(__dirname, './data/dev-token-vault.json');

let devStoreLoaded = false;
let devStoreCache = null;

function nowIso() {
  return new Date().toISOString();
}

function assertSupportedPlatform(platform) {
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error(`Unsupported platform: ${platform}`);
  }
}

function isDevFileVaultEnabled() {
  return (
    process.env.NODE_ENV !== 'production' &&
    String(process.env.ENABLE_DEV_FILE_VAULT ?? 'false').toLowerCase() === 'true'
  );
}

function createEmptyStore() {
  return {
    version: 1,
    users: {},
  };
}

function ensureStoreShape(store) {
  const shaped = store && typeof store === 'object' ? store : createEmptyStore();
  if (!shaped.users || typeof shaped.users !== 'object') {
    shaped.users = {};
  }
  return shaped;
}

function normaliseExpiresAt(expiresAt) {
  if (!expiresAt) return null;
  const dt = new Date(expiresAt);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function normaliseStringMap(input) {
  if (!input || typeof input !== 'object') return {};

  const out = {};

  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = String(rawKey ?? '').trim();
    const value = String(rawValue ?? '').trim();
    if (!key || !value) continue;
    out[key] = value;
  }

  return out;
}

function parseCookieHeader(cookieHeader) {
  const out = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return out;

  for (const part of cookieHeader.split(';')) {
    const trimmed = String(part ?? '').trim();
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;

    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!key || !value) continue;

    out[key] = value;
  }

  return out;
}

function cookieHeaderFromCookies(cookies) {
  const entries = Object.entries(cookies ?? {})
    .map(([rawKey, rawValue]) => [String(rawKey ?? '').trim(), String(rawValue ?? '').trim()])
    .filter(([key, value]) => key && value);

  if (!entries.length) return '';
  return entries.map(([key, value]) => `${key}=${value}`).join('; ');
}

function getMapValueIgnoreCase(input, candidates) {
  if (!input || typeof input !== 'object') return '';

  const names = Array.isArray(candidates) ? candidates : [candidates];
  const normalizedNames = names
    .map((name) => String(name ?? '').trim().toLowerCase())
    .filter(Boolean);

  if (!normalizedNames.length) return '';

  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = String(rawKey ?? '').trim().toLowerCase();
    if (!normalizedNames.includes(key)) continue;

    const value = String(rawValue ?? '').trim();
    if (!value) continue;
    return value;
  }

  return '';
}

function hasHeaderIgnoreCase(headers, headerName) {
  const name = String(headerName ?? '').trim().toLowerCase();
  if (!name) return false;

  return Object.keys(headers ?? {}).some((key) => String(key ?? '').trim().toLowerCase() === name);
}

function setHeaderIfMissing(headers, headerName, value) {
  const safeHeaderName = String(headerName ?? '').trim();
  const safeValue = String(value ?? '').trim();

  if (!safeHeaderName || !safeValue) return;
  if (hasHeaderIgnoreCase(headers, safeHeaderName)) return;

  headers[safeHeaderName] = safeValue;
}

function toBearerToken(token) {
  const value = String(token ?? '').trim();
  if (!value) return '';
  if (value.toLowerCase().startsWith('bearer ')) return value;
  return `Bearer ${value}`;
}

function hydrateSessionHeadersFromCookies(headers, cookies, platform = null) {
  const accessToken = getMapValueIgnoreCase(cookies, ['accessToken', 'gr_1_accessToken', 'auth_token', 'token']);
  const xsrfToken = getMapValueIgnoreCase(cookies, ['XSRF-TOKEN', 'xsrfToken']);

  setHeaderIfMissing(headers, 'Authorization', toBearerToken(accessToken));
  setHeaderIfMissing(headers, 'x-access-token', accessToken);
  setHeaderIfMissing(headers, 'x-device-id', getMapValueIgnoreCase(cookies, ['device_id', 'gr_1_deviceId', 'gr_1_device_id', '_device_id', 'deviceId']));
  setHeaderIfMissing(headers, 'x-session-id', getMapValueIgnoreCase(cookies, ['session_id', 'gr_1_session_id', 'gr_1_sessionId', '_session_tid', 'session_count']));
  setHeaderIfMissing(headers, 'x-unique-browser-id', getMapValueIgnoreCase(cookies, ['unique_browser_id', 'gr_1_unique_browser_id', 'gr_1_uniqueBrowserId', '_swuid']));
  setHeaderIfMissing(headers, 'x-xsrf-token', xsrfToken);
  setHeaderIfMissing(headers, 'x-csrf-token', xsrfToken);

  if (platform === PLATFORM_ZEPTO) {
    setHeaderIfMissing(headers, 'platform', 'WEB');
    setHeaderIfMissing(headers, 'app-version', '1.0.0');
    setHeaderIfMissing(headers, 'X-WITHOUT-BEARER', 'true');
  }
}

function normalisePlatformSession(session, platform = null) {
  const cookies = normaliseStringMap(session?.cookies);
  const headers = normaliseStringMap(session?.headers);
  const extra = normaliseStringMap(session?.extra);

  if (Object.keys(cookies).length === 0) {
    const cookieHeader = String(headers.Cookie ?? headers.cookie ?? '').trim();
    if (cookieHeader) {
      Object.assign(cookies, parseCookieHeader(cookieHeader));
    }
  }

  hydrateSessionHeadersFromCookies(headers, cookies, platform);

  const normalizedCookieHeader = cookieHeaderFromCookies(cookies);
  if (normalizedCookieHeader) {
    headers.Cookie = normalizedCookieHeader;
  }

  return {
    cookies,
    headers,
    extra,
  };
}

function getCookieHeaderFromSession(session, platform = null) {
  const normalized = normalisePlatformSession(session, platform);
  const fromCookies = cookieHeaderFromCookies(normalized.cookies);
  if (fromCookies) return fromCookies;

  const fromHeaders = String(normalized.headers.Cookie ?? normalized.headers.cookie ?? '').trim();
  return fromHeaders;
}

async function loadDevStore() {
  if (devStoreLoaded) {
    return devStoreCache;
  }

  try {
    const content = await fs.readFile(DEV_FILE_VAULT_PATH, 'utf8');
    devStoreCache = ensureStoreShape(JSON.parse(content));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
    devStoreCache = createEmptyStore();
  }

  devStoreLoaded = true;
  return devStoreCache;
}

async function persistDevStore() {
  if (!devStoreLoaded || !devStoreCache) return;
  await fs.mkdir(path.dirname(DEV_FILE_VAULT_PATH), { recursive: true });
  await fs.writeFile(DEV_FILE_VAULT_PATH, `${JSON.stringify(devStoreCache, null, 2)}\n`, 'utf8');
}

async function withDevStore(callback) {
  const store = await loadDevStore();
  const result = await callback(store);
  await persistDevStore();
  return result;
}

function ensureDevUserRecord(store, userId) {
  if (!store.users[userId]) {
    store.users[userId] = {
      connections: {},
      tokens: {},
      audit_events: [],
      created_at: nowIso(),
    };
  }

  const user = store.users[userId];
  if (!user.connections || typeof user.connections !== 'object') user.connections = {};
  if (!user.tokens || typeof user.tokens !== 'object') user.tokens = {};
  if (!Array.isArray(user.audit_events)) user.audit_events = [];
  return user;
}

function pushDevAudit(user, { platform, eventType, metadata = {} }) {
  user.audit_events.unshift({
    platform,
    event_type: eventType,
    metadata,
    created_at: nowIso(),
  });

  if (user.audit_events.length > 500) {
    user.audit_events.length = 500;
  }
}

function disconnectedStatus(platform) {
  return {
    platform,
    status: 'disconnected',
    status_reason: 'never_connected',
  };
}

function vaultUnavailableError() {
  return new Error(
    'Token vault unavailable. Configure DATABASE_URL or set ENABLE_DEV_FILE_VAULT=true in development.'
  );
}

export function getTokenVaultMode() {
  if (isDbConfigured()) return 'postgres';
  if (isDevFileVaultEnabled()) return 'dev-file';
  return 'unavailable';
}

export function isTokenVaultAvailable() {
  return getTokenVaultMode() !== 'unavailable';
}

async function ensureUserDb(client, userId) {
  await client.query(
    `INSERT INTO users (id)
     VALUES ($1)
     ON CONFLICT (id) DO NOTHING`,
    [userId]
  );
}

async function writeAuditDb(client, { userId, platform, eventType, metadata = {} }) {
  await client.query(
    `INSERT INTO token_audit_events (user_id, platform, event_type, metadata)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [userId, platform, eventType, JSON.stringify(metadata)]
  );
}

export async function listConnections(userId) {
  const mode = getTokenVaultMode();

  if (mode === 'postgres') {
    const { rows } = await query(
      `SELECT platform, status, status_reason, connected_at, disconnected_at, last_validated_at, updated_at
       FROM platform_connections
       WHERE user_id = $1
       ORDER BY platform ASC`,
      [userId]
    );
    return rows;
  }

  if (mode === 'dev-file') {
    const store = await loadDevStore();
    const user = store.users[userId];
    if (!user?.connections) return [];

    return Object.entries(user.connections)
      .map(([platform, connection]) => ({
        platform,
        status: connection.status,
        status_reason: connection.status_reason ?? null,
        connected_at: connection.connected_at ?? null,
        disconnected_at: connection.disconnected_at ?? null,
        last_validated_at: connection.last_validated_at ?? null,
        updated_at: connection.updated_at ?? null,
      }))
      .sort((a, b) => a.platform.localeCompare(b.platform));
  }

  throw vaultUnavailableError();
}

export async function getPlatformConnectionStatus(userId, platform) {
  assertSupportedPlatform(platform);
  const mode = getTokenVaultMode();

  if (mode === 'postgres') {
    const { rows } = await query(
      `SELECT platform, status, status_reason, connected_at, disconnected_at, last_validated_at, updated_at
       FROM platform_connections
       WHERE user_id = $1 AND platform = $2
       LIMIT 1`,
      [userId, platform]
    );

    if (!rows[0]) return disconnectedStatus(platform);
    return rows[0];
  }

  if (mode === 'dev-file') {
    const store = await loadDevStore();
    const user = store.users[userId];
    const conn = user?.connections?.[platform];

    if (!conn) return disconnectedStatus(platform);

    return {
      platform,
      status: conn.status,
      status_reason: conn.status_reason ?? null,
      connected_at: conn.connected_at ?? null,
      disconnected_at: conn.disconnected_at ?? null,
      last_validated_at: conn.last_validated_at ?? null,
      updated_at: conn.updated_at ?? null,
    };
  }

  throw vaultUnavailableError();
}

export async function storePlatformCookieSession({ userId, platform, cookieHeader, expiresAt = null }) {
  assertSupportedPlatform(platform);

  if (!cookieHeader || typeof cookieHeader !== 'string' || cookieHeader.length < 10) {
    throw new Error('cookieHeader is required and appears invalid');
  }

  const encrypted = encryptSecret(cookieHeader);
  const safeExpiresAt = normaliseExpiresAt(expiresAt);
  const mode = getTokenVaultMode();

  if (mode === 'postgres') {
    return withTransaction(async (client) => {
      await ensureUserDb(client, userId);

      await client.query(
        `INSERT INTO platform_connections (
           user_id, platform, status, status_reason, connected_at, disconnected_at, last_validated_at, updated_at
         ) VALUES ($1, $2, 'connected', NULL, NOW(), NULL, NOW(), NOW())
         ON CONFLICT (user_id, platform)
         DO UPDATE SET
           status = 'connected',
           status_reason = NULL,
           connected_at = COALESCE(platform_connections.connected_at, NOW()),
           disconnected_at = NULL,
           last_validated_at = NOW(),
           updated_at = NOW()`,
        [userId, platform]
      );

      await client.query(
        `INSERT INTO platform_tokens (
           user_id, platform, token_type, encrypted_token, iv, auth_tag, key_version, expires_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (user_id, platform, token_type)
         DO UPDATE SET
           encrypted_token = EXCLUDED.encrypted_token,
           iv = EXCLUDED.iv,
           auth_tag = EXCLUDED.auth_tag,
           key_version = EXCLUDED.key_version,
           expires_at = EXCLUDED.expires_at,
           updated_at = NOW()`,
        [
          userId,
          platform,
          TOKEN_TYPE_COOKIE,
          encrypted.encryptedToken,
          encrypted.iv,
          encrypted.authTag,
          encrypted.keyVersion,
          safeExpiresAt,
        ]
      );

      await writeAuditDb(client, {
        userId,
        platform,
        eventType: 'token_upsert',
        metadata: {
          tokenType: TOKEN_TYPE_COOKIE,
          keyVersion: encrypted.keyVersion,
          hasExpiry: Boolean(safeExpiresAt),
        },
      });

      return {
        platform,
        status: 'connected',
        expiresAt: safeExpiresAt,
        tokenType: TOKEN_TYPE_COOKIE,
      };
    });
  }

  if (mode === 'dev-file') {
    return withDevStore(async (store) => {
      const user = ensureDevUserRecord(store, userId);
      const current = user.connections[platform] ?? null;
      const timestamp = nowIso();

      user.connections[platform] = {
        status: 'connected',
        status_reason: null,
        connected_at: current?.connected_at ?? timestamp,
        disconnected_at: null,
        last_validated_at: timestamp,
        updated_at: timestamp,
      };

      if (!user.tokens[platform] || typeof user.tokens[platform] !== 'object') {
        user.tokens[platform] = {};
      }

      user.tokens[platform][TOKEN_TYPE_COOKIE] = {
        encrypted_token: encrypted.encryptedToken,
        iv: encrypted.iv,
        auth_tag: encrypted.authTag,
        key_version: encrypted.keyVersion,
        expires_at: safeExpiresAt,
        updated_at: timestamp,
      };

      pushDevAudit(user, {
        platform,
        eventType: 'token_upsert',
        metadata: {
          tokenType: TOKEN_TYPE_COOKIE,
          keyVersion: encrypted.keyVersion,
          hasExpiry: Boolean(safeExpiresAt),
          mode: 'dev-file',
        },
      });

      return {
        platform,
        status: 'connected',
        expiresAt: safeExpiresAt,
        tokenType: TOKEN_TYPE_COOKIE,
      };
    });
  }

  throw vaultUnavailableError();
}

export async function storePlatformSession({ userId, platform, session, expiresAt = null }) {
  assertSupportedPlatform(platform);

  const normalizedSession = normalisePlatformSession(session, platform);
  const cookieHeader = getCookieHeaderFromSession(normalizedSession, platform);
  if (!cookieHeader || !cookieHeader.includes('=')) {
    throw new Error('session cookies are required and appear invalid');
  }

  const encryptedSession = encryptSecret(JSON.stringify(normalizedSession));
  const encryptedCookie = encryptSecret(cookieHeader);
  const safeExpiresAt = normaliseExpiresAt(expiresAt);
  const mode = getTokenVaultMode();

  if (mode === 'postgres') {
    return withTransaction(async (client) => {
      await ensureUserDb(client, userId);

      await client.query(
        `INSERT INTO platform_connections (
           user_id, platform, status, status_reason, connected_at, disconnected_at, last_validated_at, updated_at
         ) VALUES ($1, $2, 'connected', NULL, NOW(), NULL, NOW(), NOW())
         ON CONFLICT (user_id, platform)
         DO UPDATE SET
           status = 'connected',
           status_reason = NULL,
           connected_at = COALESCE(platform_connections.connected_at, NOW()),
           disconnected_at = NULL,
           last_validated_at = NOW(),
           updated_at = NOW()`,
        [userId, platform]
      );

      await client.query(
        `INSERT INTO platform_tokens (
           user_id, platform, token_type, encrypted_token, iv, auth_tag, key_version, expires_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (user_id, platform, token_type)
         DO UPDATE SET
           encrypted_token = EXCLUDED.encrypted_token,
           iv = EXCLUDED.iv,
           auth_tag = EXCLUDED.auth_tag,
           key_version = EXCLUDED.key_version,
           expires_at = EXCLUDED.expires_at,
           updated_at = NOW()`,
        [
          userId,
          platform,
          TOKEN_TYPE_SESSION_JSON,
          encryptedSession.encryptedToken,
          encryptedSession.iv,
          encryptedSession.authTag,
          encryptedSession.keyVersion,
          safeExpiresAt,
        ]
      );

      await client.query(
        `INSERT INTO platform_tokens (
           user_id, platform, token_type, encrypted_token, iv, auth_tag, key_version, expires_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (user_id, platform, token_type)
         DO UPDATE SET
           encrypted_token = EXCLUDED.encrypted_token,
           iv = EXCLUDED.iv,
           auth_tag = EXCLUDED.auth_tag,
           key_version = EXCLUDED.key_version,
           expires_at = EXCLUDED.expires_at,
           updated_at = NOW()`,
        [
          userId,
          platform,
          TOKEN_TYPE_COOKIE,
          encryptedCookie.encryptedToken,
          encryptedCookie.iv,
          encryptedCookie.authTag,
          encryptedCookie.keyVersion,
          safeExpiresAt,
        ]
      );

      await writeAuditDb(client, {
        userId,
        platform,
        eventType: 'token_upsert',
        metadata: {
          tokenType: TOKEN_TYPE_SESSION_JSON,
          keyVersion: encryptedSession.keyVersion,
          hasExpiry: Boolean(safeExpiresAt),
          hasCookieHeader: true,
        },
      });

      return {
        platform,
        status: 'connected',
        expiresAt: safeExpiresAt,
        tokenType: TOKEN_TYPE_SESSION_JSON,
      };
    });
  }

  if (mode === 'dev-file') {
    return withDevStore(async (store) => {
      const user = ensureDevUserRecord(store, userId);
      const current = user.connections[platform] ?? null;
      const timestamp = nowIso();

      user.connections[platform] = {
        status: 'connected',
        status_reason: null,
        connected_at: current?.connected_at ?? timestamp,
        disconnected_at: null,
        last_validated_at: timestamp,
        updated_at: timestamp,
      };

      if (!user.tokens[platform] || typeof user.tokens[platform] !== 'object') {
        user.tokens[platform] = {};
      }

      user.tokens[platform][TOKEN_TYPE_SESSION_JSON] = {
        encrypted_token: encryptedSession.encryptedToken,
        iv: encryptedSession.iv,
        auth_tag: encryptedSession.authTag,
        key_version: encryptedSession.keyVersion,
        expires_at: safeExpiresAt,
        updated_at: timestamp,
      };

      user.tokens[platform][TOKEN_TYPE_COOKIE] = {
        encrypted_token: encryptedCookie.encryptedToken,
        iv: encryptedCookie.iv,
        auth_tag: encryptedCookie.authTag,
        key_version: encryptedCookie.keyVersion,
        expires_at: safeExpiresAt,
        updated_at: timestamp,
      };

      pushDevAudit(user, {
        platform,
        eventType: 'token_upsert',
        metadata: {
          tokenType: TOKEN_TYPE_SESSION_JSON,
          keyVersion: encryptedSession.keyVersion,
          hasExpiry: Boolean(safeExpiresAt),
          hasCookieHeader: true,
          mode: 'dev-file',
        },
      });

      return {
        platform,
        status: 'connected',
        expiresAt: safeExpiresAt,
        tokenType: TOKEN_TYPE_SESSION_JSON,
      };
    });
  }

  throw vaultUnavailableError();
}

export async function getPlatformSession(userId, platform) {
  assertSupportedPlatform(platform);
  const mode = getTokenVaultMode();

  if (mode === 'postgres') {
    const { rows } = await query(
      `SELECT encrypted_token, iv, auth_tag, key_version, expires_at
       FROM platform_tokens
       WHERE user_id = $1 AND platform = $2 AND token_type = $3
       LIMIT 1`,
      [userId, platform, TOKEN_TYPE_SESSION_JSON]
    );

    if (rows[0]) {
      const row = rows[0];
      const decrypted = decryptSecret({
        encryptedToken: row.encrypted_token,
        iv: row.iv,
        authTag: row.auth_tag,
      });

      const parsed = JSON.parse(decrypted);
      const normalized = normalisePlatformSession(parsed, platform);

      return {
        ...normalized,
        expiresAt: row.expires_at ?? null,
        keyVersion: row.key_version ?? 1,
      };
    }

    const { rows: cookieRows } = await query(
      `SELECT encrypted_token, iv, auth_tag, key_version, expires_at
       FROM platform_tokens
       WHERE user_id = $1 AND platform = $2 AND token_type = $3
       LIMIT 1`,
      [userId, platform, TOKEN_TYPE_COOKIE]
    );

    if (!cookieRows[0]) {
      return null;
    }

    const row = cookieRows[0];
    const cookieHeader = decryptSecret({
      encryptedToken: row.encrypted_token,
      iv: row.iv,
      authTag: row.auth_tag,
    });

    const normalized = normalisePlatformSession(
      {
        cookies: parseCookieHeader(cookieHeader),
        headers: cookieHeader ? { Cookie: cookieHeader } : {},
        extra: {},
      },
      platform
    );

    return {
      ...normalized,
      expiresAt: row.expires_at ?? null,
      keyVersion: row.key_version ?? 1,
    };
  }

  if (mode === 'dev-file') {
    const store = await loadDevStore();
    const sessionToken = store.users[userId]?.tokens?.[platform]?.[TOKEN_TYPE_SESSION_JSON] ?? null;

    if (sessionToken) {
      const decrypted = decryptSecret({
        encryptedToken: sessionToken.encrypted_token,
        iv: sessionToken.iv,
        authTag: sessionToken.auth_tag,
      });

      const parsed = JSON.parse(decrypted);
      const normalized = normalisePlatformSession(parsed, platform);

      return {
        ...normalized,
        expiresAt: sessionToken.expires_at ?? null,
        keyVersion: sessionToken.key_version ?? 1,
      };
    }

    const cookieToken = store.users[userId]?.tokens?.[platform]?.[TOKEN_TYPE_COOKIE] ?? null;
    if (!cookieToken) {
      return null;
    }

    const cookieHeader = decryptSecret({
      encryptedToken: cookieToken.encrypted_token,
      iv: cookieToken.iv,
      authTag: cookieToken.auth_tag,
    });

    const normalized = normalisePlatformSession(
      {
        cookies: parseCookieHeader(cookieHeader),
        headers: cookieHeader ? { Cookie: cookieHeader } : {},
        extra: {},
      },
      platform
    );

    return {
      ...normalized,
      expiresAt: cookieToken.expires_at ?? null,
      keyVersion: cookieToken.key_version ?? 1,
    };
  }

  throw vaultUnavailableError();
}

export async function getPlatformCookieSession(userId, platform) {
  assertSupportedPlatform(platform);
  const mode = getTokenVaultMode();

  if (mode === 'postgres') {
    const { rows } = await query(
      `SELECT encrypted_token, iv, auth_tag, key_version, expires_at
       FROM platform_tokens
       WHERE user_id = $1 AND platform = $2 AND token_type = $3
       LIMIT 1`,
      [userId, platform, TOKEN_TYPE_COOKIE]
    );

    if (!rows[0]) {
      const session = await getPlatformSession(userId, platform);
      if (!session) return null;

      const cookieHeader = getCookieHeaderFromSession(session, platform);
      if (!cookieHeader) return null;

      return {
        cookieHeader,
        expiresAt: session.expiresAt ?? null,
        keyVersion: session.keyVersion ?? 1,
      };
    }

    const row = rows[0];
    const cookieHeader = decryptSecret({
      encryptedToken: row.encrypted_token,
      iv: row.iv,
      authTag: row.auth_tag,
    });

    return {
      cookieHeader,
      expiresAt: row.expires_at,
      keyVersion: row.key_version,
    };
  }

  if (mode === 'dev-file') {
    const store = await loadDevStore();
    const token = store.users[userId]?.tokens?.[platform]?.[TOKEN_TYPE_COOKIE] ?? null;
    if (!token) {
      const session = await getPlatformSession(userId, platform);
      if (!session) return null;

      const cookieHeader = getCookieHeaderFromSession(session, platform);
      if (!cookieHeader) return null;

      return {
        cookieHeader,
        expiresAt: session.expiresAt ?? null,
        keyVersion: session.keyVersion ?? 1,
      };
    }

    const cookieHeader = decryptSecret({
      encryptedToken: token.encrypted_token,
      iv: token.iv,
      authTag: token.auth_tag,
    });

    return {
      cookieHeader,
      expiresAt: token.expires_at ?? null,
      keyVersion: token.key_version ?? 1,
    };
  }

  throw vaultUnavailableError();
}

export async function markPlatformReconnectRequired(userId, platform, reason = 'session_invalid') {
  assertSupportedPlatform(platform);
  const mode = getTokenVaultMode();

  if (mode === 'postgres') {
    return withTransaction(async (client) => {
      await ensureUserDb(client, userId);

      await client.query(
        `INSERT INTO platform_connections (
           user_id, platform, status, status_reason, connected_at, disconnected_at, updated_at
         ) VALUES ($1, $2, 'reconnect_required', $3, NULL, NOW(), NOW())
         ON CONFLICT (user_id, platform)
         DO UPDATE SET
           status = 'reconnect_required',
           status_reason = EXCLUDED.status_reason,
           disconnected_at = NOW(),
           updated_at = NOW()`,
        [userId, platform, reason]
      );

      await writeAuditDb(client, {
        userId,
        platform,
        eventType: 'reconnect_required',
        metadata: { reason },
      });
    });
  }

  if (mode === 'dev-file') {
    return withDevStore(async (store) => {
      const user = ensureDevUserRecord(store, userId);
      const current = user.connections[platform] ?? null;
      const timestamp = nowIso();

      user.connections[platform] = {
        status: 'reconnect_required',
        status_reason: reason,
        connected_at: current?.connected_at ?? null,
        disconnected_at: timestamp,
        last_validated_at: current?.last_validated_at ?? null,
        updated_at: timestamp,
      };

      pushDevAudit(user, {
        platform,
        eventType: 'reconnect_required',
        metadata: { reason, mode: 'dev-file' },
      });
    });
  }

  throw vaultUnavailableError();
}

export async function disconnectPlatform(userId, platform, disconnectReason = 'user_disconnect') {
  assertSupportedPlatform(platform);
  const mode = getTokenVaultMode();

  if (mode === 'postgres') {
    return withTransaction(async (client) => {
      await ensureUserDb(client, userId);

      await client.query(
        `DELETE FROM platform_tokens
         WHERE user_id = $1 AND platform = $2`,
        [userId, platform]
      );

      await client.query(
        `INSERT INTO platform_connections (
           user_id, platform, status, status_reason, connected_at, disconnected_at, updated_at
         ) VALUES ($1, $2, 'disconnected', $3, NULL, NOW(), NOW())
         ON CONFLICT (user_id, platform)
         DO UPDATE SET
           status = 'disconnected',
           status_reason = EXCLUDED.status_reason,
           disconnected_at = NOW(),
           updated_at = NOW()`,
        [userId, platform, disconnectReason]
      );

      await writeAuditDb(client, {
        userId,
        platform,
        eventType: 'disconnect',
        metadata: { actor: 'user', reason: disconnectReason },
      });
    });
  }

  if (mode === 'dev-file') {
    await withDevStore(async (store) => {
      const user = ensureDevUserRecord(store, userId);
      const current = user.connections[platform] ?? null;
      const timestamp = nowIso();

      if (user.tokens[platform]) {
        delete user.tokens[platform][TOKEN_TYPE_COOKIE];
        delete user.tokens[platform][TOKEN_TYPE_SESSION_JSON];
      }

      user.connections[platform] = {
        status: 'disconnected',
        status_reason: disconnectReason,
        connected_at: current?.connected_at ?? null,
        disconnected_at: timestamp,
        last_validated_at: current?.last_validated_at ?? null,
        updated_at: timestamp,
      };

      pushDevAudit(user, {
        platform,
        eventType: 'disconnect',
        metadata: { actor: 'user', reason: disconnectReason, mode: 'dev-file' },
      });
    });
    return;
  }

  throw vaultUnavailableError();
}

// Blinkit wrappers
export async function getBlinkitConnectionStatus(userId) {
  return getPlatformConnectionStatus(userId, PLATFORM_BLINKIT);
}

export async function storeBlinkitCookieSession({ userId, cookieHeader, expiresAt = null }) {
  return storePlatformCookieSession({ userId, platform: PLATFORM_BLINKIT, cookieHeader, expiresAt });
}

export async function getBlinkitCookieSession(userId) {
  return getPlatformCookieSession(userId, PLATFORM_BLINKIT);
}

export async function markBlinkitReconnectRequired(userId, reason = 'session_invalid') {
  return markPlatformReconnectRequired(userId, PLATFORM_BLINKIT, reason);
}

export async function disconnectBlinkit(userId) {
  return disconnectPlatform(userId, PLATFORM_BLINKIT, 'user_disconnect');
}

// Zepto wrappers
export async function getZeptoConnectionStatus(userId) {
  return getPlatformConnectionStatus(userId, PLATFORM_ZEPTO);
}

export async function storeZeptoCookieSession({ userId, cookieHeader, expiresAt = null }) {
  return storePlatformCookieSession({ userId, platform: PLATFORM_ZEPTO, cookieHeader, expiresAt });
}

export async function getZeptoCookieSession(userId) {
  return getPlatformCookieSession(userId, PLATFORM_ZEPTO);
}

export async function markZeptoReconnectRequired(userId, reason = 'session_invalid') {
  return markPlatformReconnectRequired(userId, PLATFORM_ZEPTO, reason);
}

export async function disconnectZepto(userId) {
  return disconnectPlatform(userId, PLATFORM_ZEPTO, 'user_disconnect');
}

// Instamart wrappers
export async function getInstamartConnectionStatus(userId) {
  return getPlatformConnectionStatus(userId, PLATFORM_INSTAMART);
}

export async function storeInstamartCookieSession({ userId, cookieHeader, expiresAt = null }) {
  return storePlatformCookieSession({ userId, platform: PLATFORM_INSTAMART, cookieHeader, expiresAt });
}

export async function getInstamartCookieSession(userId) {
  return getPlatformCookieSession(userId, PLATFORM_INSTAMART);
}

export async function markInstamartReconnectRequired(userId, reason = 'session_invalid') {
  return markPlatformReconnectRequired(userId, PLATFORM_INSTAMART, reason);
}

export async function disconnectInstamart(userId) {
  return disconnectPlatform(userId, PLATFORM_INSTAMART, 'user_disconnect');
}
