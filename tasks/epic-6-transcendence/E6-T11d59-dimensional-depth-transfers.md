---
id: E6-T11d59
epic: 6
title: Allocate and transfer original cube and array depth resources
priority: 525.027039000396
status: implemented
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

### 2026-10-12 — worker — implemented; sealed pristine-clone submission

Runtime and browser sources froze at
`ac6e174bbf86b94494b4213c7637f559f1b5ca8b`; the final acceptance harness head is
`ca9481ebe67cb0678939996d5f796552c6a1bf3b`. The original scrubbed pristine clone
completed all14 native/wasm format, clippy, recorded native test and target-build
commands at the runtime freeze. Two historical browser servers then revealed
incomplete hardcoded module lists. Harness-only commits4208c7b8 and ca9481eb
repair those servers and preserve the complete already-passing recordings.
The pristine checkout, clean before/after, source digests and empty runtime/
dependency diff are explicitly authenticated at each continuation. Hardware,
wrong-layer sabotage and historical dimensional-view recordings ran at4208c7b8;
the remaining historical-image path, final audits, normal build and built demo
ran at ca9481eb. The receipt names every carried command and its original process
and source boundary; these are preserved results, not claims of re-execution.

Exact final commands and raw custody:

```sh
python3 tools/virgl-dimensional-depth/cold.py /tmp/wasmvm-dimensional-depth-cold-ca9481eb /tmp/wasmvm-dimensional-depth-cold-4208c7b8
# Inside the same pristine checkout, with scrubbed inherited build environment:
make verify-E6-T11d59
python3 tools/virgl-dimensional-depth/seal.py /tmp/wasmvm-dimensional-depth-cold-ca9481eb evidence/virgl-dimensional-depth/worker
```

The final cold report has exit0 and empty cleanBefore/cleanAfter at ca9481eb.
`cold/recording/receipt.json` lists all44 exact commands, environments, original
heads and expected exits. Receipt SHA256:
`404537349eced26a90d267a66b79e502cc3954294560732dd8d3735798051491`.
Original failed server runs remain at
`/tmp/wasmvm-dimensional-depth-cold-ac6e174b` and
`/tmp/wasmvm-dimensional-depth-cold-4208c7b8`, with completed runs retained in
the final recording's carried provenance. No runtime code changed after freeze.

`evidence/virgl-dimensional-depth/worker/` contains1884 complete reopened
bodies in10 transport parts of at most16MiB, reconstructing154412607 compressed
bytes. Manifest SHA256:
`109f0a3a84cbf48bca63f28206a568cd0f7b78019e26202d96b8890870504a55`;
index: `307c8af400fd4750e9b9984ef304bcdba141e630cd09d7b56d9fd39040a68130`;
archive: `231e8733d09642346013efd0e06b5937ae457e2fa114ccfdaca3da41d7886e22`.
The packer initially used indexing instead of joining a Path when checking its
parts; its preserved failed attempt is
`/tmp/wasmvm-d59-seal-failed-ca9481eb`. The one-line packaging correction was
syntax checked and exercised by the successful seal/reopen above. The corrected
sealing source is itself an indexed body. Product acceptance bytes are unchanged.

The recording demonstrates42 actual selected Wasm queue cases across seeds27449,
84131 and176129, both original targets, all five formats, roles1/8/9, legal NPOT
mips and exceptional floating fields. The independent audit reopens630 complete
observations and49770 original pixels, with1223669 native calls. All three upload
forms and inverse forms preserve live post-attachment SG dirt, public depth/
stencil fields, canonical ignored bits and complete padded RAM guards. Actual
GPU-only face/layer overwrites determine inverse output. One PBO/fence precedes
CPU collection; layered scatter precedes used-ring/IRQ publication. Fifteen
synchronous controls,30 real WAIT_FAILED cases,92 physical driver faults,
30 lifetime/revocation cases,115 budget neighbors,215 metadata refusals and110
span refusals end with zero owned native objects and budgets. The retained native
guest instruction traces and state digests cover original queue publication.

The deliberately shifted native source layer finishes the GPU copy, fence,
collection and original DMA before the unchanged oracle rejects UN16 pixel0:
expected24780, observed24498. That expected exit1 is recorded independently from
the happy exit0. Finest V8 coverage classifies401 executed changed regions,
3 unchanged HELD regions and2 static waivers with no needs-evidence region;
LLVM classifies49 executed runtime lines and81 static/declarative waivers with
no uncovered operands. Complete source/served bodies and per-case GL calls are
retained. The predecessor reader authenticates6612 unchanged D58/D56/D54 bodies.

The normal committed default build omits every proof export. Its built demo
passes127/0 with zero console/page/request errors and a screenshot. Frozen
default Wasm SHA256:
`d45b575207e0035b5c518698e7b6793b2bf12da635531723fad70813a5956c36`.
An isolated exact-byte staging tree preserves304 previously qualified boot/
site files and changes only the default Wasm, roadmap and service-worker stamp.
Wrangler publishes it to Cloudflare production deployment
`03475afc-90aa-4f18-bb8c-1a38c2fc30a4` at ca9481eb; the successful API result
and complete staging/live response bodies are sealed separately under
`evidence/virgl-dimensional-depth/deployment/`. The canonical live site also
passes127/0, zero browser errors, proof exports absent and the D59 partial pip;
its exact Wasm matches the frozen build. The original live runner, publisher,
staging recipe and screenshot are archive members.

The deployment seal reopens514 bodies,49647418 compressed bytes. Manifest:
`370e3aa117f95484a690360032397fe9ecdf01ca1a16e2d543cdd89eacb8f52c`;
index: `151dcce0cf8bda58ed7b35bcbe7cbd422b87226971c59ca3a82c0d3adfcd1a26`;
archive: `1430cb5dd5613d5e9f969e77b0f0819fb9394a179c3600775d74b73004731245`.

This is a selected depth allocation/transfer claim only. Historical admission,
new dimensional depth consumers and production capabilities remain closed.
Actual Linux Mesa/Hyprland acceleration and measured MIPS remain parent work.
The separate adversarial verifier must decide the status; the worker does not
claim verified.
