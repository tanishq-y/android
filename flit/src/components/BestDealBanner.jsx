import { ExternalLink, Trophy } from 'lucide-react';
import PlatformBadge from './PlatformBadge.jsx';
import { formatPrice } from '../utils/formatCurrency.js';
import { formatUnitPrice } from '../utils/unitPrice.js';
import { getPlatform } from '../data/platforms.js';

export default function BestDealBanner({ product, allProducts }) {
  if (!product) return null;

  const p            = getPlatform(product.platform);
  const unitPriceFmt = product.unitPrice
    ? formatUnitPrice(product.unitPrice, product.unit)
    : null;

  // How much cheaper than the most expensive option
  const worstTotal = allProducts.length
    ? Math.max(...allProducts.map(p => p.price + p.deliveryFee))
    : null;
  const savings = worstTotal
    ? worstTotal - (product.price + product.deliveryFee)
    : null;

  return (
    <div
      className="rounded-[16px] border p-4 mb-4"
      style={{
        background:   'linear-gradient(135deg, #E6F7F2 0%, #D1F2E8 100%)',
        borderColor:  '#A7F3D0',
        boxShadow:    '0 4px 24px rgba(13,159,111,0.15)',
      }}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold text-white"
          style={{ background: '#0D9F6F' }}
        >
          <Trophy size={11} />
          Best deal
        </span>
        <PlatformBadge platform={product.platform} size="sm" />
        {savings > 0 && (
          <span className="ml-auto text-[12px] font-semibold text-emerald-700">
            ₹{Math.round(savings)} cheaper than rest
          </span>
        )}
      </div>

      {/* Product info + buy button */}
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="font-heading font-semibold text-[16px] text-gray-900 leading-tight line-clamp-2">
            {product.name}
          </p>
          {product.quantity && (
            <p className="text-[12px] text-gray-500 mt-0.5">{product.quantity}</p>
          )}

          <div className="flex items-baseline gap-2 mt-2">
            <span className="font-heading font-bold text-[26px] text-[#0D9F6F] leading-none">
              {formatPrice(product.price)}
            </span>
            {product.mrp > product.price && (
              <span className="text-[13px] text-gray-400 line-through">
                {formatPrice(product.mrp)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 mt-1.5 text-[12px] text-gray-500">
            {unitPriceFmt && <span>{unitPriceFmt}</span>}
            {unitPriceFmt && <span className="text-gray-300">•</span>}
            <span
              className="px-2 py-0.5 rounded-full font-semibold text-[11px]"
              style={{ background: '#D1FAE5', color: '#059669' }}
            >
              {product.deliveryEta}
            </span>
            <span className="text-gray-300">•</span>
            <span>
              {product.deliveryFee === 0 ? 'Free delivery' : `₹${product.deliveryFee} delivery`}
            </span>
          </div>
        </div>

        <a
          href={product.deepLink}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-[10px] text-white text-[13px] font-bold whitespace-nowrap transition-opacity hover:opacity-90"
          style={{ background: p?.color ?? '#0D9F6F' }}
        >
          Buy on {p?.name}
          <ExternalLink size={13} />
        </a>
      </div>
    </div>
  );
}
