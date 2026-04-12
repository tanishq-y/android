function buildBridgeFromAndroidInterface(nativeInterface) {
  if (!nativeInterface) return null;

  if (
    typeof nativeInterface.openPlatformLogin !== 'function'
    || typeof nativeInterface.exportPlatformSession !== 'function'
  ) {
    return null;
  }

  return {
    __nativeReady: true,
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

  return {
    cookieHeader: parsed.cookieHeader,
    expiresAt: parsed.expiresAt ?? null,
  };
}
