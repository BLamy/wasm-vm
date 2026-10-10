---
id: E6-T11d18
epic: 6
title: Preserve original buffer identity across vertex index and uniform roles
priority: 525.02703900037
status: pending
depends_on: [E6-T11d17]
estimate: S
risk: high
capstone: false
---

## Boundary

One original buffer-role boundary. Add an explicitly host-selected standard-buffer resource/renderer facet, preserving every old factory's metadata admissions and public shape. Target0/format64 accepts zero creation flags and each combination of original vertex16/index32/constant64 creation hints, with the original raw bind field preserved. All selected buffers use one authoritative native other-data allocation, and original vertex/index/uniform leases retain that exact allocation. Staging and texture roles remain as previously admitted. No provenance label may select this facet.

WebGL2 forbids binding one buffer in both element-array and other-data classes and forbids copyBufferSubData across those classes. Use the standard renderer's existing bounded, fenced original index read to materialize a bounded per-draw private u32 element-array stream using the existing normalization path. Preserve the value of every original u8/u16/u32 index, range/start/offset, vertex ID, instancing and restart/topology behavior; apply existing required normalization/assembly unchanged when needed. Never bind or copy the authoritative other-data allocation as an element-array buffer. Own the private native allocation before upload, charge it to the existing draw job's index ceiling, detach before yielding and release once after final fence/error drain/cancel/disposal. No persistent full CPU shadow, duplicated per-resource native mirror or numerical shader execution.

Creation hints do not restrict subsequent original vertex/index/uniform roles. Simultaneous roles, overlapping byte ranges and public unref/detach/numeric ID reuse retain original storage; only explicit rebinding selects replacement. GPU-origin writes remain authoritative for all roles and subsequent index reads. Preserve stale-read/revision/context validation and all existing uniform range ownership.

## Deterministic acceptance

`make verify-E6-T11d18`

Record literal original metadata/op6/op11/op27 and all original transfer/draw packets for all eight creation hints, using actual fixed-memory C/Wasm stage output. Exercise one allocation serving vertex/index/both-stage uniform ranges simultaneously; compare full original uploaded/native-read storage words, actual native private u32 index values and restarted sentinels, all native attribute/UBO ranges and full independent pixels. Cover exact nonzero index byte offsets, all three index widths, real GL vertex IDs, fixed/arbitrary restart and line-loop/fan assembly, repeated draws, cache/context/subcontext restoration and subsequent GPU-origin writes. Prove no cross-class binding/copy occurred.

Exercise varied delayed read schedules, public-name and membership changes, explicit resource-generation replacement, released leases, successful/failed uploads, context destruction/reuse, cancellations, native create/upload/fence/read failures and partial draw budgets, renderer/resource disposal. Every final allocation/ticket/lease/index-byte budget is zero. Sabotage one real private index upload and one actual retained source word; the unmodified original pixel oracle must fail only after completed actual draws/fences. Record complete source/served/generated/Wasm/V8 custody, run the affected old admission/uniform/restart/assembly gates once at frozen head and one pristine scrubbed exact-head clone, seal evidence and submit to a fresh critic. No production capset or actual guest/offload/deployment authority follows from this isolated prerequisite.

## Adversarial verification

Predict creation hints, exact original allocation generations and bytes, role identities, private native index bytes/types/ranges and independent full pixels before inspecting evidence. Authenticate source/served/Wasm/cold custody and full changed-region coverage. Attack each new ownership/budget/failure transition under independent schedules; invent one bounded physical GPU aliasing attack and sabotage its original oracle after a completed fence. Carry unchanged HELD claims by exact dependency and evidence digests. Never fix implementation as verifier.

## Verification log

### 2026-10-10 — worker — negative readiness and ordered planning

The existing D17 facet preserves other-data vertex/uniform aliasing but rejects index reuse and combined creation hints. `evidence/virgl-production-readiness/standard-buffer-role-gap.mjs` records all eight original creation hints and three roles against unchanged old factories; its complete negative results and resources source/head identity are in `evidence/virgl-production-readiness/standard-buffer-role-gap.json`. D17 is independently verified at f489b8ed5599dfe9afeb7d7d1463655e768af418; its resources source bytes remain identical to this negative probe.

Pinned Mesa26.2.2 `bufferobj.c:162-186,325-341` derives creation flags from the original GL target, while `virgl_context.c:638-663` binds constant data by the original resource and updates bind_history. These creation flags cannot forbid later GL role reuse. The WebGL2 specification's Buffer Object Binding restrictions require class isolation (https://registry.khronos.org/webgl/specs/latest/2.0/). A headed M4 Metal planning probe `/tmp/wasmvm-standard-buffer-native-class.mjs` records error1282 for direct cross-class binding and copy, and exact original `[2,0,1]` bytes surviving a read/upload bridge. This planning probe is not task submission evidence; acceptance must exercise the actual renderer and original packets through completed fences.

The user's explicit instruction to finish production guest graphics keeps this ordered chain ahead of unrelated general queue work. Actual GLES3/typed API qualification, real RISC-V guest Mesa/compositor execution, worker scanout integration and live deployment remain later work.
