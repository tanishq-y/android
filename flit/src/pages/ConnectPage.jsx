import { useState, useEffect } from 'react';
import { useNavigate }         from 'react-router-dom';
import { ArrowLeft, CheckCircle, AlertCircle, ExternalLink, RefreshCw, PuzzleIcon } from 'lucide-react';
import { motion }              from 'framer-motion';
import { useUser }             from '../hooks/useUser.js';
import { PLATFORMS, PLATFORM_IDS } from '../data/platforms.js';

/**
 * FIX LOG:
 *   - getExtensionId: unchanged
 *   - checkStatus PING: now checks for response.type === 'PONG' (not just truthy)
 *   - checkStatus LOGIN: now accepts BOTH 'FLIT_LOGIN_STATUS' and 'STATUS' response types
 *   - checkStatus LOGIN: reads status from response.status OR response.platforms
 *   - Platform status values: accepts 'logged_in', true, 'logged_out', false
 */

function getExtensionId() {
  const fromDom = document.documentElement.getAttribute('data-flit-ext-id');
  if (fromDom) return fromDom;
  const fromEnv = import.meta.env.VITE_EXTENSION_ID;
  if (fromEnv && fromEnv !== 'your-extension-id-here') return fromEnv;
  return null;
}

function isChromeExtensionAvailable() {
  return typeof chrome !== 'undefined' && typeof chrome.runtime?.sendMessage === 'function';
}

export default function ConnectPage() {
  const navigate               = useNavigate();
  const { dispatch }           = useUser();

  const [extInstalled,    setExtInstalled]    = useState(null);  // null = checking
  const [platformStatus,  setPlatformStatus]  = useState({});
  const [checking,        setChecking]        = useState(false);

  async function checkStatus() {
    setChecking(true);
    const extId = getExtensionId();

    if (!extId || !isChromeExtensionAvailable()) {
      console.warn('[Connect] Extension not available — extId:', extId, 'chrome available:', isChromeExtensionAvailable());
      setExtInstalled(false);
      setChecking(false);
      return;
    }

    // ── Step 1: Ping ─────────────────────────────────────────────────────────
    let installed = false;
    await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(extId, { type: 'FLIT_PING' }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('[Connect] Ping failed:', chrome.runtime.lastError.message);
            installed = false;
          } else if (response && (response.type === 'PONG' || response.type === 'FLIT_PONG' || response.extensionId)) {
            console.log('[Connect] Extension detected, id:', response.extensionId ?? extId);
            installed = true;
          } else {
            console.warn('[Connect] Ping got unexpected response:', response);
            installed = false;
          }
          resolve();
        });
      } catch (err) {
        console.error('[Connect] Ping exception:', err);
        installed = false;
        resolve();
      }
    });

    setExtInstalled(installed);

    if (!installed) {
      setChecking(false);
      return;
    }

    // ── Step 2: Get login status ──────────────────────────────────────────────
    await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(extId, { type: 'FLIT_CHECK_LOGIN' }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('[Connect] Login check failed:', chrome.runtime.lastError.message);
            resolve();
            return;
          }

          console.log('[Connect] Login status response:', response);

          // Accept both response shapes:
          //   Web app format:  { type: 'FLIT_LOGIN_STATUS', status: { blinkit: 'logged_in', ... } }
          //   Popup format:    { type: 'STATUS', platforms: { blinkit: 'logged_in', ... } }
          let status = null;
          if (response?.type === 'FLIT_LOGIN_STATUS') {
            status = response.status ?? {};
          } else if (response?.type === 'STATUS') {
            status = response.platforms ?? {};
          } else if (response?.status) {
            // Fallback: maybe it just has status directly
            status = response.status;
          } else if (response?.platforms) {
            status = response.platforms;
          }

          if (status) {
            console.log('[Connect] Platform status map:', status);
            setPlatformStatus(status);
            dispatch({ type: 'SET_PLATFORM_STATUS', payload: status });
          } else {
            console.warn('[Connect] Could not extract status from response:', response);
          }

          resolve();
        });
      } catch (err) {
        console.error('[Connect] Login check exception:', err);
        resolve();
      }
    });

    setChecking(false);
  }

  useEffect(() => {
    checkStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="bg-[#F7F8FA] min-h-screen pb-20">
      <div className="max-w-[640px] mx-auto px-4 py-4">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <div>
            <h1 className="font-heading font-bold text-[20px] text-gray-900">Connect accounts</h1>
            <p className="text-[13px] text-gray-500">
              Log in once, get accurate local prices every time.
            </p>
          </div>
        </div>

        {/* Extension status */}
        {extInstalled === null && (
          <div className="bg-white rounded-[12px] border border-[#E5E7EB] p-4 mb-4 flex items-center gap-3">
            <div className="w-4 h-4 border-2 border-[#0D9F6F] border-t-transparent rounded-full animate-spin" />
            <span className="text-[14px] text-gray-600">Checking extension…</span>
          </div>
        )}

        {extInstalled === false && (
          <div
            className="rounded-[12px] border p-4 mb-5"
            style={{ background: '#F5F3FF', borderColor: '#DDD6FE' }}
          >
            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: '#EDE9FE' }}
              >
                <PuzzleIcon size={20} style={{ color: '#8025FB' }} />
              </div>
              <div>
                <h2 className="font-semibold text-[15px] text-gray-900 mb-1">
                  Extension not detected
                </h2>
                <p className="text-[13px] text-gray-500 leading-relaxed mb-3">
                  Flit uses a browser extension to fetch prices from your real logged-in accounts.
                  This is the only way to get live, location-accurate prices without getting blocked.
                </p>
                <a
                  href="https://chrome.google.com/webstore/detail/flit"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-[8px] text-white text-[13px] font-semibold"
                  style={{ background: '#8025FB' }}
                >
                  <PuzzleIcon size={14} />
                  Install Chrome Extension
                  <ExternalLink size={12} />
                </a>
                <p className="text-[11px] text-gray-400 mt-2">
                  After installing, click "Refresh status" below.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Refresh button */}
        <div className="flex justify-end mb-4">
          <button
            onClick={checkStatus}
            disabled={checking}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] border border-[#E5E7EB] bg-white text-[12px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={13} className={checking ? 'animate-spin' : ''} />
            {checking ? 'Checking…' : 'Refresh status'}
          </button>
        </div>

        {/* Platform cards */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {PLATFORM_IDS.map((id, i) => {
            const p      = PLATFORMS[id];
            const status = platformStatus[id] ?? 'unknown';
            // Accept 'logged_in', true, 'LOGGED_IN' as connected
            const isIn   = status === 'logged_in' || status === true || String(status).toLowerCase() === 'logged_in';
            // Accept 'logged_out', false, 'LOGGED_OUT' as disconnected
            const isOut  = status === 'logged_out' || status === false || String(status).toLowerCase() === 'logged_out';

            return (
              <motion.div
                key={id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0  }}
                transition={{ delay: i * 0.05 }}
                className="rounded-[16px] border p-4 flex flex-col items-center text-center transition-colors"
                style={
                  isIn
                    ? { background: '#F0FDF4', borderColor: '#A7F3D0', borderWidth: '1.5px' }
                    : { background: '#fff',    borderColor: '#E5E7EB', borderWidth: '1.5px' }
                }
              >
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg mb-3"
                  style={{ background: p.color }}
                >
                  {p.name[0]}
                </div>

                <p className="font-heading font-semibold text-[15px] text-gray-900 mb-0.5">
                  {p.name}
                </p>
                <p className="text-[11px] text-gray-400 mb-3">{p.tagline}</p>

                {isIn ? (
                  <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold"
                    style={{ background: '#D1FAE5', color: '#059669' }}>
                    <CheckCircle size={11} />
                    Logged in
                  </span>
                ) : isOut ? (
                  <a
                    href={p.loginUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 px-3 py-1.5 rounded-[8px] border text-[12px] font-semibold transition-colors hover:opacity-80"
                    style={{ borderColor: p.color, color: p.color }}
                  >
                    Log in to {p.name}
                    <ExternalLink size={11} />
                  </a>
                ) : (
                  <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-gray-100 text-gray-400">
                    <AlertCircle size={11} />
                    {extInstalled === false ? 'Install extension' : 'Unknown'}
                  </span>
                )}
              </motion.div>
            );
          })}
        </div>

        {/* How it works */}
        <div className="mt-6 p-4 bg-white rounded-[12px] border border-[#E5E7EB]">
          <h3 className="font-semibold text-[14px] text-gray-900 mb-2">How Flit connects</h3>
          <ol className="space-y-2 text-[13px] text-gray-600 list-decimal list-inside">
            <li>Install the Flit Chrome extension</li>
            <li>Log into Blinkit, Zepto, Instamart, BigBasket, JioMart as usual</li>
            <li>When you search on Flit, the extension fetches prices using your real session</li>
            <li>Your passwords are never seen by Flit — only your existing browser cookies are used</li>
          </ol>
        </div>

        <div className="text-center mt-6">
          <button
            onClick={() => navigate('/')}
            className="text-[13px] text-gray-400 hover:text-gray-600 transition-colors"
          >
            Skip — use basic search
          </button>
        </div>

      </div>
    </main>
  );
}
