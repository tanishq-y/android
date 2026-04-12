import { useState, useMemo, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence }       from 'framer-motion';
import { ArrowLeft, LayoutList, Grid2X2, SlidersHorizontal } from 'lucide-react';

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
    refetch,
  } = useSearch(query, loc, user.connectedPlatforms);

  // Local UI state
  const [sort,             setSort]             = useState('unit_price');
  const [viewMode,         setViewMode]         = useState('list');
  const [activePlatforms,  setActivePlatforms]  = useState(PLATFORM_IDS);
  const [inStockOnly,      setInStockOnly]      = useState(false);

  // Save query to recent searches once we have results
  useEffect(() => {
    if (query && results.length > 0) {
      userDispatch({ type: 'ADD_RECENT_SEARCH', payload: query });
    }
  }, [query, results.length, userDispatch]);

  // Compute derived state
  const processed = useMemo(() => {
    let items = filterByPlatform(results, activePlatforms);
    items = filterInStock(items, inStockOnly);

    switch (sort) {
      case 'price':      return sortByPrice(items);
      case 'eta':        return sortByEta(items);
      default:           return sortByUnitPrice(items);
    }
  }, [results, activePlatforms, inStockOnly, sort]);

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

  const allFailed = !loading && resolved === totalPlatforms && results.length === 0;

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
                  ? 'Searching 5 platforms…'
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

        {/* Loading skeletons */}
        {loading && results.length === 0 && (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {/* Main results */}
        {results.length > 0 && (
          <>
            {fallbackUsed && (
              <div className="mb-3 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                Showing sample fallback results because live platform APIs did not return data for this query.
                Reconnect your accounts in Connect and retry to compare real app prices.
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
                    {failed && <span className="text-[10px] ml-0.5">(unavailable)</span>}
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
          <ErrorState type="all_failed" onRetry={refetch} />
        )}
      </div>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}
