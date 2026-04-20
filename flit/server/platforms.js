// Server-side platform search modules
// These make direct HTTP requests from the Node.js server,
// using app-first authenticated sessions from the token vault.

import crypto from 'node:crypto';

// ─── BLINKIT ───────────────────────────────────────────────────────────────────

export async function searchBlinkit(query, lat = 28.4595, lon = 77.0266, sessionInput = null) {
  const session = resolveSessionContext(sessionInput);
  const cookieMap = session.cookies;
  const url = new URL('https://blinkit.com/v1/layout/search');
  url.searchParams.set('q', query);
  url.searchParams.set('search_type', 'type_to_search');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'lat': String(lat),
      'lon': String(lon),
      'app_client': 'consumer_web',
      'web_app_version': '2.0.0',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    };

    if (session.cookieHeader) {
      headers.Cookie = session.cookieHeader;
    }

    copySessionHeaders(headers, session.headers, {
      allowedPrefixes: ['x-', 'sec-ch-'],
      allowedNames: ['authorization', 'user-agent', 'accept', 'accept-language', 'origin', 'referer'],
    });

    applySessionHeader(headers, session.headers, 'Authorization', ['authorization']);
    applySessionHeader(headers, session.headers, 'x-device-id', ['x-device-id']);
    applySessionHeader(headers, session.headers, 'x-session-id', ['x-session-id']);
    applySessionHeader(headers, session.headers, 'x-unique-browser-id', ['x-unique-browser-id']);
    applySessionHeader(headers, session.headers, 'x-xsrf-token', ['x-xsrf-token']);
    applySessionHeader(headers, session.headers, 'x-csrf-token', ['x-csrf-token']);

    const accessToken =
      getSessionHeaderValue(session.headers, ['authorization'])
      || cookieMap.gr_1_accessToken
      || cookieMap.accessToken;
    if (accessToken && !headers.Authorization) {
      headers.Authorization = accessToken.toLowerCase().startsWith('bearer ')
        ? accessToken
        : `Bearer ${accessToken}`;
    }

    if (!headers['x-device-id']) {
      headers['x-device-id'] =
        cookieMap.gr_1_deviceId
        || cookieMap.device_id
        || cookieMap._device_id
        || headers['x-device-id'];
    }

    if (!headers['x-session-id']) {
      headers['x-session-id'] =
        cookieMap.gr_1_session_id
        || cookieMap.gr_1_sessionId
        || cookieMap.session_id
        || headers['x-session-id'];
    }

    if (!headers['x-unique-browser-id']) {
      headers['x-unique-browser-id'] =
        cookieMap.gr_1_unique_browser_id
        || cookieMap.gr_1_uniqueBrowserId
        || cookieMap.unique_browser_id
        || headers['x-unique-browser-id'];
    }

    Object.keys(headers).forEach((key) => {
      if (!headers[key]) {
        delete headers[key];
      }
    });

    const res = await fetch(url.toString(), {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: JSON.stringify({}),
    });
    clearTimeout(timer);

    if (!res.ok) {
      let error = `HTTP ${res.status}`;

      if (session.hasSessionContext && res.status === 401) {
        error = 'session_invalid';
      } else if (session.hasSessionContext && res.status === 403) {
        const bodyText = await res.text().catch(() => '');
        error = isLikelyWafChallengeResponse(res, bodyText)
          ? 'waf_challenge'
          : 'session_invalid';
      }

      return { platform: 'blinkit', products: [], error };
    }

    const data = await res.json();
    const snippets = data?.response?.snippets ?? [];
    const products = snippets
      .filter(s => s.data && (s.data.name || s.data.product_id))
      .map(s => normaliseBlinkitProduct(s.data))
      .filter(p => p.price > 0 && p.name);

    // Fallback: old format
    if (products.length === 0) {
      const oldProducts = data?.objects?.[0]?.data?.objects ?? [];
      const normalised = oldProducts.map(p => normaliseBlinkitProduct(p)).filter(p => p.price > 0 && p.name);
      return { platform: 'blinkit', products: normalised, error: null };
    }

    return { platform: 'blinkit', products, error: null };
  } catch (err) {
    clearTimeout(timer);
    return { platform: 'blinkit', products: [], error: err.name === 'AbortError' ? 'timeout' : err.message };
  }
}

function normaliseBlinkitProduct(raw) {
  const sp = parsePrice(raw.normal_price?.text ?? raw.price?.text ?? raw.sp ?? 0);
  const mrp = parsePrice(raw.mrp?.text ?? raw.normal_price?.text ?? raw.mrp ?? sp);
  const qty = raw.variant?.text ?? raw.unit ?? raw.weight_unit ?? '';
  const pid = raw.product_id ?? raw.id ?? String(Math.random());
  return {
    id: `blinkit:${pid}`,
    platform: 'blinkit',
    name: raw.name?.text ?? raw.name ?? '',
    brand: raw.brand?.text ?? raw.brand ?? '',
    image: raw.image?.url ?? raw.images?.[0]?.url ?? raw.image_url ?? null,
    price: sp,
    mrp,
    discount: mrp > sp ? Math.round(((mrp - sp) / mrp) * 100) : null,
    quantity: qty,
    unitPrice: computeUnitPrice(sp, qty),
    deliveryFee: 0,
    deliveryEta: raw.eta_tag?.title?.text ?? '10 mins',
    inStock: raw.in_stock !== false && raw.is_in_stock !== false,
    deepLink: `https://blinkit.com/prn/${pid}`,
    platformColor: '#0C831F',
  };
}

// ─── ZEPTO ─────────────────────────────────────────────────────────────────────

const ZEPTO_SIGNED_BASE_URL = 'https://bff-gateway.zeptonow.com/';
const ZEPTO_REFRESH_AUTH_URL = 'https://www.zepto.com/api/auth/refresh-auth';
const ZEPTO_PROFILE_URLS = [
  'https://api.zeptonow.com/api/v2/user/profile/',
  'https://www.zeptonow.com/api/v2/user/profile/',
];
const ZEPTO_STORE_SELECT_URLS = [
  'https://api.zeptonow.com/api/v2/store/select/',
  'https://www.zeptonow.com/api/v2/store/select/',
];
const ZEPTO_ENABLE_PROFILE_PRECHECK = String(process.env.ZEPTO_ENABLE_PROFILE_PRECHECK ?? 'true').toLowerCase() !== 'false';
const ZEPTO_ENABLE_STORE_RESOLUTION = String(process.env.ZEPTO_ENABLE_STORE_RESOLUTION ?? 'true').toLowerCase() !== 'false';
const ZEPTO_ENABLE_ENRICHED_SEARCH_PAYLOAD = String(process.env.ZEPTO_ENABLE_ENRICHED_SEARCH_PAYLOAD ?? 'true').toLowerCase() !== 'false';
const ZEPTO_COMPATIBLE_COMPONENTS = [
  'EXTERNAL_COUPONS',
  'BUNDLE',
  'MULTI_SELLER_ENABLED',
  'ROLLUPS',
  'SCHEDULED_DELIVERY',
  'HOMEPAGE_V2',
  'NEW_ETA_BANNER',
  'VERTICAL_FEED_PRODUCT_GRID',
  'AUTOSUGGESTION_PAGE_ENABLED',
  'AUTOSUGGESTION_PIP',
  'AUTOSUGGESTION_AD_PIP',
  'BOTTOM_NAV_FULL_ICON',
  'COUPON_WIDGET_CART_REVAMP',
  'DELIVERY_UPSELLING_WIDGET',
  'MARKETPLACE_CATEGORY_GRID',
  'NO_PLATFORM_CHECK_ENABLED_V2',
  'SUPER_SAVER_V1',
  'SUPERSTORE_V1',
  'PROMO_CASH',
  'COMPATIBLE_COMPONENT_24X7',
  'TABBED_CAROUSEL_V2',
  'HP_V4_FEED',
  'WIDGET_BASED_ETA',
  'PC_REVAMP_1',
  'NO_COST_EMI_V1',
  'PRE_SEARCH',
  'ITEMISATION_ENABLED',
  'ZEPTO_PASS:5',
  'BACHAT_FOR_ALL',
  'SAMPLING_UPSELL_CAMPAIGN',
  'DISCOUNTED_ADDONS_ENABLED',
  'UPSELL_COUPON_SS_ZERO',
  'ENABLE_FLOATING_CART_BUTTON',
  'FASHION_REVAMP',
  'WIDGET_RESTRUCTURE',
  'MULTITAB_V2',
].join(',');

export async function searchZepto(query, lat = 28.4595, lon = 77.0266, sessionInput = null) {
  const baseSession = resolveSessionContext(sessionInput);
  const workingCookies = { ...(baseSession.cookies ?? {}) };
  let session = buildRefreshedZeptoSession(baseSession, workingCookies);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    if (session.hasSessionContext && ZEPTO_ENABLE_PROFILE_PRECHECK) {
      const profileCheck = await validateZeptoSessionProfile(session, workingCookies, controller.signal);
      if (profileCheck.error === 'session_invalid') {
        console.warn('[Zepto] profile precheck reported session_invalid; continuing with live search path');
      }
      session = buildRefreshedZeptoSession(baseSession, workingCookies);
    }

    if (ZEPTO_ENABLE_STORE_RESOLUTION) {
      const storeRefresh = await refreshZeptoStoreContext({
        session,
        cookies: workingCookies,
        lat,
        lon,
        signal: controller.signal,
      });

      if (storeRefresh?.error === 'session_invalid') {
        console.warn('[Zepto] store resolution reported session_invalid; continuing with live search path');
      }

      session = buildRefreshedZeptoSession(baseSession, workingCookies);
    }

    const apiAttempt = await searchZeptoViaApi(query, session, controller.signal);
    const strictApiProducts = filterZeptoRelevantProducts(apiAttempt.products, query, 2);

    const signedAttempt = await searchZeptoViaSignedCatalog(query, lat, lon, session, controller.signal);
    const strictSignedProducts = filterZeptoRelevantProducts(signedAttempt.matchedProducts, query, 2);

    // Live fallback: parse product cards from Zepto search HTML payload.
    // This keeps real results flowing even when BFF contracts or auth headers change.
    const htmlAttempt = await searchZeptoViaHtml(query, session.cookieHeader, controller.signal);
    clearTimeout(timer);

    const strictHtmlMatchedProducts = filterZeptoRelevantProducts(htmlAttempt.matchedProducts, query, 2);
    const strictFallbackProducts = filterZeptoRelevantProducts(
      dedupeProductsById([
        ...(htmlAttempt.genericProducts ?? []),
        ...(signedAttempt.genericProducts ?? []),
      ]),
      query,
      2
    );

    const authFailure = isAuthLikeZeptoError(apiAttempt.error)
      || isAuthLikeZeptoError(signedAttempt.error)
      || String(apiAttempt.error ?? '').startsWith('session_invalid')
      || String(signedAttempt.error ?? '').startsWith('session_invalid');

    const mergedStrictProducts = filterZeptoRelevantProducts(
      dedupeProductsById([
        ...strictApiProducts,
        ...strictSignedProducts,
        ...strictHtmlMatchedProducts,
        ...strictFallbackProducts,
      ]),
      query,
      2
    );

    if (mergedStrictProducts.length > 0) {
      const degradedFromHtml = authFailure
        && strictApiProducts.length === 0
        && strictSignedProducts.length === 0
        && (strictHtmlMatchedProducts.length > 0 || strictFallbackProducts.length > 0);

      return {
        platform: 'zepto',
        products: mergedStrictProducts,
        error: null,
        status: degradedFromHtml ? 'ok_degraded_html' : 'ok',
      };
    }

    // Degraded mode: when auth-like failures occur, force a broader HTML-only recovery
    // path (cookie-less plus token fallback terms) before returning hard error.
    if (authFailure) {
      const termCandidates = extractSearchTerms(query);
      const retryQueries = [...new Set([
        String(query ?? '').trim(),
        ...(termCandidates.length > 1 ? [termCandidates[0], termCandidates[termCandidates.length - 1]] : []),
      ].filter(Boolean))];

      const recoveredPool = [];
      for (const retryQuery of retryQueries) {
        const recoveryAttempt = await searchZeptoViaHtml(retryQuery, null, controller.signal);
        recoveredPool.push(
          ...(recoveryAttempt.matchedProducts ?? []),
          ...(recoveryAttempt.genericProducts ?? [])
        );
      }

      const strictRecovered = filterZeptoRelevantProducts(
        dedupeProductsById(recoveredPool),
        query,
        1
      );

      if (strictRecovered.length > 0) {
        return {
          platform: 'zepto',
          products: strictRecovered,
          error: null,
          status: 'ok_degraded_html',
        };
      }
    }

    // Strict mode: only return Zepto fallback cards when they are query-relevant.
    return {
      platform: 'zepto',
      products: [],
      error: (apiAttempt.error && String(apiAttempt.error).startsWith('session_invalid'))
        ? `${apiAttempt.error}_api`
        : ((signedAttempt.error && String(signedAttempt.error).startsWith('session_invalid'))
          ? `${signedAttempt.error}_signed`
          : (apiAttempt.error ?? signedAttempt.error ?? 'no_results')),
    };
  } catch (err) {
    clearTimeout(timer);
    return { platform: 'zepto', products: [], error: err.name === 'AbortError' ? 'timeout' : err.message };
  }
}

async function validateZeptoSessionProfile(session, cookies, signal) {
  const headers = buildZeptoCommonHeaders({ session, cookies, requestId: crypto.randomUUID() });

  for (const endpoint of ZEPTO_PROFILE_URLS) {
    try {
      const res = await fetch(endpoint, {
        method: 'GET',
        headers,
        signal,
      });

      const bodyText = await res.text().catch(() => '');
      if (!res.ok) {
        if (res.status === 401 || res.status === 403 || looksLikeInvalidZeptoTokenResponse(bodyText)) {
          return { ok: false, error: 'session_invalid' };
        }

        continue;
      }

      return { ok: true, error: null };
    } catch (err) {
      if (err?.name === 'AbortError') {
        return { ok: false, error: 'timeout' };
      }
    }
  }

  return { ok: false, error: null };
}

async function refreshZeptoStoreContext({ session, cookies, lat, lon, signal }) {
  const latitude = Number.isFinite(Number(lat)) ? Number(lat) : 28.4595;
  const longitude = Number.isFinite(Number(lon)) ? Number(lon) : 77.0266;

  const requestId = crypto.randomUUID();
  const headers = buildZeptoCommonHeaders({
    session,
    cookies,
    requestId,
    extraHeaders: {
      storeid: cookies.store_id || cookies.storeId || '',
      'x-store-id': cookies.store_id || cookies.storeId || '',
      societyid: cookies.society_id || cookies.societyId || '',
      'x-latitude': String(latitude),
      'x-longitude': String(longitude),
    },
  });

  for (const endpoint of ZEPTO_STORE_SELECT_URLS) {
    try {
      const target = new URL(endpoint);
      target.searchParams.set('latitude', String(latitude));
      target.searchParams.set('longitude', String(longitude));

      const res = await fetch(target.toString(), {
        method: 'GET',
        headers,
        signal,
      });

      const bodyText = await res.text().catch(() => '');
      if (!res.ok) {
        if (res.status === 401 || res.status === 403 || looksLikeInvalidZeptoTokenResponse(bodyText)) {
          return { ok: false, error: 'session_invalid' };
        }
        continue;
      }

      const payload = safeJsonParse(bodyText);
      const extracted = extractZeptoStoreSelectResult(payload);
      if (!extracted?.storeId) {
        continue;
      }

      cookies.store_id = extracted.storeId;
      cookies.storeId = extracted.storeId;
      if (extracted.societyId) {
        cookies.society_id = extracted.societyId;
        cookies.societyId = extracted.societyId;
      }

      return { ok: true, error: null, storeId: extracted.storeId, societyId: extracted.societyId || '' };
    } catch (err) {
      if (err?.name === 'AbortError') {
        return { ok: false, error: 'timeout' };
      }
    }
  }

  return { ok: false, error: null };
}

function extractZeptoStoreSelectResult(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const queue = [payload];
  let scanned = 0;

  while (queue.length > 0 && scanned < 4000) {
    const node = queue.shift();
    scanned += 1;

    if (!node || typeof node !== 'object') {
      continue;
    }

    if (Array.isArray(node)) {
      queue.push(...node);
      continue;
    }

    const storeIdCandidate = node.store_id ?? node.storeId ?? node.primary_store_id ?? node.primaryStoreId;
    const societyIdCandidate = node.society_id ?? node.societyId;
    if (storeIdCandidate) {
      return {
        storeId: String(storeIdCandidate).trim(),
        societyId: societyIdCandidate ? String(societyIdCandidate).trim() : '',
      };
    }

    queue.push(...Object.values(node));
  }

  return null;
}

function buildZeptoCommonHeaders({ session, cookies, requestId, extraHeaders = {} }) {
  const reqId = String(requestId || crypto.randomUUID()).trim();
  const deviceId =
    getSessionHeaderValue(session?.headers, ['x-device-id'])
    || cookies?.device_id
    || cookies?.deviceId
    || '';
  const sessionId =
    getSessionHeaderValue(session?.headers, ['x-session-id'])
    || cookies?.session_id
    || '';
  const accessToken =
    getSessionHeaderValue(session?.headers, ['x-access-token'])
    || cookies?.accessToken
    || '';

  const headers = {
    accept: 'application/json, text/plain, */*',
    platform: 'WEB',
    appversion: '15.5.0',
    app_version: '15.5.0',
    requestid: reqId,
    requestId: reqId,
    'x-request-id': reqId,
    deviceid: deviceId,
    'x-device-id': deviceId,
    sessionid: sessionId,
    'x-session-id': sessionId,
    authorization: accessToken
      ? `Bearer ${accessToken}`
      : getSessionHeaderValue(session?.headers, ['authorization']),
    'x-access-token': accessToken,
    cookie: buildCookieHeader(cookies),
    origin: 'https://www.zeptonow.com',
    referer: 'https://www.zeptonow.com/',
    'user-agent':
      getSessionHeaderValue(session?.headers, ['user-agent'])
      || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    ...extraHeaders,
  };

  Object.keys(headers).forEach((key) => {
    if (!headers[key]) {
      delete headers[key];
    }
  });

  return headers;
}

async function searchZeptoViaApi(query, session, signal) {
  const cookieMap = session.cookies;

  const headers = {
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'platform': 'WEB',
    'app-version': '1.0.0',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  };

  if (session.cookieHeader) {
    headers.Cookie = session.cookieHeader;
  }

  copySessionHeaders(headers, session.headers, {
    allowedPrefixes: ['x-', 'sec-ch-'],
    allowedNames: ['authorization', 'platform', 'app-version', 'user-agent', 'accept', 'accept-language', 'origin', 'referer'],
  });

  applySessionHeader(headers, session.headers, 'platform', ['platform']);
  applySessionHeader(headers, session.headers, 'app-version', ['app-version']);

  const authHeader =
    getSessionHeaderValue(session.headers, ['authorization'])
    || (cookieMap.accessToken ? `Bearer ${cookieMap.accessToken}` : '');
  if (authHeader) {
    headers.Authorization = authHeader;
  }

  const xsrfToken =
    getSessionHeaderValue(session.headers, ['x-xsrf-token', 'x-csrf-token'])
    || cookieMap['XSRF-TOKEN']
    || cookieMap.xsrfToken;
  if (xsrfToken) {
    headers['x-xsrf-token'] = getSessionHeaderValue(session.headers, ['x-xsrf-token']) || xsrfToken;
    headers['x-csrf-token'] = getSessionHeaderValue(session.headers, ['x-csrf-token']) || xsrfToken;
  }

  headers['x-device-id'] =
    getSessionHeaderValue(session.headers, ['x-device-id'])
    || cookieMap.device_id
    || cookieMap.deviceId
    || cookieMap._device_id
    || headers['x-device-id'];
  headers['x-session-id'] =
    getSessionHeaderValue(session.headers, ['x-session-id'])
    || cookieMap.session_id
    || cookieMap._session_tid
    || cookieMap.session_count
    || headers['x-session-id'];
  headers['x-unique-browser-id'] =
    getSessionHeaderValue(session.headers, ['x-unique-browser-id'])
    || cookieMap.unique_browser_id
    || cookieMap._swuid
    || headers['x-unique-browser-id'];

  const xWithoutBearer = getSessionHeaderValue(session.headers, ['x-without-bearer']);
  if (xWithoutBearer) {
    headers['X-WITHOUT-BEARER'] = xWithoutBearer;
  }

  const xAccessToken =
    getSessionHeaderValue(session.headers, ['x-access-token'])
    || cookieMap.accessToken;
  if (xAccessToken) {
    headers['x-access-token'] = xAccessToken;
  }

  Object.keys(headers).forEach((key) => {
    if (!headers[key]) {
      delete headers[key];
    }
  });

  const endpoints = [
    'https://bff-gateway.zeptonow.com/user-search-service/api/v3/search',
    'https://bff-gateway.zepto.com/user-search-service/api/v3/search',
  ];

  const intentId = String(session?.extra?.intentId ?? '').trim();
  const userSessionId =
    getSessionHeaderValue(session.headers, ['x-session-id'])
    || cookieMap.session_id
    || cookieMap._session_tid
    || cookieMap.session_count
    || '';

  const requestVariants = [
    { mode: 'AUTOSUGGEST', pageNumber: 0, includeAuth: true, includeUserSession: false },
    { mode: 'TYPED', pageNumber: 0, includeAuth: true, includeUserSession: true, intentId: intentId || undefined },
    { mode: 'SHOW_ALL_RESULTS', pageNumber: 0, includeAuth: true, includeUserSession: true, intentId: intentId || undefined },
    { mode: 'AUTOSUGGEST', pageNumber: 0, includeAuth: false, withoutBearer: true, includeUserSession: true, intentId: intentId || undefined },
    { mode: 'TYPED', pageNumber: 0, includeAuth: false, withoutBearer: true, includeUserSession: true, intentId: intentId || undefined },
    { mode: 'SHOW_ALL_RESULTS', pageNumber: 0, includeAuth: false, withoutBearer: true, includeUserSession: true, intentId: intentId || undefined },
  ];

  let lastError = null;

  for (const endpoint of endpoints) {
    for (const variant of requestVariants) {
      const attemptHeaders = { ...headers };
      const requestId = crypto.randomUUID();
      const storeIdHeader = cookieMap.store_id || cookieMap.storeId || '';
      const societyIdHeader = cookieMap.society_id || cookieMap.societyId || '';
      attemptHeaders.requestid = requestId;
      attemptHeaders.requestId = requestId;
      attemptHeaders['x-request-id'] = requestId;
      if (storeIdHeader) {
        attemptHeaders.storeid = storeIdHeader;
        attemptHeaders['x-store-id'] = storeIdHeader;
      }
      if (societyIdHeader) {
        attemptHeaders.societyid = societyIdHeader;
      }

      if (variant.includeAuth === false) {
        delete attemptHeaders.Authorization;
        delete attemptHeaders['x-access-token'];
      }

      if (variant.withoutBearer) {
        attemptHeaders['X-WITHOUT-BEARER'] = 'true';
      }

      const payload = {
        query,
        pageNumber: Number.isFinite(variant.pageNumber) ? variant.pageNumber : 0,
        mode: variant.mode,
      };

      if (ZEPTO_ENABLE_ENRICHED_SEARCH_PAYLOAD) {
        payload.page_number = payload.pageNumber;
        payload.search_meta_data = {
          is_primary_search: true,
          search_type: 'TEXT',
          intent: 'PRODUCT',
        };
      }

      if (variant.intentId) {
        payload.intentId = variant.intentId;
      }

      if (variant.includeUserSession && userSessionId) {
        payload.userSessionId = userSessionId;
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        signal,
        headers: attemptHeaders,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');

        if (session.hasSessionContext && res.status === 401) {
          lastError = 'session_invalid';
        } else if (session.hasSessionContext && res.status === 403) {
          lastError = isLikelyWafChallengeResponse(res, bodyText)
            ? 'waf_challenge'
            : 'session_invalid';
        } else if (session.hasSessionContext && res.status === 400 && looksLikeInvalidZeptoTokenResponse(bodyText)) {
          lastError = 'session_invalid';
        } else if (res.status === 400 && String(bodyText).toLowerCase().includes('invalid request')) {
          if (!lastError) {
            lastError = 'invalid_request';
          }
        } else {
          lastError = `HTTP ${res.status}`;
        }

        continue;
      }

      const data = await res.json().catch(() => null);
      const layout = data?.layout ?? [];
      const productGrid = layout.find(
        (w) => w?.widgetId === 'PRODUCT_GRID' || w?.type === 'PRODUCT_GRID' || String(w?.campaignName ?? '').includes('PRODUCT_GRID')
      );

      const items =
        productGrid?.data?.resolver?.data?.items
        ?? productGrid?.data?.items
        ?? [];

      const products = items
        .map((item) => normaliseZeptoApiItem(item))
        .filter((p) => p && p.price > 0 && p.name);

      if (products.length > 0) {
        return { products, error: null };
      }
    }
  }

  return { products: [], error: lastError };
}

async function searchZeptoViaSignedCatalog(query, lat, lon, session, signal) {
  if (!session?.hasSessionContext) {
    return { matchedProducts: [], genericProducts: [], error: null };
  }

  const cookies = { ...(session.cookies ?? {}) };
  const refresh = await refreshZeptoSignedSession(session, cookies, signal);
  if (refresh.error === 'session_invalid') {
    return { matchedProducts: [], genericProducts: [], error: 'session_invalid' };
  }

  const refreshedSession = buildRefreshedZeptoSession(session, cookies);
  const apiRetryAttempt = await searchZeptoViaApi(query, refreshedSession, signal);
  if (apiRetryAttempt.products.length > 0) {
    return {
      matchedProducts: apiRetryAttempt.products,
      genericProducts: apiRetryAttempt.products,
      error: null,
    };
  }

  const queryTerms = extractSearchTerms(query);

  // Prefer explicit query pages first. When these endpoints are accepted,
  // they tend to produce more relevant product rows than home/pre-search grids.
  const queryPageAttempts = await Promise.all([
    zeptoSignedGet({
      session,
      cookies,
      path: 'lms/api/v2/get_page',
      params: {
        page_type: 'SEARCH',
        version: 'v2',
        query,
        scope: 'search',
        latitude: String(lat),
        longitude: String(lon),
        enforce_platform_type: 'WEB',
      },
      signal,
    }),
    zeptoSignedGet({
      session,
      cookies,
      path: 'lms/api/v2/get_page',
      params: {
        page_type: 'SEARCH_RESULTS',
        version: 'v2',
        query,
        scope: 'search',
        latitude: String(lat),
        longitude: String(lon),
        enforce_platform_type: 'WEB',
      },
      signal,
    }),
    zeptoSignedGet({
      session,
      cookies,
      path: 'lms/api/v2/get_page',
      params: {
        page_type: 'PRE_SEARCH',
        version: 'v2',
        query,
        scope: 'search',
        latitude: String(lat),
        longitude: String(lon),
        enforce_platform_type: 'WEB',
      },
      signal,
    }),
  ]);

  const queryPageProducts = dedupeProductsById(
    queryPageAttempts
      .filter((attempt) => !attempt.error)
      .flatMap((attempt) => extractZeptoProductsFromNextData(attempt.data ?? {}))
      .filter((item) => item && item.price > 0 && item.name)
  );

  const queryMatchedProducts = queryTerms.length === 0
    ? queryPageProducts
    : queryPageProducts
      .map((product) => ({ product, score: scoreSearchMatch(product, queryTerms) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.product);

  if (queryMatchedProducts.length > 0) {
    return {
      matchedProducts: queryMatchedProducts,
      genericProducts: queryPageProducts,
      error: null,
    };
  }

  const homeAttempt = await zeptoSignedGet({
    session,
    cookies,
    path: 'lms/api/v2/get_page',
    params: {
      page_type: 'HOME',
      version: 'v2',
      latitude: String(lat),
      longitude: String(lon),
      show_new_eta_banner: true,
      scope: 'home',
      enforce_platform_type: 'WEB',
    },
    signal,
  });

  const preSearchAttempt = await zeptoSignedGet({
    session,
    cookies,
    path: 'lms/api/v2/get_page',
    params: {
      page_type: 'PRE_SEARCH',
      version: 'v2',
      latitude: String(lat),
      longitude: String(lon),
      show_new_eta_banner: false,
      scope: 'search',
      enforce_platform_type: 'WEB',
    },
    signal,
  });

  if (homeAttempt.error && preSearchAttempt.error) {
    return {
      matchedProducts: [],
      genericProducts: [],
      error: homeAttempt.error || preSearchAttempt.error,
    };
  }

  const homePayload = homeAttempt.data ?? {};
  const preSearchPayload = preSearchAttempt.data ?? {};

  const homePagePayloads = [homePayload];
  const nextLastWidgetId =
    homePayload?.nextPageParams?.last_widget_id
    || homePayload?.lastWidgetId
    || null;

  if (nextLastWidgetId) {
    const nextHomeAttempt = await zeptoSignedGet({
      session,
      cookies,
      path: 'lms/api/v2/get_page',
      params: {
        page_type: 'HOME',
        version: 'v2',
        latitude: String(lat),
        longitude: String(lon),
        show_new_eta_banner: true,
        scope: 'home',
        enforce_platform_type: 'WEB',
        last_widget_id: String(nextLastWidgetId),
        page_size: 30,
      },
      signal,
    });

    if (!nextHomeAttempt.error && nextHomeAttempt.data) {
      homePagePayloads.push(nextHomeAttempt.data);
    }
  }

  const homeProducts = dedupeProductsById(
    homePagePayloads
      .flatMap((payload) => extractZeptoProductsFromNextData(payload))
      .filter((item) => item && item.price > 0 && item.name)
  );
  const preSearchProducts = dedupeProductsById(
    extractZeptoProductsFromNextData(preSearchPayload)
      .filter((item) => item && item.price > 0 && item.name)
  );

  const storeId = String(
    homePagePayloads.find((payload) => payload?.storeServiceableResponse?.storeId)?.storeServiceableResponse?.storeId
    || preSearchPayload?.storeServiceableResponse?.storeId
    || extractStoreIdFromZeptoServiceability(cookies)
    || cookies.store_id
    || ''
  ).trim();

  const userId =
    getSessionHeaderValue(session.headers, ['x-user-id'])
    || cookies.user_id
    || '';

  const seeds = pickZeptoSubcategorySeeds(
    [
      ...homePagePayloads.flatMap((payload) => extractZeptoSubcategorySeeds(payload)),
      ...extractZeptoSubcategorySeeds(preSearchPayload),
    ],
    query,
    30
  );

  const subcategoryAttempts = await Promise.all(
    seeds.map((seed) => zeptoSignedGet({
      session,
      cookies,
      path: 'product-assortment-service/api/v2/store-products-by-store-subcategory-id',
      params: {
        subcategory_id: seed.id,
        page_number: 1,
        ...(storeId ? { store_id: storeId } : {}),
        latitude: String(lat),
        longitude: String(lon),
        ...(userId ? { user_id: userId } : {}),
      },
      signal,
    }))
  );

  let authLikeError = null;
  const subcategoryProducts = [];

  for (const attempt of subcategoryAttempts) {
    if (attempt.error) {
      if (isAuthLikeZeptoError(attempt.error)) {
        authLikeError = attempt.error;
      }
      continue;
    }

    const rows = Array.isArray(attempt.data?.storeProducts)
      ? attempt.data.storeProducts
      : [];

    for (const row of rows) {
      const product = normaliseZeptoApiItem(row);
      if (product && product.price > 0 && product.name) {
        subcategoryProducts.push(product);
      }
    }
  }

  const genericProducts = dedupeProductsById([
    ...subcategoryProducts,
    ...homeProducts,
    ...preSearchProducts,
  ]);

  if (!queryTerms.length) {
    return {
      matchedProducts: genericProducts,
      genericProducts,
      error: null,
    };
  }

  const matchedProducts = genericProducts
    .map((product) => ({ product, score: scoreSearchMatch(product, queryTerms) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.product);

  return {
    matchedProducts,
    genericProducts,
    error: matchedProducts.length === 0 ? authLikeError : null,
  };
}

function buildRefreshedZeptoSession(session, cookies) {
  const safeSession = session && typeof session === 'object' ? session : {};
  const safeCookies = cookies && typeof cookies === 'object' ? cookies : {};

  const headers = {
    ...(safeSession.headers && typeof safeSession.headers === 'object' ? safeSession.headers : {}),
  };

  const accessToken = String(safeCookies.accessToken ?? '').trim();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
    headers['x-access-token'] = accessToken;
  }

  const cookieHeader = buildCookieHeader(safeCookies);

  return {
    ...safeSession,
    cookies: safeCookies,
    headers,
    cookieHeader,
    hasSessionContext: Boolean(
      Object.keys(safeCookies).length > 0
      || Object.keys(headers).length > 0
      || cookieHeader
    ),
  };
}

async function refreshZeptoSignedSession(session, cookies, signal) {
  const requestId = crypto.randomUUID();
  const requestBody = '{}';
  const deviceId =
    getSessionHeaderValue(session.headers, ['x-device-id'])
    || cookies.device_id
    || cookies.deviceId
    || '';

  const xsrfToken =
    getSessionHeaderValue(session.headers, ['x-xsrf-token', 'x-csrf-token'])
    || cookies['XSRF-TOKEN']
    || cookies.xsrfToken
    || '';

  const csrfSecret =
    getSessionHeaderValue(session.headers, ['x-csrf-secret'])
    || cookies.csrfSecret
    || '';

  const signature = buildZeptoRequestSignature({
    method: 'POST',
    path: '/api/auth/refresh-auth',
    params: {},
    requestId,
    deviceId,
    secret: xsrfToken,
    body: requestBody,
  });

  const headers = {
    'accept': 'application/json, text/plain, */*',
    'content-type': 'application/json',
    'platform': 'WEB',
    'source': 'DIRECT',
    'requestId': requestId,
    'request_id': requestId,
    'deviceId': deviceId,
    'device_id': deviceId,
    'sessionId':
      getSessionHeaderValue(session.headers, ['x-session-id'])
      || cookies.session_id
      || '',
    'session_id':
      getSessionHeaderValue(session.headers, ['x-session-id'])
      || cookies.session_id
      || '',
    'appVersion': '15.5.0',
    'app_version': '15.5.0',
    'auth_revamp_flow': 'v2',
    'compatible_components': ZEPTO_COMPATIBLE_COMPONENTS,
    'authorization': cookies.accessToken
      ? `Bearer ${cookies.accessToken}`
      : getSessionHeaderValue(session.headers, ['authorization']),
    'x-access-token': cookies.accessToken || getSessionHeaderValue(session.headers, ['x-access-token']),
    'x-device-id': deviceId,
    'x-session-id':
      getSessionHeaderValue(session.headers, ['x-session-id'])
      || cookies.session_id
      || '',
    'x-unique-browser-id':
      getSessionHeaderValue(session.headers, ['x-unique-browser-id'])
      || cookies.unique_browser_id
      || '',
    'x-api-key': getSessionHeaderValue(session.headers, ['x-api-key']),
    'x-xsrf-token': xsrfToken,
    'x-csrf-secret': csrfSecret,
    'x-timezone': sha256Hex(signature || ''),
    'request-signature': signature,
    'cookie': buildCookieHeader(cookies),
    'origin': 'https://www.zepto.com',
    'referer': 'https://www.zepto.com/',
    'user-agent':
      getSessionHeaderValue(session.headers, ['user-agent'])
      || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  };

  Object.keys(headers).forEach((key) => {
    if (!headers[key]) delete headers[key];
  });

  const res = await fetch(ZEPTO_REFRESH_AUTH_URL, {
    method: 'POST',
    headers,
    body: requestBody,
    signal,
    redirect: 'manual',
  });

  const bodyText = await res.text().catch(() => '');
  if (!res.ok) {
    if (res.status === 401 || res.status === 403 || looksLikeInvalidZeptoTokenResponse(bodyText)) {
      return { ok: false, error: 'session_invalid' };
    }

    // Refresh failures that are not auth-related are non-blocking.
    return { ok: false, error: null };
  }

  const setCookieHeaders = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [];

  Object.assign(cookies, parseZeptoSetCookieValues(setCookieHeaders));
  return { ok: true, error: null };
}

async function zeptoSignedGet({ session, cookies, path, params, signal }) {
  const normalizedParams = normalizeZeptoQueryParams(params);
  const requestId = crypto.randomUUID();

  const deviceId =
    getSessionHeaderValue(session.headers, ['x-device-id'])
    || cookies.device_id
    || cookies.deviceId
    || '';

  const sessionId =
    getSessionHeaderValue(session.headers, ['x-session-id'])
    || cookies.session_id
    || '';

  const xsrfToken =
    getSessionHeaderValue(session.headers, ['x-xsrf-token', 'x-csrf-token'])
    || cookies['XSRF-TOKEN']
    || cookies.xsrfToken
    || '';

  const csrfSecret =
    getSessionHeaderValue(session.headers, ['x-csrf-secret'])
    || cookies.csrfSecret
    || '';

  const accessToken =
    cookies.accessToken
    || getSessionHeaderValue(session.headers, ['x-access-token'])
    || '';

  const storeContext = extractZeptoStoreContext(cookies);

  const signature = buildZeptoRequestSignature({
    method: 'GET',
    path: `/${String(path).replace(/^\/+/, '')}`,
    params: normalizedParams,
    requestId,
    deviceId,
    secret: xsrfToken,
    body: undefined,
  });

  const headers = {
    'accept': 'application/json, text/plain, */*',
    'platform': 'WEB',
    'source': 'DIRECT',
    'appVersion': '15.5.0',
    'app_version': '15.5.0',
    'auth_revamp_flow': 'v2',
    'compatible_components': ZEPTO_COMPATIBLE_COMPONENTS,
    'requestId': requestId,
    'request_id': requestId,
    'deviceId': deviceId,
    'device_id': deviceId,
    'sessionId': sessionId,
    'session_id': sessionId,
    'auth_from_cookie': 'true',
    'marketplace_type': cookies.marketplace || 'SUPER_SAVER',
    'storeId': storeContext.storeId,
    'store_id': storeContext.storeId,
    'store_ids': storeContext.storeIds || storeContext.storeId,
    'store_etas': storeContext.storeEtas,
    'authorization': accessToken
      ? `Bearer ${accessToken}`
      : getSessionHeaderValue(session.headers, ['authorization']),
    'x-access-token': accessToken,
    'x-device-id': deviceId,
    'x-session-id': sessionId,
    'x-unique-browser-id':
      getSessionHeaderValue(session.headers, ['x-unique-browser-id'])
      || cookies.unique_browser_id
      || '',
    'x-api-key': getSessionHeaderValue(session.headers, ['x-api-key']),
    'x-xsrf-token': xsrfToken,
    'x-csrf-secret': csrfSecret,
    'x-timezone': sha256Hex(signature || ''),
    'request-signature': signature,
    'cookie': buildCookieHeader(cookies),
    'origin': 'https://www.zeptonow.com',
    'referer': 'https://www.zeptonow.com/',
    'user-agent':
      getSessionHeaderValue(session.headers, ['user-agent'])
      || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  };

  Object.keys(headers).forEach((key) => {
    if (!headers[key]) delete headers[key];
  });

  const target = new URL(path, ZEPTO_SIGNED_BASE_URL);
  Object.entries(normalizedParams).forEach(([key, value]) => {
    target.searchParams.set(key, value);
  });

  const res = await fetch(target.toString(), {
    method: 'GET',
    headers,
    signal,
  });

  const text = await res.text().catch(() => '');
  const data = safeJsonParse(text);

  if (!res.ok) {
    if (res.status === 401 || res.status === 403 || looksLikeInvalidZeptoTokenResponse(text)) {
      return { ok: false, status: res.status, data, text, error: 'session_invalid' };
    }

    return {
      ok: false,
      status: res.status,
      data,
      text,
      error: `HTTP ${res.status}`,
    };
  }

  return { ok: true, status: res.status, data, text, error: null };
}

function normalizeZeptoQueryParams(params = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    normalized[key] = String(value);
  }
  return normalized;
}

function extractZeptoStoreContext(cookies = {}) {
  let parsed = {};
  try {
    parsed = safeJsonParse(decodeURIComponent(String(cookies.serviceability || '')))
      || safeJsonParse(String(cookies.serviceability || ''))
      || {};
  } catch {
    parsed = {};
  }

  const primary = parsed?.primaryStore || parsed?.store || {};
  const secondary = parsed?.secondaryStore || null;
  const storeId = String(primary?.storeId || primary?.store_id || cookies.store_id || '').trim();
  const storeIds = [primary?.storeId, secondary?.storeId].filter(Boolean).join(',');

  const etaPairs = [];
  if (primary?.storeId) {
    etaPairs.push(`"${primary.storeId}":${Number(primary?.etaInMinutes ?? -1)}`);
  }
  if (secondary?.storeId) {
    etaPairs.push(`"${secondary.storeId}":${Number(secondary?.etaInMinutes ?? -1)}`);
  }

  return {
    storeId,
    storeIds,
    storeEtas: etaPairs.length > 0 ? `{${etaPairs.join(',')}}` : '',
  };
}

function extractStoreIdFromZeptoServiceability(cookies = {}) {
  return extractZeptoStoreContext(cookies).storeId;
}

function buildZeptoRequestSignature({ method, path, params, requestId, deviceId, secret, body }) {
  const payload = {
    method: String(method || 'GET').toLowerCase(),
    url: buildZeptoPathWithParams(path, params),
    requestId,
    deviceId,
    secret: secret || '',
    body,
  };

  const joined = Object.keys(payload)
    .sort()
    .reduce((acc, key, index) => `${acc}${index === 0 ? '' : '|'}${payload[key]}`, '');

  return sha256Hex(joined);
}

function buildZeptoPathWithParams(path, params = {}) {
  const pathname = `/${String(path || '').replace(/^\/+/, '')}`;
  const search = new URLSearchParams(params).toString();
  return search ? `${pathname}?${search}` : pathname;
}

function parseZeptoSetCookieValues(setCookieHeaders = []) {
  const updates = {};
  for (const cookieLine of setCookieHeaders) {
    const [pair] = String(cookieLine ?? '').split(';');
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;

    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!key) continue;
    updates[key] = value;
  }

  return updates;
}

function buildCookieHeader(cookies = {}) {
  return Object.entries(cookies)
    .map(([key, value]) => [String(key ?? '').trim(), String(value ?? '').trim()])
    .filter(([key, value]) => key && value)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

function extractZeptoSubcategorySeeds(root) {
  const seeds = new Map();
  const stack = [root];
  let visited = 0;

  while (stack.length > 0 && visited < 120000) {
    const node = stack.pop();
    visited += 1;

    if (!node || typeof node !== 'object') continue;

    if (Array.isArray(node)) {
      for (const entry of node) stack.push(entry);
      continue;
    }

    const id = String(
      node.primarySubcategoryId
      || node.subcategoryId
      || node.sub_category_id
      || ''
    ).trim();

    if (id) {
      const name = String(
        node.primarySubcategoryName
        || node.subcategoryName
        || node.sub_category_name
        || node.primaryCategoryName
        || node.categoryName
        || ''
      ).trim();

      const existing = seeds.get(id) ?? { id, name: '' };
      if (!existing.name && name) {
        existing.name = name;
      }
      seeds.set(id, existing);
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }

  return [...seeds.values()];
}

function pickZeptoSubcategorySeeds(seeds, query, limit = 10) {
  const safeSeeds = Array.isArray(seeds) ? seeds : [];
  const dedupedSeeds = [...new Map(
    safeSeeds
      .filter((seed) => seed && typeof seed.id === 'string' && seed.id.trim())
      .map((seed) => [String(seed.id).trim(), { id: String(seed.id).trim(), name: String(seed?.name ?? '').trim() }])
  ).values()];

  if (dedupedSeeds.length === 0) return [];

  const terms = extractSearchTerms(query);
  if (terms.length === 0) {
    return dedupedSeeds.slice(0, limit);
  }

  const scored = dedupedSeeds
    .map((seed) => ({
      seed,
      score: scoreSearchMatch({ name: seed?.name ?? '', brand: '' }, terms),
    }))
    .sort((a, b) => b.score - a.score);

  const positives = scored.filter((entry) => entry.score > 0).map((entry) => entry.seed);
  if (positives.length === 0) {
    return [];
  }

  return positives.slice(0, limit);
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
}

async function searchZeptoViaHtml(query, sessionCookie, signal) {
  const baseHeaders = {
    'Accept': 'text/html',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  };

  const urls = [
    `https://www.zeptonow.com/search?query=${encodeURIComponent(query)}`,
    `https://www.zeptonow.com/search?q=${encodeURIComponent(query)}`,
    `https://www.zeptonow.com/cn/search?query=${encodeURIComponent(query)}`,
    `https://www.zepto.com/search?query=${encodeURIComponent(query)}`,
  ];

  const headerVariants = [];
  if (sessionCookie) {
    headerVariants.push({ ...baseHeaders, Cookie: sessionCookie });
  }
  headerVariants.push({ ...baseHeaders });

  const merged = [];
  for (const headers of headerVariants) {
    for (const url of urls) {
      const res = await fetch(url, { method: 'GET', signal, headers });
      if (!res.ok) {
        continue;
      }

      const html = await res.text();
      const products = extractZeptoProductsFromHtmlPayload(html);
      if (products.length > 0) {
        merged.push(...products);
      }
    }
  }

  const deduped = new Map();
  for (const product of merged) {
    deduped.set(product.id, product);
  }

  const dedupedProducts = [...deduped.values()];
  const queryTerms = extractSearchTerms(query);

  if (queryTerms.length > 0) {
    const ranked = dedupedProducts
      .map((product) => ({
        product,
        score: scoreSearchMatch(product, queryTerms),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    if (ranked.length > 0) {
      return {
        matchedProducts: ranked.map((entry) => entry.product),
        genericProducts: dedupedProducts,
      };
    }

    // If nothing matches the query terms, this block is likely a pre-search
    // recommendation widget rather than true search output.
    return {
      matchedProducts: [],
      genericProducts: dedupedProducts,
    };
  }

  return {
    matchedProducts: dedupedProducts,
    genericProducts: dedupedProducts,
  };
}

function extractZeptoProductsFromHtmlPayload(html) {
  const rawHtml = String(html ?? '');
  if (!rawHtml) return [];

  const normalized = rawHtml.replace(/\\"/g, '"');
  const merged = [];

  const campaigns = [
    '"campaignName":"PRODUCT_GRID_01_WEB"',
    '"campaignName":"PRODUCT_GRID"',
    '"widget_name":"PRODUCT_GRID_01_WEB"',
    '"widget_id":"PRE_SEARCH_PRODUCT_GRID"',
  ];

  for (const marker of campaigns) {
    let from = 0;
    while (true) {
      const markerIdx = normalized.indexOf(marker, from);
      if (markerIdx < 0) break;

      const itemsKeyIdx = normalized.indexOf('"items":[', markerIdx);
      if (itemsKeyIdx > -1) {
        const itemsRaw = extractJsonArrayFromIndex(normalized, itemsKeyIdx + '"items":'.length);
        const parsedItems = safeJsonParse(itemsRaw);

        if (Array.isArray(parsedItems)) {
          for (const item of parsedItems) {
            const product = normaliseZeptoHtmlItem(item);
            if (product && product.price > 0 && product.name) {
              merged.push(product);
            }
          }
        }
      }

      from = markerIdx + marker.length;
    }
  }

  const looseEmbeddedProducts = extractZeptoProductsFromLoosePayload(normalized);
  if (looseEmbeddedProducts.length > 0) {
    merged.push(...looseEmbeddedProducts);
  }

  if (merged.length > 0) {
    return dedupeProductsById(merged);
  }

  const nextDataMatch = rawHtml.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
  if (!nextDataMatch?.[1]) {
    return [];
  }

  const nextData = safeJsonParse(nextDataMatch[1]);
  if (!nextData || typeof nextData !== 'object') {
    return [];
  }

  const extracted = extractZeptoProductsFromNextData(nextData);
  return dedupeProductsById(extracted);
}

function extractZeptoProductsFromLoosePayload(text) {
  const source = String(text ?? '');
  if (!source) return [];

  const matches = [];
  const scanTargets = [
    {
      marker: '"productResponse":',
      buildCandidate: (payload) => ({ productResponse: payload }),
    },
    {
      marker: '"cardData":',
      buildCandidate: (payload) => ({ cardData: payload }),
    },
  ];

  for (const target of scanTargets) {
    let from = 0;
    let hits = 0;

    while (from < source.length && hits < 300) {
      const markerIdx = source.indexOf(target.marker, from);
      if (markerIdx < 0) break;

      const objectRaw = extractJsonObjectFromIndex(source, markerIdx + target.marker.length);
      if (objectRaw) {
        const parsed = safeJsonParse(objectRaw);
        const candidate = target.buildCandidate(parsed);
        const normalised = normaliseZeptoApiItem(candidate);
        if (normalised && normalised.price > 0 && normalised.name) {
          matches.push(normalised);
        }
      }

      hits += 1;
      from = markerIdx + target.marker.length;
    }
  }

  return dedupeProductsById(matches);
}

function extractZeptoProductsFromNextData(root) {
  const out = [];
  const stack = [root];
  let walked = 0;

  while (stack.length > 0 && walked < 12000) {
    const node = stack.pop();
    walked += 1;

    if (!node || typeof node !== 'object') continue;

    if (Array.isArray(node)) {
      for (const entry of node) {
        stack.push(entry);
      }
      continue;
    }

    const probe = normaliseZeptoApiItem(node);
    if (probe && probe.price > 0 && probe.name) {
      out.push(probe);
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }

  return out;
}

function dedupeProductsById(products) {
  const deduped = new Map();
  for (const product of products ?? []) {
    if (!product?.id) continue;
    deduped.set(product.id, product);
  }

  return [...deduped.values()];
}

function normaliseZeptoApiItem(item) {
  const pr = item?.productResponse ?? item?.cardData ?? {};
  const product = pr.product ?? item?.product ?? {};
  const variant = pr.productVariant ?? item?.productVariant ?? product.productVariant ?? {};

  const productId = product.id ?? pr.id ?? item?.id;
  if (!productId) return null;

  const discounted = toRupees(
    pr.discountedSellingPrice
    ?? item?.discountedSellingPrice
    ?? item?.sellingPrice
    ?? item?.superSaverSellingPrice
    ?? pr.sellingPrice
    ?? 0
  );
  const mrp = toRupees(
    pr.mrp
    ?? item?.mrp
    ?? product.mrp
    ?? item?.sellingPrice
    ?? pr.sellingPrice
    ?? 0
  );

  const brandName = typeof product.brand === 'string'
    ? product.brand
    : (product.brand?.name ?? item?.brandName ?? pr.brandName ?? '');

  const availabilityStatus = String(
    pr.availabilityStatus
    ?? item?.availabilityStatus
    ?? ''
  ).toUpperCase();

  const outOfStock =
    pr.outOfStock
    ?? item?.outOfStock
    ?? false;

  return {
    id: `zepto:${productId}`,
    platform: 'zepto',
    name: product.name ?? pr.name ?? '',
    brand: brandName,
    image:
      product.images?.[0]?.path
      ?? variant.images?.[0]?.path
      ?? pr.product?.images?.[0]?.path
      ?? item?.images?.[0]?.path
      ?? null,
    price: discounted,
    mrp,
    discount: mrp > discounted ? Math.round(((mrp - discounted) / mrp) * 100) : null,
    quantity:
      variant.formattedPacksize
      ?? variant.packSize
      ?? item?.quantity
      ?? pr.quantity
      ?? '',
    unitPrice: null,
    deliveryFee: 0,
    deliveryEta: (pr.etaInMins ?? item?.etaInMins) ? `${pr.etaInMins ?? item?.etaInMins} mins` : '10 mins',
    inStock: availabilityStatus === 'AVAILABLE' || outOfStock === false,
    deepLink: `https://www.zeptonow.com/pn/${productId}`,
    platformColor: '#8025FB',
  };
}

function normaliseZeptoHtmlItem(item) {
  return normaliseZeptoApiItem({
    id: item?.cardData?.id,
    cardData: item?.cardData,
    product: item?.cardData?.product,
  });
}

// ─── BIGBASKET ─────────────────────────────────────────────────────────────────

export async function searchBigBasket(query, sessionInput = null) {
  const session = resolveSessionContext(sessionInput);
  const cookieMap = session.cookies;
  const endpoints = [
    `https://www.bigbasket.com/listing-svc/v2/products?type=ps&slug=${encodeURIComponent(query)}&page=1`,
    `https://www.bigbasket.com/listing-svc/v1/short-list?type=ps&slug=${encodeURIComponent(query)}`,
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let lastError = null;

  for (const url of endpoints) {
    try {
      const headers = {
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Origin': 'https://www.bigbasket.com',
        'Referer': `https://www.bigbasket.com/ps/?q=${encodeURIComponent(query)}`,
      };

      if (session.cookieHeader) {
        headers.Cookie = session.cookieHeader;
      }

      applySessionHeader(headers, session.headers, 'X-Auth-Token', ['x-auth-token']);
      applySessionHeader(headers, session.headers, 'x-csrf-token', ['x-csrf-token']);
      applySessionHeader(headers, session.headers, 'Authorization', ['authorization']);
      applySessionHeader(headers, session.headers, 'x-channel', ['x-channel']);

      if (!headers['X-Auth-Token']) {
        headers['X-Auth-Token'] = cookieMap.bb_auth_token || cookieMap.bbAuthToken || '';
      }

      if (!headers['x-csrf-token']) {
        headers['x-csrf-token'] = cookieMap._bb_csrf || cookieMap.csrftoken || '';
      }

      if (!headers['x-channel']) {
        headers['x-channel'] = cookieMap['x-channel'] || 'web';
      }

      Object.keys(headers).forEach((key) => {
        if (!headers[key]) {
          delete headers[key];
        }
      });

      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers,
        redirect: 'manual',
      });
      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        const errorMessage = parseBigBasketErrorMessage(bodyText);

        if (
          session.hasSessionContext
          && (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308)
        ) {
          clearTimeout(timer);
          return { platform: 'bigbasket', products: [], error: 'session_invalid' };
        }

        if (session.hasSessionContext && (res.status === 401 || res.status === 403)) {
          clearTimeout(timer);
          return { platform: 'bigbasket', products: [], error: 'session_invalid' };
        }

        if (session.hasSessionContext && res.status === 400 && isBigBasketMissingLocationError(errorMessage)) {
          clearTimeout(timer);
          return { platform: 'bigbasket', products: [], error: 'session_invalid' };
        }

        lastError = errorMessage ? `HTTP ${res.status}: ${errorMessage}` : `HTTP ${res.status}`;
        continue;
      }

      const data = await res.json();
      let raw = [];
      if (data?.tabs?.[0]?.product_info?.products) raw = data.tabs[0].product_info.products;
      else if (Array.isArray(data?.products)) raw = data.products;
      else if (Array.isArray(data?.product_info?.products)) raw = data.product_info.products;
      else if (Array.isArray(data?.data?.products)) raw = data.data.products;
      else if (data?.tab_info) {
        const prdTab = data.tab_info.find(t => t.tab_type === 'prd');
        raw = prdTab?.product_map ?? [];
      }

      if (raw.length > 0) {
        clearTimeout(timer);
        const products = raw.map(r => ({
          id: `bigbasket:${r.id ?? r.product_id}`,
          platform: 'bigbasket',
          name: r.desc ?? r.name ?? r.product_name ?? '',
          brand: r.brand?.name ?? r.brand ?? '',
          image:
            r.images?.[0]?.m
            ?? r.images?.[0]?.l
            ?? r.images?.[0]?.s
            ?? r.img_url
            ?? r.image
            ?? r.image_url
            ?? null,
          price: parsePrice(
            r.pricing?.discount?.prim_price?.sp
            ?? r.sp
            ?? r.selling_price
            ?? r.price
            ?? 0
          ),
          mrp: parsePrice(
            r.pricing?.discount?.mrp
            ?? r.mrp
            ?? r.price
            ?? 0
          ),
          discount: null,
          quantity: r.w ?? r.pack_desc ?? r.pack_size ?? r.quantity ?? '',
          unitPrice: null,
          deliveryFee: 0,
          deliveryEta: '1-2 hrs',
          inStock:
            r.in_stock !== false
            && r.availability?.avail_status !== '003'
            && String(r.availability?.button ?? '').toLowerCase() !== 'notify me',
          deepLink: String(r.absolute_url ?? '').startsWith('/')
            ? `https://www.bigbasket.com${r.absolute_url}`
            : `https://www.bigbasket.com/pd/${r.id ?? r.product_id}/`,
          platformColor: '#84C225',
        })).filter(p => p.price > 0 && p.name);
        return { platform: 'bigbasket', products, error: null };
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        clearTimeout(timer);
        return { platform: 'bigbasket', products: [], error: 'timeout' };
      }

      if (
        session.hasSessionContext
        && String(err?.message ?? '').toLowerCase().includes('redirect count exceeded')
      ) {
        clearTimeout(timer);
        return { platform: 'bigbasket', products: [], error: 'session_invalid' };
      }

      lastError = err.message ?? 'request_failed';
      continue;
    }
  }
  clearTimeout(timer);
  return { platform: 'bigbasket', products: [], error: lastError ?? 'all_endpoints_failed' };
}

// ─── SWIGGY INSTAMART ──────────────────────────────────────────────────────────

export async function searchInstamart(query, lat = 28.4595, lon = 77.0266, sessionInput = null) {
  const session = resolveSessionContext(sessionInput);
  const cookieMap = session.cookies;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const url = new URL('https://www.swiggy.com/api/instamart/search/v2');
    url.searchParams.set('offset', '0');
    url.searchParams.set('ageConsent', 'false');

    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    };

    if (session.cookieHeader) {
      headers.Cookie = session.cookieHeader;
    }

    copySessionHeaders(headers, session.headers, {
      allowedPrefixes: ['x-', 'sec-ch-'],
      allowedNames: ['authorization', 'user-agent', 'accept', 'accept-language', 'origin', 'referer'],
    });

    applySessionHeader(headers, session.headers, 'Authorization', ['authorization']);
    applySessionHeader(headers, session.headers, 'x-device-id', ['x-device-id']);
    applySessionHeader(headers, session.headers, 'x-session-id', ['x-session-id']);
    applySessionHeader(headers, session.headers, 'x-unique-browser-id', ['x-unique-browser-id']);
    applySessionHeader(headers, session.headers, 'x-xsrf-token', ['x-xsrf-token']);
    applySessionHeader(headers, session.headers, 'x-csrf-token', ['x-csrf-token']);

    if (!headers['x-device-id']) {
      headers['x-device-id'] = cookieMap._device_id || cookieMap.device_id || headers['x-device-id'];
    }

    if (!headers['x-session-id']) {
      headers['x-session-id'] = cookieMap.session_id || headers['x-session-id'];
    }

    Object.keys(headers).forEach((key) => {
      if (!headers[key]) {
        delete headers[key];
      }
    });

    const res = await fetch(url.toString(), {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: JSON.stringify({
        facets: [],
        sortAttribute: '',
        query,
        search_results_offset: '0',
        page_type: 'INSTAMART_SEARCH_PAGE',
        is_pre_search_tag: false,
      }),
    });
    clearTimeout(timer);

    if (res.status === 202 && res.headers.get('x-amzn-waf-action') === 'challenge') {
      return { platform: 'instamart', products: [], error: 'waf_challenge' };
    }

    if (!res.ok) {
      const error = session.hasSessionContext && (res.status === 401 || res.status === 403)
        ? 'session_invalid'
        : `HTTP ${res.status}`;
      return { platform: 'instamart', products: [], error };
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return { platform: 'instamart', products: [], error: 'unexpected_content_type' };
    }

    const data = await res.json();
    const cards = data?.data?.cards ?? [];
    const products = [];

    for (const card of cards) {
      const items = card?.gridElements?.infoWithStyle?.info ?? [];
      for (const item of items) {
        products.push({
          id: `instamart:${item.id ?? item.productId}`,
          platform: 'instamart',
          name: item.displayName ?? item.name ?? '',
          brand: item.brand ?? '',
          image: item.imageIds?.[0]
            ? `https://media-assets.swiggy.com/swiggy/image/upload/${item.imageIds[0]}`
            : null,
          price: item.price?.offerPrice?.units ?? item.price?.mrp?.units ?? 0,
          mrp: item.price?.mrp?.units ?? 0,
          discount: null,
          quantity: item.quantityDescription ?? item.quantity ?? '',
          unitPrice: null,
          deliveryFee: 0,
          deliveryEta: '20-30 mins',
          inStock: item.inventory?.inStock !== false,
          deepLink: `https://www.swiggy.com/instamart/item/${item.id}`,
          platformColor: '#FC8019',
        });
      }
    }

    return { platform: 'instamart', products: products.filter(p => p.price > 0 && p.name), error: null };
  } catch (err) {
    clearTimeout(timer);
    return { platform: 'instamart', products: [], error: err.name === 'AbortError' ? 'timeout' : err.message };
  }
}

// ─── JIOMART ───────────────────────────────────────────────────────────────────

export async function searchJioMart(query, sessionInput = null) {
  const session = resolveSessionContext(sessionInput);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let lastError = null;

  const endpoints = [
    `https://www.jiomart.com/api/products/search/v2?q=${encodeURIComponent(query)}&page=1`,
    `https://www.jiomart.com/api/search?query=${encodeURIComponent(query)}`,
  ];

  for (const url of endpoints) {
    try {
      const headers = {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      };

      if (session.cookieHeader) {
        headers.Cookie = session.cookieHeader;
      }

      applySessionHeader(headers, session.headers, 'X-JioMart-Token', ['x-jiomart-token']);
      applySessionHeader(headers, session.headers, 'Authorization', ['authorization']);

      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers,
      });
      if (!res.ok) {
        if (session.hasSessionContext && (res.status === 401 || res.status === 403)) {
          clearTimeout(timer);
          return { platform: 'jiomart', products: [], error: 'session_invalid' };
        }

        lastError = `HTTP ${res.status}`;
        continue;
      }

      const data = await res.json();
      const raw = data?.products ?? data?.data?.products ?? [];
      if (raw.length > 0) {
        clearTimeout(timer);
        const products = raw.map(r => ({
          id: `jiomart:${r.id ?? r.entity_id}`,
          platform: 'jiomart',
          name: r.name ?? r.product_name ?? '',
          brand: r.brand ?? '',
          image: r.image ?? null,
          price: r.our_price ?? r.special_price ?? 0,
          mrp: r.price ?? 0,
          discount: null,
          quantity: r.weight_net_quantity ?? r.pack_info ?? '',
          unitPrice: null,
          deliveryFee: 0,
          deliveryEta: '2-4 hrs',
          inStock: r.is_in_stock !== false,
          deepLink: `https://www.jiomart.com/p/groceries/${r.id}`,
          platformColor: '#0089CF',
        })).filter(p => p.price > 0 && p.name);
        return { platform: 'jiomart', products, error: null };
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        clearTimeout(timer);
        return { platform: 'jiomart', products: [], error: 'timeout' };
      }

      lastError = err.message ?? 'request_failed';
      continue;
    }
  }
  clearTimeout(timer);
  return { platform: 'jiomart', products: [], error: lastError ?? 'all_endpoints_failed' };
}

// ─── HELPERS ───────────────────────────────────────────────────────────────────

function isLikelyWafChallengeResponse(response, bodyText = '') {
  const contentType = String(response?.headers?.get('content-type') ?? '').toLowerCase();
  const server = String(response?.headers?.get('server') ?? '').toLowerCase();
  const wafAction = String(response?.headers?.get('x-amzn-waf-action') ?? '').toLowerCase();
  const probe = String(bodyText ?? '').toLowerCase();

  if (wafAction === 'challenge' || wafAction === 'captcha') {
    return true;
  }

  if (contentType.includes('text/html')) {
    if (!probe) {
      return true;
    }

    if (
      probe.includes('attention required')
      || probe.includes('cloudflare')
      || probe.includes('captcha')
      || probe.includes('cf-chl')
      || probe.includes('access denied')
      || probe.includes('request blocked')
    ) {
      return true;
    }
  }

  return server.includes('cloudflare') && response?.status === 403;
}

function looksLikeInvalidZeptoTokenResponse(bodyText = '') {
  const probe = String(bodyText ?? '').toLowerCase();
  if (!probe) return false;

  return probe.includes('invalid or corrupted token')
    || (probe.includes('invalid') && probe.includes('token'));
}

function isAuthLikeZeptoError(error) {
  const probe = String(error ?? '').trim();
  if (!probe) return false;

  return probe === 'session_invalid'
    || probe === 'invalid_request'
    || probe === 'waf_challenge'
    || probe === 'HTTP 401'
    || probe === 'HTTP 403';
}

function parseBigBasketErrorMessage(bodyText = '') {
  const data = safeJsonParse(String(bodyText ?? '').trim());
  const message = data?.errors?.[0]?.msg
    ?? data?.errors?.[0]?.display_msg
    ?? data?.message
    ?? '';

  return String(message ?? '').trim();
}

function isBigBasketMissingLocationError(errorMessage = '') {
  const probe = String(errorMessage ?? '').toLowerCase();
  if (!probe) return false;

  return probe.includes('missing either mid or addressid or lat-long');
}

function resolveSessionContext(sessionInput) {
  if (typeof sessionInput === 'string') {
    const cookieHeader = String(sessionInput).trim();
    return {
      cookieHeader,
      cookies: parseCookieHeader(cookieHeader),
      headers: {},
      extra: {},
      hasSessionContext: Boolean(cookieHeader),
    };
  }

  if (sessionInput && typeof sessionInput === 'object') {
    const sessionHeaders = sessionInput.headers && typeof sessionInput.headers === 'object'
      ? sessionInput.headers
      : {};

    const rawCookies = sessionInput.cookies && typeof sessionInput.cookies === 'object'
      ? sessionInput.cookies
      : {};

    const cookieFromHeaders =
      getSessionHeaderValue(sessionHeaders, ['cookie'])
      || '';

    const cookies = Object.keys(rawCookies).length > 0
      ? rawCookies
      : parseCookieHeader(cookieFromHeaders);

    const cookieHeader = Object.keys(cookies).length > 0
      ? Object.entries(cookies)
          .map(([key, value]) => [String(key ?? '').trim(), String(value ?? '').trim()])
          .filter(([key, value]) => key && value)
          .map(([key, value]) => `${key}=${value}`)
          .join('; ')
      : cookieFromHeaders;

    return {
      cookieHeader,
      cookies: parseCookieHeader(cookieHeader),
      headers: sessionHeaders,
      extra: sessionInput.extra && typeof sessionInput.extra === 'object' ? sessionInput.extra : {},
      hasSessionContext: Boolean(cookieHeader) || Object.keys(sessionHeaders).length > 0,
    };
  }

  return {
    cookieHeader: '',
    cookies: {},
    headers: {},
    extra: {},
    hasSessionContext: false,
  };
}

function getSessionHeaderValue(sessionHeaders, headerNames) {
  if (!sessionHeaders || typeof sessionHeaders !== 'object') return '';

  const names = Array.isArray(headerNames) ? headerNames : [headerNames];
  const normalizedNameSet = new Set(
    names
      .map((name) => String(name ?? '').trim().toLowerCase())
      .filter(Boolean)
  );

  if (normalizedNameSet.size === 0) return '';

  for (const [rawName, rawValue] of Object.entries(sessionHeaders)) {
    const name = String(rawName ?? '').trim().toLowerCase();
    if (!normalizedNameSet.has(name)) continue;

    const value = String(rawValue ?? '').trim();
    if (!value) continue;
    return value;
  }

  return '';
}

function applySessionHeader(targetHeaders, sessionHeaders, targetName, sourceNames) {
  const value = getSessionHeaderValue(sessionHeaders, sourceNames ?? targetName);
  if (!value) return;
  targetHeaders[targetName] = value;
}

function copySessionHeaders(targetHeaders, sessionHeaders, options = {}) {
  if (!sessionHeaders || typeof sessionHeaders !== 'object') return;

  const allowedNames = new Set(
    (options.allowedNames ?? [])
      .map((name) => String(name ?? '').trim().toLowerCase())
      .filter(Boolean)
  );

  const allowedPrefixes = (options.allowedPrefixes ?? [])
    .map((prefix) => String(prefix ?? '').trim().toLowerCase())
    .filter(Boolean);

  const hasHeader = (headerNameLower) =>
    Object.keys(targetHeaders).some((name) => String(name ?? '').trim().toLowerCase() === headerNameLower);

  for (const [rawName, rawValue] of Object.entries(sessionHeaders)) {
    const name = String(rawName ?? '').trim();
    const lowerName = name.toLowerCase();
    const value = String(rawValue ?? '').trim();

    if (!name || !value) continue;

    const allowedByName = allowedNames.has(lowerName);
    const allowedByPrefix = allowedPrefixes.some((prefix) => lowerName.startsWith(prefix));
    if (!allowedByName && !allowedByPrefix) continue;

    if (hasHeader(lowerName)) continue;
    targetHeaders[name] = value;
  }
}

function parseCookieHeader(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;

  for (const part of String(cookieHeader).split(';')) {
    const trimmed = part.trim();
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;

    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!key) continue;

    out[key] = value;
  }

  return out;
}

function extractSearchTerms(query) {
  const terms = String(query ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);

  return [...new Set(terms)];
}

function filterZeptoRelevantProducts(products, query, minimumScore = 1) {
  const rows = Array.isArray(products) ? products : [];
  if (rows.length === 0) return [];

  const terms = extractSearchTerms(query);
  if (terms.length === 0) {
    return rows;
  }

  const threshold = Number.isFinite(Number(minimumScore))
    ? Math.max(1, Number(minimumScore))
    : 1;

  const scored = rows
    .map((product) => ({ product, score: scoreSearchMatch(product, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return [];
  }

  const topScore = scored[0].score;
  const ratioFloor = terms.length > 1
    ? Math.ceil(topScore * 0.25)
    : Math.ceil(topScore * 0.2);
  const adaptiveThreshold = scored.length <= 12
    ? threshold
    : Math.max(threshold, ratioFloor);

  return scored
    .filter((entry) => entry.score >= adaptiveThreshold)
    .slice(0, 40)
    .map((entry) => entry.product);
}

function tokenizeSearchText(value) {
  return String(value ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function scoreSearchMatch(product, terms) {
  if (!product || !terms?.length) return 0;

  const nameText = String(product.name ?? '').toLowerCase();
  const brandText = String(product.brand ?? '').toLowerCase();
  const quantityText = String(product.quantity ?? '').toLowerCase();
  const haystack = `${nameText} ${brandText} ${quantityText}`.trim();
  if (!haystack) return 0;

  const nameWords = tokenizeSearchText(nameText);
  const brandWords = tokenizeSearchText(brandText);
  const quantityWords = tokenizeSearchText(quantityText);
  const nameWordSet = new Set(nameWords);
  const brandWordSet = new Set(brandWords);
  const quantityWordSet = new Set(quantityWords);

  let score = 0;
  const strongTermMatches = new Set();
  let strongNameMatches = 0;

  const matchPrefix = (words, term) => words.some((word) => word.startsWith(term));

  for (const term of terms) {
    if (nameWordSet.has(term)) {
      strongTermMatches.add(term);
      strongNameMatches += 1;
      score += term.length + 9;
      continue;
    }

    if (brandWordSet.has(term)) {
      strongTermMatches.add(term);
      score += term.length + 5;
      continue;
    }

    if (term.length >= 4 && matchPrefix(nameWords, term)) {
      strongTermMatches.add(term);
      strongNameMatches += 1;
      score += term.length + 6;
      continue;
    }

    if (term.length >= 4 && matchPrefix(brandWords, term)) {
      strongTermMatches.add(term);
      score += term.length + 3;
      continue;
    }

    if (nameText.includes(term)) {
      score += 2;
      continue;
    }

    if (brandText.includes(term)) {
      score += 1;
      continue;
    }

    if (quantityWordSet.has(term)) {
      score += 1;
    }
  }

  if (terms.length > 1 && nameText.includes(terms.join(' '))) {
    score += 8;
  }

  if (terms.length === 1 && nameWordSet.has(terms[0])) {
    score += 3;
  }

  const requiredStrongMatches = terms.length === 1
    ? 1
    : Math.max(1, Math.ceil(terms.length * 0.5));

  if (strongTermMatches.size < requiredStrongMatches) {
    return 0;
  }

  if (terms.length > 1 && strongNameMatches === 0) {
    return 0;
  }

  return score;
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractJsonArrayFromIndex(text, arrayStartIndex) {
  let start = arrayStartIndex;
  while (start < text.length && text[start] !== '[') start += 1;
  if (start >= text.length) return null;

  let inString = false;
  let escaped = false;
  let depth = 0;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '[') depth += 1;
    if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

function extractJsonObjectFromIndex(text, objectStartIndex) {
  let start = objectStartIndex;
  while (start < text.length && text[start] !== '{') start += 1;
  if (start >= text.length) return null;

  let inString = false;
  let escaped = false;
  let depth = 0;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;

    if (depth === 0) {
      return text.slice(start, i + 1);
    }
  }

  return null;
}

function toRupees(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;

  // Zepto payloads typically report price in paise.
  if (Number.isInteger(num) && num >= 1000) {
    return num / 100;
  }

  return num;
}

function parsePrice(str) {
  if (typeof str === 'number') return str;
  if (!str) return 0;
  const match = String(str).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}

function computeUnitPrice(price, qtyStr) {
  if (!qtyStr || !price) return null;
  const s = qtyStr.toLowerCase();
  const m = s.match(/(\d+(?:\.\d+)?)\s*(ml|l\b|g\b|kg|gm|litre|liter|ltr)/);
  if (!m) return null;
  let val = parseFloat(m[1]);
  const unit = m[2];
  if (unit === 'kg' || unit === 'l' || unit === 'litre' || unit === 'liter' || unit === 'ltr') val *= 1000;
  return val > 0 ? price / val : null;
}
