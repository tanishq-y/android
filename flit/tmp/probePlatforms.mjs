import dotenv from 'dotenv';
import {
  getBlinkitCookieSession,
  getZeptoCookieSession,
  getInstamartCookieSession,
} from '../server/tokenVault.js';

dotenv.config();

const USER_ID = process.argv[2] || 'deb41a21-c652-40a0-b4a1-efac7f581a37';

function parseCookieHeader(cookieHeader = '') {
  const out = {};
  for (const part of String(cookieHeader).split(';')) {
    const trimmed = part.trim();
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
}

async function probeZepto() {
  const session = await getZeptoCookieSession(USER_ID);
  if (!session?.cookieHeader) {
    return { ok: false, reason: 'no_cookie' };
  }

  const cookies = parseCookieHeader(session.cookieHeader);
  const access = cookies.accessToken;
  const xsrf = cookies['XSRF-TOKEN'];

  const headers = {
    accept: 'application/json, text/plain, */*',
    'content-type': 'application/json',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    platform: 'WEB',
    'app-version': '1.0.0',
    cookie: session.cookieHeader,
  };

  if (access) headers.authorization = `Bearer ${access}`;
  if (xsrf) {
    headers['x-xsrf-token'] = xsrf;
    headers['x-csrf-token'] = xsrf;
  }

  const body = { query: 'milk', pageNumber: 0, mode: 'AUTOSUGGEST' };
  const url = 'https://bff-gateway.zeptonow.com/user-search-service/api/v3/search';

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();

  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get('content-type'),
    preview: text.slice(0, 240),
  };
}

async function probeZeptoHtml() {
  const response = await fetch('https://www.zeptonow.com/search?query=milk', {
    headers: {
      accept: 'text/html',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  });
  const html = await response.text();

  const markers = {
    PRODUCT_GRID: html.includes('PRODUCT_GRID'),
    productResponse: html.includes('productResponse'),
    sellingPrice: html.includes('sellingPrice'),
    discountedSellingPrice: html.includes('discountedSellingPrice'),
    searchServicePath: html.includes('user-search-service/api/v3/search'),
  };

  const idx = html.indexOf('PRODUCT_GRID');
  const snippet = idx >= 0 ? html.slice(Math.max(0, idx - 220), idx + 380) : null;

  let parsedCount = 0;
  let firstCardKeys = [];
  let firstCardPreview = null;

  try {
    const normalized = html.replace(/\\"/g, '"');
    const campaignIdx = normalized.indexOf('"campaignName":"PRODUCT_GRID_01_WEB"');
    if (campaignIdx >= 0) {
      const itemsKeyIdx = normalized.indexOf('"items":[', campaignIdx);
      if (itemsKeyIdx >= 0) {
        const arrayStart = normalized.indexOf('[', itemsKeyIdx);
        let inString = false;
        let escaped = false;
        let depth = 0;
        let arrayEnd = -1;

        for (let i = arrayStart; i < normalized.length; i += 1) {
          const ch = normalized[i];

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
              arrayEnd = i;
              break;
            }
          }
        }

        if (arrayEnd > arrayStart) {
          const itemsRaw = normalized.slice(arrayStart, arrayEnd + 1);
          const items = JSON.parse(itemsRaw);
          parsedCount = Array.isArray(items) ? items.length : 0;
          const first = Array.isArray(items) ? items[0]?.cardData : null;
          if (first && typeof first === 'object') {
            firstCardKeys = Object.keys(first).slice(0, 30);
            firstCardPreview = JSON.stringify(first).slice(0, 300);
          }
        }
      }
    }
  } catch {
    // Probe-only parser; ignore parse failures for now.
  }

  return {
    ok: response.ok,
    status: response.status,
    htmlLength: html.length,
    markers,
    snippet,
    parsedCount,
    firstCardKeys,
    firstCardPreview,
  };
}

async function probeInstamart() {
  const session = await getInstamartCookieSession(USER_ID);
  if (!session?.cookieHeader) {
    return { ok: false, reason: 'no_cookie' };
  }

  const headers = {
    accept: 'application/json, text/plain, */*',
    'content-type': 'application/json',
    'x-requested-with': 'XMLHttpRequest',
    origin: 'https://www.swiggy.com',
    referer: 'https://www.swiggy.com/instamart/search?query=milk',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    cookie: session.cookieHeader,
  };

  const body = {
    facets: [],
    sortAttribute: '',
    query: 'milk',
    search_results_offset: '0',
    page_type: 'INSTAMART_SEARCH_PAGE',
    is_pre_search_tag: false,
  };

  const url = 'https://www.swiggy.com/api/instamart/search/v2?offset=0&ageConsent=false';
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();

  return {
    ok: response.ok,
    status: response.status,
    wafAction: response.headers.get('x-amzn-waf-action'),
    contentType: response.headers.get('content-type'),
    preview: text.slice(0, 240),
  };
}

async function probeInstamartHtml() {
  const response = await fetch('https://www.swiggy.com/instamart/search?query=milk', {
    headers: {
      accept: 'text/html',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  });
  const html = await response.text();

  const markers = {
    INITIAL_STATE: html.includes('__INITIAL_STATE__'),
    offerPrice: html.includes('offerPrice'),
    mrp: html.includes('"mrp"'),
    instamart: html.includes('instamart'),
    search: html.includes('search'),
  };

  const idx = html.indexOf('offerPrice');
  const snippet = idx >= 0 ? html.slice(Math.max(0, idx - 220), idx + 360) : null;

  let stateParsed = false;
  let stateKeys = [];
  let statePreview = null;

  try {
    const stateMarkers = ['window.__INITIAL_STATE__=', 'window.__INITIAL_STATE__ =', 'window.___INITIAL_STATE__ ='];
    let start = -1;
    let marker = null;
    for (const m of stateMarkers) {
      start = html.indexOf(m);
      if (start >= 0) {
        marker = m;
        break;
      }
    }

    if (start >= 0 && marker) {
      const from = start + marker.length;
      const scriptEnd = html.indexOf('</script>', from);
      let rawState = html.slice(from, scriptEnd).trim();
      if (rawState.endsWith(';')) rawState = rawState.slice(0, -1);

      const parsed = JSON.parse(rawState);
      stateParsed = true;
      stateKeys = Object.keys(parsed).slice(0, 25);
      statePreview = JSON.stringify(parsed).slice(0, 360);
    }
  } catch {
    // Ignore parse errors in probe mode.
  }

  return {
    ok: response.ok,
    status: response.status,
    htmlLength: html.length,
    markers,
    snippet,
    stateParsed,
    stateKeys,
    statePreview,
  };
}

async function probeBigBasketHtml() {
  const response = await fetch('https://www.bigbasket.com/ps/?q=milk');
  const html = await response.text();

  const markerHits = {
    productInfo: html.includes('product_info'),
    productId: html.includes('product_id'),
    listingSvc: html.includes('listing-svc'),
    sku: html.includes('sku'),
    sellingPrice: html.includes('selling_price'),
    mrp: html.includes('"mrp"'),
  };

  const productIdIdx = html.indexOf('product_id');
  const productSnippet =
    productIdIdx >= 0 ? html.slice(Math.max(0, productIdIdx - 180), productIdIdx + 380) : null;

  const marker = '<script id="__NEXT_DATA__" type="application/json">';
  const start = html.indexOf(marker);
  if (start < 0) {
    return {
      ok: response.ok,
      status: response.status,
      hasNextData: false,
      htmlLength: html.length,
    };
  }

  const end = html.indexOf('</script>', start + marker.length);
  const payload = html.slice(start + marker.length, end);
  let pageProps = null;
  try {
    const parsed = JSON.parse(payload);
    pageProps = parsed?.props?.pageProps ?? null;
  } catch {
    pageProps = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    hasNextData: true,
    htmlLength: html.length,
    markerHits,
    productSnippet,
    pagePropsKeys: pageProps ? Object.keys(pageProps).slice(0, 20) : [],
    pagePropsPreview: pageProps ? JSON.stringify(pageProps).slice(0, 320) : null,
  };
}

async function probeBlinkit() {
  const session = await getBlinkitCookieSession(USER_ID);
  if (!session?.cookieHeader) {
    return { ok: false, reason: 'no_cookie' };
  }

  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
    lat: '28.4595',
    lon: '77.0266',
    app_client: 'consumer_web',
    web_app_version: '2.0.0',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    cookie: session.cookieHeader,
  };

  const url = 'https://blinkit.com/v1/layout/search?q=milk&search_type=type_to_search';
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  const text = await response.text();

  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get('content-type'),
    preview: text.slice(0, 240),
  };
}

(async () => {
  const [blinkit, zepto, zeptoHtml, instamart, instamartHtml, bigbasketHtml] = await Promise.all([
    probeBlinkit(),
    probeZepto(),
    probeZeptoHtml(),
    probeInstamart(),
    probeInstamartHtml(),
    probeBigBasketHtml(),
  ]);

  console.log(
    JSON.stringify({ USER_ID, blinkit, zepto, zeptoHtml, instamart, instamartHtml, bigbasketHtml }, null, 2)
  );
})();
