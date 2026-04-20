import { buildPlatformSessionFromCookieHeader } from './platformSession.js';

function buildBridgeFromAndroidInterface(nativeInterface) {
  if (!nativeInterface) return null;

  if (
    typeof nativeInterface.openPlatformLogin !== 'function'
    || typeof nativeInterface.exportPlatformSession !== 'function'
  ) {
    return null;
  }

  const supportsDeviceSearch =
    typeof nativeInterface.startDeviceSearch === 'function'
    && typeof nativeInterface.getDeviceSearchStatus === 'function'
    && typeof nativeInterface.cancelDeviceSearch === 'function';

  return {
    __nativeReady: true,
    __deviceSearchReady: supportsDeviceSearch,
    openPlatformLogin(platformId, loginUrl) {
      const raw = nativeInterface.openPlatformLogin(String(platformId || ''), String(loginUrl || ''));

      if (typeof raw === 'string') {
        try {
          return JSON.parse(raw);
        } catch {
          return { ok: false, error: 'invalid_native_response', raw };
        }
      }

      return raw;
    },
    exportPlatformSession(platformId) {
      return nativeInterface.exportPlatformSession(String(platformId || ''));
    },
    startDeviceSearch(payload) {
      if (!supportsDeviceSearch) {
        return { ok: false, error: 'native_method_unavailable' };
      }

      const raw = nativeInterface.startDeviceSearch(JSON.stringify(payload ?? {}));
      if (typeof raw === 'string') {
        try {
          return JSON.parse(raw);
        } catch {
          return { ok: false, error: 'invalid_native_response', raw };
        }
      }

      return raw;
    },
    getDeviceSearchStatus(jobId) {
      if (!supportsDeviceSearch) {
        return { ok: false, error: 'native_method_unavailable' };
      }

      const raw = nativeInterface.getDeviceSearchStatus(String(jobId || ''));
      if (typeof raw === 'string') {
        try {
          return JSON.parse(raw);
        } catch {
          return { ok: false, error: 'invalid_native_response', raw };
        }
      }

      return raw;
    },
    cancelDeviceSearch(jobId) {
      if (!supportsDeviceSearch) {
        return { ok: false, error: 'native_method_unavailable' };
      }

      const raw = nativeInterface.cancelDeviceSearch(String(jobId || ''));
      if (typeof raw === 'string') {
        try {
          return JSON.parse(raw);
        } catch {
          return { ok: false, error: 'invalid_native_response', raw };
        }
      }

      return raw;
    },
  };
}

function getNativeBridge() {
  if (typeof window === 'undefined') return null;

  const appBridge = window.FlitNativeApp;
  if (
    appBridge
    && typeof appBridge.openPlatformLogin === 'function'
    && typeof appBridge.exportPlatformSession === 'function'
  ) {
    return appBridge;
  }

  return buildBridgeFromAndroidInterface(window.FlitNativeAndroid);
}

function unwrapBridgePayload(payload) {
  if (payload == null) return null;

  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload);
    } catch {
      return { cookieHeader: payload };
    }
  }

  if (typeof payload === 'object') {
    return payload;
  }

  return null;
}

export function isNativeAppBridgeAvailable() {
  const bridge = getNativeBridge();
  return Boolean(
    bridge &&
    typeof bridge.openPlatformLogin === 'function' &&
    typeof bridge.exportPlatformSession === 'function'
  );
}

export function isNativeDeviceSearchAvailable() {
  const bridge = getNativeBridge();
  return Boolean(
    bridge &&
    typeof bridge.startDeviceSearch === 'function' &&
    typeof bridge.getDeviceSearchStatus === 'function' &&
    typeof bridge.cancelDeviceSearch === 'function'
  );
}

export async function openPlatformLoginInApp(platformId, loginUrl) {
  const bridge = getNativeBridge();

  if (!bridge || typeof bridge.openPlatformLogin !== 'function') {
    window.open(loginUrl, '_blank', 'noopener,noreferrer');
    return { mode: 'browser' };
  }

  const result = await Promise.resolve(bridge.openPlatformLogin(platformId, loginUrl));
  return { mode: 'native', result };
}

export async function exportPlatformSessionFromApp(platformId) {
  const bridge = getNativeBridge();

  if (!bridge || typeof bridge.exportPlatformSession !== 'function') {
    throw new Error('Native app bridge is not available in this runtime.');
  }

  const raw = await Promise.resolve(bridge.exportPlatformSession(platformId));
  const parsed = unwrapBridgePayload(raw);

  if (parsed?.error) {
    if (parsed.error === 'no_session_cookie') {
      throw new Error('No platform session cookie found yet. Complete login in the app WebView, then retry capture.');
    }
    throw new Error(`Native session export failed: ${parsed.error}`);
  }

  if (!parsed || typeof parsed.cookieHeader !== 'string' || !parsed.cookieHeader.includes('=')) {
    throw new Error('Native app returned an invalid cookie session payload.');
  }

  const cookieHeader = parsed.cookieHeader.trim();
  const session = parsed?.session && typeof parsed.session === 'object'
    ? parsed.session
    : buildPlatformSessionFromCookieHeader(platformId, cookieHeader, parsed?.extra ?? {});

  return {
    cookieHeader,
    expiresAt: parsed.expiresAt ?? null,
    session,
  };
}

export async function startDeviceSearchInApp({ query, lat = null, lon = null, platforms = [] }) {
  const bridge = getNativeBridge();
  if (!bridge || typeof bridge.startDeviceSearch !== 'function') {
    throw new Error('Native device search bridge is not available in this runtime.');
  }

  const raw = await Promise.resolve(bridge.startDeviceSearch({
    query,
    lat,
    lon,
    platforms: Array.isArray(platforms) ? platforms : [],
  }));
  const parsed = unwrapBridgePayload(raw);

  if (parsed?.error || parsed?.ok === false) {
    throw new Error(parsed?.error ?? 'Native device search start failed.');
  }

  if (!parsed?.jobId) {
    throw new Error('Native device search did not return a job id.');
  }

  return parsed;
}

export async function getDeviceSearchStatusInApp(jobId) {
  const bridge = getNativeBridge();
  if (!bridge || typeof bridge.getDeviceSearchStatus !== 'function') {
    throw new Error('Native device search bridge is not available in this runtime.');
  }

  const raw = await Promise.resolve(bridge.getDeviceSearchStatus(jobId));
  const parsed = unwrapBridgePayload(raw);

  if (parsed?.error || parsed?.ok === false) {
    throw new Error(parsed?.error ?? 'Native device search status failed.');
  }

  return parsed;
}

export async function cancelDeviceSearchInApp(jobId) {
  const bridge = getNativeBridge();
  if (!bridge || typeof bridge.cancelDeviceSearch !== 'function') {
    throw new Error('Native device search bridge is not available in this runtime.');
  }

  const raw = await Promise.resolve(bridge.cancelDeviceSearch(jobId));
  const parsed = unwrapBridgePayload(raw);

  if (parsed?.error || parsed?.ok === false) {
    throw new Error(parsed?.error ?? 'Native device search cancel failed.');
  }

  return parsed;
}
