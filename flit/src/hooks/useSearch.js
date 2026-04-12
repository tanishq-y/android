import { useState, useEffect, useCallback, useRef } from 'react';
import { unitPrice as computeUnitPrice } from '../utils/unitPrice';
import { getOrCreateDeviceUserId } from '../utils/deviceUserId';
import { apiUrl } from '../utils/apiUrl';

const TOTAL_PLATFORMS = 5;

function enrichProduct(item) {
  const qty = item.quantity || item.unit || '';
  return {
    ...item,
    quantity: qty,
    brand: item.brand ?? '',
    unitPrice: item.unitPrice != null ? item.unitPrice : computeUnitPrice(item.price, qty),
    deliveryEta: String(item.deliveryEta ?? '999'),
    deliveryFee: Number(item.deliveryFee ?? 0),
  };
}

export function useSearch(query, loc, _connectedPlatforms) {
  const userIdRef = useRef(getOrCreateDeviceUserId());
  const activeQuery = useRef('');

  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [resolved, setResolved] = useState(0);
  const [platformStatus, setPlatformStatus] = useState({});
  const [fallbackUsed, setFallbackUsed] = useState(false);

  const run = useCallback(async (q, location) => {
    if (!q?.trim()) return;

    setResults([]);
    setResolved(0);
    setPlatformStatus({});
    setFallbackUsed(false);
    setLoading(true);
    activeQuery.current = q;

    try {
      const response = await fetch(apiUrl('/api/search'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-flit-user-id': userIdRef.current,
        },
        body: JSON.stringify({
          query: q.trim(),
          lat: location?.lat ?? null,
          lon: location?.lon ?? null,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? `Server search failed: HTTP ${response.status}`);
      }

      if (activeQuery.current !== q) return;

      const items = (data.results ?? [])
        .map((item) => {
          try {
            return enrichProduct(item);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      setPlatformStatus(data.platformStatus ?? {});
      setResolved(data.resolved ?? TOTAL_PLATFORMS);
      setFallbackUsed(Boolean(data.fallbackUsed));
      setResults(items);
    } catch {
      if (activeQuery.current === q) {
        setResolved(TOTAL_PLATFORMS);
        setFallbackUsed(false);
      }
    } finally {
      if (activeQuery.current === q) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (query) {
      run(query, loc);
    }
  }, [loc, query, run]);

  const refetch = useCallback(() => run(query, loc), [run, query, loc]);

  return {
    results,
    loading,
    resolved,
    totalPlatforms: TOTAL_PLATFORMS,
    platformStatus,
    fallbackUsed,
    refetch,
  };
}