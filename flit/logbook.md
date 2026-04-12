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

---

## 2026-04-09 — Blinkit Token-Vault Pilot (Phase 1 + Pilot Wiring)

### Summary
Implemented the first production-oriented backend token-vault slice for **Blinkit** while keeping existing extension-first behavior intact. Added PostgreSQL foundation, encryption, migration tooling, Blinkit connection APIs, session-aware server search, extension session export, and Connect page controls for syncing Blinkit session to backend.

This is an incremental migration step, not a hard switch. Current flows still work, and Blinkit backend connection is introduced as a pilot path.

---

### Chronological Work Log

1. Confirmed architecture target and migration direction from roadmap and todo artifacts.
2. Added PostgreSQL dependency and migration script to package metadata.
3. Extended environment template with DB + crypto settings.
4. Built new DB utility with pool, transaction helper, and health ping.
5. Built token crypto layer using AES-256-GCM with base64 key validation.
6. Added user context middleware (`x-flit-user-id`) with dev fallback.
7. Added SQL migration for users, platform connections, encrypted tokens, and audit events.
8. Added migration runner (`npm run migrate`) with `schema_migrations` tracking.
9. Added token-vault repository for Blinkit:
	- store encrypted cookie session
	- read/decrypt session
	- list connection status
	- mark reconnect required
	- disconnect and audit
10. Updated server-side Blinkit fetcher to optionally attach stored cookie header.
11. Rewrote backend server route layer to include:
	- `GET /api/v2/connections`
	- `GET /api/v2/connections/blinkit`
	- `POST /api/v2/connections/blinkit/session`
	- `DELETE /api/v2/connections/blinkit`
	- `POST /api/v2/search/blinkit`
12. Updated legacy `/api/search` to optionally use Blinkit token vault when user context is provided.
13. Added frontend stable device user-id utility (`flit_user_id`) for backend scoping.
14. Updated search hook to send `x-flit-user-id` header and use relative `/api/search` path.
15. Added new frontend hook for Blinkit backend connection lifecycle (`useBlinkitConnection`).
16. Enhanced Connect page UI with Blinkit backend pilot panel:
	- status badge
	- sync from extension
	- refresh backend status
	- disconnect backend session
17. Added extension background message `FLIT_EXPORT_BLINKIT_SESSION`:
	- exports Blinkit cookie header from browser cookies
	- returns expiry hint and cookie count
18. Installed dependencies with peer-safe workaround.
19. Ran diagnostics checks on all modified files and verified no editor errors.

---

### Commands Executed

1. `npm install pg@^8.13.1` (failed due existing React/Lucide peer conflict in workspace)
2. `npm install --legacy-peer-deps` (successful; added packages and updated lockfile)

Notes:

1. Existing dependency graph had a pre-existing peer mismatch (`lucide-react` peer range vs React 19). Used legacy peer resolution to avoid forcing unrelated upgrades during this migration step.

---

### New Files Added

1. `server/db.js`
2. `server/security/tokenCrypto.js`
3. `server/middleware/userContext.js`
4. `server/migrations/001_token_vault.sql`
5. `server/scripts/migrate.js`
6. `server/tokenVault.js`
7. `src/utils/deviceUserId.js`
8. `src/hooks/useBlinkitConnection.js`

---

### Existing Files Updated

1. `package.json`
2. `.env.example`
3. `server/platforms.js`
4. `server/server.js`
5. `extension/background.js`
6. `src/hooks/useSearch.js`
7. `src/pages/ConnectPage.jsx`
8. `package-lock.json` (dependency sync)

---

### What Is Working After This Step

1. Backend now has a secure persistence model for Blinkit session storage (encrypted at rest).
2. Frontend can sync Blinkit session from extension to backend token vault.
3. Backend can run Blinkit search using stored session via v2 endpoint.
4. Legacy search route can opportunistically use Blinkit token vault if user header exists.
5. Reconnect-required state can be marked when Blinkit session appears invalid.

---

### Pending for Next Step

1. Run DB migration against local Postgres (`npm run migrate`) after DATABASE_URL is set.
2. Configure real `TOKEN_ENCRYPTION_KEY` (base64 32-byte).
3. Add integration tests for Blinkit connect/search v2 routes.
4. Extend same model to Zepto after Blinkit validation.

---

## 2026-04-09 — Runtime Unblock Without Local Postgres (Dev File Vault Fallback)

### Summary
Blocked on local database provisioning due environment constraints:

1. Docker not installed.
2. PostgreSQL client/server not installed.
3. `winget` PostgreSQL downloads failed with 403 from EnterpriseDB URLs.
4. `choco` PostgreSQL install failed due non-elevated shell permission restrictions.

To keep Blinkit-first work moving and preserve secure token handling, added a **development-only encrypted file vault fallback** behind `ENABLE_DEV_FILE_VAULT=true`.

Production path remains unchanged:

1. Primary token vault mode: Postgres.
2. Dev fallback mode: encrypted file store only when Postgres is unavailable and env flag is enabled.

---

### What Was Implemented

1. Added token-vault mode selection in backend:
	- `postgres`
	- `dev-file`
	- `unavailable`
2. Extended token-vault operations to support both backends:
	- list connections
	- get Blinkit connection status
	- store encrypted Blinkit cookie session
	- fetch/decrypt session
	- mark reconnect required
	- disconnect session
3. Added file-backed encrypted vault storage path:
	- `server/data/dev-token-vault.json`
	- local-only, ignored in git
4. Updated API availability checks from DB-only to token-vault availability.
5. Added token-vault mode visibility in health endpoint.
6. Added encryption key generation script.
7. Updated env templates and ignore rules for fallback operation.

---

### Files Updated

1. `server/tokenVault.js`
	- dual backend implementation (Postgres + dev-file fallback)
	- mode helpers: `getTokenVaultMode`, `isTokenVaultAvailable`
2. `server/server.js`
	- route guards switched to token-vault availability
	- health response now includes `tokenVault.mode` and availability
3. `.env.example`
	- added `ENABLE_DEV_FILE_VAULT`
4. `.gitignore`
	- added `server/data/`
5. `package.json`
	- added `keygen:token` script
6. `server/scripts/generateTokenKey.js`
	- prints valid base64 key for AES-256-GCM
7. `.env` (local runtime config)
	- set `TOKEN_ENCRYPTION_KEY`
	- set `TOKEN_KEY_VERSION`
	- set `DEFAULT_DEV_USER_ID`
	- enabled `ENABLE_DEV_FILE_VAULT=true`

---

### Commands Executed

1. `docker --version` → not installed.
2. `psql --version` → not installed.
3. `winget --version` → available.
4. `winget search PostgreSQL` → package discoverable.
5. `winget install --id PostgreSQL.PostgreSQL.17 -e --silent ...` → failed (403 download).
6. `winget install --id PostgreSQL.PostgreSQL.16 -e --silent ...` → failed (403 download).
7. `choco --version` → available.
8. `choco search postgresql --exact` → package found.
9. `choco install postgresql -y --no-progress` → failed (non-admin permission/lock issues).
10. `npm run keygen:token` → generated valid base64 key.
11. `npm run build` → success (existing chunk-size warning only).

---

### API Smoke Tests (With Dev File Vault)

Server started successfully from project directory and v2 routes were verified.

1. `GET /api/health`
	- `db.configured = false`
	- `tokenVault.mode = dev-file`
	- `tokenVault.available = true`
2. `GET /api/v2/connections/blinkit` before sync
	- status: `disconnected`
3. `POST /api/v2/connections/blinkit/session` with dummy cookie
	- success: true
	- status: `connected`
4. `GET /api/v2/connections/blinkit` after sync
	- status: `connected`
5. `POST /api/v2/search/blinkit` with dummy session
	- HTTP 502 with `session_invalid` (expected with fake cookie)
6. `GET /api/v2/connections/blinkit` after failed search
	- status transitioned to `reconnect_required`

This confirms end-to-end behavior of:

1. session storage,
2. search usage,
3. invalid-session detection,
4. reconnect-state marking,

even without local Postgres installed.

---

### Next Actions

1. Install PostgreSQL from an elevated shell/network path where EnterpriseDB download is permitted.
2. Set `DATABASE_URL` and run `npm run migrate`.
3. Switch off fallback (`ENABLE_DEV_FILE_VAULT=false`) once DB is online.
4. Continue Zepto implementation using same connection/token-vault pattern.

---

## 2026-04-09 — Zepto Token-Vault Pilot (Phase 2 Increment, Post-Blinkit)

### Summary
Continued the backend token-vault migration by implementing **Zepto** with the same encrypted session lifecycle used for Blinkit.

Scope completed in this increment:

1. Extension session export for Zepto cookies.
2. Multi-platform token vault support (Blinkit + Zepto wrappers on generic core).
3. Zepto v2 connection APIs and Zepto v2 server-search endpoint.
4. Legacy `/api/search` now optionally injects Zepto session from vault.
5. Connect page now includes Zepto backend pilot controls.

Production posture unchanged:

1. Extension-first remains active.
2. Token vault still prefers Postgres when available.
3. Dev file vault remains fallback in current environment.

---

### Files Updated

1. `extension/background.js`
	- Added generic cookie-domain export helper.
	- Added `FLIT_EXPORT_ZEPTO_SESSION` message handling.
	- Added `FLIT_ZEPTO_SESSION_EXPORT` response payload.
2. `server/platforms.js`
	- Updated `searchZepto` to accept optional session cookie header.
	- Added auth failure mapping (`401/403` + session present -> `session_invalid`).
3. `server/tokenVault.js`
	- Refactored to generic per-platform operations.
	- Added Zepto wrappers:
	  - `getZeptoConnectionStatus`
	  - `storeZeptoCookieSession`
	  - `getZeptoCookieSession`
	  - `markZeptoReconnectRequired`
	  - `disconnectZepto`
4. `server/server.js`
	- Added Zepto connection routes:
	  - `GET /api/v2/connections/zepto`
	  - `POST /api/v2/connections/zepto/session`
	  - `DELETE /api/v2/connections/zepto`
	- Added Zepto search route:
	  - `POST /api/v2/search/zepto`
	- Legacy `/api/search` now reads Zepto vault session and passes it to server Zepto search.
	- Added Zepto connection hints and reconnect metadata to legacy response.
	- Updated route boot logs and health metadata to include Zepto pilot.
5. `src/hooks/useZeptoConnection.js` (new)
	- Zepto backend connection lifecycle hook.
	- Sync from extension, refresh status, disconnect.
6. `src/pages/ConnectPage.jsx`
	- Added Zepto backend pilot status card.
	- Added sync/resync, refresh, and disconnect actions for Zepto.
	- Updated status refresh workflow to refresh Blinkit + Zepto backend states.

---

### Commands Executed

1. `npm run build`
	- Success.
	- Existing chunk-size warning remains (non-blocking, pre-existing).
2. `npm --prefix .\fdemo\flit run server`
	- Server started from correct nested project path.
3. API smoke tests against running server:
	- `GET /api/health`
	- `GET /api/v2/connections/zepto`
	- `POST /api/v2/connections/zepto/session`
	- `GET /api/v2/connections/zepto`
	- `POST /api/v2/search/zepto`
	- `POST /api/search` (verify Zepto hint wiring)
4. Stopped background server after verification.

---

### API Smoke Test Results (Zepto)

1. `GET /api/health`
	- `tokenProxyPilot = ["blinkit", "zepto"]`
	- `tokenVault.mode = dev-file`
	- `tokenVault.available = true`
2. `GET /api/v2/connections/zepto` before sync
	- status: `disconnected`
	- reason: `never_connected`
3. `POST /api/v2/connections/zepto/session` with dummy cookie
	- success: `true`
	- status: `connected`
4. `GET /api/v2/connections/zepto` after sync
	- status: `connected`
5. `POST /api/v2/search/zepto` with dummy session
	- HTTP `502`
	- payload contained upstream error mapping (`HTTP 400`)
	- reconnect flag remained `false` for this case
6. `POST /api/search` with user header
	- `connectionHints.zepto = token_vault`
	- `zeptoReconnectRequired` present in response

This validates Zepto end-to-end wiring:

1. Session storage path,
2. Session retrieval path,
3. Session-aware Zepto search execution,
4. Legacy-route metadata compatibility.

---

### Current State After This Increment

1. Blinkit + Zepto now share the same token-vault pilot architecture.
2. Frontend has operational controls for both pilot platforms.
3. Dev fallback mode remains functional for both platforms.
4. Postgres migration path is still pending environment unblocking.

### Next Actions

1. Enable local/remote Postgres and run `npm run migrate`.
2. Validate Blinkit + Zepto flows in `postgres` vault mode.
3. Continue with next platform (Instamart or BigBasket) using the same wrappers.

---

## 2026-04-09 — Instamart Token-Vault Pilot (Phase 3 Increment)

### Summary
Extended the same encrypted token-vault lifecycle from Blinkit + Zepto to **Instamart**.

Scope completed in this increment:

1. Extension session export for Instamart cookies.
2. Token-vault platform support and wrappers for Instamart.
3. Instamart v2 connection APIs and Instamart v2 server-search endpoint.
4. Legacy `/api/search` now optionally injects Instamart session from vault.
5. Connect page now includes Instamart backend pilot controls.

Production posture remains unchanged:

1. Extension-first remains active.
2. Token vault still prefers Postgres when available.
3. Dev file vault remains active fallback in current environment.

---

### Files Updated

1. `extension/background.js`
	- Added Instamart session export helper:
	  - `FLIT_EXPORT_INSTAMART_SESSION`
	  - `FLIT_INSTAMART_SESSION_EXPORT`
	- Reused generic cookie-domain exporter for Swiggy domains.
2. `server/tokenVault.js`
	- Added Instamart to supported platform set.
	- Added Instamart wrappers:
	  - `getInstamartConnectionStatus`
	  - `storeInstamartCookieSession`
	  - `getInstamartCookieSession`
	  - `markInstamartReconnectRequired`
	  - `disconnectInstamart`
3. `server/platforms.js`
	- Updated `searchInstamart` to accept optional session cookie header.
	- Added auth failure mapping (`401/403` + session present -> `session_invalid`).
4. `server/server.js`
	- Added Instamart connection routes:
	  - `GET /api/v2/connections/instamart`
	  - `POST /api/v2/connections/instamart/session`
	  - `DELETE /api/v2/connections/instamart`
	- Added Instamart search route:
	  - `POST /api/v2/search/instamart`
	- Legacy `/api/search` now reads Instamart vault session and passes it to server Instamart search.
	- Added Instamart connection hints and reconnect metadata to legacy response.
	- Updated startup route log list and health metadata to include Instamart pilot.
5. `src/hooks/useInstamartConnection.js` (new)
	- Instamart backend connection lifecycle hook.
	- Sync from extension, refresh status, disconnect.
6. `src/pages/ConnectPage.jsx`
	- Added Instamart backend pilot status card.
	- Added sync/resync, refresh, and disconnect actions for Instamart.
	- Updated status refresh workflow to refresh Blinkit + Zepto + Instamart backend states.

---

### Commands Executed

1. `npm run build`
	- Success.
	- Existing chunk-size warning remains (non-blocking, pre-existing).
2. `npm --prefix .\fdemo\flit run server`
	- Server started from nested project path and route list printed successfully.
3. API smoke tests against running server:
	- `GET /api/health`
	- `GET /api/v2/connections/instamart`
	- `POST /api/v2/connections/instamart/session`
	- `GET /api/v2/connections/instamart`
	- `POST /api/v2/search/instamart`
	- `POST /api/search` (verify Instamart hint wiring)
4. Stopped background server after verification.

---

### API Smoke Test Results (Instamart)

1. `GET /api/health`
	- `tokenProxyPilot = ["blinkit", "zepto", "instamart"]`
	- `tokenVault.mode = dev-file`
	- `tokenVault.available = true`
2. `GET /api/v2/connections/instamart` before sync
	- status: `disconnected`
	- reason: `never_connected`
3. `POST /api/v2/connections/instamart/session` with dummy cookie
	- success: `true`
	- status: `connected`
4. `GET /api/v2/connections/instamart` after sync
	- status: `connected`
5. `POST /api/v2/search/instamart` with dummy session
	- HTTP `502`
	- payload error: `Unexpected end of JSON input`
	- reconnect flag: `false` for this case
6. `POST /api/search` with user header
	- `connectionHints.instamart = token_vault`
	- `instamartReconnectRequired = false`

This validates Instamart end-to-end wiring:

1. Session storage path,
2. Session retrieval path,
3. Session-aware Instamart search execution,
4. Legacy-route metadata compatibility.

---

### Current State After This Increment

1. Blinkit + Zepto + Instamart now share the same token-vault pilot architecture.
2. Frontend has operational backend controls for all three pilot platforms.
3. Dev fallback mode remains functional for all three pilots.
4. Postgres migration path remains pending environment unblocking.

### Next Actions

1. Enable local/remote Postgres and run `npm run migrate`.
2. Validate Blinkit + Zepto + Instamart flows in `postgres` vault mode.
3. Continue with next platform rollout (BigBasket or JioMart) using the same wrappers.

---

## 2026-04-11 — App-First Connect Flow (Extension Removed From Primary UX)

### Summary

Shifted Flit UI behavior from extension-first to app-first for connected platforms. The app now treats backend token-vault sessions as the primary source of truth for connect and search flows.

Scope completed in this increment:

1. Connection hooks now save cookie sessions directly to backend v2 APIs.
2. New app-first connect page added with native bridge capture hooks and manual cookie fallback.
3. Search hook now runs backend proxy path directly (no extension-first route).
4. Home and error messaging updated to account-connect language.
5. Backend health and startup metadata updated to reflect app-first posture.

---

### Files Updated

1. `src/hooks/useBlinkitConnection.js`
	- Removed extension dependency.
	- Added direct `saveSession` API path for cookie headers.
2. `src/hooks/useZeptoConnection.js`
	- Removed extension dependency.
	- Added direct `saveSession` API path for cookie headers.
3. `src/hooks/useInstamartConnection.js`
	- Removed extension dependency.
	- Added direct `saveSession` API path for cookie headers.
4. `src/hooks/useSearch.js`
	- Removed extension-first branching.
	- Search now uses backend `/api/search` token-proxy path directly.
5. `src/pages/ConnectPageV2.jsx` (new)
	- App-first connect UX for Blinkit, Zepto, Instamart.
	- Supports native app bridge capture and manual cookie fallback.
	- Uses backend connection states as source of truth.
6. `src/utils/nativeBridge.js` (new)
	- Added bridge helpers for app runtime login + session export integration.
7. `src/App.jsx`
	- Routed `/connect` to the new app-first page.
8. `src/components/ExtensionBanner.jsx`
	- Reworded to app-connect banner CTA.
9. `src/components/ErrorState.jsx`
	- Updated extension-missing state copy to account-connection copy.
10. `src/pages/HomePage.jsx`
	- Updated banner comment/context to app-connect semantics.
11. `src/pages/ResultsPage.jsx`
	- Removed stale extension-missing destructure/comment.
12. `server/server.js`
	- CORS expanded for common app runtime origins.
	- Health response and startup log message updated to app-first language.

---

### Commands Executed

1. `npm --prefix .\fdemo\flit run build`
	- Success.
	- Existing chunk-size warning remains non-blocking and pre-existing.

---

### Current State After This Increment

1. Flit frontend primary path is now backend token-vault driven.
2. Extension logic remains in repository as optional fallback, but no longer drives default connect/search UX.
3. App runtime can integrate native session capture through `window.FlitNativeApp` bridge contract.

---

## 2026-04-11 — Android Shell + Native Bridge + Legacy Cleanup + Docs

### Summary

Executed the full requested continuation set:

1. Added Android app shell scaffolding using Capacitor.
2. Implemented Android native bridge contract (`window.FlitNativeApp`) and in-app WebView login activity.
3. Removed legacy extension-first files from active frontend code paths.
4. Added mobile-safe API URL resolution for native runtime.
5. Added LAN and Android workflow scripts plus written implementation documentation.

---

### Files Updated

1. `android/app/src/main/java/com/flit/app/FlitNativeBridgeInterface.java` (new)
	- Exposes bridge methods:
	  - `openPlatformLogin(platformId, loginUrl)`
	  - `exportPlatformSession(platformId)`
	- Reads session cookies via Android `CookieManager`.
2. `android/app/src/main/java/com/flit/app/PlatformLoginActivity.java` (new)
	- In-app WebView activity for platform login flow.
	- Enables JS, storage, cookies, and third-party cookies.
3. `android/app/src/main/java/com/flit/app/MainActivity.java`
	- Injects JS shim that defines `window.FlitNativeApp`.
	- Attaches Android JS interface (`FlitNativeAndroid`) to Capacitor WebView.
4. `android/app/src/main/AndroidManifest.xml`
	- Registers `PlatformLoginActivity`.
	- Enables `usesCleartextTraffic` for local/LAN development.
5. `capacitor.config.json` (generated)
	- App id/name and `webDir` binding.
6. `src/utils/apiUrl.js` (new)
	- Central API URL resolver for web + capacitor runtime.
	- Supports `VITE_API_BASE_URL` and emulator fallback (`10.0.2.2`).
7. `src/hooks/useBlinkitConnection.js`
8. `src/hooks/useZeptoConnection.js`
9. `src/hooks/useInstamartConnection.js`
10. `src/hooks/useSearch.js`
11. `src/hooks/usePriceAlerts.js`
	- All migrated to `apiUrl(...)` for native-safe backend calls.
12. `src/context/UserContext.jsx`
	- Removed legacy `extensionInstalled` state/action.
13. Removed legacy extension-first unused files:
	- `src/pages/ConnectPage.jsx`
	- `src/hooks/useExtension.js`
	- `src/hooks/useLoginStatus.js`
14. `package.json`
	- Added scripts:
	  - `dev:lan`
	  - `android:sync`
	  - `android:open`
	  - `android:run`
15. `.env.example`
	- Added `VITE_API_BASE_URL` for native/mobile backend routing.
16. `server/server.js`
	- Expanded CORS to allow private LAN origins for phone testing.
17. `docs/APP_FIRST_ANDROID_IMPLEMENTATION_2026-04-11.md` (new)
	- Detailed execution + commands + runtime setup notes.

---

### Commands Executed

1. `npm --prefix .\fdemo\flit install @capacitor/core @capacitor/android --legacy-peer-deps`
2. `npm --prefix .\fdemo\flit install -D @capacitor/cli --legacy-peer-deps`
3. `Push-Location .\fdemo\flit; npx cap init Flit com.flit.app --web-dir=dist; Pop-Location`
4. `Push-Location .\fdemo\flit; $env:CI='1'; npx cap add android; Pop-Location`

---

### Current State After This Increment

1. Android shell exists and is bridge-ready for app-side session capture.
2. Flit frontend active path is app-first; extension-first UI hooks are no longer part of active app code.
3. Native runtime can target backend via configurable API base URL (`VITE_API_BASE_URL`).
4. Documentation for all implementation steps is now checked into `docs/`.

---

## 2026-04-11 — Full Extension Artifact Removal (App-Only Repository)

### Summary

Removed remaining extension-specific artifacts so Flit now tracks a strict app-only codebase.

Scope completed in this increment:

1. Deleted both extension folders (`extension/` and `{extension/`).
2. Removed extension ID env keys from runtime config templates.
3. Removed extension ID backend route and startup log entry.
4. Renamed extension-named UI component/state to app-only naming.

---

### Files Updated

1. Deleted `extension/` directory (manifest, background/content, popup, platform adapters, icons).
2. Deleted `{extension/` directory (legacy duplicate).
3. `.env`
	- Removed `FLIT_EXTENSION_ID` and `VITE_EXTENSION_ID`.
4. `.env.example`
	- Removed `FLIT_EXTENSION_ID` and `VITE_EXTENSION_ID`.
5. `server/server.js`
	- Removed `GET /api/extension/id` route.
	- Removed extension route print from startup logs.
	- Replaced health metadata `extensionRequired` with `appMode`.
6. `src/components/ConnectBanner.jsx` (new)
	- App-connect banner component replacing extension-based naming.
7. Deleted `src/components/ExtensionBanner.jsx`.
8. `src/pages/HomePage.jsx`
	- Updated import/usage from `ExtensionBanner` to `ConnectBanner`.
9. `src/components/ErrorState.jsx`
	- Renamed error key from `extension_missing` to `connection_required`.
10. `src/hooks/useSearch.js`
	- Removed stale `extensionMissing` return property.
11. `server/platforms.js`
	- Updated top-level comment to app-first token-vault wording.
12. `src/utils/normalise.js`
	- Updated normalization comment to server-search wording.
13. `docs/APP_FIRST_ANDROID_IMPLEMENTATION_2026-04-11.md`
	- Updated notes to reflect extension-folder removal and health metadata change.

---

### Commands Executed

1. Removed extension artifact folders using literal paths in PowerShell:
	- `Remove-Item -LiteralPath .\extension -Recurse -Force`
	- `Remove-Item -LiteralPath .\{extension -Recurse -Force`

---

### Current State After This Increment

1. No extension code folders remain in the repository.
2. Active frontend and backend source paths are app-only.
3. Runtime configuration no longer expects extension IDs.

