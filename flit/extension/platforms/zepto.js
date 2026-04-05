// Zepto search — updated April 2026
// Domain changed: zeptonow.com → zepto.com
// New endpoint: POST https://bff-gateway.zepto.com/user-search-service/api/v3/search
// Old endpoint api.zeptonow.com/api/v4/search/ returns "Failed to fetch"
// Price is in paise (divide by 100 for rupees)

import { normaliseAll } from './normalise.js';

const TIMEOUT_MS = 15000;
const API_BASE   = 'https://bff-gateway.zepto.com';

export async function searchZepto(query, location) {
  const { lat = 28.4595, lon = 77.0266 } = location ?? {};

  // Try to get stored token
  const stored = await chrome.storage.local.get('zepto_token').catch(() => ({}));
  const token  = stored.zepto_token ?? null;

  // Try to get storeId from storage (set by content script on zepto.com)
  const storeData = await chrome.storage.local.get('zepto_store_id').catch(() => ({}));
  const storeId   = storeData.zepto_store_id ?? null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const headers = {
    'Accept':       'application/json',
    'Content-Type': 'application/json',
    'platform':     'WEB',
    'app-version':  '1.0.0',
  };

  if (storeId) {
    headers['store_id'] = storeId;
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${API_BASE}/user-search-service/api/v3/search`, {
      method: 'POST',
      credentials: 'include',
      signal: controller.signal,
      headers,
      body: JSON.stringify({
        query,
        pageNumber: 0,
        mode:       'AUTOSUGGEST',
      }),
    });

    clearTimeout(timer);

    if (response.status === 401 || response.status === 403) {
      return { platform: 'zepto', products: [], error: 'not_logged_in' };
    }
    if (!response.ok) {
      return { platform: 'zepto', products: [], error: `HTTP ${response.status}` };
    }

    const data = await response.json();

    // New response: layout[] → find widget with PRODUCT_GRID → data.resolver.data.items[]
    let rawProducts = [];

    const layout = data?.layout ?? [];
    const productGrid = layout.find(w => w.widgetId === 'PRODUCT_GRID' || w.type === 'PRODUCT_GRID');
    if (productGrid) {
      const items = productGrid?.data?.resolver?.data?.items ?? [];
      rawProducts = items.map(item => {
        const pr = item.productResponse ?? {};
        const product = pr.product ?? pr;
        const variant = pr.productVariant ?? product.productVariant ?? {};
        return {
          id:                    product.id ?? product.productId ?? item.id,
          name:                  product.name ?? '',
          brand:                 product.brand?.name ?? product.brand ?? null,
          imagePath:             product.images?.[0]?.path ?? variant.images?.[0]?.path ?? null,
          // Price is in paise, convert to rupees
          sellingPrice:          (pr.sellingPrice ?? pr.discountedSellingPrice ?? 0) / 100,
          mrp:                   (pr.mrp ?? product.mrp ?? 0) / 100,
          unitString:            variant.formattedPacksize ?? variant.packSize ?? '',
          etaInMins:             pr.etaInMins ?? null,
          availabilityStatus:    pr.availabilityStatus ?? 'AVAILABLE',
        };
      });
    }

    // Fallback: try old response shape
    if (rawProducts.length === 0) {
      const oldItems = data?.data?.sections?.[0]?.items ?? [];
      rawProducts = oldItems;
    }

    const products = normaliseAll('zepto', rawProducts);
    return { platform: 'zepto', products, error: null };

  } catch (err) {
    clearTimeout(timer);
    const error = err.name === 'AbortError' ? 'timeout' : err.message || 'network_error';
    return { platform: 'zepto', products: [], error };
  }
}
