# Flit Bug Fix Logbook

## 2026-04-05 — Critical Protocol Mismatch Fix

### Summary
Fixed a **complete communication breakdown** between the Flit web app and the Chrome extension. The web app was sending messages using `FLIT_*` naming convention, but the extension only understood the original names (`PING`, `GET_STATUS`, `SEARCH_ALL`). Every message hit the `default` case and returned an error, which was silently swallowed.

---

### Bug #1: Message Type Protocol Mismatch (CRITICAL)

**Symptom**: Extension showed as "not detected" or platforms showed "Unknown" status on the Connect page. Searches returned no results.

**Root Cause**: The web app (`useExtension.js`, `useSearch.js`, `ConnectPage.jsx`) sent messages with types:
- `FLIT_PING` → extension expected `PING`
- `FLIT_SEARCH` → extension expected `SEARCH_ALL` or `SEARCH_PLATFORM`
- `FLIT_CHECK_LOGIN` → extension expected `GET_STATUS`

The extension's `handleMessage` switch-case didn't have cases for `FLIT_*` types, so it always returned `{ type: 'ERROR', error: 'Unknown message type: ...' }`.

**Fix**: Added `FLIT_*` aliases to `extension/background.js` so both naming conventions are accepted. The old names still work for `popup.js`.

**Files Changed**: `extension/background.js`

---

### Bug #2: Search Response Schema Mismatch

**Symptom**: Even if the extension returned results, the web app showed a blank screen.

**Root Cause**: The extension returned `{ type: 'SEARCH_ALL_RESULT', results: [{ platform, products, error }] }` but `useSearch.js` only accepted `response.type === 'FLIT_RESULTS'`.

**Fix**: 
1. Updated `extension/background.js` to return `{ type: 'FLIT_RESULTS' }` for `FLIT_SEARCH` messages
2. Updated `useSearch.js` to also accept `SEARCH_ALL_RESULT` as a fallback
3. Updated `useSearch.js` to accept both `items` and `products` field names

**Files Changed**: `extension/background.js`, `src/hooks/useSearch.js`

---

### Bug #3: Login Status Response Schema Mismatch

**Symptom**: Platforms always showed as "Unknown" even when the user was logged in on those sites.

**Root Cause**: Extension returned `{ type: 'STATUS', platforms: {...} }` but ConnectPage expected `{ type: 'FLIT_LOGIN_STATUS' }` with data under `response.status` (not `response.platforms`).

**Fix**: 
1. For `FLIT_CHECK_LOGIN` messages, extension now returns `{ type: 'FLIT_LOGIN_STATUS', status: {...} }`
2. ConnectPage now accepts both response shapes as fallback
3. `useLoginStatus.js` hook also fixed to accept both shapes

**Files Changed**: `extension/background.js`, `src/pages/ConnectPage.jsx`, `src/hooks/useLoginStatus.js`

---

### Bug #4: Location Data Shape Incompatibility

**Symptom**: Platform searches might use wrong default coordinates instead of user's location.

**Root Cause**: Web app sent `{ lat, lng }` at the top level of the message, but platform scrapers expected `location.lat` / `location.lon` (note: `lon` not `lng`).

**Fix**: The `FLIT_SEARCH` handler in `background.js` now correctly reshapes the incoming `{ lat, lng }` into `{ lat, lon }` before passing to platform scrapers.

**Files Changed**: `extension/background.js`

---

### Bug #5: Session Cookie Name Brittleness

**Symptom**: Some platforms might show as "logged out" even when logged in.

**Root Cause**: Each platform was checked using a single hardcoded cookie name. Platforms frequently change their cookie names.

**Fix**: Changed `SESSION_CHECKS` to use an array of possible cookie names per platform, checked in sequence. If any match, the platform is considered "logged in". This reduces the chance of false negatives when platforms update their cookies.

**Files Changed**: `extension/background.js`

---

### Bug #6: Ping Response Not Validated

**Symptom**: Extension might be falsely detected as "missing" even when installed.

**Root Cause**: `useExtension.js` only checked if the ping response was truthy. The extension returns `{ type: 'PONG', extensionId: '...' }`, which IS truthy, but the code should explicitly check for the expected response type to avoid false positives from other extensions or errors.

**Fix**: `useExtension.js` now checks `response.type === 'PONG'` or `response.extensionId` exists.

**Files Changed**: `src/hooks/useExtension.js`

---

### Additional Robustness Improvements

1. **Timeout on sendMessage** (`useExtension.js`): Added a 30-second timeout to prevent the UI from hanging indefinitely if the extension service worker dies mid-request.

2. **Dynamic Extension ID** (`useExtension.js`): Now reads the extension ID from both the DOM attribute (set by `content.js`) and the env variable, with DOM taking priority. This makes it work even if the env var is stale.

3. **Boolean status values** (`UserContext.jsx`, `ConnectPage.jsx`): The `SET_PLATFORM_STATUS` reducer and the Connect page now accept `true`/`false` in addition to `'logged_in'`/`'logged_out'` string values.

4. **Comprehensive logging**: Added `console.log` / `console.warn` / `console.error` calls throughout the extension background worker and the frontend hooks for easier debugging.

---

### Files Modified (Summary)

| File | Change |
|---|---|
| `extension/background.js` | Added FLIT_* aliases, multi-cookie checks, correct response shapes, logging |
| `src/hooks/useExtension.js` | Accept PONG, dynamic ext ID, 30s timeout, logging |
| `src/hooks/useSearch.js` | Accept both response types/field names, fix location shape, logging |
| `src/hooks/useLoginStatus.js` | Accept both response types |
| `src/pages/ConnectPage.jsx` | Accept PONG ping, both login response shapes, boolean status values |
| `src/context/UserContext.jsx` | Accept `true` as logged_in status |
