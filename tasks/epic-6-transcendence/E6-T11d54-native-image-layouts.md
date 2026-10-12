---
id: E6-T11d54
epic: 6
title: Carry qualified 2D image layouts and mip DMA through native desktop queues
priority: 525.027039000397
status: pending
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
