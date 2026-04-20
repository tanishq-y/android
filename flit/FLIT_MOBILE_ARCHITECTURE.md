# Flit Mobile — Full Architecture Spec
**Version:** 1.0  
**Date:** 2026-04-12  
**Audience:** AI coding agent / lead engineer  
**Scope:** Mobile-only (React Native), token proxy backend, 5-platform search

---

## 1. What We Are Building

A React Native app that:
1. Lets users log into Blinkit, Zepto, Instamart, BigBasket, JioMart inside the app using their real accounts (via in-app WebView).
2. Captures and stores the session token for each connected platform securely on the backend.
3. When the user searches for a product, fires parallel requests to every connected platform using each platform's real user session — so requests look like the user searching on their own device.
4. Returns normalized results to the app for side-by-side price comparison.

**Why this works against Cloudflare / bot protection:** Every outbound request from the backend carries a real user session token (cookies + auth headers) belonging to that actual user. From the platform's perspective it is indistinguishable from the user searching on their own phone.

---

## 2. Tech Stack

### Mobile (React Native)
| Layer | Choice | Reason |
|---|---|---|
| Framework | React Native 0.74 (bare workflow) | Full native access needed for cookie extraction |
| Navigation | React Navigation v6 | Stack + Tab navigators |
| WebView | react-native-webview 13.x | Platform login flows |
| Cookie reader | @react-native-cookies/cookies | Extract cookies after WebView login |
| Secure storage | expo-secure-store | Encrypted local storage for Flit JWT |
| HTTP client | axios 1.x | Request interceptors, instance-per-platform |
| State | Zustand | Lightweight, no boilerplate |
| UI | NativeWind (Tailwind for RN) | Consistent with existing web code |

### Backend (Node.js)
| Layer | Choice | Reason |
|---|---|---|
| Runtime | Node 20 LTS | Current stable |
| Framework | Express 4.x | Team already knows it |
| Database | PostgreSQL 16 | Relational, reliable, free |
| ORM | Drizzle ORM | Lightweight, TypeScript-native, no magic |
| Caching | Redis 7 | TTL cache for search results |
| Encryption | Node built-in `crypto` AES-256-GCM | No extra dependencies |
| Auth (Flit users) | JWT (jsonwebtoken) | Stateless, simple |
| Job queue | BullMQ + Redis | Token refresh checks |
| Env config | dotenv + zod validation | Fail fast on missing vars |

---

## 3. Repository Structure

```
flit/
├── mobile/                          # React Native app
│   ├── src/
│   │   ├── screens/
│   │   │   ├── HomeScreen.tsx
│   │   │   ├── SearchScreen.tsx
│   │   │   ├── ResultsScreen.tsx
│   │   │   ├── ConnectScreen.tsx        # Platform connection hub
│   │   │   ├── PlatformLoginScreen.tsx  # WebView login per platform
│   │   │   └── CartScreen.tsx
│   │   ├── components/
│   │   │   ├── ProductCard.tsx
│   │   │   ├── PlatformBadge.tsx
│   │   │   ├── BestDealBanner.tsx
│   │   │   └── PlatformStatusCard.tsx
│   │   ├── store/
│   │   │   ├── useAuthStore.ts          # Flit user auth state
│   │   │   ├── useSearchStore.ts        # Search state + results
│   │   │   └── usePlatformStore.ts      # Connected platforms state
│   │   ├── services/
│   │   │   ├── api.ts                   # Axios instance to Flit backend
│   │   │   ├── search.service.ts
│   │   │   └── platform.service.ts
│   │   ├── platforms/
│   │   │   ├── index.ts                 # Platform metadata (names, colors, urls)
│   │   │   ├── blinkit.ts               # Blinkit-specific login URL + token extraction
│   │   │   ├── zepto.ts
│   │   │   ├── instamart.ts
│   │   │   ├── bigbasket.ts
│   │   │   └── jiomart.ts
│   │   └── utils/
│   │       ├── normalise.ts
│   │       └── unitPrice.ts
│   ├── android/
│   ├── ios/
│   └── package.json
│
├── server/                          # Express backend (keep existing, extend it)
│   ├── db/
│   │   ├── schema.ts                # Drizzle schema definitions
│   │   ├── migrate.ts               # Run migrations
│   │   └── index.ts                 # DB connection pool
│   ├── crypto/
│   │   └── vault.ts                 # Token encryption/decryption
│   ├── platforms/
│   │   ├── blinkit.ts               # Search adapter using user session
│   │   ├── zepto.ts
│   │   ├── instamart.ts
│   │   ├── bigbasket.ts
│   │   ├── jiomart.ts
│   │   └── normalise.ts             # Shared normalisation
│   ├── routes/
│   │   ├── auth.ts                  # /api/auth (register, login, refresh)
│   │   ├── platforms.ts             # /api/platforms (connect, disconnect, status)
│   │   └── search.ts                # /api/search
│   ├── middleware/
│   │   ├── requireAuth.ts           # JWT guard
│   │   └── rateLimit.ts
│   ├── jobs/
│   │   └── tokenRefresh.ts          # BullMQ job: check token expiry
│   ├── cache.ts                     # Redis TTL wrapper
│   └── server.ts
│
└── .env.example
```

---

## 4. Database Schema

Create all tables in PostgreSQL. Use Drizzle ORM for type safety.

```sql
-- Users table: Flit accounts only, no platform credentials here
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,          -- bcrypt, cost 12
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Platform tokens: one row per user per platform
-- The token_blob column holds the encrypted JSON payload
-- Plaintext shape before encryption: { cookies: {}, headers: {}, extra: {} }
CREATE TABLE platform_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL,            -- 'blinkit' | 'zepto' | 'instamart' | 'bigbasket' | 'jiomart'
  token_blob      TEXT NOT NULL,            -- AES-256-GCM encrypted JSON, base64 encoded
  encryption_iv   TEXT NOT NULL,            -- 12-byte IV, base64 encoded
  encryption_tag  TEXT NOT NULL,            -- 16-byte GCM auth tag, base64 encoded
  is_valid        BOOLEAN DEFAULT true,     -- set false when token expires or request returns 401
  last_used_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,              -- nullable, set when platform gives explicit expiry
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, platform)                 -- one active token per user per platform
);

-- Optional: search history for recent searches feature
CREATE TABLE search_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query       TEXT NOT NULL,
  searched_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_platform_tokens_user ON platform_tokens(user_id);
CREATE INDEX idx_search_history_user ON search_history(user_id, searched_at DESC);
```

---

## 5. Encryption Design (Token Vault)

File: `server/crypto/vault.ts`

Use AES-256-GCM. The encryption key is derived per user from a master secret so that each user's data is independently keyed.

```typescript
import { createCipheriv, createDecipheriv, randomBytes, createHmac } from 'crypto';

const MASTER_KEY = Buffer.from(process.env.TOKEN_MASTER_KEY!, 'hex'); // 32 bytes hex in env

// Derive a per-user 256-bit key using HMAC-SHA256(masterKey, userId)
function deriveKey(userId: string): Buffer {
  return createHmac('sha256', MASTER_KEY).update(userId).digest();
}

export function encrypt(userId: string, plaintext: string): { blob: string; iv: string; tag: string } {
  const key = deriveKey(userId);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    blob: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decrypt(userId: string, blob: string, iv: string, tag: string): string {
  const key = deriveKey(userId);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(blob, 'base64')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}
```

**ENV requirement:** `TOKEN_MASTER_KEY` must be a 64-character hex string (32 bytes). Generate once with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and never rotate without migrating existing tokens.

---

## 6. Platform Session Format

Each platform requires different credentials. The `token_blob` decrypts to a JSON object in this shape:

```typescript
// The plaintext stored per platform
type PlatformSession = {
  cookies: Record<string, string>;  // cookie name -> value
  headers: Record<string, string>;  // header name -> value (auth tokens, etc.)
  extra: Record<string, string>;    // platform-specific extras (store_id, lat, lon, etc.)
};
```

### Per-Platform Session Details

**Blinkit**
```json
{
  "cookies": {
    "gr_1": "<session_value>"
  },
  "headers": {
    "Authorization": "Bearer <token>"
  },
  "extra": {
    "lat": "28.6139",
    "lon": "77.2090",
    "store_id": "<store_id>"
  }
}
```
Key cookie: `gr_1`. Also needs `lat`/`lon` for store selection. Token captured from Authorization header of any authenticated XHR during WebView session.

**Zepto**
```json
{
  "cookies": {},
  "headers": {
    "Authorization": "Bearer <access_token>",
    "X-Device-Token": "<device_token>"
  },
  "extra": {
    "store_id": "<store_id>"
  }
}
```
Token captured from Authorization header. The device token is set at app init and stays constant per install.

**Instamart (Swiggy)**
```json
{
  "cookies": {
    "_sid": "<session_id>",
    "csrftoken": "<csrf_token>"
  },
  "headers": {},
  "extra": {}
}
```
Cookie-based. `_sid` is the session cookie. Read all cookies from WebView after login redirect.

**BigBasket**
```json
{
  "cookies": {
    "bb_auth_token": "<token>",
    "_bb_csrf": "<csrf>"
  },
  "headers": {
    "X-Auth-Token": "<token>"
  },
  "extra": {}
}
```
Both cookie and header auth. Capture both.

**JioMart**
```json
{
  "cookies": {
    "PHPSESSID": "<session>",
    "customer_token": "<token>"
  },
  "headers": {
    "X-JioMart-Token": "<token>"
  },
  "extra": {}
}
```
Cookie + header combo. Read cookies after login, capture token from any post-login XHR header.

---

## 7. WebView Login Flow (Mobile)

File: `mobile/src/screens/PlatformLoginScreen.tsx`

This is the screen that opens when a user taps "Connect Blinkit" (or any platform). It:
1. Opens the platform's actual login URL in a WebView.
2. Injects JavaScript that intercepts outgoing network requests to capture auth tokens.
3. Monitors cookies via `@react-native-cookies/cookies` after the login redirect resolves.
4. Sends the captured session to the backend `/api/platforms/connect` endpoint.
5. Closes and marks the platform as connected.

### WebView Configuration

```tsx
import WebView from 'react-native-webview';
import CookieManager from '@react-native-cookies/cookies';

// Injected JS — intercepts fetch and XHR to sniff auth headers
const HEADER_INTERCEPTOR_JS = `
(function() {
  const captured = {};

  // Intercept fetch
  const originalFetch = window.fetch;
  window.fetch = function(url, options = {}) {
    const headers = options.headers || {};
    const auth = headers['Authorization'] || headers['authorization'];
    if (auth && auth.startsWith('Bearer ')) {
      captured['Authorization'] = auth;
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'HEADERS', data: captured }));
    }
    return originalFetch.apply(this, arguments);
  };

  // Intercept XHR
  const XHR = XMLHttpRequest.prototype;
  const origOpen = XHR.open;
  const origSetHeader = XHR.setRequestHeader;
  XHR.open = function(method, url) {
    this._url = url;
    return origOpen.apply(this, arguments);
  };
  XHR.setRequestHeader = function(header, value) {
    if (header.toLowerCase() === 'authorization') {
      captured['Authorization'] = value;
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'HEADERS', data: captured }));
    }
    return origSetHeader.apply(this, arguments);
  };
})();
true;
`;

// Platform login URLs
const LOGIN_URLS = {
  blinkit:   'https://blinkit.com/login',
  zepto:     'https://zeptonow.com/login',
  instamart: 'https://www.swiggy.com/instamart',
  bigbasket: 'https://www.bigbasket.com/accounts/login/',
  jiomart:   'https://www.jiomart.com/login',
};

// Success redirect patterns — detect these to know login is complete
const SUCCESS_PATTERNS = {
  blinkit:   /blinkit\.com\/(home|search|v2\/)/,
  zepto:     /zeptonow\.com\/(cn|home|search)/,
  instamart: /swiggy\.com\/instamart\/?(home|search)?/,
  bigbasket: /bigbasket\.com\/?($|\?|#|\/bb-now)/,
  jiomart:   /jiomart\.com\/(home|dashboard|my-account)/,
};
```

### Login Screen Component (key logic only)

```tsx
export function PlatformLoginScreen({ route, navigation }) {
  const { platform } = route.params;
  const [capturedHeaders, setCapturedHeaders] = useState({});

  const handleNavigationChange = async (navState) => {
    const url = navState.url;
    // Detect successful login by URL pattern
    if (SUCCESS_PATTERNS[platform]?.test(url)) {
      // Read cookies after successful login
      const cookies = await CookieManager.get(url);
      const cookieMap = Object.fromEntries(
        Object.entries(cookies).map(([k, v]) => [k, v.value])
      );
      await submitSession(cookieMap, capturedHeaders);
    }
  };

  const handleWebViewMessage = (event) => {
    const msg = JSON.parse(event.nativeEvent.data);
    if (msg.type === 'HEADERS') {
      setCapturedHeaders(prev => ({ ...prev, ...msg.data }));
    }
  };

  const submitSession = async (cookies, headers) => {
    await platformService.connectPlatform(platform, {
      cookies,
      headers,
      extra: {}, // location/store resolved on backend after connection
    });
    navigation.replace('ConnectScreen', { justConnected: platform });
  };

  return (
    <WebView
      source={{ uri: LOGIN_URLS[platform] }}
      injectedJavaScript={HEADER_INTERCEPTOR_JS}
      onMessage={handleWebViewMessage}
      onNavigationStateChange={handleNavigationChange}
      thirdPartyCookiesEnabled={true}
      domStorageEnabled={true}
      javaScriptEnabled={true}
      // Set a realistic user-agent matching the platform's expected mobile browser
      userAgent="Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Mobile Safari/537.36"
    />
  );
}
```

---

## 8. Backend API Contract

### Auth Routes (`/api/auth`)

```
POST /api/auth/register
Body: { email, password }
Response: { token, user: { id, email } }

POST /api/auth/login
Body: { email, password }
Response: { token, user: { id, email } }

POST /api/auth/refresh
Headers: Authorization: Bearer <token>
Response: { token }
```

### Platform Routes (`/api/platforms`)

All routes require `Authorization: Bearer <flit_jwt>` header.

```
POST /api/platforms/connect
Body: { platform, session: { cookies, headers, extra } }
Response: { connected: true, platform }
-- Encrypts session and saves to platform_tokens table

GET /api/platforms/status
Response: { platforms: { blinkit: 'connected'|'disconnected'|'expired', ... } }
-- Reads is_valid flag per platform for this user

DELETE /api/platforms/:platform
Response: { disconnected: true }
-- Deletes the platform_token row

POST /api/platforms/:platform/verify
Response: { valid: true|false }
-- Fires a lightweight test request to that platform using stored session
-- Sets is_valid = false if it gets 401/403
```

### Search Route (`/api/search`)

```
POST /api/search
Headers: Authorization: Bearer <flit_jwt>
Body: {
  query: string,
  lat: number,
  lon: number,
  platforms?: string[]   // optional filter, defaults to all connected
}
Response: {
  results: NormalizedProduct[],
  platformStatus: Record<string, 'success' | 'error' | 'not_connected'>,
  query: string,
  resolvedAt: string
}
```

---

## 9. Search Proxy Implementation

File: `server/routes/search.ts`

This is the core of the app. On every search request:
1. Fetch all platform sessions for this user from the DB.
2. Decrypt each session.
3. Fire parallel requests to all connected platforms using each session.
4. Normalize results into the shared product shape.
5. Cache the response in Redis for 90 seconds keyed by `userId:query:lat:lon`.
6. Return merged results.

```typescript
router.post('/search', requireAuth, async (req, res) => {
  const { query, lat, lon, platforms } = req.body;
  const userId = req.user.id;

  // Cache check
  const cacheKey = `search:${userId}:${query}:${lat}:${lon}`;
  const cached = await redis.get(cacheKey);
  if (cached) return res.json(JSON.parse(cached));

  // Load sessions
  const tokenRows = await db.query.platformTokens.findMany({
    where: and(eq(platformTokens.userId, userId), eq(platformTokens.isValid, true))
  });

  // Filter to requested platforms
  const active = platforms
    ? tokenRows.filter(r => platforms.includes(r.platform))
    : tokenRows;

  // Parallel search
  const settled = await Promise.allSettled(
    active.map(async (row) => {
      const session = JSON.parse(decrypt(userId, row.tokenBlob, row.encryptionIv, row.encryptionTag));
      const adapter = getPlatformAdapter(row.platform);
      const items = await adapter.search(query, lat, lon, session);
      return { platform: row.platform, items };
    })
  );

  const results: NormalizedProduct[] = [];
  const platformStatus: Record<string, string> = {};

  for (const [i, outcome] of settled.entries()) {
    const platform = active[i].platform;
    if (outcome.status === 'fulfilled') {
      results.push(...outcome.value.items);
      platformStatus[platform] = 'success';
    } else {
      platformStatus[platform] = 'error';
      // If 401, mark token as invalid in background
      if (outcome.reason?.status === 401) {
        db.update(platformTokens)
          .set({ isValid: false })
          .where(and(eq(platformTokens.userId, userId), eq(platformTokens.platform, platform)))
          .execute();
      }
    }
  }

  const response = { results, platformStatus, query, resolvedAt: new Date().toISOString() };
  await redis.setex(cacheKey, 90, JSON.stringify(response));
  res.json(response);
});
```

---

## 10. Platform Search Adapters

Each adapter in `server/platforms/<platform>.ts` follows this interface:

```typescript
interface PlatformAdapter {
  search(
    query: string,
    lat: number,
    lon: number,
    session: PlatformSession
  ): Promise<NormalizedProduct[]>;
}
```

Each adapter:
1. Builds the request URL and params (platform-specific).
2. Attaches the session cookies as `Cookie` header and session headers.
3. Sets a realistic browser `User-Agent`.
4. Parses the response into `NormalizedProduct[]` via the shared normaliser.

### Example: Blinkit Adapter

```typescript
import axios from 'axios';
import { normalise } from './normalise';

export const blinkitAdapter: PlatformAdapter = {
  async search(query, lat, lon, session) {
    const response = await axios.get('https://api.blinkit.com/v1/search', {
      params: { q: query, lat, lon },
      headers: {
        'Authorization': session.headers['Authorization'],
        'Cookie': Object.entries(session.cookies).map(([k,v]) => `${k}=${v}`).join('; '),
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Mobile Safari/537.36',
        'Accept': 'application/json',
        'Origin': 'https://blinkit.com',
        'Referer': 'https://blinkit.com/',
      },
      timeout: 8000,
    });
    return normalise.blinkit(response.data);
  }
};
```

Build the same pattern for all five platforms. The endpoint paths and response shapes will differ per platform — these need to be discovered/verified against current API behaviour at build time.

---

## 11. Normalized Product Shape

All platform adapters must return `NormalizedProduct[]`. This is the shared contract between backend and mobile app.

```typescript
type NormalizedProduct = {
  id: string;                    // platform + original_id e.g. "blinkit_12345"
  platform: 'blinkit' | 'zepto' | 'instamart' | 'bigbasket' | 'jiomart';
  name: string;
  brand: string | null;
  imageUrl: string | null;
  price: number;                 // selling price in INR paise (multiply by 100 to avoid float)
  mrp: number;                   // original price
  discount: number;              // percentage 0-100
  quantity: string;              // "500g" | "1L" | "6 pack" etc.
  unitPrice: number | null;      // paise per base unit (g or ml), null if not computable
  unitLabel: string | null;      // "₹2.40/100g" formatted
  inStock: boolean;
  deliveryEta: number | null;    // minutes
  deliveryFee: number;           // paise, 0 if free
  deepLink: string;              // direct URL to product on platform
  category: string | null;
};
```

---

## 12. Mobile State Management

Using Zustand stores. Keep stores thin — data lives on the backend, stores are cache + UI state.

### usePlatformStore

```typescript
type PlatformStore = {
  connected: Record<string, 'connected' | 'disconnected' | 'expired'>;
  loading: boolean;
  fetchStatus: () => Promise<void>;
  setConnected: (platform: string) => void;
  setDisconnected: (platform: string) => void;
};
```

### useSearchStore

```typescript
type SearchStore = {
  query: string;
  results: NormalizedProduct[];
  platformStatus: Record<string, string>;
  loading: boolean;
  error: string | null;
  search: (query: string, lat: number, lon: number) => Promise<void>;

  // Derived (computed in selectors, not stored)
  // sorted / filtered results computed in component via useMemo
};
```

---

## 13. Connect Screen UX Flow

This is the flow the user walks through to connect a platform. Implement this exactly.

```
ConnectScreen (list of platforms)
  |
  Each platform shows one of:
    [Connect]       → user not connected
    [Connected ✓]   → is_valid = true
    [Reconnect]     → is_valid = false (session expired)
  |
  Tap [Connect] on any platform
    |
    → Navigate to PlatformLoginScreen with { platform }
    → WebView loads platform login page
    → User logs in (Flit is out of this loop — no passwords touched)
    → On success redirect detected:
        → Capture cookies via CookieManager
        → Capture auth headers from injected JS interceptor
        → POST /api/platforms/connect
        → Backend encrypts and stores
        → Navigate back to ConnectScreen
        → Platform shows [Connected ✓]
```

---

## 14. Search Flow (End to End)

```
User types "amul milk 1L" in SearchScreen
  |
  → Tap search or submit
  → Navigate to ResultsScreen with { query }
  |
ResultsScreen mounts
  → useSearchStore.search(query, lat, lon)
  → POST /api/search with JWT + query + location
  |
Backend receives
  → Check Redis cache (90s TTL keyed by userId:query:lat:lon)
  → Cache miss: load sessions from DB, decrypt all
  → Promise.allSettled — fire all platforms in parallel (8s timeout each)
  → Normalise, merge, cache, respond
  |
ResultsScreen receives NormalizedProduct[]
  → Render sorted by unit price (default)
  → Show BestDealBanner for lowest (price + deliveryFee)
  → User can sort by: unit price | total price | delivery ETA
  → User can filter by: platform chip | in-stock toggle
```

---

## 15. Security Requirements

These are non-negotiable. Implement before any production traffic.

1. **Never log decrypted tokens.** Structured logging must never include `session`, `cookies`, `headers`, `token_blob`.
2. **Rate limit search endpoint** to 30 requests per user per minute.
3. **Rate limit connect endpoint** to 5 attempts per user per hour per platform. Prevents session stuffing.
4. **HTTPS only.** Backend must reject HTTP. Use `helmet` middleware.
5. **JWT expiry.** Flit JWTs expire in 7 days. Refresh token valid 30 days.
6. **Token validity checks.** Run a BullMQ job every 6 hours that fires a lightweight probe request to each platform for each connected user. Mark `is_valid = false` on 401/403. App polls `/api/platforms/status` on foreground resume and prompts reconnect.
7. **Input validation.** Use `zod` to validate all request bodies. Reject unknown fields.
8. **SQL injection.** Drizzle ORM parameterises all queries. Never use raw string interpolation.

---

## 16. Environment Variables

```bash
# Server
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://user:pass@host:5432/flit
REDIS_URL=redis://localhost:6379
JWT_SECRET=<64-char-hex>          # openssl rand -hex 32
TOKEN_MASTER_KEY=<64-char-hex>    # openssl rand -hex 32  -- NEVER ROTATE WITHOUT MIGRATION
ALLOWED_ORIGINS=https://yourdomain.com

# Mobile (set in app.config.ts or .env)
EXPO_PUBLIC_API_URL=https://api.yourdomain.com
```

---

## 17. Implementation Order (Phases)

Build in this order. Each phase is independently shippable.

### Phase 1 — Skeleton (Week 1)
- [ ] RN project init, navigation setup, NativeWind
- [ ] Express server with `/api/health`
- [ ] PostgreSQL + Drizzle schema + migrations
- [ ] Redis connection
- [ ] User register/login endpoints + JWT

### Phase 2 — Connect Flow (Week 2)
- [ ] PlatformLoginScreen with WebView + header interceptor
- [ ] CookieManager integration for each platform
- [ ] `/api/platforms/connect` endpoint with encryption
- [ ] `/api/platforms/status` endpoint
- [ ] ConnectScreen showing live connection state

### Phase 3 — Search Core (Week 3)
- [ ] Search adapters for all 5 platforms (verify endpoints)
- [ ] Normaliser for each platform
- [ ] `/api/search` with parallel proxy
- [ ] Redis cache layer
- [ ] ResultsScreen with cards + sort + filter

### Phase 4 — Reliability (Week 4)
- [ ] Token validity check job (BullMQ)
- [ ] Auto-reconnect prompt on expired session
- [ ] Error states in UI (platform down, all failed, no connection)
- [ ] Rate limiting middleware
- [ ] Security hardening (helmet, input validation, logging audit)

---

## 18. Known Risks and Mitigation

| Risk | Likelihood | Mitigation |
|---|---|---|
| Platform changes search endpoint | High | Adapter pattern isolates blast radius to one file per platform |
| Platform detects and blocks backend IP | Medium | Add per-user request pacing; add randomised User-Agent rotation |
| Session cookies rotate on platform side | Medium | Token refresh job + reconnect prompts |
| User loses phone (token exposure) | Low | Tokens are server-side encrypted, not on device |
| WebView CSRF issues on some platforms | Low | Some platforms block third-party WebViews; test each platform's login page in RN WebView before Phase 2 |
| JioMart / BigBasket use OTP login | High | OTP-based login works fine in WebView — user receives OTP on their number as normal and types it into the WebView; Flit is not involved |

---

## 19. What NOT to Build (Scope Limits)

- No Chrome extension (deprecated by this architecture)
- No desktop/web app in Phase 1–4
- No server-side scraping without user session (gets blocked)
- No storing of platform passwords, OTPs, or phone numbers
- No sharing of one user's session across other users (each session is per-user only)
