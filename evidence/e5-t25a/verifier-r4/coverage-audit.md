# E5-T25a pass-four changed-hunk coverage audit

Reviewed range: `ea18259c072be8cd4d20212fb5d0228b29d1a99b..f7cee38b5aa93b00509e60d7dd103f5e5c21bfe3`.

- `web/src/sink/presentation.js:270-278`: dynamically exercised with ordinary callback
  throws, first-field getter throws, fallback-field getter throws, and the hostile thrown
  diagnostic value. Ordinary getters are contained; the hostile diagnostic formatting
  escapes to the outer presentation catch and is the semantic refutation.
- `web/dist/src/sink/presentation.js`: directly exercised for ordinary callback and getter
  throws and for the refuting hostile diagnostic value. It is also byte-identical to the
  source controller (`static-audit-results.json:4-6,48-49`).
- `web/tests/e5-t25a-perf-hooks.test.mjs`: the new hostile-getter regression ran in the
  exact focused suite: 9 passed, 0 failed/skipped/todo/cancelled (`make-verify.log`). It
  proves the promoted pass-three case but does not cover a throwing diagnostic accessor.
- `tools/verify/e5-t25a-release-audit.mjs`: executed by the exact target and passed. Its
  scheduler, sampler, surface, and teardown slices were independently inspected; all
  current exact checks held (`static-audit-results.json:7-23`). Five isolated mutations
  were each rejected by the actual copied audit (`release-audit-sabotage-results.json:3-30`).
- `web/main.js` is unchanged in this pass-four range. Because the sandbox rejected the
  listener required for the owner path, the raw guard, exact dual gate, sampler owner
  guard/setup, timer clear/null, and baseline reset receive the exact deterministic static
  waiver in `static-audit-results.json:7-16,44`; current source/dist bytes match.
- The task status/log and `tasks/QUEUE.md` are declarative lifecycle metadata. Browser and
  demo evidence are immutable artifacts; hashes, JSON semantics, and both screenshots
  were independently checked (`integrity-results.json:3-99`).

The unchanged helper and presentation attack surface was deliberately re-exercised per
the verifier request: both delayed call orders, rejected queue recovery, stale/duplicate
no-ops, invalid input/damage, null sink, five stable records, and source/dist schema parity
all held. No changed implementation hunk is dead or otherwise uncovered.
