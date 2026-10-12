---
id: E6-T11d54
epic: 6
title: Carry qualified 2D image layouts and mip DMA through native desktop queues
priority: 525.027039000397
status: implemented
depends_on: [E6-T11d53, E6-T11d50]
estimate: S
risk: high
capstone: false
---

## Boundary

Connect the selected native 2D creation and outer-transfer boundary to the
already verified desktop host image profile. Admit its finite81 original
formats with exact color/depth/sampler/hint masks, bounded NPOT mip levels,
and separate public versus owned GPU byte costs. Derive transfer coordinates,
default strides and byte footprints from immutable original metadata and the
selected mip level. Preserve4MiB resource/transfer,32MiB GPU/backing,64 selected
owners and historical constructors. No new host storage, shader, capability,
scanout or production negotiation semantics are introduced.

Creation and transfer validation are one atomic native layout boundary:
admitting an image without its original public-byte DMA layout cannot produce
usable guest transfers. Format semantics are carried from the verified host;
this task proves their native admission and transport composition.

## Deterministic acceptance

`make verify-E6-T11d54` runs literal real native and selected Wasm queues against
actual hardware WebGL2. Exercise every admitted original format and NPOT mip
level, original role classes/hints, live split-SG uploads written after backing
attachment, and fenced full-plane public readback. Independently model all
public words and guest/GPU accounting; retain complete inputs, actual GL calls,
packets, reply/ring/SG guards, canonical owners, epochs/generations and guest-loop
instruction traces. Use three independent completion schedules.

Refuse unsupported formats/targets/roles, impossible mip/dimension/sample/flag
words, public or native per-resource costs, aggregate GPU limits and malformed
transfer boxes/levels/strides/layers/offsets/backing before callback/publication.
Require complete native/host rollback, reset and disposal with no stale DMA
authority. Preserve ordinary constructors and the held buffer/owner limits.

Authenticate unchanged D50/D53 host/compiler/runtime source and evidence
boundaries. Run scoped fmt/clippy, affected native GPU/control/submit/Machine
tests, no_std wasm builds and actual selected wasm/browser path. Record finest
changed Rust coverage and one final scrubbed pristine clone. The built/default/
live page stays127/0, proof exports absent and graphics partial; rebuild/commit/
deploy the demo per AGENTS.

## Adversarial verification

Predict exact public and owned costs for all finite formats, especially RGB
padding, ignored-alpha contraction and16-byte owned126 depth storage. Attack
NPOT and1xN/Nx1 mip ends, high level words, neighboring masks, exact budgets,
odd/split SG offsets, dirty post-attach source words, both DMA directions,
short backing, overflow and pending reset/ID reuse. Run independent schedules
and one bounded novel transport attack. Sabotage either native public pixel
size or selected mip extent and require the independent queue/word oracle to
fail. Classify every changed hunk, authenticate full bodies and final clone,
carry unchanged held results incrementally. A fresh verifier alone sets verified.

## Verification log

### 2026-10-12 — worker — verified-head native image refusal

D53 is independently verified at
`0211566e662a3512b374c69ab915c563e7daf0cc` and published as open/draft PR531
above PR530 on existing native stack500. Both stack identities and all131
prior PR identities/order/heads/bases survive; all132 remain open/draft/unmerged.
The complete continuity audit is
`evidence/virgl-production-readiness/native-image-layout-gap/stack-continuity.json`.
The app's100-attachment cap prevented attaching PR531; no prior attachment
was removed and no PR was merged.

At that clean head the actual selected Wasm native queue refuses original
RGBA8 complete mip chains, RG8, RGB8, floating RGBA and Z16 metadata with0x1205
before host callbacks or hardware allocation. Full native/host states remain
unchanged. The same original metadata allocates through the qualified selected
hardware host, and disposal leaves zero GPU objects. The native implementation
still assumes4 bytes per 2D pixel and rejects nonzero transfer levels.

Repro:
`node /tmp/wasmvm-selected-native-image-readiness.mjs --output /tmp/wasmvm-selected-native-image-readiness-verified`.
The complete runner is archive member `readiness-runner.mjs`; primary native
source bodies and actual generated Wasm are retained. The1112ms recording has
261 actual GL calls, zero browser errors and no guest Linux, draw, DMA,
production negotiation or throughput claim.

`evidence/virgl-production-readiness/native-image-layout-gap/` seals74 complete
bodies,2721287 compressed bytes, all reopened:

- manifest `1e7cb6037ab84975c5010cc8a81016986de39401178acd9a42c35e6d099bbf25`
- index `76a25718bfcd1736990f850db642fd99ddb04d89cbd6052d5408abb9ab432fdb`
- archive `7e11fdcdd4431b6bf7069b8294089fe3f28b7c49df12adc7ae0ca10edb38352d`
- report `edcff0af16f81c9d832bfa4990eb678d6894fcbcfa87d6337f817904e83e9007`

The explicit human instruction continues production graphics ahead of unrelated
general-queue work. Typed capabilities/API, actual RISC-V Mesa/Hyprland,
production worker/scanout and measured responsiveness/MIPS remain parent work.

### 2026-10-12 — worker — CLAIM: implemented

Runtime freeze `88957c714d6ca95143a0fd958600dcd9532c2e93`; final proof-harness
freeze and authoritative cold head `6799137b1df9601f02cb7347e609095553bd8951`.
The intervening commit changes only coverage classification, physical response
capture, cold invocation and sealing. No runtime semantics changed after the
first freeze. The initial warm gate passed every product gate and detected only
17 static-syntax coverage reporting gaps; the corrected report has no unproved
runtime operand. That warm run is a preflight, not the evidence of record.

Final commands:
`python3 tools/virgl-native-image/cold.py target/evidence/virgl-native-image-cold-6799137b`
(invokes `make verify-E6-T11d54` in its clean, scrubbed clone), then
`python3 tools/virgl-native-image/seal.py target/evidence/virgl-native-image-cold-6799137b evidence/virgl-native-image/worker`.
All 26 exact commands, environment overrides, full outputs, source pins and
binary hashes are in archive member `cold/recording/receipt.json`. Its SHA-256 is
`9c63c3e0bcc7f466a4915467594585752b37f263256077115ccd2225e560eece`.
The clone is `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-native-image-cold-0p0wrohy/repo`;
both before and after Git status are empty, exit 0. Fresh npm installation,
scoped default/selected/Wasm clippy, 16 submission tests, 13 control tests,
GPU/Machine tests, both no_std Wasm builds, selected Wasm, hardware, sabotage,
default dist/demo, LLVM and independent integration audits all pass.

`evidence/virgl-native-image/worker/` seals 1,179 complete bodies,
15,922,322 compressed bytes, every member reopened:

- manifest `760e7cec92d98d9cf2104e534f296429d6f8305e0d24e013a62c4eff91dfd624`
- index `ca2681aab7fe795ffc508441f0b0c7db306f78ae32de55aa524109b68f85c99b`
- archive `438ecaf1c7eb936ea785d93ba37792460963f7a39ce1277aaed6cc0d7878c5c2`

The recording demonstrates native admission and transport composition for all
81 already qualified original 2D formats. Three actual Metal hardware schedules
(14241, 33485, 58393) check 972 NPOT mip planes and all 13,608 pixels, fresh
post-attachment split-SG source words, fenced output, every padding/guard byte,
original immutable owners, public/owned costs, cancellation and same-ID reuse.
The independently recomputed canonical records include 3,402 browser and 3,032
native points, 2,721 native image guards, 324 complete native DMA points, four
complete RAM checkpoints and 4,143 retired guest-loop traces. All 142,653 actual
GL calls are retained; no browser, page, request or final GPU errors occurred.
The literal Python inverse imports no product conversion or observed result.
Normal floats and SNORM -127 make these transport inputs uniquely invertible;
unchanged host endpoint/exception semantics remain held.

Every original role class and creation hint, unsupported neighbor/high bits,
invalid metadata and transfer geometry, NPOT ends, exact resource/aggregate
budgets and historical constructors are covered. Finest LLVM segments cover
65 changed runtime lines and 264 operands with 169 explicit syntax waivers and
zero unexplained gaps. A separate-checkout mip mutant charges 720 bytes for
format 1 instead of the independent literal 224; the queue oracle fails with
exit 101 and complete request/response/canonical point retained. D50 and D53
worker/verifier seals authenticate 2,699 complete dependency bodies and 314
unchanged host/compiler/native ownership source boundaries; they are carried
incrementally, not replaced by summaries.

Deployment command `bash tools/deploy-cloudflare.sh` publishes
`https://4ace451b.wasm-vm.pages.dev`, production `https://wasm-vm.pages.dev`.
The retained live runner is `evidence/virgl-native-image/deployment/final/source.mjs`;
command `node /tmp/wasmvm-native-image-live.mjs --output evidence/virgl-native-image/deployment/final --task E6-T11d54`.
Both built and live pages reach 127/0 with zero errors, proof exports absent,
partial graphics pip and production acceleration disabled; served Wasm and
roadmap hashes match the committed dist. Live screenshot, responses, full
runner/logs and generated deployment manifests are retained. Only the four
owned staging URL rewrites were restored after preserving their deployed bodies.

This claim introduces no new host storage, shader, capability, scanout,
production VIRGL negotiation, RISC-V Mesa/Hyprland execution or measured MIPS.
Those remain parent work. A fresh critic must set verified before further work.
