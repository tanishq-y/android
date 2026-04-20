# Flit Mobile Architecture — Refined Execution Plan

Date: 2026-04-12
Input Reference: FLIT_MOBILE_ARCHITECTURE.md

## 1. Why "nothing happened" in current testing

1. The architecture spec is token-proxy first (backend decrypts user platform sessions and fans out search), but current app changes introduced device-side adapter execution in Android bridge.
2. Current backend connect flow still depends on API reachability from phone. If backend is not reachable, platform status and saved sessions do not update, and searches can return empty.
3. Current token vault mostly stores cookieHeader only for pilot platforms, while spec requires structured session storage:
   - cookies
   - headers
   - extra
4. Current project is Capacitor + React web app. Spec target is React Native mobile app. This is a major architectural gap, not a small patch.

## 2. Target alignment strategy

Use a two-track approach so progress is visible quickly without blocking the final architecture.

### Track A (Immediate Stabilization, 1-2 weeks)

Goal: Make current repo behave like the spec logically (token-proxy, encrypted per-user sessions, parallel backend search), even before React Native migration.

### Track B (Full Spec Cutover, 3-6 weeks)

Goal: Build the React Native mobile app defined in FLIT_MOBILE_ARCHITECTURE.md and migrate traffic from Capacitor app.

## 3. Refined phases for current repo

## Phase A1: Backend Contract Alignment

1. Introduce spec-aligned routes in server:
   - POST /api/auth/register
   - POST /api/auth/login
   - POST /api/auth/refresh
   - POST /api/platforms/connect
   - GET /api/platforms/status
   - DELETE /api/platforms/:platform
   - POST /api/platforms/:platform/verify
   - POST /api/search
2. Keep current /api/v2 routes as compatibility layer only during migration.
3. Replace x-flit-user-id primary identity with JWT for all new routes.
4. Add zod request validation on every new route.

Definition of done:
1. New routes are live and documented.
2. Old routes still work temporarily.
3. Auth required on platform/search routes.

## Phase A2: Token Vault Data Model Alignment

1. Extend storage model to save structured PlatformSession payload per user/platform:
   - cookies: Record<string,string>
   - headers: Record<string,string>
   - extra: Record<string,string>
2. Continue AES-256-GCM encryption.
3. Add explicit token validity flags and last validation timestamps.
4. Add audit events without storing plaintext secrets in logs.

Definition of done:
1. Platform session can round-trip encrypt/decrypt as JSON.
2. No plaintext session values appear in logs.

## Phase A3: Search Proxy Refactor

1. Move canonical search execution to backend /api/search only.
2. For each connected platform:
   - load encrypted session
   - decrypt
   - call adapter with session
   - normalize to shared product contract
3. Add Promise.allSettled fanout and per-platform status map.
4. Add Redis 90s TTL cache keyed by userId:query:lat:lon.
5. Add per-user rate limiting for search and connect endpoints.

Definition of done:
1. /api/search returns merged normalized results.
2. platformStatus includes success|error|not_connected.
3. Cache hit path works.

## Phase A4: Client Flow Alignment (Current Capacitor App)

1. Keep existing Connect screen but change session submit format to spec PlatformSession structure.
2. Use JWT auth in client API layer.
3. Replace native-first search path as default with backend /api/search proxy path.
4. Keep native bridge only for login/cookie capture, not for search fanout.

Definition of done:
1. Connect updates platform status through spec routes.
2. Search results appear from backend proxy using stored sessions.

## 4. React Native Cutover Plan (Spec Compliance)

## Phase B1: New mobile/ app skeleton

1. Create mobile/ React Native app with navigation, Zustand, NativeWind, WebView.
2. Build auth store and API service with JWT support.

## Phase B2: Platform login WebView implementation

1. Implement PlatformLoginScreen with header interceptor and cookie capture.
2. Submit captured session to /api/platforms/connect.
3. Build ConnectScreen status cards exactly as spec.

## Phase B3: Search and results UX

1. Implement SearchScreen and ResultsScreen using /api/search.
2. Add sorting/filtering and best-deal logic.
3. Add platform-specific error display.

## Phase B4: Reliability and security hardening

1. Add BullMQ token validity checks.
2. Add reconnect prompts for expired sessions.
3. Add helmet, strict input validation, and logging redaction.

## 5. Concrete delta vs current code

Current state (already present):
1. Capacitor Android bridge with login/session export.
2. Pilot token vault and platform search logic in server.
3. Basic app-first connection flows for Blinkit/Zepto/Instamart.

Missing for spec alignment:
1. JWT auth-first API contract.
2. Structured platform session storage (cookies + headers + extra).
3. Canonical backend token-proxy search route contract.
4. Full 5-platform adapter parity.
5. React Native mobile app under mobile/.

## 6. Recommended next 3 actions (highest impact)

1. Implement Phase A1 route contract and JWT migration in server first.
2. Implement Phase A2 structured token vault session model.
3. Switch current client search to backend /api/search proxy path (disable native search fanout default).

If these 3 are done first, testing will produce predictable behavior aligned to your architecture doc and "nothing happened" situations become diagnosable through one canonical backend search path.
