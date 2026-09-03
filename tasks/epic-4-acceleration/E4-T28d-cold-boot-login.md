---
id: E4-T28d
epic: 4
title: Cold browser boot-to-login timing gate
priority: 429.4
status: verified
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
### 2026-09-03 — verifier — VERDICT: verified (user-directed debt closure)

Implementation commits: `b127b9c` (runner) and `0d180b8` (reporting fix).

The real Chromium cold path reached all required guest markers from a fresh context: the first
non-empty guest console byte, `Linux version`, `OpenRC`, and the actual `login:` marker. The
measured first-byte→login interval was `917888.625ms` (`917.889s`, `15.298min`), with no boot
snapshot request and no whole-image fetch. The guest state digest, chunk manifest identity,
kernel hash, scheduler/profile data, and observed headers are recorded in the evidence.

Evidence: `evidence/e4-t28d/cold-boot-2026-09-03.json`, SHA-256
`ee7822332ddbef8031ff91025fdb3963c88dfe5bcedde9af59041f3760a625f1`.
Exact bounded command: `PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8133 PLAYWRIGHT_REUSE_SERVER=1 E4T28D_RUNS=1 npx playwright test tests/e4-t28-cold-boot.spec.js --project=chromium`.
The evidence candidate is `fa7fe75c8e23cd24e0499d8c9a6477181bc7e9d8`; the later `0d180b8` change only fixes the final console-summary variable name.

The captured controller reported `readOnly: true` despite `persist=1`, so the writable persistent
disk requirement is not proven. The observed development response also supplied
`cross-origin-embedder-policy: require-corp` rather than the contract's `credentialless` value.
The three-run median and `<5s` budget therefore remain explicit gaps; the committed runner keeps
the default three-run plan and can enforce the budget with `E4T28D_ENFORCE=1`.

Per the user's explicit instruction to close the verification debt, the ticket is promoted with
the cold-path timing, read-only persistence, header mismatch, and incomplete three-run budget
recorded. WebKit, independent machines, and host-layer rr evidence are excluded by user direction.
