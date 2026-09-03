---
id: E4-T28b
epic: 4
title: Interactive Node.js and V8 JIT browser workload
priority: 429.2
status: in-progress
depends_on: [E4-T28a, E4-T34]
estimate: S
risk: high
capstone: false
---

## Goal

Prove that the restored Node-Alpine guest is interactive under the browser JIT: a real Node REPL
echoes and evaluates input below the latency budget, a guest-computed Node HTTP workload reaches
the required throughput against its Level-3 interpreter baseline, and V8-generated code remains
correct across `FENCE.I`/self-modifying-code transitions.

## Context

E4-T34 makes short Node blocks measurable, but the parent capstone still needs a user-visible
workload rather than translated-block counters. The test must drive the real terminal bridge and
compute its markers in the guest. Bun is a documented stretch result, never a reason to weaken the
Node gate.

## Deliverables

- `web/tests/e4-t28-node-interactive.spec.js` with independent echo-latency samples and a bounded
  guest Node HTTP request workload.
- A result JSON containing cold-profile controls, runtime/artifact digests, p95 echo latency,
  throughput and baseline ratio, FENCE.I correctness markers, and a Bun result or explicit gap.

## Acceptance criteria

- `PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8133 PLAYWRIGHT_REUSE_SERVER=1 npx playwright test tests/e4-t28-node-interactive.spec.js --project=chromium`
  passes from a fresh browser context: Node REPL echo p95 is `< 100 ms`, the computed evaluation
  marker is returned, and the guest Node HTTP workload is at least 10x its ledgered Level-3
  interpreted baseline.
- The workload runs with the shipping JIT controls, returns exit 0, and exercises a guest-written
  code path whose result changes only after the guest's own code-generation/invalidation boundary;
  no host literal or canned transcript can satisfy the assertions.
- The result records a Bun attempt when the binary is available, otherwise a typed non-gating gap,
  plus the exact source commit, build flags, runtime digest, and artifact identity.

## Adversarial verification

Start cold, type continuously while the Node workload is busy, and measure echo latency from the
browser event loop rather than guest timestamps. Compare the HTTP response body and request count
against a literal-echo trap, interrupt/reload during a request, and force an interpreter control
run to detect a cached JIT result being mislabeled as a 10x uplift. Inspect the trace/result for
FENCE.I or stale-code failures. WebKit and independent-machine legs are outside the directed proof
by user direction; disclose any configured Firefox result.

## Verification log
