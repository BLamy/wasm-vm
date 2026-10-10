---
id: E6-T11d18
epic: 6
title: Preserve original buffer identity across vertex index and uniform roles
priority: 525.02703900037
status: implemented
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

### 2026-10-10 — worker — activation

Selected as the next eligible ordered graphics prerequisite under the user’s instruction to finish production guest graphics. D17 fresh verifier commit f489b8ed is the native stack parent. Original buffer identity and the existing private u32 index bridge are the only active boundary.

### 2026-10-10 — worker — frozen original buffer-role submission

Runtime and all acceptance sources are frozen at `ed017102fd01137a7f1ff55569e9bc69da149f11`, based on independently verified D17 `f489b8ed5599dfe9afeb7d7d1463655e768af418`. Commands:

```sh
VIRGL_BUFFER_ROLES_EVIDENCE_DIR=target/evidence/virgl-standard-buffer-roles-final make verify-E6-T11d18
python3 tools/virgl-command/standard-buffer-role-cold.py --output target/evidence/virgl-standard-buffer-roles-cold-final
python3 tools/virgl-command/standard-buffer-role-seal.py target/evidence/virgl-standard-buffer-roles-final target/evidence/virgl-standard-buffer-roles-cold-final evidence/virgl-standard-buffer-roles/worker
```

The recorded headed Chrome155/M4 Metal run contains 251 frames, 253 positive native draws, 74,496 independently checked pixels, 452 guest native uniform blocks and 14,665,228 audited original GPU bytes. All eight original creation hints, all three index widths, simultaneous overlapping vertex/index/VS/FS roles, real vertex IDs, restart/topology assembly, repeated draws, original generation replacement, native GPU-origin writes and all 18 delayed ownership schedules execute. All 157 positive private native index allocations retire once; final native allocation, draw/read ticket, lease, uniform-snapshot and index-byte budgets are zero. Both actual source-word and private-index corruptions complete native draws and fences before the unchanged original pixel oracle rejects them. Complete native words, reflection, original packets, full pixels, served/generated/Wasm identities and V8 regions are recorded. Every added runtime line has an execution sample; full nested regions remain the critic's coverage authority. The selected resource/renderer factories are the only runtime change; old factories retain their admissions and shape, and the affected D17 resource/uniform/packed and D10 restart/assembly acceptances pass on this frozen head.

The sole final pristine scrubbed clone checked out the exact frozen head, removed inherited `RUST_LOG`, passed the complete same acceptance command and left the checkout clean before and after. Clone `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-uniform-bindings-cold-ywnma3kk/wasm-vm`; copied receipt and cold log are sealed. Worker archive `evidence/virgl-standard-buffer-roles/worker/recording.tar.gz` contains 16,096 records / 52,104,253 compressed bytes, SHA256 `c785984e6a27fd49a91b9e91b7b160a443e8ea3861d12a486c282a0efda50c8f`; record index SHA256 `5d73e08e2ca930c1bcdc73ba4547d85b2740094f120cc86265f0ac149a7bc9de`. Hot receipt SHA256 `f33d06fd84f7425792eb2d5319d554294eca6713267393fbdb2d3fc417dc4877`; cold report `c05a77185ecdca6680d2c5e10d4037caf8da93fa4d464a69364bab4ad0a735ed`; cold receipt `0740b2c13baf6b34f0a2573bac7f03cae95c43b5feb1149d5d936981c1e16dde`.

Unchanged D16 compiler worker/critic archives (`e481c471060723b3e183781836fa413eb76722ad53f8e97e2146308ad6046943` / `66de35c269e44252dc302ddc152e93d0aa1cd02fe9d1cd9171247d91b0daf09e`) and D17 range worker/critic archives (`73a5bdfa08e5b7568b96017d471ac40cfbb8f5d087d52c1b2842cf6c2235d9d5` / `df3c55558fec56f14b838cc9c8f477fa4806a47657909c81696bcd595438542d`) are authenticated by the receipt and carried without changed dependency bytes. Production caps, worker imports, guest images, scanout, demo and deployment bytes are unchanged: this isolated prerequisite grants no production capability, actual guest execution, desktop offload or performance authority. Submit this diff and sealed evidence to a fresh adversarial verifier; only that session may set `verified`.
