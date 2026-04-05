// JioMart search — updated April 2026
// Trying multiple endpoint patterns for resilience

import { normaliseAll } from './normalise.js';

const TIMEOUT_MS = 15000;

export async function searchJioMart(query, location) {
  const pincode = location?.pincode ?? '201301';

  // Try multiple endpoint patterns
  const endpoints = [
    {
      url: `https://www.jiomart.com/search/${encodeURIComponent(query)}`,
      method: 'GET',
      isHtml: true,
    },
    {
      url: `https://www.jiomart.com/api/products/search/v2?q=${encodeURIComponent(query)}&pincode=${pincode}&page=1&category_id=`,
      method: 'GET',
      isHtml: false,
    },
    {
      url: `https://www.jiomart.com/api/search?query=${encodeURIComponent(query)}&pincode=${pincode}`,
      method: 'GET',
      isHtml: false,
    },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint.url, {
        method: endpoint.method,
        credentials: 'include',
        signal: controller.signal,
        headers: {
          'Accept': endpoint.isHtml ? 'text/html,application/json' : 'application/json',
        },
      });

      if (response.status === 401 || response.status === 403) {
        clearTimeout(timer);
        return { platform: 'jiomart', products: [], error: 'not_logged_in' };
      }
      if (!response.ok) continue;

      if (endpoint.isHtml) {
        // Parse product data from HTML page (often embedded as JSON in __NEXT_DATA__ or similar)
        const html = await response.text();
        const products = extractProductsFromHtml(html);
        if (products.length > 0) {
          clearTimeout(timer);
          return { platform: 'jiomart', products: normaliseAll('jiomart', products), error: null };
        }
        continue;
      }

      const data = await response.json();
      let rawProducts = data?.products ?? data?.data?.products ?? [];

      if (rawProducts.length > 0) {
        clearTimeout(timer);
        const products = normaliseAll('jiomart', rawProducts);
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

function extractProductsFromHtml(html) {
  try {
    // Try to find __NEXT_DATA__ or embedded JSON
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      const nextData = JSON.parse(nextDataMatch[1]);
      const products = nextData?.props?.pageProps?.products
        ?? nextData?.props?.pageProps?.searchResult?.products
        ?? [];
      return products;
    }

    // Try other embedded JSON patterns
    const jsonMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});/);
    if (jsonMatch) {
      const state = JSON.parse(jsonMatch[1]);
      return state?.search?.products ?? state?.products ?? [];
    }
  } catch {
    // JSON parsing failed
  }
  return [];
}
