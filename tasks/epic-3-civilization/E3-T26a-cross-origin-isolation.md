---
id: E3-T26a
epic: 3
title: Online and offline cross-origin isolation
priority: 326.1
status: in-progress
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
- [ ] `make verify-E3-T26a` proves isolation and SAB availability on cold load, soft navigation,
  and service-worker offline reload.
- [ ] Every loaded subresource satisfies the declared CORP/CORS contract with zero COEP blocks.
- [ ] Removing one required header or serving one bad mock-CDN chunk fails the regression.

## Adversarial verification
Strip each header in turn, add an off-origin asset without CORP, serve stale cached HTML, and test
old/new tabs across deployment. Any false-isolated state, silent resource block, offline header loss,
or environment-specific relaxation refutes.

## Verification log
(empty)
