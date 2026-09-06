VERDICT: refuted

- **P1 prior ordering refutation — HELD after rework.** Predicted that every delayed
  concurrent public operation would complete through its device sync before the next
  operation began. Across 64 trials in both call orders, all frames were complete; the
  five-frame mixed tablet/keyboard burst retained sequences 1-5, and a rejected queued
  press released the queue for sequences 2 and 3
  (`independent-observations.json:26-162`).
- **P2 prior guest-attribution refutation — HELD on valid samples.** Predicted totals
  100 then 175 would emit `(total,delta)=(100,100),(175,75)`. Source, committed dist,
  and both supported object schemas did exactly that
  (`independent-observations.json:191-227`).
- **P3 required attacks and stable schema — HELD.** Stale and duplicate button/key
  transitions were explicit no-ops with unique sequences 1-11; invalid input consumed
  no sequence; out-of-bounds damage left the next valid record at sequence 1/16 bytes;
  an acknowledging null sink had one successful call but 0 drawn presents/bytes. Five
  fixture hashes and the dist hash were identical, and JS/TS plus source/dist projections
  were byte-equal (`independent-observations.json:163-189,264-306`).
- **P4 release/browser/demo gate — HELD.** The retained exact gate has 8/8 focused tests,
  0 skipped, the expected release-audit result, Chromium 152.0.7977.76 and Firefox 132.0;
  each normal surface was absent and each both-gates move ended in `syncTablet`
  (`make-verify.log:1-25`; `integrity-results.json:51-109`). A reviewed 16-case
  Chromium/Firefox × source/dist × query audit confirms normal and half-gated pages
  install no perf surface or callback (`surface-results.json:14-65,109-177` and
  `surface-results.json:227-277,321-371`); the independent structural audit confirms the 50 ms sampler is also under
  that conjunction (`release-surface-results.json:3-35`). The refreshed demo is 126/126 with empty
  browser/HTTP errors and only the waived favicon resource error
  (`integrity-results.json:41-49`).
- **P5 unavailable guest sample — FAILED / product refutation.** Predicted the page's
  pre-sample state would remain explicit `null/null`. `web/main.js:25,87` supplies the
  initialized-null cache to the sink, while `web/src/sink/presentation.js:277-285`
  applies `Number(null)` and accepts it as safe integer zero. The independent run
  therefore emitted a forged `(guestInstructionsTotal,guestInstructions)=(0,0)` even
  though no scheduler sample existed; missing, throwing, and invalid sources correctly
  emitted null (`independent-observations.json:8-24,232-277`). The reviewed browser
  surface artifact independently records the same forged `0/0` on all four gated
  Chromium/Firefox source/dist pages (`surface-results.json:67-104,178-215` and
  `surface-results.json:278-315,372-410`). Reject null/missing object values before numeric coercion, keep the baseline
  unchanged, and promote a deterministic unavailable-then-100-then-175 regression test.
- **P6 claimed evidence digest — FAILED.** Three rework hashes recompute, and the retained
  and fresh browser artifacts byte-match. The Verification log's browser PNG digest has
  a transposition: it claims `...64b9a46...`, while both the committed and fresh PNG are
  `7b77d08efbfeab64a9b46cf6b3617c86b1e81afd90781a24bf4c2b02893f5547`
  (`integrity-results.json:3-39,99-109`). Correct the log when resubmitting.
- **COVERAGE — NEEDS EVIDENCE in addition to the refutation.** All helper and sink hunks
  executed, but the no-boot exact gate cannot execute `web/main.js:1516-1530,907-911`
  (scheduler sampling, interval ownership, teardown). Static isolation held; add a
  deterministic page-level data-flow/teardown exercise with the semantic fix. Full
  classifications are in `coverage-audit.md`.
- **SUITE:** retain the exact target, dual-browser gate, and verifier attacks. Promote
  the null-sampler case into the focused test after fixing it; no unrelated suite
  expansion. Independent machines, WebKit, host rr/ssh-dev, T25b/T25c, T22c, and merge
  remain out of scope.

Commands: exact diff/source inspection; focused `node --check` and 8-test replay;
release audit; byte comparisons; 64 delayed concurrency trials; mixed-device and queue-
recovery attacks; scalar/object/null/error/invalid/decreasing attribution attacks;
state, damage, and null-sink attacks; SHA-256 recomputation; demo JSON/image inspection;
static four-query source/dist gate audit. No localhost listener was started in this
replacement session; the already-generated exact-head Chromium/Firefox artifacts were
independently parsed, hashed, byte-compared, and visually inspected.
