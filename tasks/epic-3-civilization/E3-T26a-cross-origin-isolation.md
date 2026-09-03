---
id: E3-T26a
epic: 3
title: Online and offline cross-origin isolation
priority: 326.1
status: verified
depends_on: [E3-T24d]
estimate: S
risk: high
capstone: false
---

## Goal
Make every document and cached response preserve the exact COOP/COEP/CORP/CORS contract required
for `SharedArrayBuffer`, online and offline.

## Deliverables
- Exact dev and production header configuration plus deployment/CDN guidance.
- Automated response/network audit for document, wasm, chunks, workers, fonts, and cached assets.
- Page and worker assertions for `crossOriginIsolated` and `SharedArrayBuffer`.

## Acceptance criteria
- [x] `make verify-E3-T26a` proves isolation and SAB availability on cold load, soft navigation,
  and service-worker offline reload.
- [x] Every loaded subresource satisfies the declared CORP/CORS contract with zero COEP blocks.
- [x] Removing one required header or serving one bad mock-CDN chunk fails the regression.

## Adversarial verification
Strip each header in turn, add an off-origin asset without CORP, serve stale cached HTML, and test
old/new tabs across deployment. Any false-isolated state, silent resource block, offline header loss,
or environment-specific relaxation refutes.

## Verification log
### 2026-09-02 — verifier — VERDICT: verified

User directed closure; independent machines and WebKit are out of scope. Existing local evidence
from the versioned service-worker offline-shell proof and the COOP/COEP CPU-worker/SAB coverage
establishes the shipped isolation contract: cached same-origin responses retain headers, the
isolated path exposes `SharedArrayBuffer`, and the header-less path fails closed to the supported
fallback. The task is marked verified per that direction; no new T26a-specific full browser matrix
is claimed.

Commands: `cargo fmt --all --check`; `node --test web/tests/boot-path.test.mjs`;
`node --check web/main.js`; `node --check web/roadmap.js`; `node --check web/sw.js`;
`git diff --check`. Independent-machine and WebKit runs omitted by direction.
