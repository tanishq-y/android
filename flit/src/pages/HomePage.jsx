import { useNavigate } from 'react-router-dom';
import { MapPin, Link2, Clock } from 'lucide-react';
import SearchBar       from '../components/SearchBar.jsx';
import ExtensionBanner from '../components/ExtensionBanner.jsx';
import { useUser }     from '../hooks/useUser.js';
import { useLocation } from '../hooks/useLocation.js';
import { PLATFORMS, PLATFORM_IDS } from '../data/platforms.js';

export default function HomePage() {
  const { state: user, dispatch } = useUser();
  const { state: loc }            = useLocation();
  const navigate                  = useNavigate();

  const connectedCount = user.connectedPlatforms.length;

  function handleRecentSearch(q) {
    dispatch({ type: 'ADD_RECENT_SEARCH', payload: q });
    navigate(`/results?q=${encodeURIComponent(q)}`);
  }

  return (
    <main className="min-h-[calc(100vh-56px)] flex flex-col items-center justify-center bg-[#F7F8FA] px-4 py-10">
      <div className="w-full max-w-[480px] flex flex-col items-center">

        {/* Hero */}
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-2xl mb-4"
            style={{ background: '#0D9F6F' }}
          >
            F
          </div>
          <h1 className="font-heading font-bold text-[36px] text-gray-900 leading-none tracking-tight mb-2">
            flit
          </h1>
          <p className="text-[15px] text-gray-500 text-center">
            Fastest price, every time.
          </p>
        </div>

        {/* Extension banner if not installed */}
        <div className="w-full">
          <ExtensionBanner />
        </div>

        {/* Search bar */}
        <div className="w-full mb-5">
          <SearchBar autoFocus />
        </div>

        {/* Platform chips */}
        <div className="flex flex-wrap gap-2 justify-center mb-5">
          {PLATFORM_IDS.map(id => {
            const p         = PLATFORMS[id];
            const connected = user.connectedPlatforms.includes(id);
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-[24px] text-[12px] font-medium"
                style={
                  connected
                    ? { background: p.bgColor, color: p.color }
                    : { background: '#F3F4F6', color: '#9CA3AF' }
                }
              >
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: connected ? p.color : '#D1D5DB' }}
                />
                {p.name}
              </span>
            );
          })}
        </div>

        {/* Connect CTA — only if 0 platforms logged in */}
        {connectedCount === 0 && (
          <button
            onClick={() => navigate('/connect')}
            className="w-full flex items-center justify-between p-3.5 rounded-[12px] border text-left mb-5 hover:border-amber-300 transition-colors"
            style={{ background: '#FFFBEB', borderColor: '#FDE68A' }}
          >
            <div className="flex items-center gap-2.5">
              <Link2 size={16} className="text-amber-500 flex-shrink-0" />
              <span className="text-[13px] font-medium text-amber-800">
                Log in to get accurate local prices
              </span>
            </div>
            <span className="text-[13px] font-bold text-[#0D9F6F] flex-shrink-0 ml-2">
              Connect →
            </span>
          </button>
        )}

        {/* Recent searches */}
        {user.recentSearches.length > 0 && (
          <div className="w-full mb-5">
            <div className="flex items-center gap-1.5 mb-2">
              <Clock size={12} className="text-gray-400" />
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                Recent
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {user.recentSearches.map(q => (
                <button
                  key={q}
                  onClick={() => handleRecentSearch(q)}
                  className="px-3 py-1 rounded-[24px] bg-gray-100 text-[12px] text-gray-600 hover:bg-gray-200 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Location status */}
        <button
          onClick={() => navigate('/location')}
          className="flex items-center gap-1.5 text-[13px] mt-2 transition-colors"
          style={{ color: loc.address ? '#0D9F6F' : '#9CA3AF' }}
        >
          <MapPin size={14} />
          {loc.address
            ? `📍 ${loc.address}`
            : 'Add your location for local prices'
          }
        </button>

      </div>
    </main>
  );
}
