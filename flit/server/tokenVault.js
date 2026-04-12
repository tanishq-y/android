import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { isDbConfigured, query, withTransaction } from './db.js';
import { encryptSecret, decryptSecret } from './security/tokenCrypto.js';

const PLATFORM_BLINKIT = 'blinkit';
const PLATFORM_ZEPTO = 'zepto';
const PLATFORM_INSTAMART = 'instamart';
const TOKEN_TYPE_COOKIE = 'cookie_header';
const SUPPORTED_PLATFORMS = new Set([PLATFORM_BLINKIT, PLATFORM_ZEPTO, PLATFORM_INSTAMART]);

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

    if (!rows[0]) return null;

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
    if (!token) return null;

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
    return withDevStore(async (store) => {
      const user = ensureDevUserRecord(store, userId);
      const current = user.connections[platform] ?? null;
      const timestamp = nowIso();

      if (user.tokens[platform]) {
        delete user.tokens[platform][TOKEN_TYPE_COOKIE];
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
