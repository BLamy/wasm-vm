# E5-T25a amended changed-hunk coverage audit

Range audited: `47b489e8a86351994a6399bbfe8691979d0c7c5b..0da96f6a5c7f323b986fe41b6f6bfb2508eec834`.

- `Makefile` (`verify-E5-T25a`): the added `node --check web/main.js` ran in the
  retained exact gate and again independently. Executed.
- `web/bench/desktop-perf-hooks.js:42-47,69-87`: the queue, success and rejection
  continuation, sequence allocation, post-sync pressed-state mutation, both no-op
  branches, and synchronous move validation ran in 64 delayed two-operation trials,
  the mixed tablet/keyboard burst, the injected controller failure, and the required
  state/sequence attacks. Executed. `desktop-perf-hooks.ts` is byte-identical to that
  executed JavaScript and is waived as its editor projection.
- `web/src/sink/presentation.js:140-141,268-286,347,364-365`: callback-present and
  callback-absent construction; scalar, `retiredInstructions` object and
  `guestInstructions` object sources; missing, null, throwing, invalid, decreasing,
  first-total and increasing-total branches; and emitted total/delta fields all ran.
  Source and committed-dist controllers were directly compared byte-for-byte. The null
  callback run contradicts the intended unavailable state and is the semantic finding
  in the report; this is executed refutation, not a coverage gap.
- `web/main.js:25-26,80-87`: reviewed Chromium/Firefox source/dist loads executed all
  four query combinations, module initialization, conditional presentation construction,
  and an actual pre-sample present. Normal/half-gated pages had no sink/callback; all four
  gated pages emitted the refuted `0/0`. The query truth table, surface placement, unique
  timer installation site, cleanup presence, and source/dist byte parity were also
  independently audited in `release-surface-results.json`. The 4096-record cap is
  unchanged defensive bounding context and is waived.
- `web/main.js:1516-1530,907-911`: the exact gate does not boot Linux, so it cannot
  execute the new scheduler RPC sampler, 50 ms interval, ownership guard, or timer
  teardown. Static placement proves normal pages install no timer/callback/surface, but
  the gated live data-flow and teardown remain **needs-evidence**. After the semantic
  fix, add a deterministic page-level harness (a stub controller/timer is sufficient)
  that observes unavailable-before-first-sample, a real retired total, a later delta,
  and teardown. `web/dist/main.js` is byte-identical and waived as generated deployment
  projection. The indentation-only movement of `diagnosticJitStatsTimer = null` is
  behavior-neutral formatting and waived.
- `web/tests/e5-t25a-perf-hooks.test.mjs`: both added tests ran with the complete focused
  suite (8/8, 0 skipped). The numeric 100-to-175 assertion executes the happy path but
  omits the page-shaped initial-null case; that omission permitted the refutation.
- `evidence/e5-t25a/demo/*` and the task-log/status changes are declarative evidence.
  Both images were visually inspected, all four artifacts were hashed, and the demo
  JSON was parsed for 126/126 and empty browser/HTTP error arrays.
- Harness-only 404/traversal catches, browser-launch cleanup, and presentation callback
  exception containment are defensive lines. The attribution callback exception path
  itself was nevertheless executed independently.

Mock/environment hunt: the task intentionally defines a test adapter, so fake input
controllers/backends are appropriate only where exact call ledgers and sink truth are
the subject. The retained gate separately ran real Chromium and Firefox. No randomized
fixtures, hidden `skip`/`todo`, test-only runtime semantic switch, or inherited build
flag was found in the amended diff. A cold clone is not required for this medium-risk,
non-portability claim.
