---
id: E6-T11d30
epic: 6
title: Consume original RGB9E5 sampler views in the native standard renderer
status: verified
estimate: S
risk: high
priority: 525.027039000372
depends_on:
  - E6-T11d29
capstone: false
---

Original VirGL `R9G9B9E5_FLOAT` / format 125 sampler views remain refused by the
verified packed-float command decoder after the shared-exponent storage prerequisite.
The exact verified predecessor is `b76fa7d63703e3cf2a3dfc3b2d7c835c3f3db5e1`; `evidence/virgl-production-readiness/standard-shared-exponent-consumer-gap.json` records two original125 views and a surface, all returning unsupported-feature through the historical packed decoder.

Admit original 125 2D sampler views through a separately selected standard decoder and
async renderer. Complete the selected GPU view refresh before applying native guest
draw state. Preserve every historical profile, resource owner, shader compiler,
cache budget, native transfer backend, guest capability set, and production renderer.
Original 125 surfaces and render-target use remain refused. Existing qualified original
RGBA32F / format 31 targets prove resulting pixels without adding output-format authority.

## Acceptance criteria

- `make verify-E6-T11d30` is the one deterministic acceptance command. It freezes exact
  tracked source and generated compiler identities, original packets/programs/input words,
  complete native/public planes, physical completion points, and full nested V8 intervals.
- Two original 125 view swizzles and nonzero first/last levels are accepted only by the
  explicitly selected decoder. Every older decoder refuses them. Invalid formats, targets,
  ranges, layers and swizzles are refused, as are all original 125 surfaces. Wire input is
  copied; hostile configuration fields cannot add private authority or invoke getters.
- Native vertex and fragment TEX/TXL/TXF/TXD/TXQ, fragment TXB, nearest/linear filters,
  identity/zero/one/lane swizzles, truncated/full source tails, and four fractional-mip
  linear cases execute original programs. Inputs and expected values are declared before
  GPU execution on an exact binary16 precision lattice established independently from
  original shared-exponent fields. The existing 2e-6 output budget stays fixed.
- Clear, first draw and warm draw follow actual native completion. Cold/warm programs
  retain the new selected namespace and warm execution creates no additional links.
  Original RGBA32F base/mip outputs, blend/masks, transfer output and scatter/gather
  padding are reconstructed independently from original public packets and bytes.
- With three varied schedules, retained original 125 views continue sampling old native
  storage after source-ID reuse, context switching and cache reset. Queued source/target
  destruction and name reuse preserve the actual owned terminal fence, including cancel
  and both disposal paths, and retire every native object once with terminal budgets zero.
- A GPU-only source-mip update clears an independent byte framebuffer into a PBO and
  uploads original packed bytes into RGB9_E5. No CPU image download supplies the update.
  The next original shader draw observes its new native values, adjacent mips retain
  complete original values, and every source backing byte remains unchanged.
- Missing selected host capabilities and an actual native output-clear error refuse with
  no guest draw. Unknown/inherited/accessor/trapping config fields refuse before any
  consumer allocation. Original source and private copy allocations keep prior bounds.
- An actual original-level substitution and an actual nearest-for-linear sampler mutation
  each reach native completion before the unchanged original-bit/pixel inverse fails.
- Async jobs, ordinary float consumers, packed-float storage/consumers and shared-exponent
  storage run their affected gates. All eight predecessor worker/critic seals are carried
  by exact digest. One final pristine scrubbed clone repeats this same acceptance command.

## Adversarial verification

Fresh critic: read the task and complete scoped diff before observing evidence; write
falsifiable predictions, then independently reopen/hash every member and reconstruct whole
native/public planes from original 125 fields and literal packet/TGSI operands. Audit the
smallest governing nested V8 interval for every new runtime boundary, not line samples.
Exercise all selected protocol/owner/fence/lifetime/host-error cases, carry unchanged held
results and seals, invent one bounded native sampler/owner attack, and sabotage a new test
through an actual post-completion pixel or original-level corruption. Confirm the pristine
clone and generated bindings, promote the independent proof, seal the critic capture,
then set the verdict under the task policy. The worker never marks this task verified.

## Execution slices

One boundary: original 125 sampler admission and the selected consumer/cache namespace in
`decoder.mjs` and `state.mjs`. Storage and compiler behavior remain the verified predecessor.
The selected refresh order prevents native helper draws from intervening between guest
state restoration and execution. Consumer integration has one deterministic acceptance
command with wire, native matrix,
three ownership schedules, two native sabotage controls and affected prior gates.

## Evidence boundary

This task proves the isolated original 125 sampler consumer only. It does not establish a
real guest driver handshake, advertise production capsets, render original 125 surfaces,
complete a production compositor, or deploy graphics offload to the public demo. The
parent production bringup stays blocked on its remaining original-protocol requirements.

## Verification log

### 2026-10-10 — worker — verified dependency and literal readiness

D29 is independently verified at `b76fa7d63703e3cf2a3dfc3b2d7c835c3f3db5e1` and published as open PR507 on the existing upper native stack. Both original125 range1..3 views, identity and [2,4,0,5] swizzles, still return `unsupported-feature` through `decodeStandardPackedFloatImageSubmission`; the original mip2 surface remains refused. The adjacent readiness script reproduces the literal original-wire negatives at that recorded head and pins both complete D29 seals and source closure. This has wire-refusal authority only. The ordered S/high consumer prerequisite is next on the user-authorized production graphics chain; no native consumer, guest, capset or production evidence is claimed yet.

Pure scratch preparation declares52 original vertex/fragment programs and40,776 original components on an exact binary16 lattice before any GPU observation. Independent JavaScript and Python original-word calculations agree without changing the existing pixel budget. Those checks are preparation only; native execution, physical completion, hot/cold source closure and fresh adversarial verification remain required.

### 2026-10-10 — worker — native integration before the frozen submission

The first ephemeral original125 draw completed its native fence but retained the preceding
clear plane. The packed-float predecessor smoke passed on the same hardware. Independent
sampler-diagnostic removal did not alter the failure; temporarily bypassing the selected
GPU view refresh restored rasterization with the expected empty private texture. The
selected consumer now completes all sampler refresh helpers before configuring the guest
VAO/framebuffer/program and remaining draw state, without changing any historical refresh
path, backend, compiler, input lattice or pixel budget. After this ordering change, the
full52-program native matrix and one11-case lifetime/host/error schedule pass. These are
implementation checks only; the frozen hot/cold acceptance, inverse audit, seals and fresh
critic verdict remain required.

Commands: `node tools/verify-virgl-standard-shared-exponent-consumer.mjs --output
target/evidence/virgl-standard-shared-exponent-consumer-prefreeze-matrix`; the same runner
with `--mode boundaries --seed 0xa5471e03` and output
`target/evidence/virgl-standard-shared-exponent-consumer-prefreeze-boundaries`;
`node tools/verify-virgl-standard-packed-float-consumer.mjs --output
target/evidence/virgl-standard-shared-exponent-consumer-prefreeze-predecessor --smoke true`.
Temporary query, shader, sampler-capture, refresh and case-selection isolation changes
were removed before freezing. Native attribute/VAO/program/draw-buffer/capability snapshots
remain in the final capture so the critic can inspect the actual draw state.

### 2026-10-10 — worker — frozen original consumer submission

Frozen runtime and complete harness: `62011567d7616e2b9bbe888e4754aa2064bde3ee`.
`VIRGL_SHARED_EXPONENT_CONSUMER_EVIDENCE_DIR=target/evidence/virgl-standard-shared-exponent-consumer-final make verify-E6-T11d30` passes once on that frozen head.
`python3 tools/virgl-command/standard-shared-exponent-consumer-cold.py --output target/evidence/virgl-standard-shared-exponent-consumer-cold-final` repeats the same command from a pristine scrubbed clone; both before/after tracked and untracked status are empty.
The clone remains at `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-shared-exponent-consumer-cold-ujwwxejv/wasm-vm`.

The original-bit/packet/TGSI inverse authenticates25,340 output components,17,824 retained native components,89,600 public bytes and29,760 padding bytes in each hot/cold run. The52 original shader cases, all three11-case ownership/host/error schedules, both actual native corruption controls after physical completion, and five affected predecessor gates pass their prescribed results. Full nested coverage for19 changed-source script records is retained; all29 added-line navigation samples have a positive governing counter, with whole intervals remaining the critic's authority. No original inputs or output tolerance were changed after GPU observation. All objects retire once and all recorded terminal budgets are zero.

`python3 tools/virgl-command/standard-shared-exponent-consumer-seal.py target/evidence/virgl-standard-shared-exponent-consumer-final target/evidence/virgl-standard-shared-exponent-consumer-cold-final evidence/virgl-standard-shared-exponent-consumer/worker` seals the full recordings, original source closure, generated compiler, browser captures, physical planes and coverage. The worker reopens and hashes every member against the index before submission.

Worker seal: `evidence/virgl-standard-shared-exponent-consumer/worker/manifest.json`, `evidence/virgl-standard-shared-exponent-consumer/worker/records.json`, `evidence/virgl-standard-shared-exponent-consumer/worker/recording.tar.gz`; 13,146 members, 11,227,303 compressed bytes. Archive `319c7460a407c940302aa5023c328e945a7e7d082a6fb9668c02b214851a859d`; index `e0c86f2beb30fec38a27951a967c7844ea9cd496d56477f05ae07d3894395250`; hot receipt `6bc95efad0e7331a724b922dcef98b97956c2f4c2fea9a1009fb842cc269fd7c`; cold report `8a8aeaa5535b6cc919d7ef6ecce5a438d2a6edf39abee3818d7d47d1e51ea17c`; cold receipt `6ea23e9431ce95ccd51ffee4182e1784b1af819aee82c3224b61e74b78569472`.

Claim: only the explicitly selected original125 sampler consumer is implemented, with original vertex/fragment sampling, fixed native precision, safe refresh/draw ordering, retained storage, actual terminal fences, GPU-only updates and explicit refusals demonstrated in the sealed session. All eight D26/D27/D28/D29 worker/critic seals and unchanged storage/compiler/cache boundaries are carried by exact digest. This submission grants no production capability, guest execution, live deployment or performance authority. A separate fresh critic must attack the diff and these recordings before verification.


### 2026-10-10 — verifier — VERDICT: verified

Fresh adversarial critic; no runtime implementation was edited. Read the actual operating
manual, complete task and scoped diff before opening evidence, and wrote the eleven
falsifiable predictions preserved in `evidence/virgl-standard-shared-exponent-consumer/verifier/predictions.json`.
Worker submission `691d75bcbae32edd8ee76a824164165f714b0e9e`;
frozen runtime/harness `62011567d7616e2b9bbe888e4754aa2064bde3ee`;
independent critic harness and final native recording `d740431ef45572660dd80fed5b90c424d9853392`.
All eleven predictions are HELD; no refutation or outstanding evidence gap remains.
The full prediction/observation/citation verdict is
`evidence/virgl-standard-shared-exponent-consumer/verifier/verdict.md`.

- P1/P9 source, cold and carry — HELD. Independently reopened and hashed all 13,146
  worker members, checked all 1,190 hot/cold source identities and identical generated
  compiler bytes, and confirmed the successful exact frozen-head pristine scrubbed
  clone. The unchanged five affected gates and eight D26/D27/D28/D29 worker/critic
  seals retain their exact digests. Carry those HELD results and the final cold proof;
  the critic changes only proof, so no unrelated wall or cold rerun is required.
- P2/P3/P4 admission, original arithmetic and completed pixels — HELD. All nine
  exported decoders were directly challenged; only the selected decoder admits the
  two original125 views, and original125 surfaces remain refused. Reconstructed
  original packet/TGSI operands, RGB9E5 fields, source/backing rows, every retained
  mip, native guest state, public transfer rows and padding without worker expected
  blobs. Binary16 lattice checks precede output and the 2e-6 budget stays fixed.
  An additional byte-for-byte reconstruction matched all 486 worker hot/cold,
  fresh-matrix and novel native/public frames (67,560 components). Clear/first/warm
  observations follow actual signaled native fences, and warm links do not increase.
- P5/P6/P7 owner, update and refusal — HELD. Three fresh schedules
  `0x6a09e667`, `0xbb67ae85`, `0x3c6ef372` preserve old-generation sampling across
  name reuse, context switches and cache reset. Owned target/source holds, complete/
  cancel fences, both unchanged disposal paths, one-time native deletion and zero
  terminal budgets agree. The GPU-only byte-framebuffer/PBO update reaches RGB9_E5
  without a CPU image download; adjacent mips and every source backing byte stay
  unchanged. Missing capabilities, native clear failure and hostile configurations
  refuse with no guest draw or private allocation/getter side effect. Disposal keeps
  the unchanged predecessor behavior of deleting its owned sync without claiming
  GPU completion; no new disposal-wait requirement was introduced.
- P8/P11 independent native attacks — HELD. Original-level substitution and
  nearest-for-linear mutation complete actual native draws before the unchanged
  inverse fails. The new attack uses distinct original ranges at the same sampler
  slot in vertex/fragment stages, retaining two separate textures through source
  reuse, two contexts and cache reset; literal arithmetic predicts `[.25,1,.875,2]`
  and every native/public byte agrees. Actual post-fence native red corruption changes
  component 0 from .25 to 7, and both the unchanged pixel oracle and independent
  inverse reject it at the fixed 2e-6 budget. Inputs and the novel prediction are
  declared before the final GPU run.
- P10 coverage — HELD. The smallest governing nested V8 intervals are positive for
  all 130 runtime partitions across 42 full records, with no waivers. Direct native
  historical controls cover the 17 inherited fragments absent from the initial
  worker-only sweep. Full captures retain all interval partitions; line samples
  are navigation only.

Commands: `VIRGL_SHARED_EXPONENT_CONSUMER_CRITIC_DIR=target/evidence/virgl-standard-shared-exponent-consumer-critic-final make verify-E6-T11d30-adversarial`
passed once on the frozen critic head. The supplemental exact-public reconstruction
also passed. Node/Python/shell syntax checks and `git diff --check` passed. Promoted
suite: literal-wire/rational whole-plane proof, full nested coverage audit, same-slot
vertex/fragment owner attack, real post-fence sabotage, complete capture/seal tools
and the recurring adversarial Make target. All final browser/server/Node/native
processes completed before sealing.

Critic seal: `evidence/virgl-standard-shared-exponent-consumer/verifier/manifest.json`,
`records.json`, `recording.tar.gz`, predictions, pre-run novel input declaration and
verdict. Every written archive member was reopened and independently hashed against
its index. `capture/citations.json` supplies authenticated file lines and canonical
JSON pointers for all 804 observation points; `capture/audit.json` retains their
concrete states, and `capture/coverage.json` retains the governing partitions.
The seal contains 18,457 members (22,542,223 compressed bytes).
Archive `90d564fdf045a320ab7bf4f4e0418a85b7d6ecb68c4c2fe9c059e52bf6e2fff9`; index `f946b031072a466238290da5146174d97291649a6e9f8e967b9ec0e6eefe5a79`;
audit `108f5be7f7af046a235083a6137f574dbccfd7ebd9a75cd341579a63fb8628ea`; coverage `7f8c9b12ce0dad29326aad3dfab01efdbf6a885b4ae5fa8a05fb133fa16e7824`;
verdict `2c1b3f428b561f20ab93201cd649608b3bef6d93e6d3f12a443629dcaf46ff74`.
Exact-public reconstruction `303e0e99f5fb7dc996880b98c90e8cacbb53a53c38f257ad012972eaf82389d1`;
observation citations `460906c38023ef46e74215e6084454668b6aa48bb20f914df8af9ca3b9924852`.

The verified authority is the isolated original125 native sampler consumer. Storage,
compiler, cache bounds, format maps, production renderer, web, guest and crates remain
unchanged. This verdict grants no original125 surface/render-target, guest execution,
production negotiation/draw, live deployment or performance authority.
