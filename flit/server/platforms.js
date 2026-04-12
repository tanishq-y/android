// Server-side platform search modules
// These make direct HTTP requests from the Node.js server,
// using app-first authenticated sessions from the token vault.

// ─── BLINKIT ───────────────────────────────────────────────────────────────────

export async function searchBlinkit(query, lat = 28.4595, lon = 77.0266, sessionCookie = null) {
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

    if (sessionCookie) {
      headers.Cookie = sessionCookie;
    }

    const res = await fetch(url.toString(), {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: JSON.stringify({}),
    });
    clearTimeout(timer);

    if (!res.ok) {
      const error = sessionCookie && (res.status === 401 || res.status === 403)
        ? 'session_invalid'
        : `HTTP ${res.status}`;
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

export async function searchZepto(query, lat = 28.4595, lon = 77.0266, sessionCookie = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const apiAttempt = await searchZeptoViaApi(query, sessionCookie, controller.signal);
    if (apiAttempt.products.length > 0) {
      clearTimeout(timer);
      return { platform: 'zepto', products: apiAttempt.products, error: null };
    }

    // Live fallback: parse product cards from Zepto search HTML payload.
    // This keeps real results flowing even when BFF contracts or auth headers change.
    const htmlProducts = await searchZeptoViaHtml(query, sessionCookie, controller.signal);
    clearTimeout(timer);

    if (htmlProducts.length > 0) {
      return { platform: 'zepto', products: htmlProducts, error: null };
    }

    return { platform: 'zepto', products: [], error: apiAttempt.error ?? 'no_results' };
  } catch (err) {
    clearTimeout(timer);
    return { platform: 'zepto', products: [], error: err.name === 'AbortError' ? 'timeout' : err.message };
  }
}

async function searchZeptoViaApi(query, sessionCookie, signal) {
  const cookieMap = parseCookieHeader(sessionCookie);

  const headers = {
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'platform': 'WEB',
    'app-version': '1.0.0',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  };

  if (sessionCookie) {
    headers.Cookie = sessionCookie;
  }

  if (cookieMap.accessToken) {
    headers.Authorization = `Bearer ${cookieMap.accessToken}`;
  }

  const xsrfToken = cookieMap['XSRF-TOKEN'] ?? cookieMap.xsrfToken;
  if (xsrfToken) {
    headers['x-xsrf-token'] = xsrfToken;
    headers['x-csrf-token'] = xsrfToken;
  }

  if (cookieMap.device_id) headers['x-device-id'] = cookieMap.device_id;
  if (cookieMap.session_id) headers['x-session-id'] = cookieMap.session_id;
  if (cookieMap.unique_browser_id) headers['x-unique-browser-id'] = cookieMap.unique_browser_id;

  const endpoints = [
    'https://bff-gateway.zeptonow.com/user-search-service/api/v3/search',
    'https://bff-gateway.zepto.com/user-search-service/api/v3/search',
  ];

  let lastError = null;

  for (const endpoint of endpoints) {
    const res = await fetch(endpoint, {
      method: 'POST',
      signal,
      headers,
      body: JSON.stringify({ query, pageNumber: 0, mode: 'AUTOSUGGEST' }),
    });

    if (!res.ok) {
      lastError = sessionCookie && (res.status === 401 || res.status === 403)
        ? 'session_invalid'
        : `HTTP ${res.status}`;
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

  return { products: [], error: lastError };
}

async function searchZeptoViaHtml(query, sessionCookie, signal) {
  const headers = {
    'Accept': 'text/html',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  };

  if (sessionCookie) {
    headers.Cookie = sessionCookie;
  }

  const url = `https://www.zeptonow.com/search?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { method: 'GET', signal, headers });
  if (!res.ok) return [];

  const html = await res.text();
  const normalized = html.replace(/\\"/g, '"');

  const campaigns = [
    '"campaignName":"PRODUCT_GRID_01_WEB"',
    '"campaignName":"PRODUCT_GRID"',
    '"widget_name":"PRODUCT_GRID_01_WEB"',
    '"widget_id":"PRE_SEARCH_PRODUCT_GRID"',
  ];

  const merged = [];
  for (const marker of campaigns) {
    const markerIdx = normalized.indexOf(marker);
    if (markerIdx < 0) continue;

    const itemsKeyIdx = normalized.indexOf('"items":[', markerIdx);
    if (itemsKeyIdx < 0) continue;

    const itemsRaw = extractJsonArrayFromIndex(normalized, itemsKeyIdx + '"items":'.length);
    if (!itemsRaw) continue;

    const parsedItems = safeJsonParse(itemsRaw);
    if (!Array.isArray(parsedItems)) continue;

    for (const item of parsedItems) {
      const product = normaliseZeptoHtmlItem(item);
      if (product && product.price > 0 && product.name) {
        merged.push(product);
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
      return ranked.map((entry) => entry.product);
    }

    // If nothing matches the query terms, this block is likely a pre-search
    // recommendation widget rather than true search output.
    return [];
  }

  return dedupedProducts;
}

function normaliseZeptoApiItem(item) {
  const pr = item?.productResponse ?? item?.cardData ?? {};
  const product = pr.product ?? item?.product ?? {};
  const variant = pr.productVariant ?? product.productVariant ?? {};

  const productId = product.id ?? pr.id ?? item?.id;
  if (!productId) return null;

  const discounted = toRupees(pr.discountedSellingPrice ?? pr.sellingPrice ?? 0);
  const mrp = toRupees(pr.mrp ?? product.mrp ?? pr.sellingPrice ?? 0);

  return {
    id: `zepto:${productId}`,
    platform: 'zepto',
    name: product.name ?? pr.name ?? '',
    brand: product.brand?.name ?? pr.brandName ?? '',
    image:
      product.images?.[0]?.path
      ?? variant.images?.[0]?.path
      ?? pr.product?.images?.[0]?.path
      ?? null,
    price: discounted,
    mrp,
    discount: mrp > discounted ? Math.round(((mrp - discounted) / mrp) * 100) : null,
    quantity: variant.formattedPacksize ?? variant.packSize ?? pr.quantity ?? '',
    unitPrice: null,
    deliveryFee: 0,
    deliveryEta: pr.etaInMins ? `${pr.etaInMins} mins` : '10 mins',
    inStock: pr.availabilityStatus === 'AVAILABLE' || pr.outOfStock === false,
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

export async function searchBigBasket(query) {
  const endpoints = [
    `https://www.bigbasket.com/listing-svc/v2/products?type=search&slug=${encodeURIComponent(query)}&page=1`,
    `https://www.bigbasket.com/listing-svc/v2/products?type=search&query=${encodeURIComponent(query)}&page=1`,
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        },
      });
      if (!res.ok) continue;

      const data = await res.json();
      let raw = [];
      if (data?.tabs?.[0]?.product_info?.products) raw = data.tabs[0].product_info.products;
      else if (Array.isArray(data?.products)) raw = data.products;
      else if (data?.tab_info) {
        const prdTab = data.tab_info.find(t => t.tab_type === 'prd');
        raw = prdTab?.product_map ?? [];
      }

      if (raw.length > 0) {
        clearTimeout(timer);
        const products = raw.map(r => ({
          id: `bigbasket:${r.id ?? r.product_id}`,
          platform: 'bigbasket',
          name: r.desc ?? r.name ?? '',
          brand: r.brand?.name ?? '',
          image: r.img_url ?? null,
          price: r.sp ?? r.selling_price ?? 0,
          mrp: r.mrp ?? 0,
          discount: null,
          quantity: r.w ?? r.pack_desc ?? '',
          unitPrice: null,
          deliveryFee: 0,
          deliveryEta: '1-2 hrs',
          inStock: r.in_stock !== false,
          deepLink: `https://www.bigbasket.com/pd/${r.id ?? r.product_id}/`,
          platformColor: '#84C225',
        })).filter(p => p.price > 0 && p.name);
        return { platform: 'bigbasket', products, error: null };
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        clearTimeout(timer);
        return { platform: 'bigbasket', products: [], error: 'timeout' };
      }
      continue;
    }
  }
  clearTimeout(timer);
  return { platform: 'bigbasket', products: [], error: 'all_endpoints_failed' };
}

// ─── SWIGGY INSTAMART ──────────────────────────────────────────────────────────

export async function searchInstamart(query, lat = 28.4595, lon = 77.0266, sessionCookie = null) {
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

    if (sessionCookie) {
      headers.Cookie = sessionCookie;
    }

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
      const error = sessionCookie && (res.status === 401 || res.status === 403)
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

export async function searchJioMart(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  const endpoints = [
    `https://www.jiomart.com/api/products/search/v2?q=${encodeURIComponent(query)}&page=1`,
    `https://www.jiomart.com/api/search?query=${encodeURIComponent(query)}`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        },
      });
      if (!res.ok) continue;

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
      continue;
    }
  }
  clearTimeout(timer);
  return { platform: 'jiomart', products: [], error: 'all_endpoints_failed' };
}

// ─── HELPERS ───────────────────────────────────────────────────────────────────

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

function scoreSearchMatch(product, terms) {
  if (!product || !terms?.length) return 0;

  const haystack = `${product.name ?? ''} ${product.brand ?? ''}`.toLowerCase();
  if (!haystack) return 0;

  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += term.length;
    }
  }

  if (terms.length > 1 && haystack.includes(terms.join(' '))) {
    score += 5;
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
