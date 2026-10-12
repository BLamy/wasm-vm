---
id: E6-T11d56
epic: 6
title: Carry original layered RGBA8 allocation and DMA through native guest queues
priority: 525.027039000397
status: implemented
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
