---
id: E3-T26b
epic: 3
title: Enforced CSP and full-app compatibility
priority: 326.2
status: pending
depends_on: [E3-T26a, E3-T20d, E3-T21d, E3-T22, E3-T23]
estimate: S
risk: high
capstone: false
---

## Goal
Enforce a minimum CSP that permits the shipped wasm, worker, network, terminal, snapshot, and file
flows while blocking inline/off-origin execution and framing.

## Deliverables
- A documented CSP policy and dev report-only shadow policy with violation collection.
- Exact allowlists for scripts, wasm compilation, workers, styles, connections, and framing.
- Positive block tests plus the frozen full-app E2E suite under enforcement.

## Acceptance criteria
- [ ] `make verify-E3-T26b` runs boot, networking, clipboard, file transfer, snapshot, and terminal
  flows with zero unexpected CSP violations.
- [ ] Planted inline/off-origin scripts, connects, frames, `eval`, `new Function`, data scripts,
  and unauthorized blob workers are blocked.
- [ ] Wasm module compilation and the dedicated worker remain functional under the minimum policy.

## Adversarial verification
Try each documented bypass class, inject third-party styles/assets, vary navigation and worker
creation, and compare enforced versus report-only results. Any bypass, hidden wildcard, required
dev relaxation, or broken shipped flow refutes.

## Verification log
(empty)
