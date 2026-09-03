---
id: E4-T28d
epic: 4
title: Cold browser boot-to-login timing gate
priority: 429.4
status: pending
depends_on: [E4-T28a, E4-T32, E4-T34]
estimate: S
risk: high
capstone: false
---

## Goal

Measure the default persistent-disk browser path from the first OpenSBI byte to the real Alpine
`login:` prompt in three genuinely fresh browser contexts and enforce the parent capstone's median
sub-five-second boot gate.

## Context

Fast restore and JIT counters can make a repeat visit look like a cold boot. The parent definition
is explicit: OpenSBI first byte through `login:`, default persistent disk, three runs, median. This
slice isolates that boundary and records the boot artifact identity needed by the final sign-off.

## Deliverables

- `web/tests/e4-t28-cold-boot.spec.js` with fresh-context/site-data cleanup and byte-level start/end
  markers.
- Boot timing evidence and a ledger entry carrying all three samples, median, browser/version,
  headers, guest digest, and snapshot/disk hashes.

## Acceptance criteria

- `PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8133 PLAYWRIGHT_REUSE_SERVER=1 npx playwright test tests/e4-t28-cold-boot.spec.js --project=chromium`
  records three fresh-profile runs, proves the OpenSBI-first-byte and actual `login:` markers, and
  reports median boot `< 5.0 s`.
- The test proves it did not reuse IndexedDB/OPFS/JIT state from a prior run, keeps the default
  persistent-disk configuration, and reports zero non-favicon console/request errors.
- Every sample binds to the same candidate commit and generated deploy artifacts; a missing boot
  byte, guessed prompt, or cached restore is a hard failure.

## Adversarial verification

Use a new context and cleared origin data for every sample, vary run order, and inspect network
requests for a restore shortcut masquerading as a first boot. Delay or remove the login marker and
confirm the harness times out rather than stopping at a generic ready banner. Compare all three
raw samples and require the median field to be recomputable.

## Verification log
