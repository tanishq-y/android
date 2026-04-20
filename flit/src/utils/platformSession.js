function normalizePlatformId(platformId) {
  return String(platformId ?? '').trim().toLowerCase();
}

export function parseCookieHeader(cookieHeader = '') {
  const cookies = {};

  for (const part of String(cookieHeader).split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!key || !value) continue;

    cookies[key] = value;
  }

  return cookies;
}

export function buildCookieHeader(cookies = {}) {
  return Object.entries(cookies)
    .map(([key, value]) => [String(key ?? '').trim(), String(value ?? '').trim()])
    .filter(([key, value]) => key && value)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

function buildCommonHeaders(cookieHeader, cookies) {
  const headers = {};

  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  if (cookies.accessToken) {
    headers.Authorization = `Bearer ${cookies.accessToken}`;
  }

  if (cookies.device_id) {
    headers['x-device-id'] = cookies.device_id;
  }

  if (cookies.session_id) {
    headers['x-session-id'] = cookies.session_id;
  }

  if (cookies.unique_browser_id) {
    headers['x-unique-browser-id'] = cookies.unique_browser_id;
  }

  const xsrfToken = cookies['XSRF-TOKEN'] ?? cookies.xsrfToken;
  if (xsrfToken) {
    headers['x-xsrf-token'] = xsrfToken;
    headers['x-csrf-token'] = xsrfToken;
  }

  return headers;
}

function buildPlatformHeaders(platformId, cookies, cookieHeader) {
  const headers = {
    ...buildCommonHeaders(cookieHeader, cookies),
  };

  if (platformId === 'zepto') {
    headers.platform = headers.platform ?? 'WEB';
    headers['app-version'] = headers['app-version'] ?? '1.0.0';
  }

  if (platformId === 'bigbasket') {
    if (cookies.bb_auth_token) {
      headers['X-Auth-Token'] = cookies.bb_auth_token;
    }
    if (cookies._bb_csrf) {
      headers['x-csrf-token'] = headers['x-csrf-token'] ?? cookies._bb_csrf;
    }
  }

  if (platformId === 'jiomart') {
    if (cookies.customer_token) {
      headers['X-JioMart-Token'] = cookies.customer_token;
    }
  }

  return headers;
}

function buildPlatformExtra(platformId, cookies) {
  const extra = {};

  if (platformId === 'blinkit' && cookies.store_id) {
    extra.store_id = cookies.store_id;
  }

  if (platformId === 'zepto' && cookies.store_id) {
    extra.store_id = cookies.store_id;
  }

  return extra;
}

export function buildPlatformSessionFromCookieHeader(platformId, cookieHeader, extra = {}) {
  const safePlatform = normalizePlatformId(platformId);
  const cookies = parseCookieHeader(cookieHeader);
  const normalizedCookieHeader = buildCookieHeader(cookies);

  return {
    cookies,
    headers: buildPlatformHeaders(safePlatform, cookies, normalizedCookieHeader),
    extra: {
      ...buildPlatformExtra(safePlatform, cookies),
      ...(extra && typeof extra === 'object' ? extra : {}),
    },
  };
}