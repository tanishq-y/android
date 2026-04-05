// Instamart (Swiggy) search — updated April 2026
// New endpoint: POST /api/instamart/search/v2 (old GET /api/instamart/search returns 404)
// Now requires POST with JSON body including query and page_type
// Results in data.cards[] → look for ItemCollectionCard types

import { normaliseAll } from './normalise.js';

const TIMEOUT_MS = 15000;

export async function searchInstamart(query, location) {
  const { lat = 28.4595, lon = 77.0266 } = location ?? {};

  // The v2 endpoint needs storeId — try without it first but include location cookies
  const url = new URL('https://www.swiggy.com/api/instamart/search/v2');
  url.searchParams.set('offset', '0');
  url.searchParams.set('ageConsent', 'false');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      credentials: 'include',    // sends session cookies including lat/lng
      signal: controller.signal,
      headers: {
        'Accept':          'application/json',
        'Content-Type':    'application/json',
      },
      body: JSON.stringify({
        facets: [],
        sortAttribute: '',
        query: query,
        search_results_offset: '0',
        page_type: 'INSTAMART_PRE_SEARCH_PAGE',
        is_pre_search_tag: false,
      }),
    });

    clearTimeout(timer);

    if (response.status === 401 || response.status === 403) {
      return { platform: 'instamart', products: [], error: 'not_logged_in' };
    }
    if (!response.ok) {
      return { platform: 'instamart', products: [], error: `HTTP ${response.status}` };
    }

    const data = await response.json();

    // New v2 response: data.cards[] → look for product cards
    let rawProducts = [];

    const cards = data?.data?.cards ?? [];
    for (const card of cards) {
      // Look for GridWidget with ItemCollectionCard
      const gridElements = card?.gridElements?.infoWithStyle?.info ?? [];
      if (gridElements.length > 0) {
        for (const item of gridElements) {
          rawProducts.push({
            product_id:   item.id ?? item.productId,
            display_name: item.displayName ?? item.name ?? '',
            brand_name:   item.brand ?? null,
            offer_price:  item.price?.offerPrice?.units ?? item.price?.mrp?.units ?? 0,
            total_mrp:    item.price?.mrp?.units ?? 0,
            weight:       item.quantityDescription ?? item.quantity ?? '',
            img_url:      item.imageIds?.[0]
              ? `https://media-assets.swiggy.com/swiggy/image/upload/${item.imageIds[0]}`
              : null,
            in_stock:     item.inventory?.inStock !== false,
            eta:          null,
          });
        }
      }
    }

    // Fallback: try old response shape
    if (rawProducts.length === 0) {
      const widgets = data?.data?.widgets ?? [];
      const productWidget = widgets.find(w => w.type === 'PRODUCT_GRID');
      rawProducts = productWidget?.data ?? [];
    }

    const products = normaliseAll('instamart', rawProducts);
    return { platform: 'instamart', products, error: null };

  } catch (err) {
    clearTimeout(timer);
    const error = err.name === 'AbortError' ? 'timeout' : err.message || 'network_error';
    return { platform: 'instamart', products: [], error };
  }
}
