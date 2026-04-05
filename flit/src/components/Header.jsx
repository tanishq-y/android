import { Link } from 'react-router-dom';
import { ShoppingCart, Bell } from 'lucide-react';
import { useCart } from '../hooks/useCart.js';
import { usePriceAlerts } from '../hooks/usePriceAlerts.js';

export default function Header() {
  const { cartComparison } = useCart();
  const { alerts }         = usePriceAlerts();

  const cartCount  = cartComparison.itemCount;
  const alertCount = alerts.length;

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-[#E5E7EB] h-14 md:h-16">
      <div className="max-w-[1200px] mx-auto px-4 md:px-6 h-full flex items-center justify-between">

        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 select-none">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm"
            style={{ background: '#0D9F6F' }}
          >
            F
          </div>
          <span className="font-heading font-semibold text-[20px] text-gray-900 tracking-tight">
            flit
          </span>
        </Link>

        {/* Right actions */}
        <div className="flex items-center gap-1">
          {/* Cart */}
          <Link
            to="/cart"
            className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label={`Cart — ${cartCount} item${cartCount !== 1 ? 's' : ''}`}
          >
            <ShoppingCart size={22} className="text-gray-500" />
            {cartCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
                {cartCount > 9 ? '9+' : cartCount}
              </span>
            )}
          </Link>

          {/* Price alerts */}
          <Link
            to="/connect"
            className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label={`Price alerts — ${alertCount} set`}
          >
            <Bell size={22} className="text-gray-500" />
            {alertCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
                {alertCount > 9 ? '9+' : alertCount}
              </span>
            )}
          </Link>
        </div>
      </div>
    </header>
  );
}
