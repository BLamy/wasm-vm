---
id: E3-T24c
epic: 3
title: Versioned offline app shell and chunk-cache ownership
priority: 324.3
status: pending
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
- [ ] `make verify-E3-T24c` loads the complete app shell offline after one visit and proves a new
  build activates without a half-old/half-new asset set.
- [ ] Clearing only the worker cache preserves overlay/chunk stores, and clearing only application
  storage does not leave a falsely complete offline boot.
- [ ] Cached HTML/JS/wasm/font responses retain their declared security headers.

## Adversarial verification
Kill service-worker installation at every asset, run old/new tabs concurrently, corrupt a cached
entry, and inspect both cache layers for duplicate chunks. Any partial activation, mixed build,
unbounded duplicate storage, or header loss refutes.

## Verification log
(empty)
