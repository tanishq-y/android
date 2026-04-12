# Flit Roadmap: Extension-First to Backend Token Proxy

Date: 2026-04-09
Status: Draft for approval before implementation

## 1. Goal

Move Flit from browser-extension-dependent search to a backend token-proxy model that works across web and mobile while preserving user privacy and platform-specific session behavior.

Expected outcome:

1. Users connect each platform once.
2. Flit stores encrypted session artifacts per user.
3. Search proxy uses user-specific sessions server-side.
4. Extension becomes optional fallback, not required core.


## 2. Scope

### In scope

1. User auth foundation for Flit accounts.
2. Postgres schema for users, connections, tokens, and audits.
3. Encryption layer for token at rest.
4. Connect and reconnect flows.
5. Search proxy using per-user session tokens.
6. Health checks, rate limits, caching, retry policy.
7. UI updates for connect status and degraded states.

### Out of scope for first release

1. Full mobile app implementation.
2. Automatic token refresh for every platform (platform-specific complexity).
3. Complete replacement of extension on day one.


## 3. Assumptions to confirm

1. Database is Postgres.
2. Deployment starts local-first, then cloud.
3. Platform rollout is incremental, starting with Blinkit.
4. Existing extension remains fallback during migration.


## 4. Phase Plan

## Phase 0: Product and Security Freeze
Duration: 2 to 4 days

Objectives:

1. Finalize architecture decisions.
2. Confirm legal and policy boundaries for token/session handling.
3. Freeze V1 platform set and fallback behavior.

Deliverables:

1. Architecture decision note.
2. Data classification and security policy note.
3. V1 feature acceptance checklist.

Exit criteria:

1. Team signs off on security model.
2. Platform order is approved.


## Phase 1: Foundation (Identity, Data, Encryption)
Duration: 1 week

Objectives:

1. Add persistent user model.
2. Add secure token vault model in database.
3. Add encryption/decryption services with rotation-ready design.

Implementation tasks:

1. Add database migration tool and migration scripts.
2. Create tables:
   - users
   - platform_connections
   - platform_tokens
   - token_audit_events
3. Build crypto service:
   - encrypt token before save
   - decrypt token only at proxy call time
   - secure key source from environment or KMS abstraction
4. Add auth middleware for per-user resource isolation.

Deliverables:

1. DB schema in source control.
2. Crypto service with tests.
3. Auth-aware backend request context.

Exit criteria:

1. Can create user and store encrypted token row.
2. No raw token appears in logs.


## Phase 2: Connect Flow APIs and UI
Duration: 1 to 2 weeks

Objectives:

1. Allow users to connect platform accounts to Flit profile.
2. Persist encrypted session artifacts.
3. Expose connection status to frontend.

Implementation tasks:

1. Add connect endpoints:
   - start connect
   - callback/complete connect
   - get connection status
   - disconnect
2. Implement platform-specific token capture strategy for first platform.
3. Add connection status states:
   - connected
   - disconnected
   - expired
   - reconnect_required
4. Update connect page and status chips in app.

Deliverables:

1. Working connect flow for pilot platform.
2. Frontend status UI fully driven by backend.

Exit criteria:

1. User can connect and disconnect pilot platform from app UI.
2. Stored token is encrypted and linked to correct user.


## Phase 3: Search Proxy Vertical Slice
Duration: 1 to 2 weeks

Objectives:

1. Search using backend token vault for connected users.
2. Preserve current result normalization behavior.
3. Provide graceful fallback when platform session fails.

Implementation tasks:

1. Add per-user token retrieval in search request path.
2. Inject session token/cookies to outbound platform request.
3. Reuse and adapt existing normalizers.
4. Add per-platform timeout, retry, and error mapping.
5. Add short TTL cache on query plus location plus user/connection context.

Deliverables:

1. End-to-end search for pilot platform without extension.
2. Stable error states in results page.

Exit criteria:

1. Connected user gets valid search result from backend proxy.
2. Expired token maps to reconnect_required state.


## Phase 4: Hardening (Rate Limit, Health, Observability)
Duration: 1 week

Objectives:

1. Protect platform APIs and Flit backend from abuse.
2. Add visibility into reliability and failures.

Implementation tasks:

1. Add user and IP rate limits.
2. Add platform circuit breaker thresholds.
3. Add structured logs and metrics:
   - search latency
   - success rate by platform
   - token error rate
   - reconnect events
4. Add audit trail for token create/update/delete.

Deliverables:

1. Production-safe operational baseline.

Exit criteria:

1. Observability dashboard shows platform health.
2. Abuse controls verified in test.


## Phase 5: Multi-Platform Expansion
Duration: 2 to 4 weeks

Objectives:

1. Scale pilot to remaining platforms one by one.

Implementation tasks per platform:

1. Implement connect strategy.
2. Implement token injection and search adapter.
3. Add expiry detection mapping.
4. Add integration tests.

Deliverables:

1. Supported platforms marked backend-ready.

Exit criteria:

1. Each added platform meets reliability target before release.


## Phase 6: Migration Completion
Duration: 1 week

Objectives:

1. Transition extension from required to optional fallback.
2. Finalize user messaging and release policy.

Implementation tasks:

1. Change default search path to backend token proxy.
2. Keep extension path behind fallback feature flag.
3. Update docs, onboarding, and support playbook.

Deliverables:

1. Stable release with extension-optional behavior.

Exit criteria:

1. Core search and connect works without extension for supported platforms.


## 5. Recommended Platform Rollout Order

1. Blinkit (pilot)
2. Zepto
3. Instamart
4. BigBasket
5. JioMart

Reason:

1. Fast validation of architecture with one platform.
2. Incremental risk containment.
3. Faster first release.


## 6. Milestones

1. M1: Foundation complete (Phase 1 done)
2. M2: Pilot connect complete (Phase 2 for Blinkit)
3. M3: Pilot proxy search live (Phase 3 for Blinkit)
4. M4: Hardening complete (Phase 4)
5. M5: Multi-platform expansion done (Phase 5)
6. M6: Extension optional release (Phase 6)


## 7. Risks and Mitigations

1. Platform auth/session changes frequently.
   - Mitigation: adapter isolation, contract tests, fast rollback.
2. Token leakage risk.
   - Mitigation: encryption, strict logs redaction, limited decrypt scope.
3. Session expiry volatility.
   - Mitigation: health checks and reconnect_required workflow.
4. Increased backend cost/latency.
   - Mitigation: cache, rate limits, parallel fan-out controls.
5. Legal/policy uncertainty.
   - Mitigation: explicit compliance review before Phase 2 production rollout.


## 8. Definition of Done for V1

1. User can connect Blinkit account in app.
2. Search works from backend using stored encrypted session.
3. Expired/invalid session prompts reconnect clearly.
4. No raw token stored or logged.
5. Observability and rate limiting in place.


## 9. Work Breakdown (Ticket-Level Starter)

1. Create migrations and DB models.
2. Implement token crypto service and tests.
3. Implement user auth middleware and user identity propagation.
4. Build connect status API and UI state integration.
5. Build pilot platform token capture flow.
6. Build backend proxy search for pilot platform.
7. Integrate proxy path into frontend search hook with feature flag.
8. Add error mapping and reconnect UX.
9. Add rate limiter, audit logs, and metrics.
10. Run pilot validation and release checklist.


## 10. Approval Checklist Before Coding

1. Approve platform order.
2. Approve Postgres and migration tool choice.
3. Approve extension fallback during migration.
4. Approve local-first then cloud deployment order.
5. Approve V1 done criteria.
