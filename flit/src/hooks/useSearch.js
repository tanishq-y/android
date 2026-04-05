/**
 * useSearch.js
 *
 * Sends FLIT_SEARCH to the extension and processes results.
 *
 * FIX LOG:
 *   - Extension now handles FLIT_SEARCH and returns { type: 'FLIT_RESULTS', results }
 *   - Each result item has shape: { platform, items: [...], error: string|null }
 *   - Added fallback acceptance of 'SEARCH_ALL_RESULT' type (from legacy SEARCH_ALL)
 *   - Fixed: results used to be called "products" but extension returns "items"
 *   - Added per-platform status tracking for the UI
 *   - Added detailed logging for debugging
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useExtension } from './useExtension';
import { unitPrice as computeUnitPrice } from '../utils/unitPrice';

const TOTAL_PLATFORMS = 5;

function enrichProduct(item) {
  const qty = item.quantity || item.unit || '';
  return {
    ...item,
    quantity:    qty,
    brand:       item.brand    ?? '',
    unitPrice:   item.unitPrice != null ? item.unitPrice : computeUnitPrice(item.price, qty),
    deliveryEta: String(item.deliveryEta ?? '999'),
    deliveryFee: Number(item.deliveryFee ?? 0),
  };
}

export function useSearch(query, loc) {
  const { sendMessage, status } = useExtension();

  const [results,          setResults]        = useState([]);
  const [loading,          setLoading]        = useState(false);
  const [resolved,         setResolved]       = useState(0);
  const [platformStatus,   setPlatformStatus] = useState({});
  const [extensionMissing, setExtMissing]     = useState(false);

  const activeQuery = useRef('');

  const run = useCallback(async (q, location) => {
    if (!q?.trim()) return;
    if (status === 'checking') return;
    if (status === 'missing') {
      setExtMissing(true);
      return;
    }

    setExtMissing(false);
    setResults([]);
    setResolved(0);
    setPlatformStatus({});
    setLoading(true);
    activeQuery.current = q;

    console.log('[Flit Search] Starting search for:', q, 'location:', location);

    try {
      const response = await sendMessage({
        type:  'FLIT_SEARCH',
        query: q.trim(),
        lat:   location?.lat ?? 28.6139,
        lng:   location?.lon ?? location?.lng ?? 77.2090,
      });

      if (activeQuery.current !== q) return;

      console.log('[Flit Search] Got response:', response?.type, response);

      // Accept both FLIT_RESULTS (new) and SEARCH_ALL_RESULT (legacy)
      if (!response || (response.type !== 'FLIT_RESULTS' && response.type !== 'SEARCH_ALL_RESULT')) {
        console.error('[Flit Search] Bad response type:', response?.type);
        throw new Error('Bad response from extension: ' + (response?.type ?? 'null'));
      }

      const statusMap = {};
      const allItems  = [];

      // Handle both response shapes:
      //   FLIT_RESULTS:      { results: [{ platform, items, error }] }
      //   SEARCH_ALL_RESULT: { results: [{ platform, products, error }] }
      const resultList = response.results ?? [];

      resultList.forEach(({ platform, items, products, error }) => {
        statusMap[platform] = error ? `error: ${error}` : 'ok';

        // Accept both "items" (new) and "products" (legacy)
        const productList = items ?? products ?? [];
        console.log(`[Flit Search] ${platform}: ${productList.length} products, error=${error ?? 'none'}`);

        productList.forEach(item => {
          try {
            allItems.push(enrichProduct(item));
          } catch (e) {
            console.warn(`[Flit Search] Failed to enrich product from ${platform}:`, e);
          }
        });
      });

      setPlatformStatus(statusMap);
      setResolved(resultList.length || TOTAL_PLATFORMS);
      setResults(allItems);

      console.log(`[Flit Search] Total: ${allItems.length} products from ${resultList.length} platforms`);

    } catch (err) {
      console.error('[Flit Search] Search error:', err.message);
      // ── CRITICAL FIX ────────────────────────────────────────────────────────
      // Without this, resolved stays 0 and allFailed in ResultsPage never fires.
      // The user sees a blank screen with a frozen "0/5 platforms searched" bar.
      // Setting resolved=TOTAL_PLATFORMS makes allFailed=true → shows error+retry.
      if (activeQuery.current === q) {
        setResolved(TOTAL_PLATFORMS);
      }
    } finally {
      if (activeQuery.current === q) setLoading(false);
    }
  }, [sendMessage, status]);

  useEffect(() => {
    if (query && status !== 'checking') {
      run(query, loc);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, status]);

  const refetch = useCallback(() => run(query, loc), [run, query, loc]);

  return {
    results,
    loading,
    resolved,
    totalPlatforms: TOTAL_PLATFORMS,
    platformStatus,
    extensionMissing,
    refetch,
  };
}