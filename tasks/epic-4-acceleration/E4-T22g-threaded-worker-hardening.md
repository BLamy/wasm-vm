---
id: E4-T22g
epic: 4
title: Threaded worker fallback and lifecycle adversarial hardening
priority: 422.7
status: in-progress
depends_on: [E4-T22f]
estimate: S
risk: high
capstone: false
---

## Goal

Close the worker boundary with deterministic attacks against headerless fallback, wake delivery,
shared-memory ordering, tab lifecycle, and worker failure, then publish the final end-to-end proof
for the decomposed E4-T22 capability.

## Context

The worker can appear healthy while losing input, observing stale device bytes, or leaving the page
half-booted after termination. These attacks exercise the failure modes that the happy boot and unit
protocol tests cannot see. The final result must retain the exact guest oracle rather than only UI
text.

## Deliverables

- Headerless-server fallback and second-load service-worker-shim browser coverage.
- Wake-storm and handshake-counter stress, shared-buffer ordering, tab background/foreground, and
  worker-kill fatal-state tests.
- Final E4-T22 result JSON and a concise committed verification command.

## Acceptance criteria

- `PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8133 PLAYWRIGHT_REUSE_SERVER=1 npx playwright test tests/e4-t22-fallback-no-headers.spec.js tests/e4-t22-worker-hardening.spec.js --project=chromium`
  (the second spec is added in this task) passes with no lost UART bytes, no stale shared-buffer
  reads, a bounded fatal UI after worker kill, and a clean single-thread fallback on the headerless
  server.
- Ten-kilobyte-per-second input for the bounded stress window preserves ordering and reaches the
  guest; reload/background cycles leave no orphan worker, pending RPC, or corrupted overlay.
- The final result carries runtime digest, first-command boundary, exact checksum, control flags,
  and the generated deploy artifact identity. The child is not verified on claims alone.

## Adversarial verification

Deliberately strip COOP/COEP, race ten thousand IRQ/input events with WFI, write a device buffer
immediately before notifying, background for five minutes, reload during MMIO, and terminate the
worker from DevTools. Any white screen, lost byte, stale read, guest time warp, or uncited optimistic
state is a refutation.

## Verification log
