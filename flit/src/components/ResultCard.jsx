import { useState } from 'react';
import { ShoppingCart, ExternalLink, Bell, BellOff, ImageOff } from 'lucide-react';
import PlatformBadge  from './PlatformBadge.jsx';
import { useCart }    from '../hooks/useCart.js';
import { usePriceAlerts } from '../hooks/usePriceAlerts.js';
import { formatPrice, formatDiscount, formatDeliveryFee } from '../utils/formatCurrency.js';
import { formatUnitPrice } from '../utils/unitPrice.js';
import { getPlatform }     from '../data/platforms.js';

export default function ResultCard({ product, onAddToCart }) {
  const { dispatch }       = useCart();
  const { addAlert, removeAlert, isAlertSet } = usePriceAlerts();
  const [imgError, setImgError] = useState(false);

  const p          = getPlatform(product.platform);
  const alertSet   = isAlertSet(product.id);
  const discount   = formatDiscount(product.mrp, product.price);
  const unitPriceFmt = product.unitPrice
    ? formatUnitPrice(product.unitPrice, product.unit)
    : null;

  function handleAddToCart() {
    dispatch({ type: 'ADD_ITEM', payload: product });
    onAddToCart?.(product);
  }

  function handleAlertToggle() {
    if (alertSet) {
      removeAlert(product.id);
    } else {
      addAlert(product);
    }
  }

  const outOfStock = !product.inStock;

  return (
    <div
      className={`bg-white rounded-[12px] border border-[#E5E7EB] p-3 flex flex-col gap-2.5 shadow-[0_1px_4px_rgba(0,0,0,0.05)] transition-opacity ${outOfStock ? 'opacity-50' : ''}`}
    >
      {/* Row 1 — Image + info */}
      <div className="flex gap-3">
        {/* Product image */}
        <div className="w-16 h-16 flex-shrink-0 rounded-[8px] bg-gray-50 flex items-center justify-center overflow-hidden">
          {product.image && !imgError ? (
            <img
              src={product.image}
              alt={product.name}
              className={`w-full h-full object-contain ${outOfStock ? 'grayscale' : ''}`}
              onError={() => setImgError(true)}
              loading="lazy"
            />
          ) : (
            <ImageOff size={24} className="text-gray-300" />
          )}
          {outOfStock && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="bg-black/60 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                OUT OF STOCK
              </span>
            </div>
          )}
        </div>

        {/* Text info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-1">
            <PlatformBadge platform={product.platform} size="sm" />
            <button
              onClick={handleAlertToggle}
              className="p-0.5 rounded text-gray-400 hover:text-primary transition-colors flex-shrink-0"
              aria-label={alertSet ? 'Remove price alert' : 'Set price alert'}
              title={alertSet ? 'Remove alert' : 'Alert me when price drops'}
            >
              {alertSet
                ? <BellOff size={14} style={{ color: '#0D9F6F' }} />
                : <Bell size={14} />
              }
            </button>
          </div>

          <p className="font-heading font-semibold text-[15px] text-gray-900 leading-tight mt-1 line-clamp-2">
            {product.name}
          </p>

          {(product.brand || product.quantity) && (
            <p className="text-[12px] text-gray-500 mt-0.5">
              {[product.brand, product.quantity].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </div>

      {/* Row 2 — Price */}
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="font-heading font-bold text-[22px] text-gray-900 leading-none">
          {formatPrice(product.price)}
        </span>

        {product.mrp && product.mrp > product.price && (
          <span className="text-[13px] text-gray-400 line-through">
            {formatPrice(product.mrp)}
          </span>
        )}

        {discount && (
          <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
            {discount}
          </span>
        )}
      </div>

      {/* Row 3 — Meta */}
      <div className="flex items-center gap-1.5 flex-wrap text-[12px] text-gray-500">
        {unitPriceFmt && (
          <span>{unitPriceFmt}</span>
        )}

        {unitPriceFmt && <span className="text-gray-300">•</span>}

        <span
          className="px-2 py-0.5 rounded-full font-semibold text-[11px]"
          style={{ background: '#D1FAE5', color: '#059669' }}
        >
          {product.deliveryEta}
        </span>

        <span className="text-gray-300">•</span>

        <span>{formatDeliveryFee(product.deliveryFee)}</span>
      </div>

      {/* Row 4 — Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleAddToCart}
          disabled={outOfStock}
          className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-[8px] text-white text-[13px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: outOfStock ? '#E5E7EB' : '#0D9F6F', color: outOfStock ? '#9CA3AF' : '#fff' }}
        >
          <ShoppingCart size={14} />
          Add to Cart
        </button>

        <a
          href={product.deepLink}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-[8px] text-[13px] font-semibold border transition-colors hover:opacity-80"
          style={{
            borderColor: p?.color ?? '#E5E7EB',
            color:       p?.color ?? '#6B7280',
          }}
        >
          Open in {p?.name ?? 'App'}
          <ExternalLink size={12} />
        </a>
      </div>
    </div>
  );
}
