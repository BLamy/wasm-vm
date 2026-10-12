---
id: E6-T11d59
epic: 6
title: Allocate and transfer original cube and array depth resources
priority: 525.027039000396
status: in-progress
depends_on: [E6-T11d58, E6-T11d56, E6-T11d54]
estimate: S
risk: high
capstone: false
---

## Boundary

One explicitly selected original allocation and DMA layout contract across the
native VirtIO control owner and hardware host owner for PIPE_TEXTURE_CUBE=4 and
PIPE_TEXTURE_2D_ARRAY=7 with formats16/18/20/21/126 and original depth/sampler
roles1/8/9. Six square cube faces and fixed array layer counts persist through
the legal NPOT mip chain. Preserve original metadata and public pixel sizes,
and charge complete native storage,126's owned upload PBO, conversion scratch,
readback staging and retained ownership before allocation or publication.

Creation, native span validation and host transfer addressing form one atomic
contract: admitting a layered owner without matching public z/layer/row spans
cannot produce a usable guest transfer. Use actual immutable native cube/array
depth storage, face/layer uploads and GPU depth/stencil copies with the qualified
word packer. A layered asynchronous read uses one bounded PBO and one fence;
reuse one charged plane of conversion storage across layers. No CPU image mirror
or pixel work in the emulated guest supplies inverse bytes.

Keep every historical factory and proof constructor closed to these new owners.
RGBA8 dimensional views and qualified2D paths remain unchanged. New depth owners
remain outside dimensional sampler, shadow, surface and scanout consumers until
their separate qualification. Depth volumes, cube arrays, multisample storage,
unknown formats/roles/flags and impossible mip chains remain refused. No positive
production capabilities, complete GLES API, guest Mesa or throughput claim follows
from this selected allocation/transfer boundary.

## Deterministic acceptance

`make verify-E6-T11d59`

Actual selected Wasm queues and original resource/op9/43/45 packets must create,
upload and read all five formats for both original targets across legal mip
levels, nonzero layers/faces and NPOT tails. An independent original field oracle
checks every output pixel, canonical ignored fields and exact stencil words,
using only the already pinned depth quantization/clamping budgets. Record three
varied seeds/completion schedules, all three upload forms and inverse directions,
odd offsets, split SG boundaries, padded rows/layers, nonzero x/y/z subboxes,
post-attachment guest writes and complete RAM guards. A GPU-only overwrite of
each selected native face/layer must determine inverse output.

Before native publication reject illegal depth volumes and target/format/role
cross-products, malformed cube/array shapes, samples/flags/hints, high mip words,
whole-chain/aggregate/public/native/scratch budgets, dimension/layer neighbors,
overflow, short backing and overlapping row/layer spans. Exercise native
allocation/upload/readback failure cleanup, stale generations, backing/context
revocation, queued cancellation, reset and disposal. Final budgets and native
objects must be zero. Real GPU fences must precede CPU collection, all layered
scatter must precede VirtIO used/IRQ publication, and guest execution must never
poll host GPU fences.

Run affected native Rust fmt/clippy/tests and proof/default wasm builds, affected
historical browser resource/transfer paths, and authenticate unchanged D58/D56/
D54 evidence bodies rather than repeat unrelated walls. Preserve full original
inputs, native calls, source/served identities, guest traces/state digests and
finest changed executable-region coverage. Record one final scrubbed pristine
clone and submit sealed bytes to a fresh adversarial verifier. Update the demo's
partial capability, rebuild/commit/deploy it, and prove built/live127 passed,
0 failed with zero browser errors and a screenshot per AGENTS.md.

## Adversarial verification

Predict public/native/conversion costs, every physical mip/face/layer choice and
each public field before reopening evidence. Attack cube face order, distinct
array layers, NPOT mip tails, packed depth/stencil order and ignored bits, finite
and exceptional floating fields, original SG dirt, exact budget neighbors and
stale/pending revocation. Execute independent schedules and one bounded novel
layered transport attack. Sabotage native layer or depth/stencil selection and
require the unchanged independent oracle to fail after completed physical GPU
work and original DMA. Classify every changed hunk and finest nested region,
reopen complete source/native/guest bodies and final pristine-clone proof, and
carry unchanged HELD boundaries incrementally. Do not expand this storage claim
into a sampler, production capset or performance claim.

## Verification log

### 2026-10-12 — worker — verified-head depth refusal; planned atomic slice

D58 is independently verified at
`fa4692ab33c0bd91e4d2cedddc8003df29354108` and published as open/draft
[PR536](https://github.com/BLamy/wasm-vm/pull/536) above PR535 on the existing
native stack500. The complete native stack comparison holds both stack
identities and all136 previous PR identities/order/heads/bases/open states;
only PR536 was appended. Codex's100-attachment limit refused its attachment;
no previous attachment was removed. The comparison, full before/after API bodies,
checker and publication log are retained in the negative readiness archive.

At this exact clean verified head, actual Wasm RESOURCE_CREATE_3D requests for
cube/array targets, all five original depth formats and all three depth/sampler
roles return0x1205 before any host callback. All30 refusals preserve native/host
ownership and native allocations. Independent direct host/store attempts also
refuse each combination. All15 matching2D depth controls and all3 dimensional
RGBA8 controls allocate through the real native callback and retire. Hardware
Chrome155 runs ANGLE Metal on Apple M4 Max;3271 original GL calls and3182
assertions are retained with zero console/page/request and terminal GL errors.
The independent pure public-layout probe records60 cube/array depth refusals
over both directions while30 matching2D depth and3 dimensionalRGBA8 controls pass.

Exact verified-head repro commands (complete runners are archive members):

```sh
node /tmp/wasmvm-dimensional-depth-readiness.mjs fa4692ab33c0bd91e4d2cedddc8003df29354108 /tmp/wasmvm-dimensional-depth-layout-gap-fa4692ab
node /tmp/wasmvm-dimensional-depth-native-readiness.mjs fa4692ab33c0bd91e4d2cedddc8003df29354108 /tmp/wasmvm-dimensional-depth-native-gap-fa4692ab-final
```

`evidence/virgl-production-readiness/dimensional-depth-gap/` seals142 complete
bodies,10003317 compressed bytes; every indexed body was reopened. Index:
`85c996d5af28bb7d1597109ca10a99f249ee2ffe707c9ff5323272332e128e64`.
Archive: `c4dbe16cc1c661eaf12cbc71d80160fef50482851e1d3f4b41ba62aed912bebe`.
Source closure, actual compiler/native Wasm, original requests/responses,
ownership snapshots, guest traces/digests, complete GL calls, browser coverage,
screenshot and pinned Mesa/GLES/WebGL primary bodies are retained. The initial
harness precheck lacked the dynamically loaded compiler JS endpoint; it is also
retained, followed by the successful complete-closure run. Runtime never changed.

Pinned Mesa26.2.2 st_extensions.c1296 exposes depth cube support at GLSL130;
version.c487..512 includes that promise in its GLES3 floor. Hyprland's captured
minimum remains GLES3.0. The explicit human instruction continues this ordered
graphics chain ahead of unrelated general-queue work. This record proves a
specific prerequisite gap; real Linux guest Mesa/Hyprland, dimensional depth
consumers, other remaining API gates, truthful capabilities, production worker/
scanout and measured MIPS remain parent work.

### 2026-10-12 — worker — activated

D59 is the sole active allocation and layered DMA contract. Its D58/D56/D54
dependencies are independently verified. Preserve historical admission,
exercise one selected native/host path, then record the prescribed final
pristine-clone submission and hand it to a separate adversarial critic.
