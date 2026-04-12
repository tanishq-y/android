import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL?.trim();

let pool = null;

if (connectionString) {
  pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  pool.on('error', (err) => {
    console.error('[DB] Unexpected pool error:', err.message);
  });
}

export function isDbConfigured() {
  return Boolean(pool);
}

export async function query(text, params = []) {
  if (!pool) {
    throw new Error('DATABASE_URL not configured');
  }
  return pool.query(text, params);
}

export async function withTransaction(callback) {
  if (!pool) {
    throw new Error('DATABASE_URL not configured');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function pingDb() {
  if (!pool) {
    return {
      configured: false,
      ok: false,
      error: 'DATABASE_URL not configured',
    };
  }

  try {
    await pool.query('SELECT 1');
    return { configured: true, ok: true };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      error: err.message,
    };
  }
}