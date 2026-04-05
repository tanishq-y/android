import { useState } from 'react';
import { useNavigate }    from 'react-router-dom';
import { ArrowLeft, Trash2, ShoppingCart, Sparkles, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence }  from 'framer-motion';
import { useCart }                  from '../hooks/useCart.js';
import { formatPrice }              from '../utils/formatCurrency.js';
import { getPlatform }              from '../data/platforms.js';
import PlatformBadge                from '../components/PlatformBadge.jsx';

export default function CartPage() {
  const navigate                         = useNavigate();
  const { state, dispatch, cartComparison } = useCart();
  const [showSplit, setShowSplit]         = useState(false);

  const { items }                        = state;
  const { total, itemCount, platformGroups, suggestedSplit } = cartComparison;

  function changeQty(id, qty) {
    dispatch({ type: 'UPDATE_QTY', payload: { id, quantity: qty } });
  }

  function removeItem(id) {
    dispatch({ type: 'REMOVE_ITEM', payload: id });
  }

  // ── Empty state ──────────────────────────────────────────────────────────────
  if (items.length === 0) {
    return (
      <main className="bg-[#F7F8FA] min-h-[calc(100vh-56px)] flex flex-col items-center justify-center px-4">
        <ShoppingCart size={64} className="text-gray-200 mb-4" />
        <h2 className="font-heading font-bold text-[20px] text-gray-900 mb-2">
          Your cart is empty
        </h2>
        <p className="text-[14px] text-gray-500 mb-6 text-center">
          Search for products and add them here to compare before buying.
        </p>
        <button
          onClick={() => navigate('/')}
          className="px-6 py-2.5 rounded-[10px] text-white font-semibold text-[14px]"
          style={{ background: '#0D9F6F' }}
        >
          Start searching
        </button>
      </main>
    );
  }

  return (
    <main className="bg-[#F7F8FA] min-h-screen pb-20">
      <div className="max-w-[640px] mx-auto px-4 py-4">

        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <h1 className="font-heading font-bold text-[20px] text-gray-900">
            My Cart ({itemCount} item{itemCount !== 1 ? 's' : ''})
          </h1>
        </div>

        {/* Cart items */}
        <div className="flex flex-col gap-3 mb-5">
          <AnimatePresence>
            {items.map(item => {
              const p = getPlatform(item.product.platform);
              return (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1,  x: 0 }}
                  exit={{    opacity: 0,  x: 10, height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.2 }}
                  className="bg-white rounded-[12px] border border-[#E5E7EB] p-3 flex items-center gap-3"
                >
                  {/* Image */}
                  <div className="w-14 h-14 flex-shrink-0 rounded-[8px] bg-gray-50 flex items-center justify-center overflow-hidden">
                    {item.product.image ? (
                      <img
                        src={item.product.image}
                        alt={item.product.name}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <ShoppingCart size={20} className="text-gray-300" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <PlatformBadge platform={item.product.platform} size="sm" />
                    <p className="font-heading font-semibold text-[14px] text-gray-900 leading-tight mt-0.5 line-clamp-2">
                      {item.product.name}
                    </p>
                    <p className="font-semibold text-[14px] text-gray-700 mt-0.5">
                      {formatPrice(item.product.price * item.quantity)}
                    </p>
                  </div>

                  {/* Qty + remove */}
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <button
                      onClick={() => removeItem(item.id)}
                      className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                      aria-label="Remove item"
                    >
                      <Trash2 size={15} />
                    </button>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => changeQty(item.id, item.quantity - 1)}
                        className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 font-bold text-sm transition-colors"
                        aria-label="Decrease quantity"
                      >
                        −
                      </button>
                      <span className="font-heading font-semibold text-[14px] w-5 text-center">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => changeQty(item.id, item.quantity + 1)}
                        className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 font-bold text-sm transition-colors"
                        aria-label="Increase quantity"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Subtotals */}
        <div className="bg-white rounded-[12px] border border-[#E5E7EB] p-4 mb-4">
          {Object.entries(platformGroups).map(([platform, data]) => (
            <div key={platform} className="flex items-center justify-between py-1.5">
              <span className="text-[14px] text-gray-600">
                {getPlatform(platform)?.name ?? platform}
              </span>
              <span className="text-[14px] font-semibold text-gray-900">
                {formatPrice(data.subtotal)}
              </span>
            </div>
          ))}
          <div className="border-t border-[#E5E7EB] mt-2 pt-2 flex items-center justify-between">
            <span className="font-heading font-bold text-[16px] text-gray-900">Total</span>
            <span className="font-heading font-bold text-[20px] text-gray-900">
              {formatPrice(total)}
            </span>
          </div>
        </div>

        {/* Optimise button */}
        <button
          onClick={() => setShowSplit(v => !v)}
          className="w-full flex items-center justify-center gap-2 h-12 rounded-[12px] text-white font-semibold text-[15px] mb-4 transition-opacity hover:opacity-90"
          style={{ background: 'linear-gradient(90deg, #0D9F6F, #06B486)' }}
        >
          <Sparkles size={17} />
          {showSplit ? 'Hide Basket Split' : '✨ Optimise Cart'}
        </button>

        {/* Basket split result */}
        <AnimatePresence>
          {showSplit && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{    opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-white rounded-[12px] border border-[#A7F3D0] p-4 mb-4"
                style={{ background: '#F0FDF4' }}>
                <h3 className="font-heading font-bold text-[15px] text-gray-900 mb-3">
                  ✨ Basket Split Suggestion
                </h3>

                {suggestedSplit.map(({ platform, items: splitItems, subtotal }) => {
                  const p = getPlatform(platform);
                  return (
                    <div key={platform} className="mb-3">
                      <div className="flex items-center justify-between mb-1">
                        <span
                          className="text-[13px] font-semibold"
                          style={{ color: p?.color }}
                        >
                          Buy on {p?.name} ({splitItems.length} item{splitItems.length !== 1 ? 's' : ''})
                        </span>
                        <span className="font-bold text-[14px] text-gray-900">
                          {formatPrice(subtotal)}
                        </span>
                      </div>
                      <a
                        href={p?.loginUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[12px] font-semibold"
                        style={{ color: p?.color }}
                      >
                        Open {p?.name}
                        <ExternalLink size={11} />
                      </a>
                    </div>
                  );
                })}

                <div className="border-t border-[#A7F3D0] pt-3 mt-1">
                  <div className="flex justify-between text-[14px]">
                    <span className="text-gray-600">Total (split):</span>
                    <span className="font-bold text-gray-900">{formatPrice(total)}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Clear cart */}
        <button
          onClick={() => dispatch({ type: 'CLEAR_CART' })}
          className="w-full text-[13px] text-gray-400 hover:text-red-500 py-2 transition-colors"
        >
          Clear cart
        </button>
      </div>
    </main>
  );
}
