import { ArrowRight, Smartphone, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useState } from 'react';

export default function ConnectBanner() {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div
      className="flex items-start gap-3 p-4 rounded-[12px] border mb-4"
      style={{ background: '#ECFDF5', borderColor: '#A7F3D0' }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: '#D1FAE5' }}
      >
        <Smartphone size={18} style={{ color: '#059669' }} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[14px] text-gray-900 leading-snug">
          Connect your apps once to unlock live search
        </p>
        <p className="text-[12px] text-gray-500 mt-0.5 leading-relaxed">
          Flit stores only your active session cookie in an encrypted vault and then searches
          Blinkit, Zepto, and Instamart in parallel under your own user context.
        </p>
        <Link
          to="/connect"
          className="inline-flex items-center gap-1.5 mt-2 text-[12px] font-semibold"
          style={{ color: '#059669' }}
        >
          Open connect flow
          <ArrowRight size={11} />
        </Link>
      </div>

      <button
        onClick={() => setDismissed(true)}
        className="text-gray-400 hover:text-gray-600 p-0.5 transition-colors flex-shrink-0"
        aria-label="Dismiss"
      >
        <X size={16} />
      </button>
    </div>
  );
}
