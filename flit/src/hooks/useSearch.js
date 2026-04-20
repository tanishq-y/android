import { useState, useEffect, useCallback, useRef } from 'react';
import { unitPrice as computeUnitPrice } from '../utils/unitPrice';
import { getOrCreateDeviceUserId } from '../utils/deviceUserId';
import { apiUrl } from '../utils/apiUrl';
import { ensureDeviceAuthToken, getStoredDeviceAuthSession } from '../utils/deviceAuth.js';
import {
  isNativeDeviceSearchAvailable,
  startDeviceSearchInApp,
  getDeviceSearchStatusInApp,
  cancelDeviceSearchInApp,
} from '../utils/nativeBridge.js';

const DEFAULT_TOTAL_PLATFORMS = 5;
const DEVICE_STATUS_POLL_MS = 350;
const NATIVE_PLATFORM_IDS = ['blinkit', 'zepto', 'instamart'];
const NATIVE_PLATFORM_SET = new Set(NATIVE_PLATFORM_IDS);
const ENABLE_NATIVE_DEVICE_SEARCH = String(import.meta.env.VITE_ENABLE_NATIVE_DEVICE_SEARCH ?? 'true')
  .trim()
  .toLowerCase() === 'true';

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

function normalizePlatforms(connectedPlatforms) {
  if (!Array.isArray(connectedPlatforms)) return [];

  return connectedPlatforms
    .map((value) => String(value ?? '').trim().toLowerCase())
    .filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function shouldUseNativeFallbackFromBackend(payload) {
  if (!payload || typeof payload !== 'object') return false;

  const results = Array.isArray(payload?.results) ? payload.results : [];
  const fallbackUsed = Boolean(payload?.fallbackUsed);
  const fallbackReason = String(payload?.fallbackReason ?? '').trim().toLowerCase();

  if (results.length > 0 && !(fallbackUsed && fallbackReason === 'all_platform_errors')) {
    return false;
  }

  const statusMap = payload?.platformStatus && typeof payload.platformStatus === 'object'
    ? payload.platformStatus
    : {};

  const statuses = Object.entries(statusMap)
    .filter(([platform]) => platform !== 'synthetic_fallback')
    .map(([, value]) => String(value ?? '').trim().toLowerCase())
    .filter(Boolean);

  if (statuses.length === 0) {
    return fallbackUsed || results.length === 0;
  }

  return statuses.every((status) => status === 'not_connected' || status.startsWith('error'));
}

function getNativeCandidatePlatforms(requestedPlatforms) {
  if (!Array.isArray(requestedPlatforms) || requestedPlatforms.length === 0) {
    return [...NATIVE_PLATFORM_IDS];
  }

  return requestedPlatforms.filter((platform) => NATIVE_PLATFORM_SET.has(platform));
}

function isRecoverablePlatformStatus(statusValue) {
  const status = String(statusValue ?? '').trim().toLowerCase();
  if (!status) return false;

  return status === 'not_connected' || status.startsWith('error');
}

function productIdentity(product, index) {
  const id = String(product?.id ?? '').trim();
  if (id) return id;

  const platform = String(product?.platform ?? '').trim().toLowerCase();
  const name = String(product?.name ?? '').trim().toLowerCase();
  const price = Number(product?.price ?? 0);
  return `${platform}:${name}:${Number.isFinite(price) ? price : 0}:${index}`;
}

function mergeProducts(baseProducts, nativeProducts) {
  const merged = [];
  const seen = new Set();

  const pushUnique = (products) => {
    products.forEach((product, index) => {
      if (!product || typeof product !== 'object') return;

      const identity = productIdentity(product, index);
      if (seen.has(identity)) return;

      seen.add(identity);
      merged.push(product);
    });
  };

  pushUnique(Array.isArray(baseProducts) ? baseProducts : []);
  pushUnique(Array.isArray(nativeProducts) ? nativeProducts : []);

  return merged;
}

function mergeSearchPayloads(backendPayload, nativePayload, requestedPlatforms) {
  if (!nativePayload || typeof nativePayload !== 'object') {
    return backendPayload;
  }

  const backendResults = Array.isArray(backendPayload?.results) ? backendPayload.results : [];
  const nativeResults = Array.isArray(nativePayload?.results) ? nativePayload.results : [];
  const nativeHasResults = nativeResults.length > 0;

  const backendBaseResults = nativeHasResults
    ? backendResults.filter((item) => !String(item?.id ?? '').startsWith('synthetic:'))
    : backendResults;

  const mergedPlatformStatus = {
    ...(backendPayload?.platformStatus && typeof backendPayload.platformStatus === 'object'
      ? backendPayload.platformStatus
      : {}),
    ...(nativePayload?.platformStatus && typeof nativePayload.platformStatus === 'object'
      ? nativePayload.platformStatus
      : {}),
  };

  if (nativeHasResults && mergedPlatformStatus.synthetic_fallback) {
    delete mergedPlatformStatus.synthetic_fallback;
  }

  const inferredTotal = Array.isArray(requestedPlatforms) && requestedPlatforms.length > 0
    ? requestedPlatforms.length
    : Math.max(
      toNonNegativeNumber(backendPayload?.totalPlatforms, 0),
      toNonNegativeNumber(nativePayload?.totalPlatforms, 0),
      DEFAULT_TOTAL_PLATFORMS
    );

  const resolvedFromStatus = Object.keys(mergedPlatformStatus)
    .filter((platform) => platform !== 'synthetic_fallback')
    .length;

  const mergedResolved = Math.max(
    toNonNegativeNumber(backendPayload?.resolved, 0),
    toNonNegativeNumber(nativePayload?.resolved, 0),
    resolvedFromStatus
  );

  const fallbackUsed = nativeHasResults
    ? false
    : Boolean(nativePayload?.fallbackUsed ?? backendPayload?.fallbackUsed);

  const fallbackReason = fallbackUsed
    ? String(nativePayload?.fallbackReason ?? backendPayload?.fallbackReason ?? 'none')
    : 'none';

  const backendConnectionHints =
    backendPayload?.connectionHints && typeof backendPayload.connectionHints === 'object'
      ? backendPayload.connectionHints
      : null;

  const nativeConnectionHints =
    nativePayload?.connectionHints && typeof nativePayload.connectionHints === 'object'
      ? nativePayload.connectionHints
      : null;

  const backendSearchDiagnostics =
    backendPayload?.searchDiagnostics && typeof backendPayload.searchDiagnostics === 'object'
      ? backendPayload.searchDiagnostics
      : null;

  const nativeSearchDiagnostics =
    nativePayload?.searchDiagnostics && typeof nativePayload.searchDiagnostics === 'object'
      ? nativePayload.searchDiagnostics
      : null;

  return {
    ...(backendPayload && typeof backendPayload === 'object' ? backendPayload : {}),
    ...(nativePayload && typeof nativePayload === 'object' ? nativePayload : {}),
    results: mergeProducts(backendBaseResults, nativeResults),
    platformStatus: mergedPlatformStatus,
    resolved: mergedResolved,
    totalPlatforms: inferredTotal,
    fallbackUsed,
    fallbackReason,
    connectionHints: backendConnectionHints ?? nativeConnectionHints ?? {},
    searchDiagnostics: backendSearchDiagnostics ?? nativeSearchDiagnostics,
  };
}

function createEmptyDebugInfo() {
  return {
    query: '',
    requestedPlatforms: [],
    mode: 'idle',
    backend: {
      attempted: false,
      resultCount: 0,
      fallbackUsed: false,
      fallbackReason: 'none',
      platformStatus: {},
      error: null,
    },
    native: {
      available: false,
      primaryEnabled: false,
      rescueFallback: false,
      candidatePlatforms: [],
      recoverablePlatforms: [],
      attempted: false,
      attemptedPlatforms: [],
      status: 'not_started',
      resultCount: 0,
      error: null,
    },
    merged: {
      applied: false,
      resultCount: 0,
      platformStatus: {},
    },
    error: null,
  };
}

export function useSearch(query, loc, _connectedPlatforms) {
  const userIdRef = useRef(getOrCreateDeviceUserId());
  const activeQueryRef = useRef('');
  const activeRunIdRef = useRef(0);
  const activeJobIdRef = useRef(null);

  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [resolved, setResolved] = useState(0);
  const [totalPlatforms, setTotalPlatforms] = useState(DEFAULT_TOTAL_PLATFORMS);
  const [platformStatus, setPlatformStatus] = useState({});
  const [fallbackUsed, setFallbackUsed] = useState(false);
  const [fallbackReason, setFallbackReason] = useState('none');
  const [connectionHints, setConnectionHints] = useState({});
  const [searchDiagnostics, setSearchDiagnostics] = useState(null);
  const [debugInfo, setDebugInfo] = useState(() => createEmptyDebugInfo());

  const applySnapshot = useCallback((payload, expectedQuery) => {
    if (activeQueryRef.current !== expectedQuery) {
      return;
    }

    const items = (payload?.results ?? [])
      .map((item) => {
        try {
          return enrichProduct(item);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    setResults(items);
    setPlatformStatus(payload?.platformStatus ?? {});
    setResolved(toNonNegativeNumber(payload?.resolved, 0));
    setTotalPlatforms(toNonNegativeNumber(payload?.totalPlatforms, DEFAULT_TOTAL_PLATFORMS));
    setFallbackUsed(Boolean(payload?.fallbackUsed));
    setFallbackReason(String(payload?.fallbackReason ?? 'none'));
    setConnectionHints(payload?.connectionHints && typeof payload.connectionHints === 'object'
      ? payload.connectionHints
      : {}
    );
    setSearchDiagnostics(payload?.searchDiagnostics && typeof payload.searchDiagnostics === 'object'
      ? payload.searchDiagnostics
      : null
    );
  }, []);

  const runBackendSearch = useCallback(async (q, location, platforms, runId) => {
    const token = await ensureDeviceAuthToken(userIdRef.current);
    const authSession = getStoredDeviceAuthSession(userIdRef.current);
    const headerUserId = String(authSession?.authUserId ?? '').trim();
    const requestHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };

    if (headerUserId) {
      requestHeaders['x-flit-user-id'] = headerUserId;
    }

    const response = await fetch(apiUrl('/api/search'), {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({
        query: q,
        lat: location?.lat ?? null,
        lon: location?.lon ?? null,
        platforms,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error ?? `Server search failed: HTTP ${response.status}`);
    }

    if (activeRunIdRef.current !== runId) {
      return null;
    }

    applySnapshot(data, q);
    return data;
  }, [applySnapshot]);

  const cancelActiveNativeJob = useCallback(async () => {
    const jobId = activeJobIdRef.current;
    if (!jobId) {
      return;
    }

    activeJobIdRef.current = null;

    try {
      await cancelDeviceSearchInApp(jobId);
    } catch {
      // Best effort cleanup when query changes or component unmounts.
    }
  }, []);

  const runNativeSearch = useCallback(async (q, location, platforms, runId) => {
    const startPayload = await startDeviceSearchInApp({
      query: q,
      lat: location?.lat ?? null,
      lon: location?.lon ?? null,
      platforms,
    });

    const jobId = String(startPayload?.jobId ?? '').trim();
    if (!jobId) {
      throw new Error('native_job_id_missing');
    }

    if (activeRunIdRef.current !== runId) {
      try {
        await cancelDeviceSearchInApp(jobId);
      } catch {
        // Ignore cleanup errors for stale runs.
      }
      return null;
    }

    activeJobIdRef.current = jobId;
    let latestPayload = startPayload;

    while (activeRunIdRef.current === runId) {
      const statusPayload = await getDeviceSearchStatusInApp(jobId);
      latestPayload = statusPayload;

      if (activeRunIdRef.current !== runId) {
        break;
      }

      const jobStatus = String(statusPayload?.status ?? '').toLowerCase();
      if (jobStatus === 'completed' || jobStatus === 'cancelled') {
        return latestPayload;
      }

      if (jobStatus === 'error') {
        throw new Error(statusPayload?.error ?? 'native_search_error');
      }

      await sleep(DEVICE_STATUS_POLL_MS);
    }

    return latestPayload;
  }, []);

  const run = useCallback(async (q, location) => {
    if (!q?.trim()) return;

    const trimmedQuery = q.trim();
    const runId = activeRunIdRef.current + 1;
    activeRunIdRef.current = runId;
    await cancelActiveNativeJob();

    const requestedPlatforms = normalizePlatforms(_connectedPlatforms);
    const initialTotal = requestedPlatforms.length > 0
      ? requestedPlatforms.length
      : DEFAULT_TOTAL_PLATFORMS;
    const nativeCandidatePlatforms = getNativeCandidatePlatforms(requestedPlatforms);
    const nativeAvailable = isNativeDeviceSearchAvailable();
    const nativePrimaryEnabled = ENABLE_NATIVE_DEVICE_SEARCH && nativeAvailable;

    const updateDebugInfo = (updater) => {
      if (activeRunIdRef.current !== runId || activeQueryRef.current !== trimmedQuery) {
        return;
      }

      setDebugInfo((prev) => {
        if (typeof updater === 'function') {
          return updater(prev);
        }
        return updater;
      });
    };

    setResults([]);
    setResolved(0);
    setTotalPlatforms(initialTotal);
    setPlatformStatus({});
    setFallbackUsed(false);
    setFallbackReason('none');
    setConnectionHints({});
    setSearchDiagnostics(null);
    setLoading(true);
    activeQueryRef.current = trimmedQuery;
    setDebugInfo({
      query: trimmedQuery,
      requestedPlatforms,
      mode: 'running',
      backend: {
        attempted: false,
        resultCount: 0,
        fallbackUsed: false,
        fallbackReason: 'none',
        platformStatus: {},
        error: null,
      },
      native: {
        available: nativeAvailable,
        primaryEnabled: nativePrimaryEnabled,
        rescueFallback: false,
        candidatePlatforms: nativeCandidatePlatforms,
        recoverablePlatforms: [],
        attempted: false,
        attemptedPlatforms: [],
        status: 'not_started',
        resultCount: 0,
        error: null,
      },
      merged: {
        applied: false,
        resultCount: 0,
        platformStatus: {},
      },
      error: null,
    });

    try {
      const backendResult = await runBackendSearch(trimmedQuery, location, requestedPlatforms, runId);

      updateDebugInfo((prev) => ({
        ...prev,
        mode: 'backend_done',
        backend: {
          attempted: true,
          resultCount: Array.isArray(backendResult?.results) ? backendResult.results.length : 0,
          fallbackUsed: Boolean(backendResult?.fallbackUsed),
          fallbackReason: String(backendResult?.fallbackReason ?? 'none'),
          platformStatus:
            backendResult?.platformStatus && typeof backendResult.platformStatus === 'object'
              ? backendResult.platformStatus
              : {},
          error: null,
        },
        merged: {
          applied: false,
          resultCount: Array.isArray(backendResult?.results) ? backendResult.results.length : 0,
          platformStatus:
            backendResult?.platformStatus && typeof backendResult.platformStatus === 'object'
              ? backendResult.platformStatus
              : {},
        },
      }));

      const nativeRescueFallback = nativeAvailable && shouldUseNativeFallbackFromBackend(backendResult);
      const backendPlatformStatus =
        backendResult?.platformStatus && typeof backendResult.platformStatus === 'object'
          ? backendResult.platformStatus
          : {};
      const recoverableNativePlatforms = nativeCandidatePlatforms.filter((platform) =>
        isRecoverablePlatformStatus(backendPlatformStatus[platform])
      );
      const shouldAttemptNative =
        nativeCandidatePlatforms.length > 0
        && (nativePrimaryEnabled || nativeRescueFallback || recoverableNativePlatforms.length > 0);

      updateDebugInfo((prev) => ({
        ...prev,
        native: {
          ...prev.native,
          rescueFallback: nativeRescueFallback,
          recoverablePlatforms: recoverableNativePlatforms,
        },
      }));

      if (shouldAttemptNative) {
        const nativePlatforms = nativePrimaryEnabled || nativeRescueFallback
          ? nativeCandidatePlatforms
          : recoverableNativePlatforms;

        updateDebugInfo((prev) => ({
          ...prev,
          mode: 'native_running',
          native: {
            ...prev.native,
            attempted: true,
            attemptedPlatforms: nativePlatforms,
            status: 'running',
            error: null,
          },
        }));

        try {
          const nativeResult = await runNativeSearch(trimmedQuery, location, nativePlatforms, runId);
          if (nativeResult && activeRunIdRef.current === runId && activeQueryRef.current === trimmedQuery) {
            const mergedPayload = mergeSearchPayloads(backendResult, nativeResult, requestedPlatforms);
            applySnapshot(mergedPayload, trimmedQuery);

            updateDebugInfo((prev) => ({
              ...prev,
              mode: 'completed',
              native: {
                ...prev.native,
                status: 'completed',
                resultCount: Array.isArray(nativeResult?.results) ? nativeResult.results.length : 0,
                error: null,
              },
              merged: {
                applied: true,
                resultCount: Array.isArray(mergedPayload?.results) ? mergedPayload.results.length : 0,
                platformStatus:
                  mergedPayload?.platformStatus && typeof mergedPayload.platformStatus === 'object'
                    ? mergedPayload.platformStatus
                    : {},
              },
            }));
          }
        } catch (nativeError) {
          // Keep backend snapshot if native rescue/backfill fails.
          updateDebugInfo((prev) => ({
            ...prev,
            mode: 'completed',
            native: {
              ...prev.native,
              status: 'error',
              error: nativeError?.message ?? 'native_search_error',
            },
          }));
        }
      } else {
        updateDebugInfo((prev) => ({
          ...prev,
          mode: 'completed',
        }));
      }
    } catch (backendError) {
      updateDebugInfo((prev) => ({
        ...prev,
        mode: 'backend_error',
        backend: {
          ...prev.backend,
          attempted: true,
          error: backendError?.message ?? 'backend_search_failed',
        },
        error: backendError?.message ?? 'backend_search_failed',
      }));

      if (nativeAvailable && nativeCandidatePlatforms.length > 0) {
        updateDebugInfo((prev) => ({
          ...prev,
          mode: 'native_running',
          native: {
            ...prev.native,
            attempted: true,
            attemptedPlatforms: nativeCandidatePlatforms,
            status: 'running',
            error: null,
          },
        }));

        try {
          const nativeOnlyResult = await runNativeSearch(trimmedQuery, location, nativeCandidatePlatforms, runId);
          if (nativeOnlyResult && activeRunIdRef.current === runId && activeQueryRef.current === trimmedQuery) {
            applySnapshot(nativeOnlyResult, trimmedQuery);

            updateDebugInfo((prev) => ({
              ...prev,
              mode: 'completed',
              native: {
                ...prev.native,
                status: 'completed',
                resultCount: Array.isArray(nativeOnlyResult?.results) ? nativeOnlyResult.results.length : 0,
                error: null,
              },
              merged: {
                applied: true,
                resultCount: Array.isArray(nativeOnlyResult?.results) ? nativeOnlyResult.results.length : 0,
                platformStatus:
                  nativeOnlyResult?.platformStatus && typeof nativeOnlyResult.platformStatus === 'object'
                    ? nativeOnlyResult.platformStatus
                    : {},
              },
            }));
            return;
          }
        } catch (nativeOnlyError) {
          // Fall through to generic failure state.
          updateDebugInfo((prev) => ({
            ...prev,
            mode: 'failed',
            native: {
              ...prev.native,
              status: 'error',
              error: nativeOnlyError?.message ?? 'native_search_error',
            },
          }));
        }
      }

      if (activeRunIdRef.current === runId && activeQueryRef.current === trimmedQuery) {
        setResolved(initialTotal);
        setTotalPlatforms(initialTotal);
        setFallbackUsed(false);
        setFallbackReason('none');

        updateDebugInfo((prev) => ({
          ...prev,
          mode: 'failed',
        }));
      }
    } finally {
      if (activeJobIdRef.current && activeRunIdRef.current !== runId) {
        await cancelActiveNativeJob();
      }

      if (activeRunIdRef.current === runId && activeQueryRef.current === trimmedQuery) {
        activeJobIdRef.current = null;
        setLoading(false);
      }
    }
  }, [_connectedPlatforms, applySnapshot, cancelActiveNativeJob, runBackendSearch, runNativeSearch]);

  useEffect(() => {
    return () => {
      activeRunIdRef.current += 1;
      cancelActiveNativeJob();
    };
  }, [cancelActiveNativeJob]);

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
    totalPlatforms,
    platformStatus,
    fallbackUsed,
    fallbackReason,
    connectionHints,
    searchDiagnostics,
    debugInfo,
    refetch,
  };
}