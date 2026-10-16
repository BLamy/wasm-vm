---
id: E6-T11d56
epic: 6
title: Carry original layered RGBA8 allocation and DMA through native guest queues
priority: 525.027039000397
status: verified
depends_on: [E6-T11d55, E6-T11d54, E6-T11d52]
estimate: S
risk: high
capstone: false
---

## Boundary

One explicitly selected native guest allocation and layered DMA boundary for
the original RGBA8 volume, cube and2D-array layouts verified by D55. Compose
the real VirtIO control/submission mailbox with that qualified host storage.
Preserve original metadata, shrinking volume depth, fixed array/cube layers,
full mip-chain budgets, exact guest row/layer strides and backing identities.
Validate the complete layered gather/scatter before guest RAM access; use the
existing bounded owner, transfer and completion authority with exact generations.

Carry original outer0x205/0x206 and inner op9/43/45 packets through real Wasm
queues, asynchronous native GPU uploads, fenced readback and live guest RAM.
Do not flatten padded layers or publish a partial success. Historical native
and host constructors remain covered. Shader sampling, surface/scanout admission,
other dimensional formats, production capsets and Linux renderer integration
remain separately gated.

## Deterministic acceptance

`make verify-E6-T11d56`

Original volume5x3x7, cube5x5x6 and array5x3x7 metadata and all NPOT mip
levels prove literal chain costs, original layer identities and complete dense
and padded guest-memory inverses. Run three varied hardware completion schedules,
dirty split SG input after attachment, odd offsets, nonzero x/y/z subboxes,
inline and staging copies, synchronized output, exact padding and guards.
Require used-ring/fence responses only after actual native completion and guest
scatter; prove Machine.run never polls GPU. Exercise reset, revoked backing,
stale exchanges, ID reuse, cancellation and failure cleanup.

Refuse malformed shape/roles/samples/flags, whole-chain and aggregate overflow,
dimension/mip neighbors, row/layer overlap, one-byte-short backing, high wire
offsets and malformed/replayed layer exchanges before native or RAM publication.
Record native guest instruction traces/state digests, original queue/response
words, immutable snapshots, accepted owners, every DMA span and full GPU output.
Authenticate unchanged D55/D54 boundaries, run affected core/clippy/native/wasm
and historical renderer gates, audit finest changed Rust/V8 coverage, record one
final scrubbed pristine clone, and submit sealed full-body evidence to a fresh
critic. Rebuild/commit/deploy the demo; built/live suite stays127/0, graphics
partial and production negotiation disabled.

## Adversarial verification

Predict every original mip/layer extent and public/GPU byte cost independently.
Attack nonzero last volume layers/cube faces, selected-mip default strides,
different padded layer strides, SG boundary splits, exact backing and byte
budgets, full-width offset/stride overflow, resource/context/backing generations,
replayed and cancelled exchanges, and withheld used-ring completion. Run three
independent schedules, one bounded novel transport attack and a physical layer
selection sabotage that the unchanged full-byte oracle must reject. Authenticate
all evidence bodies, changed operands/regions, cold clean receipt and served
demo/live identities; carry unchanged HELD dependencies incrementally.

## Verification log

### 2026-10-12 — worker — verified-head native layered-transfer refusal; planned slice

D55 is independently verified at
`98187fdf222f393af27b2307667e10427027ad46` and published as open/draft PR533
above PR532 in existing native stack500. Both stack identities and all133
prior PR identities/order/heads/bases remain unchanged; all134 are open/draft/
unmerged. Complete before/after API bodies and their digest-bound comparison
are retained in `evidence/virgl-production-readiness/native-dimensional-transport-gap/stack-continuity.json`.
Codex's100-attachment cap prevented attaching PR533; no attachment was removed.

At that exact clean verified head, actual selected Wasm queues reject original
RGBA8 volume5x3x7, cube5x5x6 and array5x3x7 metadata before any host callback
or owner/allocation publication. The existing selected submission decoder also
refuses all three original layered op43 packets, while the new D55 wire decoder
admits them. The qualified D55 hardware host allocates every original chain;
its2D5x3 positive control still passes actual native-to-host control. Original
shader sampling continues to refuse all six vertex/fragment programs and is
outside this native layout/transport slice.

Exact repro:
`node /tmp/wasmvm-native-dimensional-readiness.mjs --output /tmp/wasmvm-native-dimensional-readiness-98187fdf`.
The complete runner is archive member `readiness-runner.mjs`. Full source,
actual selected Wasm, original metadata/packet/response words, native/host
snapshots, command trace, machine digests and290 actual GL calls are preserved.
The920ms recording has zero browser/page/request/final GPU errors. It exercises
no guest DMA, shader draw, Linux desktop or positive production capability.

The gap seal contains99 complete bodies,2867599 compressed bytes; every member
was reopened:

- index `e220691cc54d72de64e3fbeb36f1a7267fa9f741d9c12174c85a804e37cc66af`
- archive `b35aa13f43cb33a88b3f4aeaa429545c7da06b34c06e9bf6a66ccf88320cb548`
- report `d0b0415605f34ba8dc06a1704e2e0d1759dfe2718e94819004aed7c53b1952f4`

The explicit human instruction continues production guest graphics ahead of
unrelated queue work. This ordered S/high boundary carries the qualified
original layout through checked real guest memory and native completion;
other formats, dimensional consumers, truthful caps/API, actual Mesa/Hyprland,
production worker/scanout and measured throughput remain successor acceptance.

### 2026-10-12 — worker — activated

This selected original native layered allocation/DMA boundary is the sole active
S/high task; D55, D54 and D52 are independently verified. The frozen submission
will record `make verify-E6-T11d56`, affected native/wasm/browser gates, one final
scrubbed pristine clone and complete evidence for a separate adversarial critic.
No production capabilities or Linux guest renderer are enabled by activation.

### 2026-10-12 — worker — implemented; exact-head native queues and layered GPU inverses

Frozen runtime/harness `9de5721b5a9c5c0d70b94956305ba76a447a5024` carries
original RGBA8 volume/cube/array allocation, outer0x205/0x206 and inner9/43/45
through actual selected Wasm VirtIO callbacks, generation-checked layered guest
DMA and the D55 hardware store. Historical constructors and original2D/buffer
paths keep their prior admission. The new selected profile enables no production
capsets, dimensional shader sampling, surface or scanout consumer, or Linux guest
renderer. Production guest graphics and300MIPS remain unproven.

The final authoritative command is
`python3 tools/virgl-native-dimensional/cold.py /tmp/wasmvm-native-dimensional-cold-9de5721b`,
which runs `make verify-E6-T11d56` once from the exact frozen pristine clone with
inherited compiler/npm/Chrome settings scrubbed. Its clean-before/clean-after
receipt names `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-native-dimensional-cold-360j2fhv/repo`.
All33 commands passed in386s: affected format/default and selected clippy/native/
wasm gates, historical decoder/storage/all81 image layouts, actual Metal replay,
physical cube-face sabotage, built127/0 default demo, finest Rust/V8 and independent
wire/RAM/GPU audit. Native queues pass21 tests, GPU83, control13, Machine4.
The new allocator oracle exercises a real System-allocation refusal in a
thread-local test scope, yielding `Err(OutOfMemory)` and zero partial spans.
The unit-harness clippy command suppresses only the pre-existing GPU module
`items_after_test_module` lint; ordinary selected/default lint remains strict.

Three hardware schedules14241/33485/58393 exercise nine original shapes,
27 mips and150 original layers. Complete independent public-byte/padding
oracles cover live dirty5-entry SG memory, default/padded row/layer pitches,
nonzero last layers/faces, inline and actual staging uploads/inverses, queued
backing revocation/reattach, generations, exchange replay, callback reentrancy,
reset, ID reuse and failed native GPU waits. The recording contains273 original
queue records,3647 native canonical state points, all27 native DMA bodies and
nine exact mip-span records,8761 actual GL calls,120 physical fences and63 PBO
collections, ending with zero native objects. Machine.run never polls GPU; used
responses follow actual fences and complete scatter. A physically rotated cube
PBO face returns a wrong600-byte inverse and fails the unchanged full-byte oracle.

Finest coverage audits168 changed native runtime lines and128 executed V8
partitions with zero gaps. Thirty-six unchanged V8 partitions are carried by
exact verified D55 source-region digests; one static null configuration is waived.
Wasm's new constructor and both layered exports execute through the original
bindgen ABI, including failed reentrant Machine borrows and malformed/replayed
exchanges; unchanged exchange parsing/error mapping remains carried. Every
compiler, primitive dependency and historical boundary is authenticated from
complete D54/D55 worker and verifier archives.

The worker seal at `evidence/virgl-native-dimensional/worker/` preserves and
reopens all1625 complete bodies,38478604 compressed bytes, including full source,
original wires, RAM inverses/guards, traces/digests, GPU calls/output, coverage,
test binaries and final pristine recording:

- manifest `7c8fb3ab46b3659ce855e77a80afc161a14f808b491a6753caa6c53231b0d0e6`
- index `01cb810875ddfcd1b895df24e688e798c1fe4e9d66364da2be4ea0d6aaeef418`
- archive `d2f66777cdba8f6375d5958e80ca9204854bbccf151a0c3325cb63e6f91eef4b`

The committed default dist was deployed without mutating that frozen checkout.
Its304 staged files total66437533 bytes and match the frozen dist except for
exact authenticated D55 boot URL/snapshot staging. Only Wasm, roadmap and service
worker differ from the preceding staged deployment. Staging index
`0730d7c93933224b59c2abd4f7e9a96c710c66f3767aa5ae7c12047985635075`
binds every file. A preliminary empty staging-directory attempt was rejected
locally with ENOENT before upload; its complete log is retained. The validated
Wrangler4.149.0 deployment succeeded as production
`9f22c455-fe79-48e1-a0c9-1062f684a74f` at14:27:21UTC, explicitly naming the
frozen commit. Canonical `https://wasm-vm.pages.dev/` serves the exact default
1634057-byte Wasm
`8b49c7912ff6ce0157552dfa01b8649d7cce81287fdd31f4e7a6506d14a1e308`.
A one-load Playwright live capture records194 full response bodies,127/0,
zero application/page/request errors, permitted favicon404, no proof exports,
and the D56 graphics marker still partial with production acceleration disabled.
The source, screenshot, full bodies, publish/API logs and staging index are
sealed separately under `evidence/virgl-native-dimensional/deployment/`.

Normal progress continues existing native stack500 above open/draft PR533.
There is no new stack initialization, reset or merge. A fresh critic must now
interrogate these claims and promote its independently surviving attack.

### 2026-10-12 — fresh adversarial verifier — VERDICT: verified

VERDICT: verified

This independent critic never implemented D56. It read the complete task and
base-to-frozen diff before reopening evidence. Predictions P1–P6 were fixed in
`predictions.json` before interrogation (SHA
`53fb0b33fba95813812274d740f3d3f3cfaa804317188392ffd48b8f3f177d6f`).
Base is verified D55 `98187fdf222f393af27b2307667e10427027ad46`; runtime and
worker harness are frozen `9de5721b5a9c5c0d70b94956305ba76a447a5024`; submission
is `aae123e8b1c410417193e4080c48f094d852f7c6`. Only verifier tests, evidence,
this log/status and the generated queue change after that submission. Archive
paths below are members of the new verifier seal unless identified as worker.

- **P1 original shapes and literal budgets — HELD.** Predicted volume extents
  `(5,3,7)/(2,1,3)/(1,1,1)` and448 bytes, cube
  `(5,5,6)/(2,2,6)/(1,1,6)` and720, array
  `(5,3,7)/(2,1,7)/(1,1,7)` and504. Observed every extent, original metadata,
  full mip span and identical public/GPU costs. Point:
  `worker/cold/recording/native-gpu.stderr:8` (nine mip records, SHA
  `814c2a006b13a7412b6d332c69a15fe459fcb0cb5fdde9a4dd29c95d29f2831c`),
  independently expanded in `interrogation.json`. Malformed roles, samples,
  flags, shape/mip neighbors, whole-chain and aggregate refusal preserve
  ownership. Historical admission remains exercised; no further demand.
- **P2 original wire packets and full inverses — HELD.** Predicted every outer
  0x205/0x206 and inner9/43/45 to preserve dirty post-attachment split SG,
  odd offsets, selected-mip default/padded pitches, nonzero last layers/faces,
  inline and actual staging copies, directions, complete output and guards.
  Three new physical schedules26719/94133/183823 produce27 original mip
  inverses and150 layers,273 original queue points and zero terminal objects.
  Point: `fresh-hardware/report.json:126053`, SHA
  `aa3bdf0f2ab5ec3049ec5e65db4b61dd2190b701c25c82d5752282986e363cfb`.
  Worker native first full DMA inverse is
  `worker/cold/recording/native-submit.stderr:27`, SHA
  `9522d26f6d7572f47c768d265ce40c047b8e76425ad53b1033d10a131f10c3f8`.
  The critic independently recomputed all54 worker/fresh mip planes and full
  RAM padding maps. No changed dimensional transfer remained unexecuted.
- **P3 complete prevalidation and allocation/transfer bounds — HELD.** Predicted
  overflow/overlap/count/offset/short-backing and malformed exchange refusals
  before spans or RAM writes. Genuine test-scoped System-allocation refusal
  produces `Err(OutOfMemory), publishedSpans=0` at
  `worker/cold/recording/native-gpu.stderr:7` with the P1 file digest. The new
  literal budget probe passes an entire4,194,304-byte original volume through
  live native gather/scatter; one-byte-short backing and4,194,305-byte backing/
  exchange refuse atomically. Point: `restored-dimensional-tests.stderr:59`,
  SHA `ee806a7d8052c16e6b3182a2ba26cd6fec6f6246c1b32e7d8f944d53aed58c14`;
  source/gather SHA
  `5cbf4afba418d069ae8709d847fc46441d1a98c35324511f67d8f92cb1ef13cb`,
  output/full RAM SHA
  `00de0c3aed16e9633620d53a87a30cc69c928f0b63aa5e36c505c166d72ed976`,
  machine digest
  `fadb0d98bbd5298984f9fc37fa4b8e5fea3e31047ae56e745e9c92b895f43045`.
  `budget-audit.json` independently checks all16MiB of recorded source,
  gathered, output and full backing bodies. No further demand.
- **P4 identity, sequence and cancellation — HELD.** Predicted stale/replayed,
  reset, ID/context/resource/backing reuse and queued revoke to reject before
  stale DMA or publication. All worker/fresh argument/owner/reset/failure
  cases hold. Novel transport probe uses physical SG lengths23/13/19/20:
  layer stride32 ends at76 and refuses, stride31 ends exactly at75 and
  scatters32 bytes; correct-sized dense/output replays refuse at the native
  gate, then sequence2 gathers the exact bytes. Moving the used-ring MMIO
  address during the pending job poisons/cancels once, rejects late completion,
  leaves both rings/responses/RAM unchanged and requires reset. Points:
  `restored-dimensional-tests.stderr:9` and`:11`, with P3 file digest;
  usedIndex remains4 and response remains24 bytes of0xa5. Final full75-byte
  backings at lines13/23/33 are independently checked in
  `final-native-citations.json`; cube machine digest
  `705f255371d3ceb38b2b7c6dfb26a8bf6350f25935d2a06bda21a1facdfc9bdb`.
  No partial success or consumed sequence on refused exchanges; no demand.
- **P5 actual completion order, independent schedules and sabotage — HELD.**
  Predicted fences and full scatter before used/fence success, no GPU polling
  inside Machine.run, convergence under three new schedules and atomic failed
  wait cleanup. Fresh physical trace contains8869 actual GL calls,120 fences
  and63 PBO collections (e.g. fence80, collection199), ending with zero objects.
  Point: `fresh-hardware/report.json:742` and`:3376`, with P2 digest; original
  queue snapshots/canonical digests prove withheld then completed publication.
  A deliberately wrong physical cube PBO face fails the unchanged600-byte
  oracle: expected
  `5583fe44019d950ede06c5a3c7dd246e04a0dfe9aa24adcc880d3f43035596c8`,
  observed
  `7a599249269ce8b707ccbbfb5c6cbe3e4a4e6e5a5c189cbc2b0b1b39e00589e4`.
  Point: `fresh-fault-cube/report.json:39849`, physical collections199 through
  1108 at lines3387/16106, SHA
  `22d818c3b381e2854487eb365eff33f641c577517cf808384859c41550d33897`.
  Separately swapping only the promoted native scatter layer payload fails its
  unchanged75-byte RAM assertion at test line455;
  `native-oracle-layer-sabotage.stderr:10`, SHA
  `30a85517d7405a8dfaf97c42e893a101289c9b2c1e4ca917a518f7eb5b4e55fa`.
  The final test source was automatically restored byte-for-byte and all five
  dimensional tests passed. No runtime mutation or fix was performed.
- **P6 custody, sufficiency, cold proof and publication — HELD.** Reopened all
  5422 complete D56 worker/deployment, D54/D55 dependency and diagnostic-gap
  bodies; every index/archive pin matches, dependencies equal the verified
  base,1241 frozen source pins match exact Git blobs and147 unchanged source
  boundaries carry HELD. Final cold clone remains clean at the named path;
  `worker/cold/report.json:3/10/11/13`, SHA
  `fb1bcdad331742757951a7b12b15e714a977213fbc3d87533fea46256309caf9`, binds
  receipt `d81c4f46a9d9d13eb61935330560ddba5e5c322ba7368419ed46f2d23d7edb6e`
  and all33 complete passed commands. Finest raw LLVM export is byte-identical:
  all661 changed native operands on168 lines are positive. All128 executed V8
  partitions are positive;36 unchanged D55 partitions carry HELD by exact byte
  regions; only a static synchronous null configuration is waived. New Wasm
  constructor/gather/scatter execute through actual bindgen, including both
  reentrant failures and malformed/positive/replayed native calls. Points:
  `coverage-publication.json:3/12085/12158`, SHA
  `beed3a2357c3d8021941202f99bc2a8b8f3ece7cc3ad798e5f101610dcc8a27c`.
  `sufficiency.json` accounts for all37 frozen changed files/84 hunks and eight
  post-frozen evidence/lifecycle files: executed, static waived or unchanged
  carried HELD; zero dead or needs-evidence hunks. Raw diff, exact sources,
  operands, regions and the per-hunk reasons are retained.

P6 publication also holds independently: all304 staged files and unchanged D55
boot URL/snapshot staging are authenticated; only default Wasm, roadmap and
service worker differ. Successful production deployment
`9f22c455-fe79-48e1-a0c9-1062f684a74f` names the frozen commit (full API at
`deployment/publication/publish-success.json:5/13`, SHA
`b48409abf0c83f361bf8e145d7a4738bc8faf4e1a1c3a40c79cf78dffbbc1450`).
Fresh canonical live Playwright load reopens194 complete actual response bodies;
`fresh-live/report.json:1002/1003/1006/1007`, SHA
`2f78c80132a69f03a7590cd6521000767ce3e83563759e70e05b0c8a4b001847`,
observes127/0, zero application/page/request errors, permitted favicon404,
partial graphics marker, absent proof exports and default Wasm
`8b49c7912ff6ce0157552dfa01b8649d7cce81287fdd31f4e7a6506d14a1e308`.
Screenshot SHA
`257248e61e94ae173fefe710eaa7ba111cad8c531bd8c168ecf6c12e1f16e2ae`.
No publish gap remains. Production caps stay zero; dimensional shader consumers,
surfaces/scanout, other formats, Linux production rendering and300MIPS remain
outside this verified boundary, and the parent remains blocked.

**Oracle/attempt audit.** Worker browser test line51 omits the output bytes in
its consumed-output replay call, so that particular assertion can throw in
bindgen before Rust. A correctly formed consumed-input scatter already proves
the shared native gate; the promoted test additionally supplies correct-sized
consumed-output bytes and proves actual native refusal. This is a covered
harness limitation, not a runtime refutation. The first budget probe incorrectly
expected4MiB+1 backing admission; historical4MiB admission correctly refused it.
Its entire failed source/stdout/stderr remain recorded; the final probe explicitly
asserts that refusal. Auditor-only wire/state-path/file-name/cleanup-spelling
corrections and the unsupported helper --help attempt also remain in full;
`attempt-notes.json` distinguishes them from product behavior. No product fix
was hidden, and no earlier HELD criterion was reset.

**SUITE.** Promote
`dimensional_exact_sg_edge_replay_and_queue_relocation_are_atomic` and
`dimensional_literal_exchange_budget_and_one_byte_short_backing` in
`crates/core/tests/virtio_gpu_submit3d/dimensional.rs:406/516`. Both are part
of existing `make verify-E6-T11d56`; no new verify recipe is needed. Final source
SHA `3063990af7a9012c53737ea080a2dd328cc7980daf9e891b0e9420a2f26122a9`.
Permanent assertions compare literal byte maps, complete RAM, rings, responses,
owner/cancellation counts and sequence authority. Both physical GPU and native
RAM sabotage prove the independent byte oracles reject wrong layer selection.

Commands: `cargo fmt --check -p wasm-vm-core`;
`cargo clippy --offline -p wasm-vm-core --features virgl-control-proof,gpu-trace,trace --test virtio_gpu_submit3d -- -D warnings`;
`cargo test --offline -p wasm-vm-core --features virgl-control-proof,gpu-trace,trace --test virtio_gpu_submit3d dimensional -- --nocapture --test-threads=1` (final5/0);
`node tools/virgl-native-dimensional/browser.mjs --output /tmp/wasmvm-native-dimensional-verifier-20261012/fresh-hardware --seeds 26719,94133,183823`;
the same runner with `--sabotage cube-async-layer` (expected exit1);
authenticated deployment/live/source.mjs for the single fresh live load;
full independent authentication, byte/canonical/coverage/publication/budget/
sufficiency auditors. Full command arrays, environments, stdout/stderr and
failed attempts are sealed. The frozen33-gate clean-clone proof is carried once;
verifier-only test promotion does not invalidate product/build/dependency proof.
`SKIP_WEB_BUILD=1` uses the documented hook bypass for this test-only verdict
commit; all product sources and committed/dist/live Wasm remain byte-identical.
Task policy passes before queue regeneration.

The critic seal at `evidence/virgl-native-dimensional/verifier/` contains
792 complete bodies, 415714871 decoded bytes and 70942831
compressed bytes; every member was reopened and matched its exact size/digest:

- manifest `d290f464b5be7dbd39e01cc588aa9d4ed580bb4d7e688c345443e86e87ec2dc5`
- index `914145b80457bbbe323229b4323cdcc04a04001f85399c36a510063cc92bd0b5`
- archive `073c067eb7fb04d5ce3747d5937e9ec05cd210ae09da8b878ad5179420158619`

The complete original worker/dependency archives remain authenticated and
committed. A redundant Git binary-delta expansion of those archive blobs is
reproducible from the named frozen/submission Git objects; its digest is retained
in the manifest and full textual metadata diff is sealed. The first oversized
seal remains in owned scratch. No actual execution body or failed test was
removed from custody.

Custody: all owned native/browser/server subprocesses completed and were closed;
unrelated Chrome PID23192/profile60rjcU and unrelated untracked evidence remain
untouched. The final cold clone is preserved for the parent after authenticated
P6. Shared source/Git/build/native/browser/GPU leases release with the committed
verdict; the parent handles append-only native stack publication. No PR merged.
