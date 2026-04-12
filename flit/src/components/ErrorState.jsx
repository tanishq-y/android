import { AlertTriangle, WifiOff, PackageSearch, Link2, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';

const CONFIGS = {
  connection_required: {
    Icon:    Link2,
    color:   '#0D9F6F',
    title:   'Connect your quick-commerce accounts',
    body:    'Flit needs at least one connected platform session to run user-context search. Open Connect and add Blinkit, Zepto, or Instamart.',
    actions: [
      {
        label:   'Open connect flow',
        href:    '/connect',
        primary: true,
      },
      {
        label:   'Read app flow notes',
        href:    'https://github.com/flit-app/flit#session-vault-flow',
        primary: false,
      },
    ],
  },

  server_offline: {
    Icon:  WifiOff,
    color: '#EF4444',
    title: 'Server not running',
    body:  'The Flit server needs to be running for price alerts. Start it with: npm run server',
    actions: [],
  },

  no_results: {
    Icon:  PackageSearch,
    color: '#F59E0B',
    title: 'No results found',
    body:  'Nothing matched your search across the platforms. Try a different query or check that you\'re logged into the apps.',
    actions: [],
  },

  all_failed: {
    Icon:  AlertTriangle,
    color: '#EF4444',
    title: 'Could not reach any platform',
    body:  'All 5 platforms failed to respond. Check your internet connection, make sure you\'re logged in on each platform, and try again.',
    actions: [],
  },

  generic: {
    Icon:  AlertTriangle,
    color: '#EF4444',
    title: 'Something went wrong',
    body:  'An unexpected error occurred. Please try again.',
    actions: [],
  },
};

export default function ErrorState({ type = 'generic', message, onRetry }) {
  const cfg = CONFIGS[type] ?? CONFIGS.generic;
  const { Icon, color, title, body, actions } = cfg;

  return (
    <div className="flex flex-col items-center text-center px-6 py-12 max-w-sm mx-auto">
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
        style={{ background: color + '18' }}
      >
        <Icon size={30} style={{ color }} />
      </div>

      <h2 className="font-heading font-bold text-[20px] text-gray-900 mb-2">
        {title}
      </h2>

      <p className="text-[14px] text-gray-500 leading-relaxed mb-6">
        {message || body}
      </p>

      {/* Custom actions */}
      {actions.length > 0 && (
        <div className="flex flex-col gap-2 w-full mb-4">
          {actions.map((action, i) => (
            <a
              key={i}
              href={action.href}
              target={action.href?.startsWith('http') ? '_blank' : undefined}
              rel="noopener noreferrer"
              className="flex items-center justify-center h-11 rounded-[10px] text-[14px] font-semibold transition-opacity hover:opacity-90"
              style={
                action.primary
                  ? { background: '#0D9F6F', color: '#fff' }
                  : { border: '1.5px solid #E5E7EB', color: '#374151' }
              }
            >
              {action.label}
            </a>
          ))}
        </div>
      )}

      {/* Retry button */}
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-2 px-4 py-2 rounded-[8px] border border-[#E5E7EB] text-[13px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <RefreshCw size={14} />
          Try again
        </button>
      )}

      {/* Account connection hint */}
      {type === 'connection_required' && (
        <p className="text-[12px] text-gray-400 mt-4">
          Already connected?{' '}
          <Link to="/connect" className="text-[#0D9F6F] font-medium hover:underline">
            Check your connection status →
          </Link>
        </p>
      )}
    </div>
  );
}
