# PWA shell + update flow

This document is the canonical reference for how DuoSync's service worker
(SW) is built, registered, and updated. It supersedes any older notes that
describe a "hand-written SW (do NOT replace with workbox)" — that
restriction was lifted during the vite-plugin-pwa migration (P-series).

## TL;DR

- SW source lives at `src/service-worker.ts`.
- Build: `vite-plugin-pwa` in **`injectManifest`** mode wraps that source,
  injects `self.__WB_MANIFEST`, and bundles workbox helpers inline. No
  `importScripts`, no CDN, no extra `registerSW.js` artifact (we set
  `injectRegister: false`).
- Registration: `src/lib/pwa/register.ts` calls `registerSW` from
  `virtual:pwa-register` and exposes a `needRefresh` Svelte writable.
- UI: `src/lib/components/duosync/UpdatePromptBanner.svelte` (mounted in
  `src/routes/+layout.svelte`) shows a Reload pill when `needRefresh` flips
  true. Reload calls `applyPendingUpdate(targetUrl)`.
- The actual SKIP_WAITING handshake stays hand-rolled (see "Why" below).

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Build                                                             │
│  ┌──────────────────────────┐                                       │
│  │ src/service-worker.ts    │                                       │
│  │   - precacheAndRoute(    │   vite-plugin-pwa                     │
│  │       self.__WB_MANIFEST)│   injectManifest mode                 │
│  │   - registerRoute(...)   │  ───────────────────►                 │
│  │   - SKIP_WAITING handler │                                       │
│  │   - PURGE_USER_CACHES    │                                       │
│  └──────────────────────────┘                                       │
│                                                                    │
│            ↓ workbox helpers bundled inline                        │
│            ↓ __WB_MANIFEST replaced with file list                 │
│                                                                    │
│  .svelte-kit/output/client/service-worker.js  (~1.2 MB precache)   │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│  Runtime                                                           │
│                                                                    │
│   Page                              SW                             │
│   ────                              ──                             │
│   layout mounts <UpdatePromptBanner/>                              │
│      │                                                             │
│      └─► registerSW({ onNeedRefresh })  (from virtual:pwa-register)│
│                                                                    │
│   When a new SW is `installed`/`waiting`:                          │
│      ← onNeedRefresh()  ─────  needRefresh.set(true)               │
│                                                                    │
│   Banner renders. User clicks Reload:                              │
│      ──► applyPendingUpdate(targetUrl)                             │
│            ──► waiting.postMessage('SKIP_WAITING')                 │
│                                          │                         │
│                                          ▼                         │
│                              message handler:                      │
│                                await skipWaiting();                │
│                                await clients.claim();              │
│                                          │                         │
│            ◄──  controllerchange  ───────┘                         │
│                                                                    │
│      ──► location.assign(targetUrl)                                │
└────────────────────────────────────────────────────────────────────┘
```

## Locked invariants

These are guarded by `src/service-worker.spec.ts`:

1. `self.__WB_MANIFEST` token is present in source (workbox-build needs the
   literal string for static replacement).
2. `precacheAndRoute` is imported from `workbox-precaching` and called at
   top level.
3. At least one `registerRoute(...)` is registered (HTML SWR strategy lives
   here today).
4. `StaleWhileRevalidate` from `workbox-strategies` is in use.
5. The `activate` GC handler whitelists the `workbox-` cache prefix
   (`WORKBOX_CACHE_PREFIX`). Forgetting this wipes the precache every cycle.
6. The `'SKIP_WAITING'` message handler calls **both** `skipWaiting()` and
   `clients.claim()`. Without `claim()`, iOS/Android standalone PWAs
   deadlock in an apply-loop because `controllerchange` never fires.
7. `install` does NOT call `skipWaiting()`. `activate` does NOT call
   `clients.claim()`. Both are gated behind the user-gesture message so
   deploys never auto-reload anyone mid-session.

## Why we kept the SKIP_WAITING handshake hand-rolled

`vite-plugin-pwa`'s returned `updateServiceWorker(reload?)` is a one-liner
that calls `worker.postMessage({ type: 'SKIP_WAITING' })` then optionally
`location.reload()`. We need two things it can't give us:

- **Navigate to a specific URL** that the layout's `beforeNavigate` hook
  captured before it cancelled the nav. Plain reload would land on the
  current URL, which may be `/` (and our pre-paint redirect would then
  bounce again).
- **Wait for the actual handoff** — `controllerchange` (after `claim()`)
  rather than a fixed timeout — so installed PWAs don't reload-loop.

So `applyPendingUpdate(targetUrl)` in `src/lib/pwa/register.ts` does the
postMessage → `controllerchange` → `location.assign(targetUrl)` dance
itself, with `statechange === 'activated'` and a 10s timeout as defensive
fallbacks. `vite-plugin-pwa` is only the channel that says "a new SW
exists" via `onNeedRefresh`.

## CSP

Already covered by `default-src 'self'` + `script-src 'self'` +
`worker-src 'self'`. workbox is bundled inline by injectManifest, so
there is no CDN allowlist to add. See the audit doc-comment in
`svelte.config.js`.

## Caches we own (besides workbox precache)

Hand-rolled, NOT managed by workbox. The activate-time GC sweeps anything
that doesn't match these prefixes OR `workbox-`:

- `ds-shell-v<n>` — small SHELL_CACHE for `/`, `/welcome`, `/offline`,
  `/auth/sign-in`, manifest, theme stylesheet. Handled via custom fetch
  fallback chain (network → cache → /offline).
- `ds-html-v<n>` — runtime HTML SWR for in-app routes.
- `ds-img-v<n>` — image LRU (LRU eviction inside fetch handler).

`PURGE_USER_CACHES` clears `ds-html-*` and `ds-img-*` on sign-out. Workbox
precache is preserved (deterministic build manifest, doesn't leak user
data).

## Files

- `src/service-worker.ts` — SW source.
- `src/service-worker.spec.ts` — invariant tests (offline contract +
  workbox/vite-pwa contract).
- `src/lib/pwa/register.ts` — registerSW glue + `needRefresh`,
  `applyPendingUpdate`, `purgeUserCaches`, polling.
- `src/lib/components/duosync/UpdatePromptBanner.svelte` — the pill.
- `src/lib/components/duosync/UpdatePromptBanner.svelte.spec.ts` — unit
  tests for the banner.
- `vite.config.ts` — `SvelteKitPWA({ strategies: 'injectManifest', ... })`.
- `src/app.d.ts` — `/// <reference types="vite-plugin-pwa/client" />`.

## History

- **P1a / P1b** — Installed `vite-plugin-pwa` + `workbox-*` deps.
- **P2** — Adopted workbox `precacheAndRoute` + `registerRoute` +
  `StaleWhileRevalidate`. Kept hand-rolled fetch chain alongside.
- **P3** — Replaced manual `navigator.serviceWorker.register` with
  `registerSW`; added `needRefresh` writable + `UpdatePromptBanner`.
- **P4** — CSP audit. No changes needed.
- **P5** — Workbox/vite-pwa contract tests + banner unit tests.
- **P6** — This doc. README updated.
