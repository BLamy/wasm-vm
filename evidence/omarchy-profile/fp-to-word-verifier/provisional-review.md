# E5.5-T03y — provisional independent review

No final verdict yet. Frozen implementation and promoted tests are commit
`53a095a485787e4ce6177712830d76728342b083`; WASM is
`7feb3179f4088b4c9ef3f69c23804ff0d9691f412b7270c66f61bbd85dc5a6b9`.
No product refutation has been found for the W/WU conversion boundary.

- P1–P4 — HELD. Independent literals (21,120 per executor) and seeded alias/
  illegal cases (1,792, including 868 illegal) match native, private and shared
  execution. Literal digest `4083560513975942652`; seeded digest
  `4721190114470949240`. See frozen worker `acceptance.log:34,36,75,76,95,96`.
  FPR preservation, unrelated X registers, signed WU results, negative-fraction
  invalid/inexact distinctions, and exact x0 FS Dirty are asserted directly.
- P5–P6 — HELD. 2,048 instrumented generated executions made exactly 1,080
  legal helper calls and zero illegal calls. Helper arguments, canonical NaN
  bits, optional import indices, exact X dirty mask and absence of FPR dirty
  bits hold. The eight-import mixed chain executes; all four earlier-helper
  combinations and unchanged integer-only behavior execute. See
  `acceptance.log:32,38` and promoted native fixture.
- P7 — HELD. Genuine interpreted CSR writes and later load/store/illegal
  faults retain the exact prefix and virtual PC. Six actual memory-growth
  scenarios each grow 65,536 bytes once; sixteen same/cross-module budget/fault
  scenarios publish the converted integer correctly. See
  `acceptance.log:30,70–107`; control digest `8504544371684976080` agrees across
  all executors.
- P8 sensitivity — HELD. Deliberately changing WU(-0.5,RMM)'s expected flags
  from 16 to 17 in an isolated copy fails at the named literal assertion.
  Restoring the exact fixture passes. See `sabotage.json` and both sabotage logs.
- P8 production execution — HELD. Independently checked the real ELF bytes,
  report registers/CSRs, RAM digest and all three screenshot hashes. Viewed
  the screenshots: 127 passed/0 failed and a live conversion pip. The real
  mixed conversion loop accounts for 3,605/4,000 JIT retirements. See
  `production-inspection.json`, worker `browser/report.json` SHA-256
  `8f1b33b6fff167632f5423e7205d122fcdf42044986d8a5af77d3a0e54cff933`.
- P9 physical measurement/gating — HELD; desktop response FAILED. The exact
  120-second window ended `2026-09-15T23:42:59.984Z`. All 128 events were trusted,
  focused on the canvas and acknowledged by the worker. Thirteen independent
  guest-file reads exited 75 without the nonce; one further request was pending.
  Both actual terminal images show only the original prompt and cursor, have
  the same SHA-256 `97fc180d4d35c68ca5941dc591afb315220550165469f3c4ead7827989cc2f3f`,
  and frames remain 2→2. Physical report SHA-256 is
  `9fdf9604e54206d87c27c9e6fb40c1d297b8fbb92768aa270edd40913ec2f687`;
  deadline fields are at `physical-input/desktop/report.json:26110–26115`.
  See `physical-inspection.json`. T03q must remain gated.

Remaining: final broad-gauntlet outcomes/unchanged-boundary limitations,
pristine-clone rebuild and acceptance, independent public bytes, worker seal,
and final task log/status. The unchanged interpreter/SoftFloat/decoder claims
from the predecessor remain HELD; this review does not reopen unrelated work.
