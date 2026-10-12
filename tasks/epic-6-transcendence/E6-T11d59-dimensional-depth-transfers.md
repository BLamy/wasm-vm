---
id: E6-T11d59
epic: 6
title: Allocate and transfer original cube and array depth resources
priority: 525.027039000396
status: verified
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

### 2026-10-12 — fresh verifier — VERDICT: verified

VERDICT: verified. This critic did not implement D59. I read the whole task
and diff before reopening evidence and retained the fourteen original
falsifiable predictions. Worker submission: `d7b20d465eaa45057c234b5fd48d8a3e2eada823`;
base: `fa4692ab33c0bd91e4d2cedddc8003df29354108`. Runtime remains frozen at ac6e174b,
acceptance harness at ca9481eb; the subsequent one-line Path join in the
sealer was independently inspected and exercised by its successful seal.
No runtime implementation was edited by this verifier.

The complete observations, original predictions, raw body/line/JSON points
and SHA256 citations are sealed in `verdict.json` and `report.md` under
`evidence/virgl-dimensional-depth/verifier/`. Each result below points at
that report’s corresponding prediction; its citations identify the full
reopenable original bodies, native call indices and guest records.

- **P1 — HELD.** Cube chain180 and array chain294 texels; all original public/native costs and immutable physical formats held. Format126 owns a public-chain-sized upload PBO and doubles native chain charge. Every read allocation/fence/collection sees charged conversion, staging and CPU scratch before publication.
  Citation: `verdict.json:/predictions/0`; its original
  prediction and each full-body digest/point are retained.

- **P2 — HELD.** All1260 inverse observations attach the original texture at the requested mip and ordered physical faces/layers. NPOT dimensions floor/clamp1; layer counts stay6/7. One conversion plane, one layered PBO and one real fence survive the per-call audit.
  Citation: `verdict.json:/predictions/1`; its original
  prediction and each full-body digest/point are retained.

- **P3 — HELD.** 204000 original per-field pixel checks held, including exact UN16, Z24/S8 ordering, cleared Z24X8/X24 ignored bits, exact stencil and qualified finite/subnormal/exceptional float allowances. This count includes repeated backing field checks, not unique pixels.
  Citation: `verdict.json:/predictions/2`; its original
  prediction and each full-body digest/point are retained.

- **P4 — HELD.** Outer0x205, inline9 and staging45 uploads and all three inverse forms held with fresh post-attachment split SG dirt, odd offsets, row/layer padding, subboxes and complete RAM guards. GPU-only selected face/layer clears determine every inverse; poisoned guest source bytes cannot supply it.
  Citation: `verdict.json:/predictions/3`; its original
  prediction and each full-body digest/point are retained.

- **P5 — HELD.** Every physical inverse records a real signaled wait between its sole fence and sole CPU collection. The original layered-output callback still sees the old used index; completed ring/IRQ follows the full scatter. Sixty original WAIT_FAILED observations across worker/fresh have no later CPU collection. 9576 canonical state digests and5538 native guest instructions authenticate publication; no guest instruction invokes host GL polling.
  Citation: `verdict.json:/predictions/4`; its original
  prediction and each full-body digest/point are retained.

- **P6 — HELD.** 430 metadata and220 span refusals retain exact native canonical state; metadata makes no GL allocation callback.230 budget neighbor cases distinguish exact from minus-one and restore transient charges.184 actual driver mutations and60 lifetime cases preserve or retire their measured owners as required; all terminal object sets and budgets are empty.
  Citation: `verdict.json:/predictions/5`; its original
  prediction and each full-body digest/point are retained.

- **P7 — HELD.** All184 injected real driver argument faults restore the exact live native object set; partial allocation state is identical before/after. Pending backing/context revocation performs no host wait/CPU collection and releases precisely the independently calculated staging charge. Disposal zeros every budget; queued reset advances epoch; unequal-format reused IDs retain the old backing format/generation until release and stale/replayed tokens fail.
  Citation: `verdict.json:/predictions/6`; its original
  prediction and each full-body digest/point are retained.

- **P8 — HELD.** 90 actual exported historical/desktop/dimensional Wasm constructor requests refuse all new target/format/role combinations with0x1205 before host callback and unchanged native state. Historical browser paths and exact predecessor sources/dependencies/bodies hold; new dimensional depth sampler/shadow/surface/scanout and production capabilities remain closed.
  Citation: `verdict.json:/predictions/7`; its original
  prediction and each full-body digest/point are retained.

- **P9 — HELD.** All9010 worker/deployment/dependency bodies reopened, plus142 readiness and512 previous-deployment bodies.938 source pins,44 commands and the final clean ca9481eb pristine checkout authenticate the carried original ac6e174b/4208c7b8 processes and empty runtime/dependency diff. The only later harness seal edit is the exercised Path join correction. No preserved command is represented as rerun.
  Citation: `verdict.json:/predictions/8`; its original
  prediction and each full-body digest/point are retained.

- **P10 — HELD.** All54 files/95 text hunks/13 binary bodies classified.401 finest nested V8 partitions and168 native LLVM operands across49 runtime lines have positive raw counters;3 byte-identical RGBA8 operands retain authenticated D58 authority.2 V8 whitespace waivers and81 native type/syntax/macro waivers plus3 additional closing delimiters have no new dynamic operand. Native re-export from retained binaries/profraws is exact; no uncovered/dead hunk remains.
  Citation: `verdict.json:/predictions/9`; its original
  prediction and each full-body digest/point are retained.

- **P11 — HELD.** Built and canonical live demos both127/0, zero browser errors, partial D59 pip and complete screenshots.151 actual default Wasm exports contain no proof exports.304 staged files and194 full live responses authenticate exact default Wasm;301 staged bodies are unchanged. Only Wasm, roadmap and service-worker stamp differ from the previously qualified deployment.
  Citation: `verdict.json:/predictions/10`; its original
  prediction and each full-body digest/point are retained.

- **A1 — HELD.** Fresh independent seeds362436069,521288629,88675123 pass42 selected original queue cases and15 synchronous controls, with1,223,675 actual GL calls and3,932,336 assertions. The complete source/served closures, hardware Metal device, positive results, faults/budgets/refusals/lifetimes and guest bodies were reopened independently.
  Citation: `verdict.json:/predictions/11`; its original
  prediction and each full-body digest/point are retained.

- **A2 — HELD.** The novel transport passed8 cases under independent seeds2654435769/2135587861: NPOT bases9/11x9 at nonzero mip1, nonzero faces/layers, overlapping inline/outer/staging uploads, dirty fragmented SG bytes, padded containing reads, unrelated native PBO/FBO state, and queued read→replacement→read ordering. Both Z24S8 and Z32FS8X24 use independently generated public fields and complete RAM oracles. Promoted rerun also records90 historical factory refusals,41,600 native calls and47,919 assertions.
  Citation: `verdict.json:/predictions/12`; its original
  prediction and each full-body digest/point are retained.

- **A3 — HELD.** Served-only stencil PBO plane rotation passes actual mip1 physical copies, fence1218, CPU collection1232 and successful original response0x1100/used index12. Then the unchanged oracle fails pixel0 stencil: expected79 (0x4f), observed216 (0xd8), with every Z24 depth bit intact. Both original and promoted fault checks give the expected exit1 after completed DMA; oracle and runtime files are unchanged.
  Citation: `verdict.json:/predictions/13`; its original
  prediction and each full-body digest/point are retained.

COVERAGE: `hunk-ledger.json` independently classifies every submission file and
hunk, including explicit non-product harness, static syntax and data waivers.
`coverage-citations.json` uses the finest nested V8 ranges and native LLVM
operands, re-exported from the retained original binaries/profiles. Unchanged
HELD RGBA8 operands preserve exact source/dependency/evidence authority.
No dead hunk, uncovered executable operand or needs-evidence prediction remains.

MOCK/ENV: all 9,010 worker/deployment/dependency bodies, 142 base readiness
bodies and 512 prior deployment bodies reopened. The final pristine checkout
is still clean at ca9481eb. The 44-command receipt retains original process
heads/environments; carried native/target gates ran at ac6e174b and selected
browser runs at 4208c7b8. These are preserved results, not re-execution claims.
Harness-only repairs did not restart unrelated native/workspace gates.

SUITE: promoted `renderer/virgl-command/tests/dimensional-depth-overlap.mjs`
and `tools/virgl-dimensional-depth/overlap-browser.mjs`. The independent
public-field/full-RAM oracle survives the positive test and detects served-only
stencil layer rotation after completed physical GPU work and original DMA.
The retained initial verifier parser/ledger mistakes are followed by corrected
successful audits; they are tooling attempts, not product findings.

Exact fresh commands (full runners, positive/fault receipts and native calls
are seal members):

```sh
node tools/virgl-dimensional-depth/browser.mjs --output evidence/virgl-dimensional-depth/verifier/fresh-362436069-521288629-88675123 --seeds 362436069,521288629,88675123
node tools/virgl-dimensional-depth/overlap-browser.mjs --output evidence/virgl-dimensional-depth/verifier/promoted-2654435769-2135587861
node tools/virgl-dimensional-depth/overlap-browser.mjs --output evidence/virgl-dimensional-depth/verifier/promoted-sabotage-stencil --fault true
# The final fault command must exit1 after original DMA; the positive commands exit0.
python3 tools/check_task_policy.py
python3 tools/build_queue.py
```

Verifier seal: 308 complete reopened bodies,
37705730 compressed bytes in 3 parts of
at most 16 MiB. Manifest SHA256:
`69815fdc9b938a99b5022c6f876c43eea3656beb336855f2ce49df187b3da4a5`;
index: `0f5636d1b4f07d815b0864b430892f6724bde0dbe50dff5c03d7a125c927f3d8`;
reconstructed archive: `2872dbc59dfeb308a758497220a18d6e67fac6f127cb8ad1ddab948116fa23f2`;
verdict body: `54baa4afcbb92042d7674386e9c9ce33f7e844cf956c62d028bfbae52831e304`.

Only the explicitly selected original cube/array depth allocation and layered
DMA boundary is verified. Dimensional depth sampler/shadow/surface/scanout
consumers, positive production caps, complete GLES, Linux Mesa/Hyprland and
measured MIPS remain outside this verdict. Built/live demo remains partial.
No merge, PR publication, Actions or deployment was performed by this critic.
