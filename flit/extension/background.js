// Flit Extension Background Service Worker (Manifest V3)
// ─────────────────────────────────────────────────────
// Handles messages from:
//   1. The Flit web app via externally_connectable (uses FLIT_* message types)
//   2. The popup (uses PING, GET_STATUS, SEARCH_ALL, etc.)
//
// ──────────────────────────────────────────────────────────────────────────────
// MESSAGE PROTOCOL (both naming conventions are accepted)
//
//   PING  /  FLIT_PING        → { type: 'PONG', extensionId }
//   GET_STATUS / FLIT_CHECK_LOGIN → { type: 'FLIT_LOGIN_STATUS', status: {...} }
//                                   (also returned as { type: 'STATUS', platforms: {...} } for popup)
//   SEARCH_PLATFORM             → { type: 'SEARCH_RESULT', platform, products, error }
//   SEARCH_ALL / FLIT_SEARCH   → { type: 'FLIT_RESULTS', results: [...] }
//   STORE_TOKEN                → { type: 'OK' }
// ──────────────────────────────────────────────────────────────────────────────

import { searchBlinkit } from './platforms/blinkit.js';
import { searchZepto } from './platforms/zepto.js';
import { searchInstamart } from './platforms/instamart.js';
import { searchBigBasket } from './platforms/bigbasket.js';
import { searchJioMart } from './platforms/jiomart.js';

// Map platform IDs to their search functions
const PLATFORM_SEARCHERS = {
  blinkit: searchBlinkit,
  zepto: searchZepto,
  instamart: searchInstamart,
  bigbasket: searchBigBasket,
  jiomart: searchJioMart,
};

// Platform cookie/session check configs for GET_STATUS / FLIT_CHECK_LOGIN
// Multiple possible cookie names per platform for resilience against changes
const SESSION_CHECKS = {
  blinkit: {
    url: 'https://blinkit.com',
    cookieNames: ['gr_1', 'gr_1_strict', '_bb_cid', 'session_id', 'blinkit_sess'],
  },
  zepto: {
    url: 'https://www.zeptonow.com',
    cookieNames: ['_zt_session', 'session_id', 'auth_token', 'zp_at', '_zp_sid'],
  },
  instamart: {
    url: 'https://www.swiggy.com',
    cookieNames: ['_session_tid', '_sid', 'sid', 'sessionId', 'swgy_sess'],
  },
  bigbasket: {
    url: 'https://www.bigbasket.com',
    cookieNames: ['sessionid', 'bb_session', 'sessionId', '_bb_sid', 'session'],
  },
  jiomart: {
    url: 'https://www.jiomart.com',
    cookieNames: ['auth', 'session_id', 'jm_session', '_jm_at', 'jm_auth'],
  },
};

// ─── MESSAGE HANDLER ─────────────────────────────────────────────────────────

chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  handleMessage(message, 'external')
    .then(sendResponse)
    .catch(err => {
      console.error('[Flit BG] External message error:', err);
      sendResponse({ type: 'ERROR', error: err.message });
    });
  return true; // keep channel open for async response
});

// Internal messages (from popup.js)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message, 'internal')
    .then(sendResponse)
    .catch(err => {
      console.error('[Flit BG] Internal message error:', err);
      sendResponse({ type: 'ERROR', error: err.message });
    });
  return true;
});

async function handleMessage(message, source) {
  const msgType = message.type;
  console.log(`[Flit BG] Received ${msgType} from ${source}`);

  switch (msgType) {

    // ── PING ────────────────────────────────────────────────────────────────
    case 'PING':
    case 'FLIT_PING': {
      return { type: 'PONG', extensionId: chrome.runtime.id };
    }

    // ── SINGLE PLATFORM SEARCH ──────────────────────────────────────────────
    case 'SEARCH_PLATFORM': {
      const { platform, query, location } = message;
      const searcher = PLATFORM_SEARCHERS[platform];
      if (!searcher) {
        return { type: 'SEARCH_RESULT', platform, products: [], error: 'unknown_platform' };
      }
      const result = await searcher(query, location);
      return { type: 'SEARCH_RESULT', ...result };
    }

    // ── ALL-PLATFORM SEARCH (used by both popup and web app) ────────────────
    case 'SEARCH_ALL':
    case 'FLIT_SEARCH': {
      // FLIT_SEARCH sends { query, lat, lng } at top level
      // SEARCH_ALL sends { query, location: { lat, lon } }
      const query = message.query;
      let location;

      if (message.location) {
        // SEARCH_ALL format
        location = message.location;
      } else {
        // FLIT_SEARCH format — lat/lng at top level
        location = {
          lat: message.lat ?? 28.6139,
          lon: message.lng ?? message.lon ?? 77.2090,
        };
      }

      console.log(`[Flit BG] Searching all platforms for "${query}"`, location);

      const platforms = Object.keys(PLATFORM_SEARCHERS);
      const settled = await Promise.allSettled(
        platforms.map(p => {
          console.log(`[Flit BG] Starting search on ${p}...`);
          return PLATFORM_SEARCHERS[p](query, location);
        })
      );

      const results = settled.map((outcome, i) => {
        const platform = platforms[i];
        if (outcome.status === 'fulfilled') {
          const r = outcome.value;
          console.log(`[Flit BG] ${platform}: ${r.products?.length ?? 0} products, error=${r.error ?? 'none'}`);
          return {
            platform: r.platform ?? platform,
            items: r.products ?? [],
            error: r.error ?? null,
          };
        }
        console.error(`[Flit BG] ${platform}: exception —`, outcome.reason?.message);
        return { platform, items: [], error: 'exception' };
      });

      // Return in the format useSearch.js expects
      return { type: 'FLIT_RESULTS', results };
    }

    // ── LOGIN STATUS CHECK ──────────────────────────────────────────────────
    case 'GET_STATUS':
    case 'FLIT_CHECK_LOGIN': {
      const statusMap = {};
      await Promise.allSettled(
        Object.entries(SESSION_CHECKS).map(async ([platform, config]) => {
          try {
            let found = false;
            // Check multiple cookie names per platform for resilience
            for (const cookieName of config.cookieNames) {
              try {
                const cookie = await chrome.cookies.get({
                  url: config.url,
                  name: cookieName,
                });
                if (cookie?.value) {
                  found = true;
                  break;
                }
              } catch {
                // This specific cookie name failed, try the next
              }
            }
            statusMap[platform] = found ? 'logged_in' : 'logged_out';
          } catch {
            statusMap[platform] = 'unknown';
          }
        })
      );

      console.log('[Flit BG] Login status:', statusMap);

      // Return BOTH shapes so popup.js and web app both work
      if (msgType === 'FLIT_CHECK_LOGIN') {
        return { type: 'FLIT_LOGIN_STATUS', status: statusMap };
      }
      return { type: 'STATUS', platforms: statusMap };
    }

    // ── TOKEN STORAGE (from content.js) ─────────────────────────────────────
    case 'STORE_TOKEN': {
      const { platform, token } = message;
      try {
        await chrome.storage.local.set({ [`${platform}_token`]: token });
      } catch (e) {
        console.warn('[Flit BG] Failed to store token:', e);
      }
      return { type: 'OK' };
    }

    default:
      console.warn(`[Flit BG] Unknown message type: ${msgType}`);
      return { type: 'ERROR', error: `Unknown message type: ${msgType}` };
  }
}

// ─── INSTALLATION HANDLER ─────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: 'http://localhost:5173/connect' }).catch(() => { });
  }
});
