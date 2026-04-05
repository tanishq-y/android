/**
 * Flit — background.js (Service Worker, MV3)
 *
 * Key fix: MV3 service workers are terminated by Chrome when idle.
 * During a FLIT_SEARCH we make 5 network fetches that can take 3-8s.
 * Without a keep-alive, Chrome kills the SW before sendResponse fires,
 * the message port closes, and the frontend gets lastError instead of results.
 *
 * Fix: setInterval calling chrome.storage.local.get every 4s keeps the SW
 * alive for the duration of the search, then clears itself.
 */

// ── Unit price helper (can't import from src/) ───────────────────────────────
function computeUnitPrice(price, unitStr) {
  if (!unitStr || !price) return null;
  const s = unitStr.toLowerCase().trim();
  const multi = s.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(ml|l\b|g\b|kg|gm)/);
  if (multi) {
    const base = toBase(parseFloat(multi[2]), multi[3]);
    return base > 0 ? price / (parseFloat(multi[1]) * base) : null;
  }
  const single = s.match(/(\d+(?:\.\d+)?)\s*(ml|l\b|g\b|kg|gm)/);
  if (single) {
    const base = toBase(parseFloat(single[1]), single[2].trim());
    return base > 0 ? price / base : null;
  }
  return null;
}
function toBase(val, unit) {
  if (unit === 'kg' || unit === 'l') return val * 1000;
  return val;
}

// ── Platform configs ─────────────────────────────────────────────────────────
const PLATFORMS = {

  blinkit: {
    search: (query, lat, lng) => ({
      url: `https://api.blinkit.com/v5/search/?q=${encodeURIComponent(query)}&lat=${lat}&lon=${lng}`,
      headers: {
        'Accept': 'application/json',
        'app_client': 'consumer_web',
        'app_version': '1000000',
        'web-app-version': '1000000',
      },
    }),
    parse: (json) => {
      const raw =
        json?.data?.objects?.[0]?.data?.products
        ?? json?.data?.objects?.flatMap(o => o?.data?.products ?? [])
        ?? [];
      return raw.map(p => {
        const qty = p.unit || p.weight || '';
        const price = Number(p.price) || 0;
        return {
          id: `blinkit-${p.id}`,
          name: p.name,
          brand: p.brand ?? '',
          quantity: qty,
          price,
          mrp: Number(p.mrp) || 0,
          unitPrice: computeUnitPrice(price, qty),
          image: p.images?.[0]?.thumbnail ?? p.images?.[0] ?? null,
          inStock: p.in_stock !== false,
          platform: 'blinkit',
          deliveryFee: 0,
          deliveryEta: '10',
          deepLink: `https://blinkit.com/prn/${p.product_slug}/prid/${p.id}`,
        };
      });
    },
  },

  zepto: {
    search: (query, lat, lng) => ({
      url: 'https://api.zeptonow.com/api/v4/search/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'app_version': '1059',
        'app_platform': 'web',
      },
      body: JSON.stringify({
        query,
        pageNumber: 0,
        pageSize: 20,
        latitude: lat,
        longitude: lng,
        mode: 'AUTOSUGGEST',
      }),
    }),
    parse: (json) => {
      const sections = json?.data?.sections ?? [];
      let raw = sections.flatMap(s =>
        s?.searchResultWidget?.data?.productData
        ?? s?.data?.products
        ?? s?.productData
        ?? []
      );
      if (!raw.length) raw = json?.data?.products ?? json?.products ?? [];
      return raw.map(p => {
        const rawPrice = Number(p.sellingPrice ?? p.price ?? 0);
        // Zepto returns paise (x100) for sellingPrice > 100
        const price = rawPrice > 500 ? rawPrice / 100 : rawPrice;
        const rawMrp = Number(p.mrp ?? p.maxRetailPrice ?? 0);
        const mrp = rawMrp > 500 ? rawMrp / 100 : rawMrp;
        const qty = p.quantity || p.unitQuantity || p.unit || '';
        return {
          id: `zepto-${p.productId ?? p.id}`,
          name: p.productName ?? p.name,
          brand: p.brand ?? p.brandName ?? '',
          quantity: qty,
          price,
          mrp,
          unitPrice: computeUnitPrice(price, qty),
          image: p.imageUrl ?? p.image ?? null,
          inStock: p.isRestocked !== false && p.outOfStock !== true,
          platform: 'zepto',
          deliveryFee: 0,
          deliveryEta: '10',
          deepLink: p.productId
            ? `https://www.zeptonow.com/product/${p.productSlug ?? p.productId}/${p.productId}`
            : 'https://www.zeptonow.com',
        };
      });
    },
  },

  instamart: {
    search: (query, lat, lng) => ({
      url: `https://api.swiggy.com/mapi/instamart/home?pageType=INSTAMART_SEARCH&searchQuery=${encodeURIComponent(query)}&lat=${lat}&lng=${lng}`,
      headers: { 'Accept': 'application/json', '_is_instamart': '1' },
    }),
    parse: (json) => {
      const cards = json?.data?.cards ?? [];
      const itemCards = cards
        .find(c =>
          c?.card?.card?.title === 'All items' ||
          c?.card?.card?.id    === 'instamart_search_all_items'
        )
        ?.card?.card?.itemCards
        ?? cards.flatMap(c => c?.card?.card?.itemCards ?? []);

      return itemCards.map(ic => {
        const p = ic?.card?.info ?? ic?.info ?? {};
        const rawPrice = p.price ?? p.defaultPrice ?? 0;
        const price = rawPrice > 500 ? rawPrice / 100 : rawPrice;
        const rawMrp = p.defaultPrice ?? p.mrp ?? rawPrice;
        const mrp = rawMrp > 500 ? rawMrp / 100 : rawMrp;
        const qty = p.unitInfo || p.itemAttribute?.unitInfo || p.quantity || '';
        return {
          id: `instamart-${p.id}`,
          name: p.name,
          brand: p.brand ?? '',
          quantity: qty,
          price,
          mrp,
          unitPrice: computeUnitPrice(price, qty),
          image: p.imageId
            ? `https://media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,h_300/${p.imageId}`
            : null,
          inStock: p.inStock !== false,
          platform: 'instamart',
          deliveryFee: 0,
          deliveryEta: '20',
          deepLink: 'https://www.swiggy.com/instamart',
        };
      });
    },
  },

  bigbasket: {
    search: (query) => ({
      url: `https://www.bigbasket.com/product/get-product-list/?type=auto_suggest&value=${encodeURIComponent(query)}&tab=PRODUCT`,
      headers: {
        'Accept': 'application/json',
        'x-channel': 'web',
        'x-requested-with': 'XMLHttpRequest',
      },
    }),
    parse: (json) => {
      const raw =
        json?.tabs?.[0]?.product?.products
        ?? json?.product?.products
        ?? json?.products
        ?? json?.data?.products
        ?? [];
      return raw.map(p => {
        const price = Number(p.sp ?? p.selling_price ?? p.price) || 0;
        const qty = p.w || p.pack || p.unit || '';
        return {
          id: `bigbasket-${p.id}`,
          name: p.desc ?? p.name,
          brand: p.brand ?? p.brand_name ?? '',
          quantity: qty,
          price,
          mrp: Number(p.mrp ?? p.market_price) || 0,
          unitPrice: computeUnitPrice(price, qty),
          image: p.image ?? p.imgUrl ?? null,
          inStock: p.is_oos !== true && p.outOfStock !== true,
          platform: 'bigbasket',
          deliveryFee: 0,
          deliveryEta: '60',
          deepLink: p.absolute_url
            ? `https://www.bigbasket.com${p.absolute_url}`
            : `https://www.bigbasket.com/ps/?q=${encodeURIComponent(p.desc ?? '')}`,
        };
      });
    },
  },

  jiomart: {
    search: (query) => ({
      url: `https://www.jiomart.com/catalogsearch/result/index/?q=${encodeURIComponent(query)}&is_bx_call=true`,
      headers: {
        'Accept': 'application/json',
        'x-requested-with': 'XMLHttpRequest',
        'x-source': 'web',
      },
    }),
    parse: (json) => {
      const raw =
        json?.data?.categories?.flatMap(c => c?.products ?? [])
        ?? json?.data?.products
        ?? json?.products
        ?? json?.items
        ?? json?.response?.data?.products
        ?? [];
      return raw.map(p => {
        const price = parseFloat(p.price?.specialPrice ?? p.price?.offerPrice ?? p.selling_price ?? 0) || 0;
        const mrp   = parseFloat(p.price?.regularPrice ?? p.mrp ?? price) || 0;
        const qty   = p.unit || p.netWeight || p.weight || '';
        return {
          id: `jiomart-${p.id ?? p.product_id}`,
          name: p.name ?? p.title,
          brand: p.brand ?? p.brand_name ?? '',
          quantity: qty,
          price,
          mrp,
          unitPrice: computeUnitPrice(price, qty),
          image: p.image ?? p.thumbnail ?? p.media_gallery?.[0]?.url ?? null,
          inStock: p.stockStatus !== 'OUT_OF_STOCK' && p.is_in_stock !== false,
          platform: 'jiomart',
          deliveryFee: 0,
          deliveryEta: '120',
          deepLink: p.url_path
            ? `https://www.jiomart.com${p.url_path}`
            : `https://www.jiomart.com/search#q=${encodeURIComponent(p.name ?? '')}`,
        };
      });
    },
  },
};

// ── Fetch one platform ────────────────────────────────────────────────────────
async function fetchPlatform(key, query, lat, lng) {
  const cfg = PLATFORMS[key];
  const req = cfg.search(query, lat, lng);
  try {
    const res = await fetch(req.url, {
      method: req.method || 'GET',
      headers: req.headers || {},
      body: req.body || undefined,
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json  = await res.json();
    const items = cfg.parse(json);
    console.log(`[Flit] ${key}: ${items.length} items`);
    return { platform: key, items, error: null };
  } catch (err) {
    console.warn(`[Flit] ${key} failed:`, err.message);
    return { platform: key, items: [], error: err.message };
  }
}

// ── Cookie-based login check ──────────────────────────────────────────────────
async function checkCookie(domain, pattern) {
  try {
    const cookies = await chrome.cookies.getAll({ domain });
    return cookies.some(c => pattern.test(c.name));
  } catch {
    return false;
  }
}

// ── Unified message handler ───────────────────────────────────────────────────
function handleMessage(message, _sender, sendResponse) {
  const type = message?.type;

  // Fast responses — no keep-alive needed
  if (type === 'FLIT_PING' || type === 'PING') {
    sendResponse({ type: 'FLIT_PONG', version: '2.0.0' });
    return true;
  }

  if (type === 'FLIT_SEARCH') {
    const { query, lat = 28.6139, lng = 77.2090 } = message;

    // ─── KEEP-ALIVE ──────────────────────────────────────────────────────────
    // Chrome MV3 service workers are terminated after ~30s of inactivity.
    // Network fetches alone don't count as "activity" — the SW can be killed
    // before our Promise resolves and sendResponse fires.
    // Calling chrome.storage.local.get every 4s keeps the event loop active.
    const keepAlive = setInterval(() => chrome.storage.local.get('_ka'), 4000);

    Promise.allSettled(
      Object.keys(PLATFORMS).map(key => fetchPlatform(key, query, lat, lng))
    ).then(settled => {
      clearInterval(keepAlive);
      const results = settled
        .filter(s => s.status === 'fulfilled')
        .map(s => s.value);
      console.log('[Flit] search done, total items:', results.reduce((n, r) => n + r.items.length, 0));
      sendResponse({ type: 'FLIT_RESULTS', results });
    }).catch(err => {
      clearInterval(keepAlive);
      console.error('[Flit] search crashed:', err);
      sendResponse({ type: 'FLIT_RESULTS', results: [] });
    });

    return true; // keep message port open for async sendResponse
  }

  if (type === 'FLIT_CHECK_LOGIN' || type === 'GET_STATUS') {
    Promise.all([
      checkCookie('blinkit.com',       /__bb_csrf_token|gr_1|__cf_bm|sid/),
      checkCookie('www.zeptonow.com',  /zepto-customer|accessToken|token|session/),
      checkCookie('www.swiggy.com',    /sid|_session_tid|swc/),
      checkCookie('www.bigbasket.com', /csrftoken|bb_wid/),
      checkCookie('www.jiomart.com',   /PHPSESSID|auth_token|user_token/),
    ]).then(([blinkit, zepto, instamart, bigbasket, jiomart]) => {
      const status = { blinkit, zepto, instamart, bigbasket, jiomart };
      sendResponse({
        type: type === 'GET_STATUS' ? 'STATUS' : 'FLIT_LOGIN_STATUS',
        status,
        platforms: status,
      });
    });
    return true;
  }

  return false;
}

chrome.runtime.onMessageExternal.addListener(handleMessage);
chrome.runtime.onMessage.addListener(handleMessage);

console.log('[Flit] background service worker ready ✓');