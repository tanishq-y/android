// BigBasket search — updated April 2026
// Trying multiple endpoint patterns for resilience

import { normaliseAll } from './normalise.js';

const TIMEOUT_MS = 15000;

async function getCsrfToken() {
  try {
    const cookie = await chrome.cookies.get({
      url:  'https://www.bigbasket.com',
      name: 'csrftoken',
    });
    return cookie?.value ?? null;
  } catch {
    return null;
  }
}

export async function searchBigBasket(query, _location) {
  const csrf = await getCsrfToken();

  // Try multiple endpoint patterns — BigBasket changes these frequently
  const endpoints = [
    `https://www.bigbasket.com/listing-svc/v2/products?type=search&slug=${encodeURIComponent(query)}&page=1`,
    `https://www.bigbasket.com/api/v2/listing/?q=${encodeURIComponent(query)}&tab_type=["prd","brands","cats"]&spelling_correction=true`,
    `https://www.bigbasket.com/listing-svc/v2/products?type=search&query=${encodeURIComponent(query)}&page=1`,
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const headers = {
    'Accept':       'application/json',
    'Content-Type': 'application/json',
  };
  if (csrf) {
    headers['X-CSRFToken'] = csrf;
  }

  for (const url of endpoints) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        signal: controller.signal,
        headers,
      });

      if (response.status === 401 || response.status === 403) {
        clearTimeout(timer);
        return { platform: 'bigbasket', products: [], error: 'not_logged_in' };
      }

      if (!response.ok) {
        continue; // Try next endpoint
      }

      const data = await response.json();

      // Parse response — try multiple known structures
      let rawProducts = [];

      // Structure 1: listing-svc format
      if (data?.tabs?.[0]?.product_info?.products) {
        rawProducts = data.tabs[0].product_info.products;
      }
      // Structure 2: old api/v2 format
      else if (data?.tab_info) {
        const prdTab = data.tab_info.find(t => t.tab_type === 'prd');
        rawProducts = prdTab?.product_map ?? [];
      }
      // Structure 3: direct products array
      else if (Array.isArray(data?.products)) {
        rawProducts = data.products;
      }

      if (rawProducts.length > 0) {
        clearTimeout(timer);
        const products = normaliseAll('bigbasket', rawProducts);
        return { platform: 'bigbasket', products, error: null };
      }

    } catch (err) {
      if (err.name === 'AbortError') {
        clearTimeout(timer);
        return { platform: 'bigbasket', products: [], error: 'timeout' };
      }
      // Try next endpoint
      continue;
    }
  }

  clearTimeout(timer);
  return { platform: 'bigbasket', products: [], error: 'all_endpoints_failed' };
}
