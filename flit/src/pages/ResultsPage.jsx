import { useState, useMemo, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence }       from 'framer-motion';
import { ArrowLeft, LayoutList, Grid2X2, SlidersHorizontal, AlertCircle } from 'lucide-react';

import SearchBar      from '../components/SearchBar.jsx';
import ResultCard     from '../components/ResultCard.jsx';
import BestDealBanner from '../components/BestDealBanner.jsx';
import SkeletonCard   from '../components/SkeletonCard.jsx';
import ErrorState     from '../components/ErrorState.jsx';

import { useSearch }   from '../hooks/useSearch.js';
import { useLocation } from '../hooks/useLocation.js';
import { useUser }     from '../hooks/useUser.js';
import { useToast }    from '../hooks/useToast.js';
import ToastContainer  from '../components/Toast.jsx';

import { PLATFORMS, PLATFORM_IDS } from '../data/platforms.js';
import {
  sortByUnitPrice,
  sortByPrice,
  sortByEta,
  filterByPlatform,
  filterInStock,
  findBestDeal,
} from '../utils/normalise.js';

const SORT_OPTIONS = [
  { value: 'unit_price', label: 'Best value (₹/unit)' },
  { value: 'price',      label: 'Lowest price' },
  { value: 'eta',        label: 'Fastest delivery' },
];

function extractQueryTerms(query) {
  return String(query ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
}

function zeptoResultMatchScore(product, queryTerms) {
  if (!product || !Array.isArray(queryTerms) || queryTerms.length === 0) return 0;

  const nameText = String(product.name ?? '').toLowerCase();
  const brandText = String(product.brand ?? '').toLowerCase();
  const quantityText = String(product.quantity ?? '').toLowerCase();
  const haystack = `${nameText} ${brandText} ${quantityText}`.trim();
  if (!haystack) return 0;

  const nameWords = nameText
    .split(/[^a-z0-9]+/)
    .map((word) => word.trim())
    .filter(Boolean);
  const brandWords = brandText
    .split(/[^a-z0-9]+/)
    .map((word) => word.trim())
    .filter(Boolean);
  const quantityWords = quantityText
    .split(/[^a-z0-9]+/)
    .map((word) => word.trim())
    .filter(Boolean);

  const nameWordSet = new Set(nameWords);
  const brandWordSet = new Set(brandWords);
  const quantityWordSet = new Set(quantityWords);

  let score = 0;
  const strongTermMatches = new Set();
  let strongNameMatches = 0;

  const matchPrefix = (words, term) => words.some((word) => word.startsWith(term));

  for (const term of queryTerms) {
    if (nameWordSet.has(term)) {
      strongTermMatches.add(term);
      strongNameMatches += 1;
      score += term.length + 9;
      continue;
    }

    if (brandWordSet.has(term)) {
      strongTermMatches.add(term);
      score += term.length + 5;
      continue;
    }

    if (term.length >= 4 && matchPrefix(nameWords, term)) {
      strongTermMatches.add(term);
      strongNameMatches += 1;
      score += term.length + 6;
      continue;
    }

    if (term.length >= 4 && matchPrefix(brandWords, term)) {
      strongTermMatches.add(term);
      score += term.length + 3;
      continue;
    }

    if (nameText.includes(term)) {
      score += 2;
      continue;
    }

    if (brandText.includes(term)) {
      score += 1;
      continue;
    }

    if (quantityWordSet.has(term)) {
      score += 1;
    }
  }

  if (queryTerms.length > 1 && nameText.includes(queryTerms.join(' '))) {
    score += 8;
  }

  if (queryTerms.length === 1 && nameWordSet.has(queryTerms[0])) {
    score += 3;
  }

  const requiredStrongMatches = queryTerms.length === 1
    ? 1
    : Math.max(1, Math.ceil(queryTerms.length * 0.5));

  if (strongTermMatches.size < requiredStrongMatches) {
    return 0;
  }

  if (queryTerms.length > 1 && strongNameMatches === 0) {
    return 0;
  }

  return score;
}

export default function ResultsPage() {
  const [searchParams]              = useSearchParams();
  const navigate                    = useNavigate();
  const query                       = searchParams.get('q') ?? '';

  const { state: loc }              = useLocation();
  const { state: user, dispatch: userDispatch } = useUser();
  const { toasts, showToast, dismissToast } = useToast();

  const {
    results,
    platformStatus,
    loading,
    resolved,
    totalPlatforms,
    fallbackUsed,
    fallbackReason,
    connectionHints,
    searchDiagnostics,
    debugInfo,
    refetch,
  } = useSearch(query, loc, user.connectedPlatforms);

  // Local UI state
  const [sort,             setSort]             = useState('unit_price');
  const [viewMode,         setViewMode]         = useState('list');
  const [activePlatforms,  setActivePlatforms]  = useState(PLATFORM_IDS);
  const [inStockOnly,      setInStockOnly]      = useState(false);
  const [debugOpen,        setDebugOpen]        = useState(false);

  const queryTerms = useMemo(() => extractQueryTerms(query), [query]);

  const { strictResults, zeptoFilteredOutCount } = useMemo(() => {
    const zeptoStatus = String(platformStatus?.zepto ?? '').trim().toLowerCase();

    // Backend now performs strict Zepto relevance; when Zepto is healthy,
    // trust backend rows to avoid hiding valid live products in the UI.
    if (zeptoStatus.startsWith('ok')) {
      return {
        strictResults: results,
        zeptoFilteredOutCount: 0,
      };
    }

    if (queryTerms.length === 0) {
      return {
        strictResults: results,
        zeptoFilteredOutCount: 0,
      };
    }

    let filteredOut = 0;
    const filtered = (results ?? []).filter((item) => {
      if (String(item?.platform ?? '').toLowerCase() !== 'zepto') {
        return true;
      }

      const score = zeptoResultMatchScore(item, queryTerms);
      const keep = score >= 2;
      if (!keep) {
        filteredOut += 1;
      }

      return keep;
    });

    return {
      strictResults: filtered,
      zeptoFilteredOutCount: filteredOut,
    };
  }, [results, queryTerms, platformStatus]);

  // Save query to recent searches once we have results
  useEffect(() => {
    if (query && strictResults.length > 0) {
      userDispatch({ type: 'ADD_RECENT_SEARCH', payload: query });
    }
  }, [query, strictResults.length, userDispatch]);

  // Compute derived state
  const processed = useMemo(() => {
    let items = filterByPlatform(strictResults, activePlatforms);
    items = filterInStock(items, inStockOnly);

    switch (sort) {
      case 'price':      return sortByPrice(items);
      case 'eta':        return sortByEta(items);
      default:           return sortByUnitPrice(items);
    }
  }, [strictResults, activePlatforms, inStockOnly, sort]);

  const bestDeal = useMemo(() => findBestDeal(processed), [processed]);

  function togglePlatform(id) {
    setActivePlatforms(prev =>
      prev.includes(id)
        ? prev.length > 1 ? prev.filter(p => p !== id) : prev   // keep at least one
        : [...prev, id]
    );
  }

  function handleAddToCart(product) {
    showToast(`✓ Added ${product.name} (${PLATFORMS[product.platform]?.name}) to cart`);
  }

  // ── Edge cases ───────────────────────────────────────────────────────────────
  if (!query) {
    navigate('/');
    return null;
  }

  const allFailed = !loading && resolved === totalPlatforms && strictResults.length === 0;

  // Check for session-specific failures
  const sessionErrors = Object.entries(platformStatus)
    .filter(([, status]) => typeof status === 'string' && (
      status.includes('session_invalid') ||
      status.includes('HTTP 401') ||
      status.includes('HTTP 403') ||
      status.includes('not_connected')
    ));
  const hasSessionErrors = sessionErrors.length > 0;
  const allSessionErrors = allFailed && sessionErrors.length > 0 &&
    sessionErrors.length >= Object.keys(platformStatus).filter(([, s]) => s !== 'ok').length;

  const reconnectRequiredMap = connectionHints?.reconnectRequiredByPlatform ?? {};
  const reconnectPlatforms = Object.entries(reconnectRequiredMap)
    .filter(([, required]) => Boolean(required))
    .map(([platform]) => platform);

  const failedPlatformDetails = Object.entries(platformStatus)
    .filter(([, status]) => typeof status === 'string' && status.startsWith('error:'))
    .map(([platform, status]) => ({
      platform,
      reason: String(status).replace(/^error:\s*/i, ''),
    }));

  const debugBackend = debugInfo?.backend ?? {};
  const debugNative = debugInfo?.native ?? {};
  const debugMerged = debugInfo?.merged ?? {};
  const debugStatusMap =
    debugMerged?.platformStatus && Object.keys(debugMerged.platformStatus).length > 0
      ? debugMerged.platformStatus
      : platformStatus;

  return (
    <main className="bg-[#F7F8FA] min-h-screen pb-20">
      <div className="max-w-[1200px] mx-auto px-4 py-4">

        {/* Search bar row */}
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0"
            aria-label="Go back"
          >
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <SearchBar initialValue={query} />
        </div>

        {/* Progress bar (while loading) */}
        {(loading || (resolved < totalPlatforms)) && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[13px] text-gray-500">
                {loading && resolved === 0
                  ? `Searching ${totalPlatforms} platforms…`
                  : `${resolved} / ${totalPlatforms} platforms searched`
                }
              </span>
            </div>
            <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: '#0D9F6F' }}
                initial={{ width: '0%' }}
                animate={{ width: `${(resolved / totalPlatforms) * 100}%` }}
                transition={{ ease: 'easeOut', duration: 0.4 }}
              />
            </div>
          </div>
        )}

        {/* Debug panel */}
        <div className="mb-4 rounded-[10px] border border-slate-300 bg-white">
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
            <div className="text-[12px] font-semibold text-slate-700">Search Debug Panel</div>
            <button
              onClick={() => setDebugOpen((prev) => !prev)}
              className="text-[11px] font-semibold text-slate-600 hover:text-slate-800"
            >
              {debugOpen ? 'Hide' : 'Show'}
            </button>
          </div>

          {debugOpen && (
            <div className="px-3 py-2 text-[11px] text-slate-700 space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
                <div><span className="font-semibold">mode:</span> {debugInfo?.mode ?? 'idle'}</div>
                <div><span className="font-semibold">query:</span> {debugInfo?.query ?? query}</div>
                <div><span className="font-semibold">requested:</span> {(debugInfo?.requestedPlatforms ?? []).join(', ') || 'n/a'}</div>
                <div><span className="font-semibold">resolved:</span> {resolved} / {totalPlatforms}</div>
                <div><span className="font-semibold">fallback:</span> {fallbackUsed ? (fallbackReason || 'yes') : 'none'}</div>
                <div><span className="font-semibold">final results:</span> {strictResults.length}</div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="rounded-[8px] bg-slate-50 border border-slate-200 px-2 py-1.5">
                  <div className="font-semibold text-slate-700 mb-1">Backend</div>
                  <div>attempted: {String(Boolean(debugBackend?.attempted))}</div>
                  <div>resultCount: {Number(debugBackend?.resultCount ?? 0)}</div>
                  <div>fallback: {String(debugBackend?.fallbackReason ?? 'none')}</div>
                  <div>error: {debugBackend?.error || 'none'}</div>
                </div>

                <div className="rounded-[8px] bg-slate-50 border border-slate-200 px-2 py-1.5">
                  <div className="font-semibold text-slate-700 mb-1">Native</div>
                  <div>available: {String(Boolean(debugNative?.available))}</div>
                  <div>primaryEnabled: {String(Boolean(debugNative?.primaryEnabled))}</div>
                  <div>rescueFallback: {String(Boolean(debugNative?.rescueFallback))}</div>
                  <div>status: {String(debugNative?.status ?? 'not_started')}</div>
                  <div>resultCount: {Number(debugNative?.resultCount ?? 0)}</div>
                  <div>attemptedPlatforms: {(debugNative?.attemptedPlatforms ?? []).join(', ') || 'n/a'}</div>
                  <div>error: {debugNative?.error || 'none'}</div>
                </div>

                <div className="rounded-[8px] bg-slate-50 border border-slate-200 px-2 py-1.5">
                  <div className="font-semibold text-slate-700 mb-1">Merged</div>
                  <div>applied: {String(Boolean(debugMerged?.applied))}</div>
                  <div>resultCount: {Number(debugMerged?.resultCount ?? strictResults.length)}</div>
                  <div>statusKeys: {Object.keys(debugStatusMap ?? {}).length}</div>
                </div>
              </div>

              <div className="rounded-[8px] bg-slate-50 border border-slate-200 px-2 py-1.5 overflow-x-auto">
                <div className="font-semibold text-slate-700 mb-1">Platform Status</div>
                <div className="whitespace-pre-wrap break-words">{JSON.stringify(debugStatusMap ?? {}, null, 2)}</div>
              </div>

              <div className="rounded-[8px] bg-slate-50 border border-slate-200 px-2 py-1.5 overflow-x-auto">
                <div className="font-semibold text-slate-700 mb-1">Search Diagnostics</div>
                <div className="whitespace-pre-wrap break-words">{JSON.stringify(searchDiagnostics ?? {}, null, 2)}</div>
              </div>
            </div>
          )}
        </div>

        {/* Loading skeletons */}
        {loading && strictResults.length === 0 && (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {/* Main results */}
        {strictResults.length > 0 && (
          <>
            {fallbackUsed && (
              <div className="mb-3 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                Showing sample fallback results because live platform APIs did not return data for this query
                {fallbackReason && fallbackReason !== 'none' ? ` (${fallbackReason.replace(/_/g, ' ')})` : ''}.
                Reconnect your accounts in Connect and retry to compare real app prices.
              </div>
            )}

            {zeptoFilteredOutCount > 0 && (
              <div className="mb-3 rounded-[10px] border border-sky-200 bg-sky-50 px-3 py-2 text-[12px] text-sky-800">
                Strict Zepto relevance filter removed {zeptoFilteredOutCount} non-matching item{zeptoFilteredOutCount !== 1 ? 's' : ''}.
              </div>
            )}

            {/* Session error banner */}
            {hasSessionErrors && strictResults.length > 0 && (
              <div className="mb-3 rounded-[10px] border border-orange-200 bg-orange-50 px-3 py-2.5 flex items-start gap-2">
                <AlertCircle size={16} className="text-orange-500 mt-0.5 flex-shrink-0" />
                <div className="text-[12px] text-orange-800">
                  <span className="font-semibold">Some platforms had session issues: </span>
                  {(reconnectPlatforms.length > 0 ? reconnectPlatforms : sessionErrors.map(([p]) => p)).join(', ')}.
                  <button
                    onClick={() => navigate('/connect')}
                    className="ml-1 font-semibold text-orange-600 underline hover:text-orange-700"
                  >
                    Reconnect →
                  </button>
                </div>
              </div>
            )}

            {/* Best Deal Banner */}
            {bestDeal && (
              <BestDealBanner product={bestDeal} allProducts={processed} />
            )}

            {/* Controls row */}
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <span className="text-[13px] text-gray-500">
                {processed.length} result{processed.length !== 1 ? 's' : ''} for "{query}"
              </span>

              <div className="flex items-center gap-2">
                {/* In-stock toggle */}
                <button
                  onClick={() => setInStockOnly(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] border text-[12px] font-medium transition-colors"
                  style={
                    inStockOnly
                      ? { background: '#E6F7F2', borderColor: '#A7F3D0', color: '#059669' }
                      : { background: '#fff', borderColor: '#E5E7EB', color: '#6B7280' }
                  }
                >
                  <SlidersHorizontal size={12} />
                  In stock
                </button>

                {/* Sort */}
                <select
                  value={sort}
                  onChange={e => setSort(e.target.value)}
                  className="h-8 px-2 pr-6 rounded-[8px] border border-[#E5E7EB] bg-white text-[12px] font-medium text-gray-700 outline-none appearance-none cursor-pointer"
                  style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'10\' height=\'6\' viewBox=\'0 0 10 6\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M1 1l4 4 4-4\' stroke=\'%239CA3AF\' stroke-width=\'1.5\' fill=\'none\' stroke-linecap=\'round\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
                >
                  {SORT_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>

                {/* View toggle */}
                <div className="flex border border-[#E5E7EB] rounded-[8px] overflow-hidden bg-white">
                  {[
                    { mode: 'list', Icon: LayoutList },
                    { mode: 'grid', Icon: Grid2X2 },
                  ].map(({ mode, Icon }) => (
                    <button
                      key={mode}
                      onClick={() => setViewMode(mode)}
                      className="p-1.5 transition-colors"
                      style={viewMode === mode ? { background: '#F3F4F6' } : {}}
                      aria-label={`${mode} view`}
                    >
                      <Icon size={16} className="text-gray-500" />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Platform filter chips */}
            <div className="flex gap-2 mb-4 overflow-x-auto pb-1 scrollbar-hide">
              {PLATFORM_IDS.map(id => {
                const p       = PLATFORMS[id];
                const status  = platformStatus[id];
                const active  = activePlatforms.includes(id);
                const failed  = status && status !== 'ok' && status !== undefined;
                const reason  = failed
                  ? String(status).replace(/^error:\s*/i, '').replace(/_/g, ' ')
                  : '';
                const shortReason = reason.length > 18 ? `${reason.slice(0, 18)}...` : reason;

                return (
                  <button
                    key={id}
                    onClick={() => !failed && togglePlatform(id)}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-[16px] text-[12px] font-semibold border transition-all"
                    style={
                      failed
                        ? { background: '#F9FAFB', borderColor: '#E5E7EB', color: '#9CA3AF', textDecoration: 'line-through', cursor: 'default' }
                        : active
                        ? { background: p.color, borderColor: p.color, color: '#fff' }
                        : { background: '#F3F4F6', borderColor: '#E5E7EB', color: '#6B7280' }
                    }
                    title={failed ? `${p.name}: ${status}` : undefined}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: failed ? '#D1D5DB' : active ? '#fff' : p.color }}
                    />
                    {p.name}
                    {failed && <span className="text-[10px] ml-0.5">({shortReason || 'unavailable'})</span>}
                  </button>
                );
              })}
            </div>

            {/* Cards */}
            {processed.length === 0 ? (
              <ErrorState type="no_results" onRetry={refetch} />
            ) : (
              <AnimatePresence mode="popLayout">
                <div className={
                  viewMode === 'grid'
                    ? 'grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3'
                    : 'flex flex-col gap-3'
                }>
                  {processed.map((product, i) => (
                    <motion.div
                      key={product.id}
                      layout
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{    opacity: 0, y: -8 }}
                      transition={{ delay: Math.min(i * 0.04, 0.4), duration: 0.22 }}
                    >
                      <ResultCard product={product} onAddToCart={handleAddToCart} />
                    </motion.div>
                  ))}
                </div>
              </AnimatePresence>
            )}
          </>
        )}

        {/* All platforms failed */}
        {allFailed && (
          <>
            {(failedPlatformDetails.length > 0 || searchDiagnostics) && (
              <div className="mb-3 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] text-red-800">
                <div className="font-semibold mb-1">Search diagnostics</div>
                {failedPlatformDetails.length > 0 && (
                  <div className="mb-1">
                    {failedPlatformDetails.map(({ platform, reason }) => `${platform}: ${reason}`).join(' | ')}
                  </div>
                )}
                {searchDiagnostics?.identityMismatch && (
                  <div className="mb-1">Identity mismatch detected between JWT user and x-flit-user-id header.</div>
                )}
                <button
                  onClick={() => navigate('/connect')}
                  className="font-semibold underline hover:opacity-80"
                >
                  Reconnect accounts →
                </button>
              </div>
            )}

            <ErrorState
              type={allSessionErrors ? 'session_expired' : 'all_failed'}
              onRetry={refetch}
            />
          </>
        )}
      </div>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}
