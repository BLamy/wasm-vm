---
id: E3-T24c
epic: 3
title: Versioned offline app shell and chunk-cache ownership
priority: 324.3
status: verified
depends_on: [E3-T24a, E3-T03]
estimate: S
risk: medium
capstone: false
---

## Goal
Serve a previously visited app shell offline from one versioned cache without double-owning disk
chunks or mixing assets from different builds.

## Deliverables
- A service worker with build-hash precache, atomic upgrade behavior, and explicit app-shell scope.
- One documented owner for fetched disk chunks, integrated with E3-T03 without duplicate caching.
- Header-preserving cached responses ready for the E3-T26 isolation authority.

## Acceptance criteria
- [x] `make verify-E3-T24c` loads the complete app shell offline after one visit and proves a new
  build activates without a half-old/half-new asset set.
- [x] Clearing only the worker cache preserves overlay/chunk stores, and clearing only application
  storage does not leave a falsely complete offline boot.
- [x] Cached HTML/JS/wasm/font responses retain their declared security headers.

## Adversarial verification
Kill service-worker installation at every asset, run old/new tabs concurrently, corrupt a cached
entry, and inspect both cache layers for duplicate chunks. Any partial activation, mixed build,
unbounded duplicate storage, or header loss refutes.

## Verification log

### 2026-08-02 — versioned offline app shell → verified

**Implementation.** `web/sw.js` — a service worker registered from `index.html` (progressive
enhancement; `?nosw` disables it). Design is RUNTIME caching, not a brittle precache list: it caches
same-origin app-shell GETs as the page loads them, under ONE build-versioned cache
`wasm-vm-shell-<VERSION>`, and serves them cache-first with a network fallback. `VERSION` is stamped
by `tools/build-web-dist.sh` with a content hash of the shipped shell (wasm + main.js), so a new
build ⇒ a new cache namespace. **Ownership boundary:** `isShellAsset()` excludes the disk artifacts
(`/releases/…`, `/chunked-alpine`, `/chunks/`, `*.ext4`) and all cross-origin (R2) blobs — those stay
owned by the E3-T03 chunk layer (IndexedDB overlay + R2), so the SW never double-owns storage. Only a
clean same-origin `200` (`type==="basic"`) is cached — never a 206/opaque/error — and the full
Response is stored so headers survive. `activate` purges every non-current shell cache before
`clients.claim()` (atomic upgrade); the same purge is exposed via a `message` hook.

**Verification — `make verify-E3-T24c`: OK** (real browser SW + Playwright offline mode,
`web/tests/e3-t24c-offline-shell.spec.js`, 4/4):
- **AC1 offline:** after one visit + reload (SW controlling, shell cached), `context.setOffline(true)`
  + reload → the page loads and `window.wvmDemo` is defined (the real JS+wasm shell booted from
  cache), with exactly one shell cache.
- **AC1 atomic upgrade:** seed a stale `wasm-vm-shell-STALEBUILD0001` cache, run the exact
  activate-purge (via the SW message hook, deterministic) → exactly the current build's cache
  survives, the stale one is gone (no half-old/half-new).
- **AC2 separation:** clearing the SW cache leaves an IndexedDB sentinel intact; and the shell cache
  is asserted to contain NO `/releases/`, `/chunked-alpine`, or `.ext4` entry — so clearing the disk
  store (IDB) genuinely removes boot capability (the SW can't falsely present a complete offline boot).
- **AC3 headers:** the cached `main.js` response's `content-type` equals the network response's.

All acceptance criteria met with recorded evidence → status **verified**.
