import { PuzzleIcon, ExternalLink, X } from 'lucide-react';
import { useState } from 'react';

export default function ExtensionBanner() {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div
      className="flex items-start gap-3 p-4 rounded-[12px] border mb-4"
      style={{ background: '#F5F3FF', borderColor: '#DDD6FE' }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: '#EDE9FE' }}
      >
        <PuzzleIcon size={18} style={{ color: '#8025FB' }} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[14px] text-gray-900 leading-snug">
          Install the Flit extension to search
        </p>
        <p className="text-[12px] text-gray-500 mt-0.5 leading-relaxed">
          Flit fetches prices from your own logged-in accounts — no bots, no blocked requests,
          no sign-up required.
        </p>
        <a
          href="https://chrome.google.com/webstore/detail/flit"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 mt-2 text-[12px] font-semibold"
          style={{ color: '#8025FB' }}
        >
          Install for Chrome
          <ExternalLink size={11} />
        </a>
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
