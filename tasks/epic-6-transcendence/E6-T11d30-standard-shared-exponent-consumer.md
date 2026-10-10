---
id: E6-T11d30
epic: 6
title: Consume original RGB9E5 sampler views in the native standard renderer
status: pending
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
async renderer. Preserve every historical profile, resource owner, shader compiler,
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
Consumer integration has one deterministic acceptance command with wire, native matrix,
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
