import { apiUrl } from './apiUrl.js';

const STORAGE_KEY = 'flit_device_auth_session';

function decodeJwtPayload(token) {
  const raw = String(token ?? '').trim();
  if (!raw) return null;

  const parts = raw.split('.');
  if (parts.length < 2) return null;

  try {
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4 || 4)) % 4);
    const json = atob(padded);
    const payload = JSON.parse(json);
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

function readStoredSession() {
  if (typeof window === 'undefined') return null;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    const userId = String(parsed.userId ?? '').trim();
    const token = String(parsed.token ?? '').trim();
    const email = String(parsed.email ?? '').trim().toLowerCase();

    if (!userId || !token || !email) return null;

    const authUserId = String(parsed.authUserId ?? '').trim()
      || String(decodeJwtPayload(token)?.sub ?? '').trim()
      || null;

    return { userId, token, email, authUserId };
  } catch {
    return null;
  }
}

export function getStoredDeviceAuthSession(userId = null) {
  const session = readStoredSession();
  if (!session) return null;

  const safeUserId = String(userId ?? '').trim();
  if (!safeUserId) return session;

  return session.userId === safeUserId ? session : null;
}

function saveStoredSession(session) {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage failures in restricted runtimes.
  }
}

export function clearDeviceAuthToken() {
  if (typeof window === 'undefined') return;

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures in restricted runtimes.
  }
}

function buildDeviceCredentials(userId) {
  const compact = String(userId ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 40) || 'anonymous';

  return {
    email: `device.${compact}@flit.local`,
    password: `Flit_${compact}_Pass!2026`,
  };
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function getOrCreateTokenFromCredentials(credentials) {
  const registerResult = await postJson(apiUrl('/api/auth/register'), credentials);
  if (registerResult.response.ok && registerResult.payload?.token) {
    return registerResult.payload.token;
  }

  if (registerResult.response.status !== 409) {
    throw new Error(registerResult.payload?.error ?? `HTTP ${registerResult.response.status}`);
  }

  const loginResult = await postJson(apiUrl('/api/auth/login'), credentials);
  if (!loginResult.response.ok || !loginResult.payload?.token) {
    throw new Error(loginResult.payload?.error ?? `HTTP ${loginResult.response.status}`);
  }

  return loginResult.payload.token;
}

async function refreshToken(token) {
  const refreshResult = await postJson(
    apiUrl('/api/auth/refresh'),
    null,
    { Authorization: `Bearer ${token}` }
  );

  if (!refreshResult.response.ok) {
    return null;
  }

  const refreshedToken = String(refreshResult.payload?.token ?? '').trim();
  return refreshedToken || null;
}

export async function ensureDeviceAuthToken(userId) {
  const safeUserId = String(userId ?? '').trim();
  if (!safeUserId) {
    throw new Error('missing_user_id');
  }

  const stored = readStoredSession();
  if (stored?.userId === safeUserId && stored.token) {
    const refreshedToken = await refreshToken(stored.token);
    if (refreshedToken) {
      const next = {
        ...stored,
        token: refreshedToken,
        authUserId: String(decodeJwtPayload(refreshedToken)?.sub ?? '').trim() || stored.authUserId || null,
      };
      saveStoredSession(next);
      return refreshedToken;
    }
  }

  const credentials = buildDeviceCredentials(safeUserId);
  const token = await getOrCreateTokenFromCredentials(credentials);
  const authUserId = String(decodeJwtPayload(token)?.sub ?? '').trim() || null;
  saveStoredSession({
    userId: safeUserId,
    email: credentials.email,
    token,
    authUserId,
  });

  return token;
}