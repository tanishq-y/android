// Content script — injected into the Flit web app page (localhost:5173 / flit.app).
// Responsibilities:
//   1. Expose the extension's ID to the web page so it can send messages.
//   2. Listen for token-relay requests from page scripts (not used for search,
//      but useful for future OAuth-style flows).
//
// Also injected into platform pages to extract session tokens from localStorage
// (e.g. Zepto stores its access_token there) and relay them to the background.

// ─── EXPOSE EXTENSION ID TO THE FLIT WEB APP ─────────────────────────────────
// The web app reads window.__FLIT_EXTENSION_ID__ to know the extension ID
// so it can call chrome.runtime.sendMessage(id, ...) from the page script.

if (window.location.hostname === 'localhost' ||
    window.location.hostname.includes('flit.app')) {

  // Set a data attribute on the document root — readable by the web app
  document.documentElement.setAttribute('data-flit-ext-id', chrome.runtime.id);

  // Also set on window for direct JS access
  // We use a custom event instead of directly setting window properties
  // (which content scripts can't do on page's window in MV3)
  const event = new CustomEvent('flit:extension-ready', {
    detail: { extensionId: chrome.runtime.id },
    bubbles: true,
  });
  document.dispatchEvent(event);

  // Listen for repeated requests (e.g. after React re-renders)
  document.addEventListener('flit:request-extension-id', () => {
    document.dispatchEvent(new CustomEvent('flit:extension-ready', {
      detail: { extensionId: chrome.runtime.id },
      bubbles: true,
    }));
  });
}

// ─── ZEPTO TOKEN EXTRACTION ───────────────────────────────────────────────────
// Zepto stores the access_token in localStorage on zeptonow.com.
// When the user visits Zepto, extract and relay to background for caching.

if (window.location.hostname.includes('zeptonow.com')) {
  function tryExtractZeptoToken() {
    try {
      const token = localStorage.getItem('access_token') ||
                    localStorage.getItem('zp_auth_token');
      if (token) {
        chrome.runtime.sendMessage({
          type:     'STORE_TOKEN',
          platform: 'zepto',
          token,
        }).catch(() => {});
      }
    } catch { /* localStorage may be blocked */ }
  }

  // Run on load and on any navigation within SPA
  tryExtractZeptoToken();
  window.addEventListener('load', tryExtractZeptoToken);

  // Watch for SPA navigation (Zepto is a SPA)
  const _origPushState = history.pushState.bind(history);
  history.pushState = function (...args) {
    _origPushState(...args);
    setTimeout(tryExtractZeptoToken, 1000);
  };
}
