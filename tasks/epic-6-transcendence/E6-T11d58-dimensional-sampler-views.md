---
id: E6-T11d58
epic: 6
title: Execute original RGBA8 volume cube and array sampler views
priority: 525.027039000397
status: implemented
depends_on: [E6-T11d57, E6-T11d56, E6-T11d55, E6-T11d49]
estimate: S
risk: high
capstone: false
---

## Boundary

One explicitly host-selected original RGBA8 dimensional sampler-view consumer.
Compose verified native layered DMA/storage and dimensional compiler output.
Decode original view target, packed mip/layer extents and swizzles; bind owned
native dimensions and actual sampler objects, with independent stage/slot units.
Use actual GPU copies for private ranges, with checked byte/lease/fence custody.
Keep historical selectors and complete public results unchanged. Preserve all
qualified 2D behavior. Dimensional storage remains format67 only; incompatible
typed/depth/shadow/cube-array/MSAA views refuse before any draw. No capset,
production Linux-worker admission, default negotiation or MIPS authority.

## Deterministic acceptance

make verify-E6-T11d58

Record original TGSI, view/sampler packets and complete compiler responses,
native reflection/bindings, all uploaded/read back bytes and original RAM state.
Exercise literal volume/cube/array extents and mip chains, six faces, all sampled
depth/array layers, private mip ranges and array-layer subsets. Both shader
stages, sparse slots, mixed native dimensions at the same original cross-stage
slot, source/write modifiers, swizzles/constant lanes, supported sample/query
operations and min/mag/mip/wrap/LOD state use independent complete pixel oracles.
Nearest, query, constants and unwritten lanes require exact 32-bit words. For
fractional linear filtering, core GLES specifies interpolation algebra without
bit-identical native filtering; selected Metal evidence imposes an explicit
analytic absolute-error budget of 1/255 for each fractional written float lane.
This is a selected-hardware test budget, not a universal GLES precision claim.
Every original RAM padding/guard byte stays exact.

Carry unchanged compiler/transport facts by exact authenticated source,
dependency and generated-byte hashes. Native draws also pass through actual
Wasm VirtIO queues and checked RAM DMA. Collect complete planes after distinct
real native fences; completion never publishes used/IRQ before actual GPU work
and owned staging retirement. Do not introduce a CPU texture mirror.

Attack target/return/range/role mismatches, malformed/accessor/proxy/extra
metadata, native reflection, private range budgets/allocation failures, cache
rebinding, generations/destroy/reuse, delayed/cancelled jobs and caller GL state
restoration. Physically corrupt a target/layer binding after a passing baseline;
the completed plane must contradict the unchanged original-byte expectation.
Repeat deterministic schedules. Retain finest governing V8 counters across
every changed executable operand, authenticated historical controls and static
waivers only. Run the affected gate once at a frozen head and one final pristine
scrubbed clone. Surface partial progress in the default demo, capture 127/0 with
zero console errors, deploy the frozen bundle and record the live response bodies.

## Adversarial verification

Predict original view fields, owned relative mip/layer extents, native sampler
dimension/type/units and exact complete output before reopening evidence.
Challenge cross-stage slot aliasing and different ranges of the same resource,
stale identities, queried depth/layers/levels, wrap/LOD/swizzle state, budget and
cleanup ordering. Invent one bounded novel original packet case and completed
physical sabotage. Audit each changed runtime partition against recorded native
calls/finest counters; carry HELD dependencies by exact digest. No runtime fixes
by the fresh critic and no unrelated regression wall.

## Primary source pins

Carry Gallium/virglrenderer protocol1.3.0 and Mesa26.2.2 original view definitions.
Packed layers use low/high16 bits, levels low/high8 bits. Mesa volume views use
arraySize1 layer0..0 while native depth minifies by mip; cube uses six faces.
Private array views expose local layer indices and local mip counts. GLES3.0/
WebGL2 dimensional sampler signatures and copy restrictions govern the native
path; no invented cube TXF/projection or unsupported dimensional shadow types.

## Verification log

### 2026-10-12 — worker — verified compiler and exact sampler-view refusal

D57 is independently verified at `deb7b3113f9adeb2e6e80449a6710dd3295093ea`.
PR535 continues existing native stack500 above PR534. Full GitHub snapshots
hold all135 earlier identities, heads, bases, order and open/draft/unmerged
states, plus both stack identities. Only PR535 was added; no stack restart or
merge occurred. The Codex attachment attempt hit its100-identity limit; no
existing attachment was removed.

The actual selected generated compiler admits54 original dimensional cases:
both stages,3D/CUBE/2D_ARRAY, homogeneous FLOAT/SINT/UINT, and TEX/TXL/TXQ.
The actual existing D56 consumer rejects all54 metadata records. A separately
labelled diagnostic changes only the profile tag and still observes native
dimension-type refusal; it grants no shader admission authority. All19 current
decoder entrypoints reject each of three original dimensional sampler-view
packets (57 complete refusals). The25 positive controls are19 original 2D view
packets plus six actual historical 2D compiler/metadata results.

Exact clean verified-head command:

```sh
node /tmp/wasmvm-dimensional-view-readiness.mjs /tmp/wasmvm-dimensional-view-gap-deb7b311-final
```

Complete original requests, compiler and consumer responses, packed view words,
runner, source closure, pinned Mesa/virglrenderer view definitions, generated
compiler bodies, before/after GitHub snapshots and audit are sealed in
`evidence/virgl-production-readiness/dimensional-sampler-view-gap/`. All84
members were reopened. ManifestSHA256
`b76764f40ad62136a835869e1adb88650ae58f8b6a56ce0284c42b8ff9f8c530`;
index `8a0f3e965d6fc8a515c2fb289c7b7e88cfcefc163b0ca2fe7225890e841351bf`;
archive `f087447c3ff9b16638724faffe0cf83c7a6f2979c37775e092f5fec2f2d6543a`.
The initial successful recording with an absolute repository path is retained;
the final runner discovers the current repository for portable replay. The
selected generated JS/Wasm match the exact D57 worker bytes:
`4ade0ffb9ffb661a729179525e7937c4695230dc57a7f79db63a1538119a95f2` /
`8749da215131646f0b7d53d59fe7ee19fa68b2fab2e9bec80446c4af3e84e100`.

The owned final D57 cold clone was removed only after the fresh critic released
all leases and worker/critic archive hashes were authenticated. Complete raw
and sealed evidence remains; the cleanup custody journal is in this archive.
Unrelated evidence and Chrome were preserved. This negative readiness has no
native draw, Linux guest, capset, production or MIPS authority. The explicit
human goal to finish production guest graphics keeps this ordered S/high
boundary ahead of the unrelated desktop snapshot task.

### 2026-10-12 — worker — recorded original dimensional sampler-view execution

Runtime and affected acceptance harness frozen at
`1c7f8c9b4e52e09e8f6e2201f92d7483ce7117a6`, against independently verified
D57 `deb7b3113f9adeb2e6e80449a6710dd3295093ea`. The explicitly selected
RGBA8 consumer executes original volume, cube and 2D-array views with native
dimensional storage, independent stage units, original swizzles and sampler
state, and GPU-only private mip/layer copies. Incompatible dimensional formats
and typed samplers remain structured refusals before drawing. Historical public
entrypoints retain their complete results. This submission has no production
guest, capset, API-completeness or MIPS authority.

Exact final commands:

```sh
python3 tools/virgl-dimensional-views/cold.py /tmp/wasmvm-dimensional-views-cold-1c7f8c9b
python3 -m py_compile tools/virgl-dimensional-views/seal.py
python3 tools/virgl-dimensional-views/seal.py /tmp/wasmvm-dimensional-views-cold-1c7f8c9b evidence/virgl-dimensional-views/worker
python3 /tmp/wasmvm-publish-dimensional-view-pages.py
node /tmp/wasmvm-dimensional-view-live.mjs --output /tmp/wasmvm-dimensional-view-live-1c7f8c9b --task E6-T11d58
python3 /tmp/wasmvm-seal-dimensional-view-deployment.py
```

The final pristine detached clone ran `make verify-E6-T11d58` once, with scrubbed
inherited compiler/runtime settings. All31 selected command exits matched their
expected values, with tracked and untracked cleanliness before and after. The
complete receipt and per-command output retain exact commands, timings, source
and generated-body identities. Unchanged compiler/C/Rust/transport facts were
carried by638 exact source pins and six generated bodies;53,318 predecessor
archive members were authenticated and reopened. No unrelated regression wall
was restarted.

Actual Apple M4 Max ANGLE Metal execution passed247 original cases for each of
three fence-delay schedules (27449,84131,176129):741 matrix runs. The same three
schedules passed129 bounded refusal/recovery/qualified-2D runs,18 cross-stage
and same-allocation range cases, and nine generation/cancellation sequences.
The794 facade contracts include54 unchanged complete compiler bodies,76 exact
historical decoder results and zero executed hostile metadata traps. Independent
whole-body arithmetic audited926 complete native planes, original source and
output RAM, all SG padding/guards and fence retirement. GPU-only source changes
refresh private views without a CPU texture upload or RAM mirror. The physical
wrong-array-layer copy completed after a passing baseline and contradicted the
unchanged word oracle (word0 expected1065353216, observed0). Native caller GL
state, failure cleanup and bounded allocation custody have complete records.

Finest governing V8 counters and exact prior-source operands cover851 executed
runtime partitions,61 HELD historical operands and one explicit static waiver,
with zero new executable gaps. HELD entries retain historical counters, including
zero counts; they are unchanged verified operands, not a claim of new positive
execution. Nearest/query/constants/unwritten lanes are bit exact; fractional
written linear-filter lanes use the stated selected-hardware1/255 analytic
budget. The independent audit also requires every RAM padding/guard byte exact.

The final sealer initially pointed at the former single `hardware/report.json`
location. Before sealing, only that evidence-serialization guard was corrected
to authenticate all three `hardware-<seed>/report.json` bodies. The invoked
corrected sealer is included in the archive; the frozen receipt also retains
its prior source. Python compilation, complete archive reopen and three head
checks prove the harness-only correction. No runtime/generated byte changed and
the successful pristine recording was retained intact.

Worker archive `evidence/virgl-dimensional-views/worker/` contains2,327 complete
reopened members (151,192,332 compressed bytes). ManifestSHA256
`366968fe114438560886832570b9c36b1ffe4e3d7526cf718fba6b6dc9a47b2c`;
index `398ef4c26c719a0995bd5fbc7d14039d5dcccdb13613de7a22c945572d9a32da`;
archive `fb56c37995c361bece8bbe14f6ec5606580741affbb8c76a9469e6c6a231cdf5`.
The clean clone remains available at
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-dimensional-views-cold-e6m3945d/repo`;
raw proof is `/tmp/wasmvm-dimensional-views-cold-1c7f8c9b/recording`.

The committed ordinary bundle passed127/0 with zero console errors, proof-only
exports absent, the scalar memory pip live and E6-T11d58 guest-GPU progress
explicitly partial. Its frozen304-file staging tree changes only roadmap.js and
sw.js; boot manifest rewrites and artifacts are authenticated unchanged against
the previous deployment, with every file below25MiB. The underlying pinned
Cloudflare Pages deploy command published commit1c7f8c9b using branch metadata
`main` without changing Git main or merging any PR. Deployment
`e7b44bfe-632e-401f-a61a-df033112f26a` succeeded at17:45:39 UTC. Canonical
`https://wasm-vm.pages.dev` independently passed127/0 and zero errors, with exact
live Wasm/roadmap hashes, complete HTTP bodies and screenshot. Production guest
acceleration remains disabled in the displayed partial marker.

Deployment archive `evidence/virgl-dimensional-views/deployment/` contains512
complete reopened members (49,649,171 compressed bytes), including all staged
bodies, frozen source archive, publication commands/output, sanitized Cloudflare
success response and live capture. ManifestSHA256
`9e91426d13b700e5b078510221e9236121f66d33b8af1450ce556feea43f84ec`;
index `0fda4f27d53d65fd39285edf245344715da499e68f6c50439841462cba70654a`;
archive `5054f169b23d2a8dcda3cd29d9bfc5708a7a05f43a54fc3af0057a0cc4a307c8`.
Fresh adversarial verification is required before this task can become verified.
