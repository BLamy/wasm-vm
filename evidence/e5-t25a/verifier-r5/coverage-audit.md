# E5-T25a verifier-r5 changed-hunk coverage audit

Frozen head: `57c2cc828c151c830ebd7a377dc29d7bf898566d`.

Incremental range after the pass-four verdict:
`80151a6d..57c2cc828c151c830ebd7a377dc29d7bf898566d`.

- `web/src/sink/presentation.js:277-283`: dynamically executed by ordinary `Error`,
  throwing retired/fallback getters, a hostile `message` getter, and a revoked proxy.
  The hostile message takes the outer fallback; the revoked proxy also makes
  `String(error)` throw and therefore executes the innermost safe-fallback catch. Both
  preserve attribution baseline and presentation success (`attack-results.json`, checks
  `source-normal-error-contained` through `source-revoked-proxy-novel-diagnostic-contained`).
- `web/dist/src/sink/presentation.js:277-283`: the same paths were independently executed
  through the imported dist controller, including both fallback catches. Current source
  and dist are byte-identical (`static-audit-results.json:4-6,43-44`).
- `web/tests/e5-t25a-perf-hooks.test.mjs:196-214`: the added regression executed in the
  exact focused suite: 10 passed, 0 failed/skipped/todo/cancelled (`make-verify.log:8-25`).
- The resubmission task log and queue change are declarative lifecycle metadata.

All earlier implementation hunks are unchanged from pass four, so its `HELD` results carry
forward under the repository's incremental re-verification rule. They were nevertheless
replayed where dynamic behavior matters:

- `web/bench/desktop-perf-hooks.{js,ts}`: 24 delayed two-operation trials, rejected-queue
  recovery, stale/duplicate transitions, invalid input, and the five-run fixture execute
  validation, queueing, sequence allocation, device dispatch, sync, state, and no-op paths.
  JS/TS bytes match. The TS projection is generated parity and receives that exact waiver.
- `web/{src,dist}/sink/presentation.js`: source and dist attribution validation, telemetry,
  counters, damage rejection, real-draw and null-draw decisions, stable records, and schema
  parity all execute in `attacks.mjs`. The prior unchanged controller fallback/lifecycle
  behavior remains covered by the focused presentation suite.
- `web/{src,dist}/sink/present-backend.{js,ts}`: the additive default `drawsPixels()` method
  is an interface default. Concrete true/false implementations are dynamically consumed by
  the controller attacks; duplicated dist/TS files are generated parity waivers.
- `web/{main,dist/main}.js`: source/dist bytes match. The exact dual query conjunction,
  strict raw-number cache assignment, owner guard, unique 50 ms sampler, timer clear/null,
  baseline reset, record cap, and gated surface are checked inside exact bounded blocks
  (`static-audit-results.json:4-20`). The Linux-owner setup/teardown path cannot execute
  after the sandbox rejects localhost; it receives this precise deterministic static waiver.
- `tools/verify/e5-t25a-release-audit.mjs` and the `Makefile` target executed. Five isolated
  gate/guard/sampler/timer/baseline mutations were rejected by the copied audit
  (`release-audit-sabotage-results.json:3-30`).
- `tools/verify/e5-t25a-browser.mjs`: the current listener setup executed and failed only at
  sandbox bind. Its browser assertions are carried forward from retained Chromium/Firefox
  evidence after exact hash/JSON inspection; current affected semantics are independently
  exercised in source/dist Node attacks.
- Browser/demo PNG and JSON files plus verification reports are evidence/declarative data;
  hashes and JSON semantics were recomputed, and both PNGs were visually inspected.

No changed task runtime hunk is unexecuted without a precise waiver, and no dead hunk was
found.
