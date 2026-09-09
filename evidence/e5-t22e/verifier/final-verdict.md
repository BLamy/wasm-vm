VERDICT: verified

Fresh verifier, 2026-09-06. Runtime `7490e64ea6414df978a0101f628a74df5481b0bf`;
frozen acceptance head `779efb7dfafc55db8ee476e3626a6d5f78b18a8c`; worker claim
commit `4915d0556e77626520c82e4aeaf2c861124131eb`. Reviewed scoped diff
`d35ad4de..779efb7d`, the entire task/claim and browser harness before evidence.
Predictions were recorded before handoff in `source-predictions-2026-09-06.md`.
No runtime edits, worker-suite rerun, additional cold clone acceptance, push,
merge, deployment, or other task-status changes were performed.

## Prediction results and citations

All paths below are relative to the repository root. Evidence digest verification
is executable via `node evidence/e5-t22e/verifier/audit-evidence.mjs`.

| Prediction | Result and concrete observation | Recorded point |
| --- | --- | --- |
| P1 monitor / actual MMIO | HELD: Wasm retires zero store to 0x10008070, then reads events=0; 901x701, 1x1 and 4095x4095 retain 60 Hz and EDID. Native direct-reset test retains synthetic 75 Hz across 2,000 resets; native transport and independent tests retain requested odd dimensions. | `evidence/e5-t22e/acceptance.log:215`, `:221`, `:516`–`:534`; `verifier/independent-attack.log:7`–`:10` under the same evidence directory. |
| P2 independent EDID | HELD: all 128 before/after bytes match for eight direct/worker cases; independent active-size decode and checksum pass. Independent native GET_EDID on reconfigured controlq returns the same block after renegotiation, and rejects before renegotiation. | `browser/browser-proof.json:310`, `:945`, `:1580`, `:2215`, `:2864`, `:3499`, `:4134`, `:4769`; `verifier/audit-evidence.log:2`–`:12`; promoted test lines 139–169. |
| P3 guest ownership cleanup | HELD: resource 43/backing disappears, accounting=0, raw scanout=None and cursor hidden after both MMIO resets. Exactly one hidden sink callback; subsequent scanout and cursor requests using 43 fail with INVALID_RESOURCE_ID until fresh allocation. | `verifier/independent-attack.log:7`–`:10`; `crates/core/src/dev/virtio/gpu/reset_verifier_tests.rs:76`–`:96`, `:124`–`:127`, `:173`–`:229`; worker native test `acceptance.log:215`. |
| P4 IRQ | HELD at device/transport boundary: pending and already-latched config+used IRQ variants both clear InterruptStatus; same-mode request after reset latches exactly once. Existing machine IRQ-to-PLIC propagation is unchanged and source-reviewed (`core/src/lib.rs:3928`–`:3933`); no new PLIC-controller semantics are claimed. | `acceptance.log:221`; `verifier/independent-attack.log:7`–`:10`; promoted test lines 69–106. |
| P5 queues | HELD: worker test drops both cached views with no old used-ring changes. Independent attack installs new addresses before deferred reset consumption; new rings complete 5 control and 2 cursor commands while old used-ring and response sentinels remain unchanged. This tests actual new-ring use, not only empty caches. | `acceptance.log:221`; `verifier/independent-attack.log:7`–`:10`; promoted test lines 107–138, 226–233. |
| P6 determinism / reset ordering | HELD: worker native 1,000-mode sequence with two resets per iteration; actual-Wasm min/max/odd cases; independent double-reset with same-mode event before deferred cleanup; direct/worker subsequent 1111x777 requests each raise a new event. | `acceptance.log:215`, `:516`–`:534`; `verifier/audit-evidence.log:2`–`:12`; promoted test lines 76–106. |
| P7 constructor / isolation | HELD: all eight new browser VM observations start 1280x800/60 with identical checksum-valid default EDID. Concurrent untouched and subsequently constructed native devices retain default dimensions, refresh, EDID, events and resource state despite mutations to the first device. | `verifier/audit-evidence.log:2`–`:9`; `browser/browser-proof.json:26`, `:2580` and remaining sample fresh blocks; promoted test lines 234–241. |
| P8 browser / exact-head proof | HELD: direct and module-worker controllers each execute four reset fixtures and emit UART R. Production Wasm and source hashes match the frozen commit, clean clone and archived JSON. Normal demo shows 126 passed/0 failed/126 done and no collected errors; screenshot inspected. | `acceptance.log:1`–`:2`, `:439`, `:549`, `:654`–`:656`; `browser/browser-proof.json:1`–`:10`, `:5122`–`:5130`; `browser/demo-suite.png`; `verifier/audit-evidence.log:13`. |

The architectural fixture digest is
`4e280b0d92d2251e2d0afeb62ccc8b03b35de2aaf6eb6c75d21b6227d14c4d25`.
It hashes RAM and excludes GPU state; preservation is established by the separate
byte/stat/transport observations above. The browser fixture is a different kernel
with a UART marker and therefore has its own RAM digest. No digest equivalence
between those different kernels, or compositor mode adoption, is claimed.

## Falsification, sufficiency and permanent artifact

- Independent attack: `display_reset_verifier_reconfigured_rings_reject_stale_resources`
  passed on the frozen source plus test-only include in disposable copy
  `/tmp/e5-t22e-verifier.AmU6jU/repo`. It uses real MMIO transport configuration
  and status writes, independent odd mode 1373x907, resource id 43, different
  old/new ring addresses, two reset writes and both pending/latched IRQ cases.
  These native transport writes are not presented as retired guest instructions;
  the worker's actual-Wasm trace supplies that distinct instruction proof.
- Single sabotage: restoring the four old monitor-default assignments in that
  disposable copy makes all three focused reset tests fail. Worker tests observe
  1280x800 instead of 901x701; independent attack observes 1280x800 instead of
  1373x907. See `verifier/sabotage.log:7`–`:17`, exit 101. No shared runtime or
  authoritative cold-clone files were sabotaged.
- SUITE: promote `crates/core/src/dev/virtio/gpu/reset_verifier_tests.rs` through
  an include inside the existing cfg(test) module. The existing acceptance
  target's native --lib phase automatically includes it. Formatting checks and
  a focused run of the promoted test pass (`verifier/promoted-test.log`).
- Worker evidence already supplies the prescribed scoped native/Wasm build,
  lint, tests, browser capture and final pristine-clone pass. The retained clone
  is exactly 779efb7d, with identical browser JSON and production Wasm hashes.
  Its post-build manifest outputs are not evidence of a dirty input checkout.
  No portability failure arose, so its acceptance was not rerun. Only test and
  verification metadata additions follow the frozen runtime proof.

## Changed-hunk coverage

- Runtime `gpu/mod.rs:523`–`:528`: deletion of default assignments is exercised
  by direct native, MMIO native, actual-Wasm and built direct/worker reset paths;
  pre/post mode/refresh/all-byte EDID assertions and sabotage discriminate it.
  The explanatory comment is waived as non-executable. Unchanged guest cleanup
  branches are observed by native tests and the independent combined attack.
- New 51-line native test and changed old lifecycle expectations: executed at
  `acceptance.log:215` and the lifecycle pass in that same native suite. The
  added 63-line IRQ/cache test executes both bool cases at `acceptance.log:221`.
  Both reset loop paths, resource/cursor presence and absent second-reset branch
  execute. No ignore or disabled-assertion hunk was added.
- Actual-Wasm test: all three cases execute at `acceptance.log:516`–`:534`,
  including every added assertion and canonical trace/digest/stats output.
- Makefile target: command lines and successful exits recorded in cold-clone
  `acceptance.log`; no extra unrelated regression claims inferred from it.
- Browser harness: both backend arms, four cases each, successful reset marker,
  post-reset stats, subsequent requests and demo assertions execute in the
  archived JSON/log. Timeout/error throws, HTTP missing-file branch, assertion
  failure and exceptional cleanup are harness safeguards; waived as defensive
  harness paths, not claimed new runtime behavior. Production source/artifact
  hash collection is independently recomputed from the frozen git objects.
- `web/roadmap.js`/dist copy: declarative entry displayed in inspected capture;
  frozen capture appropriately says in-progress, before verification. Generated
  task JSON and task/queue text are metadata, reviewed and waived from execution.
  Generated Wasm is exercised in browser proof; service-worker cache-version
  string is generated metadata. Capture blocks service workers, so it proves the
  built assets directly, not a new service-worker lifecycle claim.
- Recorded old-code failure is regression context, not successful proof.
  No changed product hunk remains unexecuted or unwaived within this reset scope.

T22a strict-input and T22b presentation HELD results carry forward for boundaries
unchanged by this task's diff. Their evidence files are not rewritten. The
reset-specific retained-monitor/cleared-guest interaction has been independently
tested here; this verdict does not re-certify earlier T22c edits or unblock that
task by changing its status. Existing broad-suite baseline failures remain outside
this scoped claim, as explicitly documented by the worker and prior verifiers.

## Evidence hashes

| Artifact | SHA-256 |
| --- | --- |
| `acceptance.log` | `76e2a911d222a6fd84cd558830c9d9fe8a5a91740168d1bcdf29155f89318237` |
| `browser/browser-proof.json` | `0664a5a4929b92d61a37a2b9389ab17619548045ed4557795d431161ee4e79d0` |
| `browser/demo-suite.png` | `d23dc60df6f059ea4e9dd3846bbf7d14610a8300cf3b3905789827fb5a5da1b3` |
| production Wasm | `c1c854b8bb3b5cfbcc5a6a6f45199fca2151d7d949e7c707b546343504d7cb0f` |
| `verifier/independent-attack.log` | `b89be813c496ea304b274f1671d71c39814b5ed2f5d472bc352799cc72a2fa42` |
| `verifier/sabotage.log` | `bb8200a6b5d7b1541f80909daf3c90b31967fb1c8a41d7ac3cd83d9e03500ce7` |
| `verifier/audit-evidence.log` | `af7458541a16b202297588b1a421c4f9717e7ea225db09758aca8046efb625c8` |
| promoted test source | `f1c48533078e0ed5d2ab0106ecc1647fedde4180bf286af53bf6de44fd668144` |
