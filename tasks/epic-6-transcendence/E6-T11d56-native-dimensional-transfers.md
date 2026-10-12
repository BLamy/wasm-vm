---
id: E6-T11d56
epic: 6
title: Carry original layered RGBA8 allocation and DMA through native guest queues
priority: 525.027039000397
status: pending
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
