VERDICT: refuted

- **P1 exact-head gate — HELD.** At
  `fc7bfdf5e6aa503e853ab85e48d4ea656dbede77`, `make verify-E5-T25a`
  passed seven Node tests, the release audit, Chromium 152.0.7977.76, and Firefox
  132.0 (`make-verify-success.log:1-23`; SHA-256
  `e7b8acc14ee9686f6e390ee92b340b1177b55244a8c8ab2370004d1a7094d3e4`).
- **P2–P6 fixture, damage, null sink, state, and sequence attacks — HELD.** Five
  complete repetitions have identical SHA-256
  `edc41b0d0fb314cefb748cb7e8e81728c08208eaa588c2df604312e72e517c8e`;
  stale/duplicate pointer and key transitions are unique-sequence no-ops; invalid
  damage leaves the next valid present at sequence 1; a successful null present has
  `successfulPresents:1` but drawn counters 0/0 (`attack-results.json:3-242`).
- **P7–P9 release isolation, hashes, and byte parity — HELD.** Normal, `testHooks`-
  only, and `perfHooks`-only source/dist pages expose no perf surface and never request
  the helper; only both gates expose telemetry. Source and committed dist each emitted
  a real drawn record, and the full deterministic Node/Chromium fixture bytes match
  exactly (`surface-results.json:5-167`; SHA-256
  `79c07a2c1c46c9c4d68a01eaad9c4cf7737401c2b64ee238232b125df9859272`).
  All four retained worker hashes recompute; the demo JSON reports 126/126 and empty
  browser/HTTP error arrays. The separately served dist page's missing deploy-staged
  `artifacts-alpine.json` is pre-existing and outside this diff, so it is waived.
- **P10 deliverable/coverage — FAILED.** The task requires guest-instruction
  attribution in sink telemetry (`E5-T25a...md:30-31`), but the emitted record contains
  only sequence, timestamp, backend, drawn/replay, rectangle, resource dimensions, and
  bytes (`web/src/sink/presentation.js:330-340`); a scoped symbol search found no guest
  instruction field in source, tests, or dist. Implement and deterministically prove
  that attribution. Other behavioral hunks executed in the gate/attacks/surface audit;
  TS/dist projections are byte-identical generated copies, evidence/task changes are
  declarative, and only defensive catches plus the 4096-record cap are waived.
- **P11 bounded novel ordering attack — FAILED.** Two concurrent public calls received
  records 1 and 2, but controller delivery was X(seq1), button(seq2), sync(seq2),
  Y(seq1), sync(seq1), contradicting deterministic event ordering
  (`attack-results.json:243-332`; SHA-256
  `5238d640452f9dab469b766f1500bc2d030ea6223535e0ad534cbc44ef0b1aef`).
  The same failure reproduced three times. Serialize public helper operations so one
  complete evdev frame reaches its sync before the next sequence begins.
- **SUITE:** retain the exact target and verifier fixtures as attack evidence; no test
  promotion is appropriate until the semantic refutations are fixed. Independent
  machines, WebKit, host rr/ssh-dev, T25b/T25c, T22c, and merge are out of scope.
