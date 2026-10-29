PREPUBLICATION VERDICT: pass

Scope: fresh actual Daybreak Blue adversarial review of
`f2e4ab0d28b157f6d41e0502d6e690c0baa93cfe..0144c662b0ffc53e0aec1efdbabc4edcac73b27d`,
with runtime frozen at `63374f7c1e546c922ba1c779f34b09fced5e1ad4`. This is readiness before
publication, not final task verification. I made no implementation, task/status, Git, deployment,
hardware-setting, or GUI changes. I did not run an original cold boot, long replay, benchmark/world
suite, or physical-phone test. Writes are confined to this audit root and scratch tests.

## Outcome

I did not refute the streamed software restore boundary. The changed fresh software path removes
the former explicit full expanded JavaScript `Response.arrayBuffer()` snapshot and fills one
pre-reserved Wasm `Vec<u8>` through bounded binding calls. The complete existing container,
coherence, component, sparse-RAM, and transactional restore logic remains below that boundary and
is unchanged. Independent actual-Wasm attacks held, including non-zero typed-array offsets, a
recoverable failed append after a valid prefix, consumed ownership on all restore outcomes,
coherence refusals, malformed TLVs, and invalid late device state. Every rejected restore left a
complete re-saved machine snapshot byte-identical.

The frozen worker gate remains honestly **FAILED**, and its first continuation remains honestly
**FAILED**. The second fixture-only continuation passes only the previously missing demo step and
cryptographically carries the eleven unchanged successful commands. This incremental combination
is sufficient for prepublication readiness; neither failed receipt is relabelled.

The first pristine receipt also remains **FAILED**. Its 2,633,541-byte output
`4aae7ad32ab000918149e7a96b0abc089b20d844d0e9636ec0c48f377865b0cf` differs from the shipped
2,650,103-byte output `6d3082341ed52848f108da2e5743a0f11716d8828694cca11ee9bf4d9bbb053d`.
The preserved v1 clone selects Rust 1.98.0 because its sparse set omitted the tracked toolchain
file; that is directly observed, not inferred from the byte difference. A new independently owned
shallow clone including the tracked Rust 1.96.0 pin rebuilt both wasm and glue byte-identically.
Its v2 receipt nevertheless remains **FAILED** because that sparse set omitted the published gzip,
so the harness could not start command 9. I did not relabel that failure either. I closed the
functional source claim with a separate Daybreak scratch acceptance using only that pinned clone's
own compiled wasm, matching glue/source and closure stamp, while reading the immutable published
release input from its custody path. It restored the complete object and matched the independent
1 GiB RAM digest. This does not claim a second empty-target build or general byte reproducibility.

Publication itself is still pending. The public site currently serves the old 2,645,647-byte wasm
(`00159a8c…`). During this review, PR 626 advanced from the requested review head `0144c662…` to
`087c69c5…`, still open/draft and based on open PR 625; all 48 listed PRs remain open. The later
commit changes only `Makefile` and `software-snapshot-gate.py`, not runtime. Its same-clone pristine
continuation passed after fetching the authenticated release object; details are separated below
because it is outside the requested diff. Deploy and verify the final exact head on main Cloudflare
Pages, then run the final post-deployment critic. Do not mark the task verified before that live
check and do not merge without a separate explicit request.

## Frozen predictions

Predictions were written before opening worker or pristine outputs at
`predictions.md`, SHA-256
`d1140ccf074cf6feee3831589fb72f2644e356e09bc73da9e73467110f429b41`.

- **P1 HELD — direct bounded view copy.** `SnapshotBuffer.append` takes a JS `Uint8Array` handle,
  validates 1..256 KiB, resizes only the reserved Rust vector, then `copy_to`s the exact view
  (`crates/wasm/src/snapshot_staging.rs:21-38`, `crates/wasm/src/lib.rs:2256-2260`). A deterministic
  xorshift schedule using sentinel-backed subarrays with non-zero offsets reconstructed the exact
  snapshot hash in the shipped wasm.
- **P2 HELD — novel failed-append recovery.** After a 37-byte valid prefix, empty, 256 KiB+1, and
  declared-total-overflow appends all threw before changing length or prefix SHA. The same object
  then accepted an independent 8,191-byte suffix schedule and restored successfully. Citation:
  `scratch/actual-wasm-boundary.mjs` and its passing log.
- **P3 HELD — consumed ownership.** Generated glue calls `buffer.__destroy_into_raw()` before Rust
  (`web/dist/pkg/wasm_vm_wasm.js:2094-2105`). Valid, incomplete, missing-identity, and corrupt calls
  all left the wrapper pointer zero. Incomplete and every refusal preserved the complete machine
  serialization exactly.
- **P4 HELD — classification and all-or-nothing refusal.** Independent offsets produced
  `foreign_build`, `foreign_image`, and `stale`; a duplicate tag, overflowing section length, and a
  structurally complete VIRTIO_RNG final-state boolean set to 2 produced `corrupt`. The last attack
  reaches the detached device parser's strict boolean check, not merely outer framing
  (`crates/core/src/lib.rs:4733-4740`, `crates/core/src/resume.rs:167-173`).
- **P5 HELD — real complete object.** Worker and independent pristine acceptance authenticate
  compressed length/hash 210,695,930 / `98235fbe…`, expanded length/hash 634,769,246 /
  `a356cd74…`, all 16 TLVs and 1 GiB sparse RAM digest `310a8f15…`. Restore added zero wasm-memory
  bytes after staging in both full runs. This is allocator high-water evidence, not RSS.
- **P6 HELD — preserved receipt history.** Frozen exit codes are eleven zeroes then one; continuation
  v2 records `originalOutcome: failed`, original gate SHA `64711b53…`, and exactly two changed paths.
  Continuation v1's locked-Mac decorative WebGL failure is also retained.
- **P7 HELD with explicit limits — pristine discrepancy.** V1 is still failed. The two preserved
  clones directly select Rust 1.98.0 versus pinned 1.96.0. Pinned v2 produced exact committed wasm
  and glue; its receipt failed only because the sparse clone lacked the release gzip. My own-output
  functional run passed. Import/export counts are both 177/282 and public JS APIs match; v1 differs
  in internal closure export spelling, snippet numbering, one optimized function, code/data sizes,
  and producer metadata. No semantic cause is assigned merely from those differences.
- **P8 HELD — frozen runtime and retained factory.** `63374f7c1..0144c662` changes only
  `tools/verify/software-snapshot-gate.py` and `tools/verify/e5-t18e-demo-smoke.mjs`. The retained
  GPU pair remains byte-identical at SHA-256 `3583ea9927d142e33c9b1de5963d89bd1f0b1022df7047c8a8b02d7f734a01bd`,
  and `artifacts-omarchy-virgl.json` is unchanged. The generated runtime closure stamp necessarily
  tracks the new wasm; this review does not relabel or qualify the old GPU pair.
- **P9 NEEDS EVIDENCE only as the final publication step.** Live Cloudflare currently serves
  2,645,647 bytes / `00159a8c…`, not the reviewed 2,650,103 bytes / `6d3082…`. Deploy exact head,
  verify live hashes and the bounded software warm restore, then perform the final critic. This is
  not a runtime refutation.

## Independent attacks and sabotage

`scratch/actual-wasm-boundary.mjs` initializes the committed web wasm directly from bytes under
Node, constructs a 16 MiB `WasmLinux`, and avoids Chrome/HTTP. It passed with module
`6d308234…`, a 7,424-byte small complete snapshot, 15 sections, exact offset-view SHA, and six
independently generated refusal cases. The novel failed-append prefix remained usable. The first
exploratory probe intentionally remains in scratch: it incorrectly demanded byte-identical
serialization after a *successful* restore; that is stronger than the contract because host-owned
state is refreshed/discarded. The corrected oracle uses `stateDigest` on success and complete
snapshot bytes only on refusal.

The sabotage copy removes `buffer?.free()` from the staging `finally`. The unchanged cleanup
assertion then exits 1 with `rejected staging must be freed` (`scratch/sabotage-cleanup-check.log`,
SHA-256 `321aaa974695ee86b56d64d1dd8e05373683cdc32d25978fd4a71021b35139a0`).
Thus the cleanup assertion is sensitive to the behavior it claims.

The pinned-clean full acceptance (`scratch/pristine-own-full-acceptance.mjs`) used its own
2,650,103-byte wasm and 193,900-byte matching glue. It passed with 41,958 copies, observed maximum
copy 16,384 bytes, wasm memory 1,173,553,152 before staging and 1,808,334,848 after staging/restore,
and RAM digest `310a8f15…`. The published gzip came from the reviewed immutable release custody path
because the sparse clone intentionally lacked large release objects. No compiled artifact was
copied from the parent repository.

## Concurrent post-scope pristine continuation

After the requested `0144c662…` review was complete, branch/PR head moved to `087c69c5…` with only
`Makefile` and `tools/verify/software-snapshot-gate.py` changed (binary diff SHA-256
`9608d54c6851fc0cef98503a749758a8fd499e2dda63f58434666032c4a3e2d5`). Read-only inspection found:

- the Make target now invokes the existing authenticated Omarchy snapshot fetcher before the gate;
- resume logic verifies the failed command prefix matches the current acceptance commands, carries
  every earlier passing log by digest, and resumes at the failed command rather than assuming a
  fixed twelfth-command failure;
- `/private/tmp/e5-5-t07-pristine-proof-v3/receipt.json` preserves v2 as FAILED, continues the same
  independently compiled pinned clone (no second empty-target claim), retains exact wasm/glue, and
  passes only the missing three browser proofs after the authenticated R2 bootstrap;
- v3 receipt SHA-256 is `4db8c96ebade72ae3be61c6d268e30bfcdaf5426585da42aba902b57a3368fc3`;
  its acceptance log is `9225f9e6eac2523681e28cd455d2f6bfc86e3b61fe511d20ab6c58d3c751245c`.

This later harness-only pass reinforces pristine readiness and does not change any runtime finding
or relabel v1/v2. Because `087c69c5…` was not part of the human-specified diff, the exact-diff and
source digests in this audit remain intentionally bound to `0144c662…`; final publication review
must cite the final PR head explicitly.

One limitation remains explicit: `DecompressionStream` is browser-owned. Source proves the old
explicit full expanded JS `arrayBuffer()` is gone and that each JS-to-Wasm copy is bounded; it does
not establish browser-internal buffering, physical residency, WebContent RSS, or a numeric peak
reduction. Actual Chrome observed 64 KiB copy parts and the clean Node run 16 KiB parts, while the
iOS 27.1 simulator completed the path. No stronger memory claim is made.

## Evidence reconciliation

- Evidence index SHA-256 `a7fc1ed56a0ec9472f4b680720900910b7a68473b6e04f2b734e9268e636b212`:
  all 30 indexed files match recorded byte lengths and SHA-256 values.
- Frozen gate `64711b53…`: FAILED, head `63374f7c1`, eleven passed commands then obsolete roadmap
  lookup exit 1. The eleven include format, native and wasm clippy, 49 wasm-native tests, 28 core
  resume tests, wasm build, four gzip tests, real-Wasm attacks/full artifact restore, and the actual
  complete warm app restore plus trusted echo.
- Staging report `58848c85…`: PASS; expanded `634769246`, SHA `a356cd74…`, 11,159 copies,
  max copy 65,536, no post-staging wasm growth, RAM `310a8f15…`, zero guest instructions during the
  isolated restore test.
- Warm UI report `c1caeafc…`: PASS; restored/paused state, staged event at 634,769,246 bytes,
  56/56 trusted keys, guest file readback `stream-restore-ok`, Chrome errors/httpErrors empty.
- Demo continuation v2 `16e34778…`: PASS of only the corrected demo command; SwiftShader is declared
  for the decorative hero, suite is 127/0, errors/httpErrors empty, task detail visible, screenshot
  SHA `d51b5248…`. It does not claim accelerated guest rendering.
- Simulator observation `2ec2ea4f…` and screenshot `93af7981…`: actual iPhone Duo Simulator,
  iOS 27.1, localhost software URL explicitly containing `gpu=0`, visible `iphone-stream-ok` and
  returned prompt. Safari console was not captured; zero browser errors belongs only to Chrome.
- Initial memory diagnostic remains HELD at exact SHA-256
  `6529f7543bcfb9e38ab63b9ec7b3830ba07733d973aa63b0fbe947b739435d56`.
  It proves the old logical copy timeline and 2,343,280,316-byte named lower bound, not the phone's
  crash cause. The new source removes the explicit expanded JS allocation at that boundary; this
  audit does not invent an RSS or 605 MiB peak reduction.

## Diff coverage

- **Executed:** `SnapshotStaging::{new,append_with,bytes,finish}`, all public `SnapshotBuffer`
  methods, `restoreSnapshotBuffer`, fresh-desktop loader staging/ownership/finally paths,
  `stageGzipSnapshot` success/descriptor/short/oversize/digest/gzip/reader/copy/cleanup paths,
  manifest expanded metadata, generated glue/wasm, actual published full restore, warm UI, and both
  corrected fixture hunks.
- **Carried HELD:** complete core format/coherence/component/sparse-RAM/device transactional restore.
  No core file changed. The selected 28 native resume tests execute malformed later components,
  missing/duplicate sections, topology mismatch, generation/base mismatch, and atomic refusal.
- **Waived with reason:** Makefile's one-line target is a dispatcher and was invoked in the pristine
  experiment; generated `web/dist` source copies are byte-identical to source; task/queue/roadmap/
  tasks JSON are declarative; the non-fresh legacy `gunzip` branch is the unchanged existing path
  and out of this fresh-software scope; generated type declarations and closure-name/snippet-order
  changes carry the actual module/glue behavior rather than separate semantics.
- **No dead or unexecuted claimed runtime hunk found.** Allocation failure inside
  `try_reserve_exact` was not forced with a huge malicious allocation; it maps the allocator failure
  to an error before staging ownership exists and is waived as unsafe to induce in this bounded
  review.

## Scope boundaries and final step

No evidence establishes physical iPhone success, a physical OOM, iOS 26.7.2 causation, WebContent
RSS, or a new GPU qualification. The user has not explicitly reconfirmed `gpu=0`; the simulator URL
records what the worker actually used but cannot substitute for that confirmation. Existing
simulator v1/v2 GPU extension/profile findings remain separate HELD findings. Image bytes, guest
workload, 1 GiB RAM, clocks, core format, lazy disk behavior, and retained GPU factory artifact are
unchanged.

Final publication requirement: deploy the final open PR 626 head (currently harness-only successor
`087c69c5…`) to main Cloudflare Pages, verify the live wasm/glue/manifest hashes and bounded software
warm restore plus echo, then run the fresh final critic. Preserve all failed receipts. Do not change
task status to verified before that live proof, and do not merge.

## Exact digests

- Full binary diff `f2e4ab0..0144c662`: `03cf992defe400f409aaaaf1fbe08ee91db97a04405096d53fa0d046945c983b`
- Runtime diff `f2e4ab0..63374f7c1`: `d4cfa5fc8207d6fc7e136c2deeb62ada8e407dd97ab5d81c677aa195d2716469`
- Fixture-only diff `63374f7c1..0144c662`: `5c4bf021b2afed3424ffea602ec093330c3341113caeb1cf2c8b5cacf133fdf8`
- `crates/wasm/src/lib.rs`: `d06122127fcd0ce84d05d1d4114ac41e46e614e7977badbbec32292feefefff3`
- `crates/wasm/src/snapshot_staging.rs`: `a08fbd82675b49c4167d26554be17af77ec15c02bb02fa5bb91c79de2fff79b1`
- `web/loader.js`: `94b9199ebea64916c386a47286d38ba393783d819b6299ffd7e9464ed65ed829`
- `web/snapshot-stream.js`: `77faf0310717d00c232391f5e11d61a7df91dd668ebc7f7149584f1445943198`
- committed glue: `015f14a6773ece07c6b4e66c82cf3c3e5f6642993f9cfac45ac5fc7c3f7acd14`
- committed wasm: `6d3082341ed52848f108da2e5743a0f11716d8828694cca11ee9bf4d9bbb053d`
- Omarchy manifest: `7e7a98a26dfd80c4cb078f3f9f64bbea40f7b88e25a0380f7aa0fe9bdc681efe`
- pristine v1 FAILED receipt: `54234a4a7e4d650193225c227ae8a876edc7e3e3a9b73e404bfecf1f494f568d`
- pristine v2 FAILED receipt: `c785fc33cefd7e495a127f0168517ee04b4b2b307cd67fd6693ad2082c9a8b8b`
- independent actual-Wasm attack log: `ecbd3bd4f03b00ec44e79283433853d6379528fd6cea6d9d6dd0937b03c0f9e3`
- independent pinned-clean full acceptance log: `19446a07b507dbe3296e907edddad46904830ba6d8fcb708b66ac48f93c8be7b`
