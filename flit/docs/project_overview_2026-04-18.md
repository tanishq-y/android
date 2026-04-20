# Flit Project Overview

**Date:** 2026-04-18

## Purpose

Flit is a quick-commerce comparison app that aggregates product search results across Blinkit, Zepto, Instamart, BigBasket, and JioMart. The current codebase is app-first: a Vite/React frontend, a Node/Express backend, and an Android native bridge used to capture platform sessions and run device-side fallbacks.

## Repository Map

- `src/` contains the React application, page routing, search orchestration, and UI components.
- `server/` contains the Express API, token-vault/session logic, platform search adapters, and platform connection routes.
- `android/` contains the Capacitor-based Android app and native bridge code used for session capture and in-app platform login/search.
- `docs/` contains architecture notes, implementation plans, and project-specific documentation.
- `tmp/` contains probe scripts and diagnostics used while reverse-engineering platform behavior.

The practical capture/search bridge in this repo is the Android native layer, which supports the app’s login and search flows directly.

## Runtime Architecture

1. The user opens the React app in the browser or inside the Android shell.
2. The app routes through `src/App.jsx`, with the main search experience rendered from `src/pages/HomePage.jsx`, `src/pages/ResultsPage.jsx`, and `src/pages/ConnectPageV2.jsx`.
3. `src/hooks/useSearch.js` submits searches to the backend and can also trigger native device search through the Android bridge when available.
4. The backend in `server/server.js` authenticates the request, resolves the active user context, loads per-platform sessions from the token vault, and dispatches searches to the platform adapters in `server/platforms.js`.
5. Results are normalized and returned to the frontend, where the results page renders cards, status chips, reconnect warnings, and empty-state handling.
6. On Android, `FlitNativeBridgeInterface.java` and `PlatformLoginActivity.java` capture platform login sessions and support device-side fallback search paths.

## Frontend Architecture

The app shell is intentionally small. `src/main.jsx` boots React, `src/App.jsx` defines the router, and the persistent header is handled by `src/components/Header.jsx`.

The search workflow is controlled by `src/hooks/useSearch.js`:

- It sends the user query, latitude, longitude, and platform selection to the backend.
- It keeps a separate native-device search path for Blinkit, Zepto, and Instamart when the backend signals a recoverable failure.
- It merges backend and native results, dedupes products, and tracks platform status for the UI.

`src/pages/ResultsPage.jsx` is the main results surface. It displays:

- product cards
- platform chips and availability state
- reconnect/session warnings
- best-deal summaries
- the no-results branch when no products survive filtering

`src/pages/ConnectPageV2.jsx` is the connection hub. It manages platform login capture, backend session sync, connection health checks, and backend URL overrides for local development.

## Backend Architecture

`server/server.js` is the main entry point. It wires:

- CORS and JSON parsing
- optional JWT and user-context middleware
- auth and platform routes
- token-vault session lookup
- multi-platform search execution

The backend search path is platform aware:

- Blinkit, Zepto, and Instamart can use token-vault sessions or device-derived sessions.
- BigBasket and JioMart run through their own adapter logic and session checks.
- The backend preserves diagnostics about auth scope, identity mismatches, and per-platform errors so the UI can show actionable reconnect states.

`server/routes/platforms.js` handles connection management:

- storing platform sessions
- returning connection status
- disconnecting sessions
- verifying a platform session by running a live search probe

`server/platforms.js` contains the real adapters and normalization code. It is the most important file for platform behavior because it translates each upstream site into a consistent product model.

## Android Bridge

The Android layer exists to capture real platform sessions and to provide a native fallback search path when web/backend behavior is not enough.

- `android/app/src/main/java/com/flit/app/PlatformLoginActivity.java` captures platform request headers and cookies during the login flow.
- `android/app/src/main/java/com/flit/app/FlitNativeBridgeInterface.java` exposes the native bridge to the React app and runs platform-specific search logic on the device.

This bridge is especially relevant for platforms that aggressively gate server-side requests or need browser-fingerprint-like headers.

## Current State Notes

- The backend is running on port `3001` in the current workspace.
- Zepto and Blinkit remain the hardest platforms because upstream auth/search behavior is unstable in this environment.
- The app previously collapsed some Zepto fallback states into a misleading no-results screen; the current adapter behavior now prefers returning real live cards when they exist.
- The missing-result behavior is driven by `ResultsPage.jsx` and the search payload returned by the backend, not by the top app header.

## Development Commands

- `npm run dev` starts the Vite frontend.
- `npm run server` starts the Express backend.
- `npm run start` runs frontend and backend together.
- `npm run build` creates a production frontend build.
- `npm run android:sync` rebuilds and syncs the Android shell.

## Practical Takeaway

The codebase is not a simple frontend app. It is a three-layer system: React UI, Express token-vault backend, and Android-native session capture. Any platform search issue should be traced in that order: UI state, backend adapter behavior, then native fallback behavior.