import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Database,
  ExternalLink,
  Link2Off,
  RefreshCw,
  Smartphone,
} from 'lucide-react';

import { useUser } from '../hooks/useUser.js';
import { useBlinkitConnection } from '../hooks/useBlinkitConnection.js';
import { useBigbasketConnection } from '../hooks/useBigbasketConnection.js';
import { useJioMartConnection } from '../hooks/useJioMartConnection.js';
import { useZeptoConnection } from '../hooks/useZeptoConnection.js';
import { useInstamartConnection } from '../hooks/useInstamartConnection.js';
import {
  exportPlatformSessionFromApp,
  isNativeAppBridgeAvailable,
  openPlatformLoginInApp,
} from '../utils/nativeBridge.js';
import {
  apiUrl,
  getApiBaseUrl,
  getStoredApiBaseUrl,
  setStoredApiBaseUrl,
} from '../utils/apiUrl.js';

const APP_PLATFORMS = [
  {
    id: 'blinkit',
    title: 'Blinkit',
    loginUrl: 'https://blinkit.com',
    accent: '#0C831F',
    iconBg: '#E8F5E9',
    description: 'Use your Blinkit session for user-context search.',
  },
  {
    id: 'zepto',
    title: 'Zepto',
    loginUrl: 'https://www.zeptonow.com',
    accent: '#8025FB',
    iconBg: '#F3E8FF',
    description: 'Use your Zepto session for user-context search.',
  },
  {
    id: 'instamart',
    title: 'Instamart',
    loginUrl: 'https://www.swiggy.com',
    accent: '#EA580C',
    iconBg: '#FFF7ED',
    description: 'Use your Instamart session for user-context search.',
  },
  {
    id: 'bigbasket',
    title: 'BigBasket',
    loginUrl: 'https://www.bigbasket.com',
    accent: '#84C225',
    iconBg: '#F1F8E9',
    description: 'Capture richer session data for BigBasket verification and search.',
  },
  {
    id: 'jiomart',
    title: 'JioMart',
    loginUrl: 'https://www.jiomart.com',
    accent: '#0089CF',
    iconBg: '#E0F2FE',
    description: 'Capture richer session data for JioMart verification and search.',
  },
];

function getStatusTone({ loading, connected, reconnectRequired }) {
  if (loading) return { bg: '#F3F4F6', fg: '#6B7280', label: 'Checking' };
  if (connected) return { bg: '#D1FAE5', fg: '#059669', label: 'Connected' };
  if (reconnectRequired) return { bg: '#FEF3C7', fg: '#B45309', label: 'Reconnect required' };
  return { bg: '#FEE2E2', fg: '#B91C1C', label: 'Not connected' };
}

function stripTrailingSlash(value) {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

function buildHealthUrl(baseUrl) {
  const base = stripTrailingSlash(baseUrl);
  if (!base) return apiUrl('/api/health');
  return `${base}/api/health`;
}

export default function ConnectPageV2() {
  const navigate = useNavigate();
  const { dispatch } = useUser();

  const blinkitModel = useBlinkitConnection();
  const bigbasketModel = useBigbasketConnection();
  const jiomartModel = useJioMartConnection();
  const zeptoModel = useZeptoConnection();
  const instamartModel = useInstamartConnection();

  const platformModels = {
    blinkit: blinkitModel,
    bigbasket: bigbasketModel,
    jiomart: jiomartModel,
    zepto: zeptoModel,
    instamart: instamartModel,
  };

  const [cookieDrafts, setCookieDrafts] = useState({
    blinkit: '',
    bigbasket: '',
    jiomart: '',
    zepto: '',
    instamart: '',
  });
  const [messages, setMessages] = useState({});
  const [errors, setErrors] = useState({});
  const [disconnectBusy, setDisconnectBusy] = useState({});
  const [captureBusy, setCaptureBusy] = useState({});
  const [verifyBusy, setVerifyBusy] = useState({});
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [nativeBridgeReady, setNativeBridgeReady] = useState(() => isNativeAppBridgeAvailable());
  const [apiBaseDraft, setApiBaseDraft] = useState(() => getStoredApiBaseUrl() || getApiBaseUrl());
  const [apiStatus, setApiStatus] = useState('');
  const [apiTesting, setApiTesting] = useState(false);

  useEffect(() => {
    const checkBridge = () => setNativeBridgeReady(isNativeAppBridgeAvailable());

    checkBridge();

    const intervalId = window.setInterval(checkBridge, 1000);
    window.addEventListener('focus', checkBridge);
    document.addEventListener('visibilitychange', checkBridge);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', checkBridge);
      document.removeEventListener('visibilitychange', checkBridge);
    };
  }, []);

  useEffect(() => {
    dispatch({
      type: 'SET_PLATFORM_STATUS',
      payload: {
        blinkit: blinkitModel.connection.status === 'connected' ? 'logged_in' : 'logged_out',
        zepto: zeptoModel.connection.status === 'connected' ? 'logged_in' : 'logged_out',
        instamart: instamartModel.connection.status === 'connected' ? 'logged_in' : 'logged_out',
        bigbasket: bigbasketModel.connection.status === 'connected' ? 'logged_in' : 'logged_out',
        jiomart: jiomartModel.connection.status === 'connected' ? 'logged_in' : 'logged_out',
      },
    });
  }, [
    bigbasketModel.connection.status,
    blinkitModel.connection.status,
    dispatch,
    instamartModel.connection.status,
    jiomartModel.connection.status,
    zeptoModel.connection.status,
  ]);

  function clearFeedback(platformId) {
    setMessages((prev) => ({ ...prev, [platformId]: '' }));
    setErrors((prev) => ({ ...prev, [platformId]: '' }));
  }

  function saveApiBaseOverride() {
    const trimmed = stripTrailingSlash(apiBaseDraft);
    setStoredApiBaseUrl(trimmed);
    setApiBaseDraft(trimmed);

    if (!trimmed) {
      setApiStatus('Cleared local backend override. App will use env/default API routing.');
      return;
    }

    setApiStatus(`Saved backend override: ${trimmed}`);
  }

  function applyDraftApiBaseOverride() {
    const trimmed = stripTrailingSlash(apiBaseDraft);
    if (!trimmed) return '';

    setStoredApiBaseUrl(trimmed);
    if (trimmed !== apiBaseDraft) {
      setApiBaseDraft(trimmed);
    }
    return trimmed;
  }

  async function testApiConnection() {
    setApiTesting(true);
    setApiStatus('Testing backend connection...');
    const candidateBase = stripTrailingSlash(apiBaseDraft) || getApiBaseUrl();
    const healthUrl = buildHealthUrl(candidateBase);

    try {
      const response = await fetch(healthUrl, { method: 'GET' });
      if (!response.ok) {
        setApiStatus(`Backend check failed at ${healthUrl}: HTTP ${response.status}`);
        return;
      }

      setApiStatus(`Backend reachable from app runtime at ${healthUrl}.`);
    } catch (error) {
      const detail = error instanceof Error && error.message
        ? ` Error: ${error.message}`
        : '';
      setApiStatus(`Failed to reach backend at ${healthUrl}. Check phone and laptop are on same Wi-Fi and backend URL is correct.${detail}`);
    } finally {
      setApiTesting(false);
    }
  }

  async function refreshAllStatuses() {
    applyDraftApiBaseOverride();
    setRefreshingAll(true);
    await Promise.all([
      blinkitModel.refresh().catch(() => {}),
      bigbasketModel.refresh().catch(() => {}),
      jiomartModel.refresh().catch(() => {}),
      zeptoModel.refresh().catch(() => {}),
      instamartModel.refresh().catch(() => {}),
    ]);
    setRefreshingAll(false);
  }

  async function handleOpenLogin(platformId, loginUrl) {
    clearFeedback(platformId);

    try {
      const launch = await openPlatformLoginInApp(platformId, loginUrl);
      if (launch.mode === 'native') {
        setMessages((prev) => ({
          ...prev,
          [platformId]: 'Login opened in app window. Complete login, then tap Capture session.',
        }));
      } else {
        setMessages((prev) => ({
          ...prev,
          [platformId]: 'Login opened in browser. Paste cookie header below to connect this platform.',
        }));
      }
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [platformId]: err.message ?? 'Could not open platform login.',
      }));
    }
  }

  async function handleCapture(platformId, saveSession) {
    clearFeedback(platformId);
    setCaptureBusy((prev) => ({ ...prev, [platformId]: true }));
    applyDraftApiBaseOverride();

    try {
      const session = await exportPlatformSessionFromApp(platformId);
      const response = await saveSession(session);
      setCookieDrafts((prev) => ({ ...prev, [platformId]: session.cookieHeader }));

      const headerCount = Number(response?.diagnostics?.headerCount ?? 0);
      const missing = Array.isArray(response?.diagnostics?.missingRequiredHeaders)
        ? response.diagnostics.missingRequiredHeaders
        : [];

      setMessages((prev) => ({
        ...prev,
        [platformId]: `Session captured from app runtime and stored in Flit vault (captured headers: ${headerCount}).`,
      }));

      if (missing.length > 0) {
        setErrors((prev) => ({
          ...prev,
          [platformId]: `Captured session is missing required headers: ${missing.join(', ')}. Reopen login and navigate/search once before Capture session.`,
        }));
      }
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [platformId]: err.message ?? 'Could not capture session from app runtime.',
      }));
    } finally {
      setCaptureBusy((prev) => ({ ...prev, [platformId]: false }));
    }
  }

  async function handleManualSave(platformId, saveSession) {
    clearFeedback(platformId);
    applyDraftApiBaseOverride();

    const cookieHeader = (cookieDrafts[platformId] ?? '').trim();
    if (!cookieHeader) {
      setErrors((prev) => ({ ...prev, [platformId]: 'Paste a cookie header before saving.' }));
      return;
    }

    try {
      const response = await saveSession({ cookieHeader, expiresAt: null });
      const missing = Array.isArray(response?.diagnostics?.missingRequiredHeaders)
        ? response.diagnostics.missingRequiredHeaders
        : [];

      setMessages((prev) => ({
        ...prev,
        [platformId]: 'Session saved to backend token vault.',
      }));

      if (missing.length > 0) {
        setErrors((prev) => ({
          ...prev,
          [platformId]: `Manual cookie save is missing required headers: ${missing.join(', ')}. Use app capture for a richer session.`,
        }));
      }
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [platformId]: err.message ?? 'Could not save session to backend vault.',
      }));
    }
  }

  async function handleDisconnect(platformId, disconnect) {
    clearFeedback(platformId);
    setDisconnectBusy((prev) => ({ ...prev, [platformId]: true }));
    applyDraftApiBaseOverride();

    try {
      await disconnect();
      setMessages((prev) => ({
        ...prev,
        [platformId]: 'Session removed from backend vault.',
      }));
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [platformId]: err.message ?? 'Could not disconnect this platform.',
      }));
    } finally {
      setDisconnectBusy((prev) => ({ ...prev, [platformId]: false }));
    }
  }

  async function handleVerify(platformId, verify) {
    clearFeedback(platformId);
    setVerifyBusy((prev) => ({ ...prev, [platformId]: true }));
    applyDraftApiBaseOverride();

    try {
      const result = await verify();

      if (result?.valid === true) {
        setMessages((prev) => ({
          ...prev,
          [platformId]: 'Session verified successfully.',
        }));
      } else {
        const missing = Array.isArray(result?.diagnostics?.missingRequiredHeaders)
          ? result.diagnostics.missingRequiredHeaders
          : [];
        const details = missing.length > 0
          ? ` Missing headers: ${missing.join(', ')}`
          : '';

        setErrors((prev) => ({
          ...prev,
          [platformId]: `Verify failed: ${result?.reason ?? 'unknown_reason'}${details}`,
        }));
      }
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [platformId]: err.message ?? 'Could not verify this platform session.',
      }));
    } finally {
      setVerifyBusy((prev) => ({ ...prev, [platformId]: false }));
    }
  }

  return (
    <main className="bg-[#F7F8FA] min-h-screen pb-20">
      <div className="max-w-[760px] mx-auto px-4 py-4">
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
              App-first session vault for real user-side quick-commerce search.
            </p>
          </div>
        </div>

        <div className="mb-5 rounded-[12px] border border-[#D1FAE5] bg-[#ECFDF5] p-4">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5">
              <Smartphone size={18} className="text-emerald-600" />
            </div>
            <div className="text-[13px] text-emerald-900 leading-relaxed">
              <p className="font-semibold">Current workflow</p>
              <p>1) Open each platform login from Flit.</p>
              <p>2) In app runtime, capture session directly. On web, paste cookie header as fallback.</p>
              <p>3) Flit stores session in backend token vault and uses it for parallel search.</p>
            </div>
          </div>

          {!nativeBridgeReady && (
            <p className="text-[12px] text-emerald-700 mt-3">
              Native bridge not detected in this runtime. Manual cookie paste is active for local testing.
            </p>
          )}

          <div className="mt-3 flex justify-end">
            <button
              onClick={refreshAllStatuses}
              disabled={refreshingAll}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] border border-[#A7F3D0] bg-white text-[12px] font-medium text-emerald-700 disabled:opacity-50"
            >
              <RefreshCw size={13} className={refreshingAll ? 'animate-spin' : ''} />
              {refreshingAll ? 'Refreshing…' : 'Refresh all'}
            </button>
          </div>
        </div>

        <div className="mb-5 rounded-[12px] border border-[#E5E7EB] bg-white p-4">
          <p className="text-[13px] font-semibold text-gray-800">Backend URL (phone runtime)</p>
          <p className="text-[12px] text-gray-500 mt-0.5">
            If you see "Failed to fetch", set your laptop LAN backend URL here.
          </p>

          <div className="mt-3 flex gap-2 flex-wrap items-center">
            <input
              type="text"
              value={apiBaseDraft}
              onChange={(event) => setApiBaseDraft(event.target.value)}
              placeholder="http://192.168.x.x:3001"
              className="flex-1 min-w-[220px] h-10 px-3 rounded-[8px] border border-[#E5E7EB] text-[12px] text-gray-700 outline-none focus:border-[#86EFAC]"
            />
            <button
              onClick={saveApiBaseOverride}
              className="h-10 px-3 rounded-[8px] text-[12px] font-semibold text-white"
              style={{ background: '#059669' }}
            >
              Save
            </button>
            <button
              onClick={testApiConnection}
              disabled={apiTesting}
              className="h-10 px-3 rounded-[8px] text-[12px] font-semibold border border-[#E5E7EB] text-gray-700 disabled:opacity-50"
            >
              {apiTesting ? 'Testing…' : 'Test'}
            </button>
          </div>

          {apiStatus && <p className="text-[12px] text-gray-600 mt-2">{apiStatus}</p>}
        </div>

        <div className="space-y-4">
          {APP_PLATFORMS.map((platform) => {
            const model = platformModels[platform.id];
            const connected = model.connection.status === 'connected';
            const reconnectRequired =
              model.connection.status === 'reconnect_required' || model.connection.status === 'expired';
            const tone = getStatusTone({
              loading: model.loading,
              connected,
              reconnectRequired,
            });

            const cookieDraft = cookieDrafts[platform.id] ?? '';
            const message = messages[platform.id];
            const error = errors[platform.id];
            const isCapturing = Boolean(captureBusy[platform.id]);
            const isDisconnecting = Boolean(disconnectBusy[platform.id]);
            const isVerifying = Boolean(verifyBusy[platform.id]);
            const canVerify = typeof model.verify === 'function';

            return (
              <div key={platform.id} className="bg-white rounded-[12px] border border-[#E5E7EB] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{ background: platform.iconBg }}
                    >
                      <Database size={16} style={{ color: platform.accent }} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-[14px] text-gray-900">{platform.title} connection</h3>
                      <p className="text-[12px] text-gray-500 mt-0.5">{platform.description}</p>
                    </div>
                  </div>

                  <span
                    className="text-[11px] font-semibold px-2 py-1 rounded-full"
                    style={{ background: tone.bg, color: tone.fg }}
                  >
                    {tone.label}
                  </span>
                </div>

                <p className="text-[11px] text-gray-400 mt-2">User scope: {model.userId}</p>

                {model.connection.status_reason && !connected && (
                  <p className="text-[12px] text-amber-700 mt-2">Reason: {model.connection.status_reason}</p>
                )}

                {message && <p className="text-[12px] text-emerald-700 mt-2">{message}</p>}
                {error && <p className="text-[12px] text-red-600 mt-2">{error}</p>}

                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    onClick={() => handleOpenLogin(platform.id, platform.loginUrl)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] border text-[12px] font-semibold"
                    style={{ borderColor: platform.accent, color: platform.accent }}
                  >
                    Open {platform.title} login
                    <ExternalLink size={12} />
                  </button>

                  {nativeBridgeReady && (
                    <button
                      onClick={() => handleCapture(platform.id, model.saveSession)}
                      disabled={isCapturing || model.syncing}
                      className="px-3 py-2 rounded-[8px] text-[12px] font-semibold text-white disabled:opacity-50"
                      style={{ background: platform.accent }}
                    >
                      {isCapturing || model.syncing ? 'Capturing…' : 'Capture session from app'}
                    </button>
                  )}

                  <button
                    onClick={async () => {
                      applyDraftApiBaseOverride();
                      await model.refresh();
                    }}
                    disabled={model.loading}
                    className="px-3 py-2 rounded-[8px] border border-[#E5E7EB] bg-white text-[12px] font-semibold text-gray-700 disabled:opacity-50"
                  >
                    Refresh status
                  </button>

                  <button
                    onClick={() => canVerify && handleVerify(platform.id, model.verify)}
                    disabled={!canVerify || isVerifying || model.loading || model.syncing}
                    className="px-3 py-2 rounded-[8px] border border-[#E5E7EB] bg-white text-[12px] font-semibold text-gray-700 disabled:opacity-50"
                  >
                    {isVerifying ? 'Verifying…' : 'Verify session'}
                  </button>

                  {connected && (
                    <button
                      onClick={() => handleDisconnect(platform.id, model.disconnect)}
                      disabled={isDisconnecting}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] border text-[12px] font-semibold disabled:opacity-50"
                      style={{ borderColor: '#FECACA', color: '#DC2626', background: '#FFF1F2' }}
                    >
                      <Link2Off size={12} />
                      Disconnect
                    </button>
                  )}
                </div>

                <div className="mt-3">
                  <label className="block text-[12px] text-gray-600 mb-1.5">
                    Cookie header fallback
                  </label>
                  <textarea
                    value={cookieDraft}
                    onChange={(event) => {
                      const value = event.target.value;
                      setCookieDrafts((prev) => ({ ...prev, [platform.id]: value }));
                    }}
                    placeholder="example_cookie=value; another_cookie=value"
                    className="w-full min-h-[84px] rounded-[10px] border border-[#E5E7EB] bg-[#F9FAFB] text-[12px] text-gray-700 p-2.5 outline-none focus:border-[#86EFAC]"
                  />

                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="text-[11px] text-gray-400">
                      Flit never asks for your password. Only an existing session cookie is stored.
                    </p>
                    <button
                      onClick={() => handleManualSave(platform.id, model.saveSession)}
                      disabled={model.syncing || !cookieDraft.trim()}
                      className="px-3 py-1.5 rounded-[8px] text-[12px] font-semibold text-white disabled:opacity-50"
                      style={{ background: platform.accent }}
                    >
                      {model.syncing ? 'Saving…' : 'Save session'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 p-4 bg-white rounded-[12px] border border-[#E5E7EB]">
          <h3 className="font-semibold text-[14px] text-gray-900 mb-2">Search behavior</h3>
          <ol className="space-y-2 text-[13px] text-gray-600 list-decimal list-inside">
            <li>Flit reads your saved platform sessions from backend vault.</li>
            <li>Flit sends parallel search requests across connected platforms.</li>
            <li>Each platform sees requests under your own logged-in session context.</li>
          </ol>
        </div>
      </div>
    </main>
  );
}
