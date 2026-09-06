# E5-T25a pass-three changed-hunk coverage audit

Reviewed range: `568159e176c52774f72b16eb26b0077fb7b68fee..a1c25437bed33910218eece228a77b230abfb8e9`.

- `web/src/sink/presentation.js:277-288`: dynamically exercised in 77 assertions
  across scalar, `retiredInstructions`, and `guestInstructions` callback forms. Null,
  undefined, coercible non-numbers, unsafe/non-finite/negative values, callback throws,
  valid 0/100/175, source/dist parity, and baseline recovery all ran. A throwing getter
  on the supported object form escaped the narrow callback try/catch and is the semantic
  refutation, not a coverage gap. `web/dist/src/sink/presentation.js` is byte-identical
  and its ordinary unavailable→100→175 path ran directly.
- `web/main.js:1516-1531` and `web/dist/main.js`: source/dist are byte-identical. The
  cache now reads the raw property, has one exact strict-number guard owning the one
  cache assignment, and the unique 50 ms sampler is inside the exact dual gate with
  the owner guard. `clearLinuxOwnerUi` uniquely clears and nulls the timer and resets
  the baseline. The sandbox forbids the listener needed to boot a Linux owner, so these
  lines receive a deterministic static-audit waiver rather than a false execution claim;
  bounded-block and uniqueness results are in `static-audit-results.json:3-21,46-51`.
- `tools/verify/e5-t25a-release-audit.mjs`: executed by the exact make target and passed.
  Its dual-gate and sampler regexes can cross unrelated/closed blocks, and its cleanup
  assertion does not require handle nulling or baseline reset. Those weaknesses are
  demonstrated in `static-audit-results.json:40-46`; the stricter verifier audit supplies
  the lifecycle waiver, so the submitted regexes are not treated as execution evidence.
- `web/tests/e5-t25a-perf-hooks.test.mjs`: all eight focused tests ran with 8 passed,
  0 failed/skipped/todo/cancelled (`make-verify.log`). The unavailable→100→175 regression
  executes the changed sink guard but does not cover property-access exceptions.
- `evidence/e5-t25a/demo/*`: declarative browser evidence. Both artifacts recomputed to
  the exact claimed hashes, the JSON is 126/126 with empty browser/HTTP errors, and the
  screenshot was visually inspected (`integrity-results.json:14-33,82-90`).
- `evidence/e5-t25a/verifier-r2/*`, the task log, and `tasks/QUEUE.md` are prior evidence
  or declarative lifecycle metadata; no runtime execution claim applies. No changed
  implementation hunk is dead.

The unchanged helper concurrency/state boundary was re-exercised because the verifier
request explicitly required carrying those attacks: 16 delayed two-call trials, queue
rejection recovery, stale/duplicate no-ops, invalid damage, null sink, five stable records,
and schema parity all held (`attack-results.json:1142-2364`).
