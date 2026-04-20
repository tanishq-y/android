import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

import { isDbConfigured, query } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEV_AUTH_STORE_PATH = path.resolve(__dirname, './data/dev-auth-users.json');

let dbSchemaEnsured = false;
let devStoreLoaded = false;
let devStore = null;

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.trim().toLowerCase();
}

function isDevAuthStoreEnabled() {
  return process.env.NODE_ENV !== 'production';
}

function createEmptyStore() {
  return {
    version: 1,
    usersById: {},
    usersByEmail: {},
  };
}

function ensureStoreShape(store) {
  const shaped = store && typeof store === 'object' ? store : createEmptyStore();
  if (!shaped.usersById || typeof shaped.usersById !== 'object') {
    shaped.usersById = {};
  }
  if (!shaped.usersByEmail || typeof shaped.usersByEmail !== 'object') {
    shaped.usersByEmail = {};
  }
  return shaped;
}

async function loadDevStore() {
  if (devStoreLoaded) return devStore;

  try {
    const content = await fs.readFile(DEV_AUTH_STORE_PATH, 'utf8');
    devStore = ensureStoreShape(JSON.parse(content));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }

    devStore = createEmptyStore();
  }

  devStoreLoaded = true;
  return devStore;
}

async function persistDevStore() {
  if (!devStoreLoaded || !devStore) return;

  await fs.mkdir(path.dirname(DEV_AUTH_STORE_PATH), { recursive: true });
  await fs.writeFile(DEV_AUTH_STORE_PATH, `${JSON.stringify(devStore, null, 2)}\n`, 'utf8');
}

async function ensureDbSchema() {
  if (!isDbConfigured() || dbSchemaEnsured) {
    return;
  }

  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
    ON users ((LOWER(email)))
    WHERE email IS NOT NULL
  `);

  dbSchemaEnsured = true;
}

export async function createAuthUser({ email, passwordHash }) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    throw new Error('email_required');
  }

  if (!passwordHash || typeof passwordHash !== 'string') {
    throw new Error('password_hash_required');
  }

  if (isDbConfigured()) {
    await ensureDbSchema();

    const userId = randomUUID();

    try {
      const { rows } = await query(
        `INSERT INTO users (id, email, password_hash, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         RETURNING id, email, created_at`,
        [userId, normalizedEmail, passwordHash]
      );

      return rows[0] ?? { id: userId, email: normalizedEmail };
    } catch (err) {
      if (err?.code === '23505') {
        const conflict = new Error('email_already_exists');
        conflict.code = 'email_already_exists';
        throw conflict;
      }

      throw err;
    }
  }

  if (!isDevAuthStoreEnabled()) {
    throw new Error('auth_store_unavailable');
  }

  const store = await loadDevStore();
  if (store.usersByEmail[normalizedEmail]) {
    const conflict = new Error('email_already_exists');
    conflict.code = 'email_already_exists';
    throw conflict;
  }

  const id = randomUUID();
  const createdAt = nowIso();
  const user = {
    id,
    email: normalizedEmail,
    password_hash: passwordHash,
    created_at: createdAt,
    updated_at: createdAt,
  };

  store.usersById[id] = user;
  store.usersByEmail[normalizedEmail] = id;

  await persistDevStore();

  return {
    id,
    email: normalizedEmail,
    created_at: createdAt,
  };
}

export async function getAuthUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  if (isDbConfigured()) {
    await ensureDbSchema();

    const { rows } = await query(
      `SELECT id, email, password_hash, created_at, updated_at
       FROM users
       WHERE LOWER(email) = LOWER($1)
       LIMIT 1`,
      [normalizedEmail]
    );

    return rows[0] ?? null;
  }

  if (!isDevAuthStoreEnabled()) {
    return null;
  }

  const store = await loadDevStore();
  const userId = store.usersByEmail[normalizedEmail];
  if (!userId) return null;

  return store.usersById[userId] ?? null;
}

export async function getAuthUserById(userId) {
  const safeUserId = String(userId ?? '').trim();
  if (!safeUserId) return null;

  if (isDbConfigured()) {
    await ensureDbSchema();

    const { rows } = await query(
      `SELECT id, email, password_hash, created_at, updated_at
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [safeUserId]
    );

    return rows[0] ?? null;
  }

  if (!isDevAuthStoreEnabled()) {
    return null;
  }

  const store = await loadDevStore();
  return store.usersById[safeUserId] ?? null;
}
