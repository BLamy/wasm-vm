VERDICT: verified

This verifies AT's narrowed submitted claim: the existing GPU source-offset
contract is corrected, and its real desktop trial still fails visibly. It does
not verify desktop responsiveness. Q remains gated through AU and a later real
physical-and-visible pass.

- **P1 — HELD.** Linux 6.6.63's producer and QEMU 9.2.0's consumer independently
  use the supplied byte offset as the first source address. In the worker's
  frozen `final/acceptance.log:27`, offset24 writes literal words A5000006,
  A5000007, A5000008, A500000B, A500000C and A500000D at destination indices
  6,7,8,11,12,13. The original regression log reports A500000C instead of
  A5000006. Native and WASM source/destination cases pass on corrected source.
- **P2/P3/P4 — HELD.** `clean.log:3–16` and `restored.log` record six independent
  critic checks plus three independent seeds ×256 SG partitions. The literal
  unaligned offset3 / 27-byte exact-tail case produces 07060504, 0B0A0908,
  17161514 and 1B1A1918 at host indices 5,6,9,10 across discontiguous SG and
  physical page boundaries. First establish presentation, then require the
  resulting damage rectangle to be (1,1,2,2); repeating identical pixels must
  not invent pending damage. Offset4/27/u64::MAX-3/u64::MAX, invalid later
  backing and bad destination/detached cases reject without shadow, damage or
  guest-RAM mutation. Checked zero-area behavior is unchanged. Existing full
  transfers and 30,000 worker model cases pass in both frozen runs.
- **P5 — HELD.** `final-device-recording.json` independently decodes the actual
  queued request bytes at `final/acceptance.log:60–64`, all 25 device responses,
  queue indices, source offsets 0/36/4/56/100, SG lengths and sink CRCs. The five
  CRCs remain 2d068e19, 80e3df97, cafeb5cb, 74f3ca70 and 4b09d24f. The logged
  shadow field is the test oracle; the recorded Rust test separately asserts
  actual host shadow equality after mutating guest backing. The cold recording
  repeats the same checks. Format, strict affected Clippy, 80 core GPU tests,
  four Machine tests, six WASM tests, 39 harness tests and the real 127/0 browser
  ISA suite pass. Neither full unrelated workspace success nor new renderer
  capability is claimed.
- **P6 — HELD.** Only in the completed pristine clone, restoring the exact old
  extra-origin arithmetic makes the worker literal test fail at
  `worker-literal-sabotage.log:9–11` (word12 versus word6), the actual queued
  transfer fail at `worker-queue-sabotage.log:8–10` (word2 versus word1), and
  the critic literal/seed cases fail with InvalidParameter. Clean and restored
  controls pass. `independent-attack.json` binds the precise mutation, all 11
  commands and logs; every tracked clone byte was restored. An initial critic
  rlib dependency-search error occurred before any probe or mutation and is
  preserved separately under `harness-initial/`; it is not a candidate finding.
- **P7 — HELD.** Runtime source is
  `2e61bf3e971595741c627e8b68fcaee055c27945`; worker submission is
  `31acd7e82171ec5b4db5be3d671a02211d490c26`. The one clean clone rebuilds the
  exact 1,602,266-byte WASM with SHA256
  `7d7b300003cf68076c28958694062dacf3c879efe921bc631bade568ee143bdf` and runs
  complete acceptance with scrubbed Rust/Cargo settings. Only three sealed
  guest-artifact directories are copied, not compiler outputs.
  `cold-integrity.json` checks all seven successful recorded commands;
  `worker-seal.json` verifies every file in the 44-file worker seal
  `970d1c9e4215d69eb0ea8f54eeade989095104ad7d7242d1f02b23d7a342e996`.
  Runtime identity/default-compatibility attacks reject all 26 mutations.
- **P8 — HELD.** Independent audits bind all 45 helpers, 96 served rows and 67
  distinct git-backed resources in each actual trial, exact AR/AQ inputs and
  corrected WASM. Each records 128 trusted keys, 256 successful ordered key/sync
  replies, 27 independent reads, one exact nonce and no pending read. Raw nonce
  completion is Enter+87.920s / +90.369s; recorder acknowledgment adds 1ms.
  Both preserve 300/60/120/20/30s budgets, original geometry, no observer or
  profiler, zero errors and normal cleanup (0.166s / 0.162s). The next presented
  frame advances 4→5 within the post-nonce capture window (15.963s / 16.455s).
- **P9 — FAILED as a positive responsiveness claim; negative result preserved.**
  I personally viewed the final PNG: only the old empty prompt remains. The
  cold PNG is byte-identical, as are both earlier AS failures: SHA256
  `431be977157bf77dcd21ca8bf3b640bce9e02dc8c54f09a30d58af78a8195b24`.
  `response-review.md` cites the actual nonce, frame, timing and image points.
  The final worker explicitly submits this failure, not a positive desktop
  result; Q depends on AU and still requires uninstrumented physical and visible
  success. No unbound-scanout cause is asserted by this task.
- **Coverage/publication — HELD.** `coverage.md` accounts for all changed hunks;
  no semantic hunk remains unproven. Generated declarative inventory is waived.
  The only post-freeze distribution changes are URL rewrites preserving artifact
  bytes. `public.json` independently fetches six exact committed files across
  deployment https://6d0d0ece.wasm-vm.pages.dev and production
  https://wasm-vm.pages.dev: corrected WASM, unchanged default kernel/pair
  manifest, and an honest partial roadmap explicitly saying responsiveness is
  unresolved. It is a GPU correction deployment, not Q's responsive release.
- **SUITE.** Retain the committed literal SG/source-destination regression,
  actual queued transfer/golden CRC fixtures, wasm32 counterpart and
  `make verify-E5_5-T03at` target. The additional critic source and reproducible
  scratch-only sabotage runner remain in this sealed evidence directory.

Unchanged AQ/AR/AS architectural evidence and AO's inherited broad-gauntlet
failures carry forward. No implementation file was edited by this verifier.
