// Blinkit search — updated April 2026
// New endpoint: POST /v1/layout/search (old /v2/search/ returns 404)
// Location headers: lat, lon sent as request headers
// Body: empty JSON object {}

import { normaliseAll } from './normalise.js';

const TIMEOUT_MS = 15000;

export async function searchBlinkit(query, location) {
  const { lat = 28.4595, lon = 77.0266 } = location ?? {};

  const url = new URL('https://blinkit.com/v1/layout/search');
  url.searchParams.set('q', query);
  url.searchParams.set('search_type', 'type_to_search');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      credentials: 'include',
      signal: controller.signal,
      headers: {
        'Accept':       'application/json',
        'Content-Type': 'application/json',
        'lat':          String(lat),
        'lon':          String(lon),
        'app_client':   'consumer_web',
        'web_app_version': '2.0.0',
      },
      body: JSON.stringify({}),
    });

    clearTimeout(timer);

    if (response.status === 401 || response.status === 403) {
      return { platform: 'blinkit', products: [], error: 'not_logged_in' };
    }
    if (!response.ok) {
      return { platform: 'blinkit', products: [], error: `HTTP ${response.status}` };
    }

    const data = await response.json();

    // New response structure: response.snippets[] → each snippet has data with product info
    let rawProducts = [];

    // Try new v1 layout format first
    const snippets = data?.response?.snippets ?? [];
    if (snippets.length > 0) {
      rawProducts = snippets
        .filter(s => s.data && (s.data.name || s.data.product_id))
        .map(s => ({
          id:           s.data.product_id ?? s.data.id,
          name:         s.data.name?.text ?? s.data.name ?? '',
          brand:        s.data.brand?.text ?? s.data.brand ?? null,
          image_url:    s.data.image?.url ?? s.data.image ?? null,
          sp:           parsePrice(s.data.normal_price?.text ?? s.data.price?.text ?? '0'),
          mrp:          parsePrice(s.data.mrp?.text ?? s.data.normal_price?.text ?? '0'),
          unit:         s.data.variant?.text ?? s.data.unit ?? '',
          in_stock:     s.data.is_in_stock !== false,
          eta_mins:     s.data.eta_tag?.title?.text ?? null,
        }));
    }

    // Fallback: try old format
    if (rawProducts.length === 0) {
      const oldProducts = data?.objects?.[0]?.data?.objects ?? [];
      rawProducts = oldProducts;
    }

    const products = normaliseAll('blinkit', rawProducts);
    return { platform: 'blinkit', products, error: null };

  } catch (err) {
    clearTimeout(timer);
    const error = err.name === 'AbortError' ? 'timeout' : err.message || 'network_error';
    return { platform: 'blinkit', products: [], error };
  }
}

function parsePrice(str) {
  if (typeof str === 'number') return str;
  if (!str) return 0;
  const match = String(str).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}
