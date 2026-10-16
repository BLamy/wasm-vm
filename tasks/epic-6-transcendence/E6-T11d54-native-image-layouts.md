---
id: E6-T11d54
epic: 6
title: Carry qualified 2D image layouts and mip DMA through native desktop queues
priority: 525.027039000397
status: verified
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

### 2026-10-12 — fresh verifier — VERDICT: verified

VERDICT: verified

Predictions were written before concrete state inspection in
`evidence/virgl-native-image/verifier/predictions.json`. The critic examined the
D53-to-worker diff independently, authenticated the original complete recordings,
then ran fresh attacks. P0–P9 all HELD; no FAILED or NEEDS EVIDENCE result remains.
The critic made no implementation or runtime change.

- P0 authentication — HELD. Reopened all 1,179 worker bodies and 2,699 D50/D53
  worker/critic bodies, checked 992 frozen source bodies against Git and 314
  unchanged host/compiler/native boundaries. Cold report, receipt and hardware
  heads equal 6799137b1df9601f02cb7347e609095553bd8951; the later worker submission
  e4de0514066e391713298c187047c3727c830362 changes only proof/metadata.
  Critic member `authentication.json` retains every source/seal pin.
- P1 original costs — HELD. The independent 56-pixel model agrees for all 81
  formats. Original format 4 is 224 public/168 owned at worker member
  `cold/recording/native-submit.stderr:816`, transport digest
  `3f16bd7865482b563883d94a293fca99890c8bc562183acd3e40335de555aaeb`;
  format 30 is 672/896 at line 1410, format 126 is 448/896 at line 2868.
  `recording-audit.json` and `verdict.json` retain all concrete points/digests.
- P2 admission, masks and bounds — HELD. Literal original role classes and
  hints, all malformed metadata/transfer points, exact per-resource costs and
 32MiB+pixel refusals preserve native/host owners before callbacks. Fresh
  native attacks additionally refuse all 333 unsupported neighbors/high words
  and check 128 single-bit role/hint inputs. Complete native packet/state
  citations are in `verdict.json/nativeBoundaries`; the independent record
  decoder checks canonical bodies, response/fence words and used-ring state.
- P3 public DMA — HELD. Independently recomputed every original source row,
  inverse public word, final backing byte and guard over 972 planes/13,608 pixels
  in both recorded and fresh hardware runs. Worker native 324 complete DMA
  points, 2,721 image guards, 3,032 canonical records and 4,143 retired guest-loop
  traces authenticate. Fresh native adds 464 adversarial points, yielding 3,496
  canonical records. Full raw requests, GL calls and outputs remain in the seal.
- P4 ownership and epochs — HELD. Pending reset cancels, clears costs/owners,
  revokes old gathers/scatters and writes no stale DMA. Same-ID recreation has
  a fresh epoch; generation reuse is interpreted together with that epoch.
  All81 runs per schedule and full native reset attacks retain concrete state.
  Ordinary 67 constructors and held 64 selected/16 historical owners are preserved.
- P5 coverage — HELD with a critic correction. The worker reporter's blanket
  pre-arrow classification included dynamic match guards. The unchanged finest
  LLVM export proves them: line 61 counts 119/93, line 65 counts 11/10/9. The
  dispatcher condition at 68 has no standalone token region; it is separately
  HELD by exact arm-entry `[68,50,1658,true,true,false]`, historical fallback
  `[84,20,2,true,true,false]` and all 81 literal historical response points.
  It is outside structural waivers. Corrected `coverage-audit.json` records 65
  runtime lines, 276 directly counted operands, this one dynamic guard, 156
  static/syntax waivers and zero gaps; every changed hunk is classified there.
- P6 final clone/environment — HELD. The final exact-head pristine clone has
  clean before/after states, fresh npm dependencies and 26 expected command exits.
  Scoped clippy/native/control/GPU/Machine, no_std/default/selected Wasm, default
  build/demo and preserved binary/export/source hashes authenticate. Both actual
  GPU reports name Metal and exclude software fallback. Fixture and literal
  inverse imports were inspected; exceptional host semantics remain incrementally
  held. `environment-audit.json` retains the custody/isolation audit. The final
  cold clone is reused once; no unrelated gates were restarted.
- P7 fresh schedules — HELD. Native 18/control 13/GPU 80/Machine 4 tests and selected
  Wasm build pass. Seeds 324508639,610839776,270544960 complete all 81 formats,
 972 mip planes,13,608 pixels and142,659 actual Metal GL calls with zero browser,
  request, page or final GPU errors. Complete result is critic member
  `fresh-hardware/report.json`; its independent audit is `recording-audit.json`.
- P8 novel attack and sabotage — HELD. RGB32F 9x7 mip 1 is 4x3; box(1,1,2,2)
  uses 24-byte public rows and 48-byte default stride. Split backing 13+64 accepts
  exact end 77; end 76 refuses both directions before callback. A whole-plane
  hardware baseline/readback independently verifies the nonzero patch and every
  untouched texel,77 backing bytes and SG guards. `novel-audit.json` cites every
  packet/digest and all 535 actual GL calls. An independent separate-checkout
  public-pixel mutant makes format 66 cost 224/168 instead of literal 168/168;
  exit 101 and complete point at `sabotage-public-pixel/stderr:1055` prove the
  oracle rejects it. The worker's distinct 720-versus224 mip mutant also
  authenticates at its stderr line 83; both full source/log/state bodies remain.
- P9 built/live page — HELD. Both retained pages are 127/0, proof exports absent,
  graphics partial and production acceleration disabled. Recomputed 388 served
  body hashes against complete committed/generated assets, including exact Wasm,
  roadmap and all owned deployed manifest rewrites; screenshots inspected.
  `environment-audit.json` retains every body pin. No new deployment was needed.
- SUITE: promoted two deterministic native tests for unsupported neighbors/hints
  and nonzero subrectangle default-stride/exact backing endpoints, plus
  `renderer/virgl-command/tests/native-image-critic.mjs` with the physical whole-
  plane coordinate oracle. Complete runner, sources, commands, outputs, snapshots,
  audits and sabotage are preserved. The focused format/clippy gates pass.

Critic seal `evidence/virgl-native-image/verifier/` contains 218 complete bodies,
10,645,070 compressed bytes, every member reopened:

- manifest `08394b2a36a9f01e375584e12afbc5b42c46aad7da5709be107dd2a09789ecac`
- index `f1ad2d4c224506b24cb6c322bb603b0d8278b13ebcfe8e1c6c2ebbc9c076baa1`
- archive `13e394b2d3efb5489180b4970dee702171895896bd4ca958a737279a02f78444`

Commands are in `fresh-commands.json` and `browser-commands.json`; the latter
records the exact three-seed native-image invocation and novel runner. Independent
sabotage command/environment is in `sabotage-public-pixel/report.json`. Task policy
runs before queue regeneration. This test/evidence-only commit skips the broad
Rust-path web hook via its documented `SKIP_WEB_BUILD=1`: all actual default Wasm
inputs and committed `web/dist` bytes remain identical to the authenticated head.
Production VIRGL, new host storage/shaders/caps/scanout, actual Linux Mesa/Hyprland
and measured MIPS remain outside this verified slice and in the parent's scope.
