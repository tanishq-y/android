/**
 * Flit — content.js
 *
 * Injected into two different contexts (see manifest.json):
 *  1. The Flit web app (localhost:5173 / flit.app) at document_start
 *     → Exposes the extension ID so the web app can call chrome.runtime.sendMessage()
 *  2. Grocery platform pages at document_idle
 *     → Detects login state via DOM signals and relays to background
 *     → Extracts Zepto access_token from localStorage
 */

(function () {
  const host = location.hostname;

  // ── 1. FLIT WEB APP — expose extension ID ──────────────────────────────────
  if (host === 'localhost' || host.includes('flit.app')) {

    // Set on document root so the React app can read it with getAttribute
    document.documentElement.setAttribute('data-flit-ext-id', chrome.runtime.id);

    // Dispatch a custom event for React hooks listening via useEffect
    const dispatch = () => document.dispatchEvent(new CustomEvent('flit:extension-ready', {
      detail:  { extensionId: chrome.runtime.id },
      bubbles: true,
    }));

    dispatch();

    // Re-dispatch on request (React may re-mount after hot reload)
    document.addEventListener('flit:request-extension-id', dispatch);
    return; // nothing else to do on the web app
  }

  // ── 2. PLATFORM PAGES — login detection ────────────────────────────────────
  const LOGIN_SIGNALS = {
    'blinkit.com':        () => !!document.querySelector('[data-testid="user-account"], .account-user-name'),
    'www.zeptonow.com':   () => !!document.querySelector('.user-name, [data-cy="account-name"]'),
    'www.swiggy.com':     () => !!document.querySelector('.account-name, [class*="UserName"]'),
    'www.bigbasket.com':  () => !!document.querySelector('.uname, .user-name-text, #userAccord'),
    'www.jiomart.com':    () => !!document.querySelector('.profile-info .cname, .user-name'),
  };

  const matchedDomain = Object.keys(LOGIN_SIGNALS).find(d => host.includes(d));
  if (!matchedDomain) return;

  function detectLogin() {
    return LOGIN_SIGNALS[matchedDomain]?.() ?? false;
  }

  function tryDetect(attempts = 0) {
    const loggedIn = detectLogin();
    if (loggedIn || attempts >= 10) {
      chrome.runtime.sendMessage({
        type:     'FLIT_PAGE_LOGIN',
        platform: matchedDomain,
        loggedIn,
        url:      location.href,
      }).catch(() => {});
      return;
    }
    // Retry up to 10× with 500 ms gaps (covers lazy-loaded auth UI)
    setTimeout(() => tryDetect(attempts + 1), 500);
  }

  if (document.readyState === 'complete') {
    tryDetect();
  } else {
    window.addEventListener('load', () => tryDetect());
  }

  // ── 3. ZEPTO — extract localStorage token ──────────────────────────────────
  // Zepto stores its access token in localStorage; relay it to background for caching.
  if (host.includes('zeptonow.com')) {
    function tryExtractZeptoToken() {
      try {
        const token =
          localStorage.getItem('access_token') ||
          localStorage.getItem('zp_auth_token') ||
          localStorage.getItem('zepto_auth');
        if (token) {
          chrome.runtime.sendMessage({ type: 'STORE_TOKEN', platform: 'zepto', token }).catch(() => {});
        }
      } catch { /* localStorage blocked */ }
    }

    tryExtractZeptoToken();
    window.addEventListener('load', tryExtractZeptoToken);

    // Intercept SPA navigation
    const _push = history.pushState.bind(history);
    history.pushState = function (...args) {
      _push(...args);
      setTimeout(tryExtractZeptoToken, 1000);
    };
  }
})();
