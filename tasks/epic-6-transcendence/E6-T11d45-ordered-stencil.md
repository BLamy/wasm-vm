---
id: E6-T11d45
epic: 6
title: Preserve original primitive order for asymmetric S8 draws
status: pending
estimate: S
risk: high
priority: 525.027039000383
depends_on: [E6-T11d44]
capstone: false
---

## Boundary

One opt-in native execution boundary for original active-S8 draws with unequal effective front/back references, comparison masks or write masks. D44 admits the original packets but deliberately refuses this actual WebGL restriction before compilation/private copies/draw. A new selected execution factory lowers the original ordered primitive stream into bounded private u32 POINTS/LINES/TRIANGLES. Preserve original vertex IDs, winding, last provoking identity, custom/fixed restart boundaries and incomplete tails. For each triangle in original order, execute the front and back culled passes with the selected original face state installed on both native faces; preserve original no-cull/BACK-cull selection. Original points/lines and BACK-culling triangles use effective front stencil state on both native faces while retaining the original native draw, instance IDs and divisor fetch. Only no-cull triangles require per-primitive two-face calls. Never gather all front primitives before all back primitives.

Require the already-qualified native LAST provoking convention for this lowering. Preserve the existing common-field, front-only, disabled and absent-S8 paths, and every predecessor execution factory. Native one-face draws retain all qualified original instance counts. Original instance fields0/1 mean one instance; active asymmetric no-cull triangle draws with effective instances>1 fail before compilation/private copies/draw until a separate compiler/instancing boundary verifies original INSTANCEID and divisor fetch for split calls. No shader rewrite, CPU vertex/fragment execution, new storage allocator, additional cull state, compiler change, production caps, guest execution or performance authority.

## Acceptance

`make verify-E6-T11d45` must independently reparse literal original wire, DSA/ref/raster fields, original TGSI and uploaded vertex/index bytes. Original overlapping alternating front/back primitives must physically distinguish preserved order from whole-front/whole-back grouping. Derive output solely from original fields and independently predicted native coverage. Cover all7 core primitive modes, original one-face native instancing/divisors/generics, array start, nonmonotonic u8/u16/u32 indices and byte offsets, disabled/custom/fixed/out-of-type restart, empty/partial/repeated/all-restart segments, strip parity, loop closure and fan center. Flat/smooth outputs and actual vertex-ID tags must hold. Test front-only unified and back-enabled literal semantics, all8 comparisons/ops, distinct effective references/value/write masks, depth fail/pass, scissor, both supported culling modes and both winding conventions, original20/126 formats and private mips. Original native depth, S8, public backing and all padding remain exact under the held conversion rules.

Use the existing owned normalized-index buffers: no more than12 times the original source-word ceiling in bytes, no more than64 buffers, bounded CPU scratch, <=6 times original source words in native vertex work and <=2 times original source words in native draw calls. Charge every original source word including restart markers and incomplete tails. Prove maximum and tightened budgets, short original source/fetch bounds, missing native provoking support, unsupported instance fields and real native allocation/upload/draw failure suffixes. Own before upload, detach before yield, restore literal guest stencil/cull state after lowering, retain native storage until consumed final completion/drain or explicit disposal. Three varied deterministic schedules prove context poisoning, public-name/generation reuse, captured sources/private mip writes, cancellation and both disposal orders. Record actual native arguments/state/private GPU index bytes, complete output/storage, original compiler/program/shader bodies and all writers/fences.

Carry complete D44 worker/critic seals and unchanged storage/compiler authority only at exact authenticated identities; exercise directly affected retained common stencil and primitive-list paths. Record finest nested V8 coverage for every new execution partition, only exact unchanged predecessor operands may be waived. Use relevant source/compiler/native/browser gates, one final frozen hot acceptance and one pristine exact-head cold clone with scrubbed environment. Reopen every sealed body. A fresh critic must perform three new schedules, one bounded original ordered-primitive attack and a real served order/state corruption completing native draw and consumed fence before detection. Production still depends on full API, guest Mesa/compositor, worker/scanout/demo/deploy and independent throughput measurement.

## Adversarial verification

Predict exact original primitive lists, strip winding, LAST vertex and ordered S8 transitions before evidence. Attack overlapping alternating faces that have noncommuting operations and unequal masks/refs; compare to the wrong whole-face grouping. Check point/line front-state semantics, absent-S8/disabled/common fast paths, all-restart/partial/degenerate segments and original culling. Attack stale stencil/cull/EBO/provoking state, original source/generation changes after capture, quota boundaries and allocation/upload/native-draw error suffixes. Require distinct consumed completion for actual order-corruption detection; metadata or patched expected values do not qualify. Full custody, finest coverage, final cold isolation and fresh verifier prediction log remain required. Do not expand this slice into compiler instancing or production deployment.

## Verification log

### 2026-10-11 — worker — verified dependency and original native asymmetry gap

D44 independently verifies at `ff80836249c9f235cae516421498a574b51b6f9c`. Its fresh critic explicitly releases all Git/source and Node/compiler/browser/GPU leases; there are no remaining jobs or active tasks. Existing PR522 now contains the verified commit. The same native stacks499/500 and all122 earlier PR IDs/order/heads/bases are authenticated unchanged, open/draft/unmerged. This layer continues existing upper500.

At that exact verified head, the actual headed M4 Chrome predecessor command records18 original guard/native failures and the held inverse passes. Six original active-S8 unequal-reference/value-mask/write-mask draws across20/126 fail with unsupported-stencil at original DRAW byteOffset40/opcode8, before a native draw or blit in the refusal phase. Complete source/compiler/native/event bodies, browser identity and screenshot remain in the recording; no guest or production capability is asserted.

Exact original reproduction, before runtime changes:

```sh
node evidence/virgl-production-readiness/standard-ordered-stencil-gap.mjs
```

The recorder requires all510 complete predecessor source identities, runs the actual native failure actor and independently audits original wire/lifetimes. Original negative manifest `standard-ordered-stencil-gap.json` SHA256 `ab0246ef23fb77e353bbbe451c86372050a97e3fb748ce676a71c1f5a06cff4c`; full recording `ordered-stencil-gap/recording.tar.gz` is2,866,674 bytes / SHA256 `e37ee5c94be466e78b59271f0a2d9d1cf4afe52bf07b35e2d3b33143935be41b`; full index SHA256 `d62a3e86621ec234a2ca29bc5bd571a978e849af83813386d24a211ec8797a8c`. All938 complete logical members were reopened, with each length/digest checked. Recorded source and execution head are the same exact verifiedff head.

Original GLES3.0.6 PDF34/35/105 describes assembly order/strip parity/last provoking identity; PDF41/43/44/91 describes original instance order, vertex identity and divisor fetch. The pinned original renderer defines front-only and back-enabled stencil behavior at6673/6690. The next native plan retains the original one-face draw when points/lines or BACK culling select front state, preserving native instancing without changing the compiler. Only no-cull asymmetric triangles require ordered per-primitive face passes and their effective instance count remains0/1 until a later compiler/consumer boundary. This is a plan requiring actual native acceptance and a fresh verifier, not an implemented capability.

The user's production-graphics instruction continues this one S/high boundary ahead of unrelated queue work. Original complete production API/caps, guest Mesa/compositor, worker/scanout/demo/deployment and300 MIPS remain unproven. The selected factory is isolated from the demo.


The new exact-source recorder itself passes at the unchanged verifiedff head: all18 original failures retain52 consumed syncs, zero output frames and zero native draws; the six active-S8 guards have the exact original92-byte packets and no native draw/blit during their refusal phase. Syntax, independent inverse, task policy and diff checks pass. The task remains pending; this is the starting gap, not new acceptance.
