---
id: E6-T12c
epic: 6
title: Execute the captured eight-object VirGL state model
priority: 525.02694
status: verified
depends_on: [E6-T12b]
estimate: S
risk: high
capstone: false
---

## Boundary

Implement typed, per-context/subcontext objects and bindings for shader, surface,
sampler view/state, vertex elements, blend, DSA and rasterizer. Consume original
decoded fields; feed original shader text into the verified bridge. Apply the
tiny scene's framebuffer, viewport, constants, vertex/index bindings and CLEAR.
Document actual reflected shader/constant/sampler/system-block bindings. Track
inactive resets without implying active unsupported-stage/storage/image support.
DRAW_VBO remains explicitly unsupported until E6-T12d.

Separate public resource removal from bound surface/view storage retention;
resource5 disappears before its retained surface is destroyed in submit249.
Unbind/destroy/reset must release references and prevent ID-generation aliasing.
Use the contract's context isolation and WebGL state restoration rules. No
production device or capset activation follows.

## Deterministic acceptance

`make verify-E6-T12c` executes the unmodified first-submission prefix through the
first draw boundary and recorded state/teardown packets in an explicitly scoped
state harness. Assert typed state, linked shader reflection, actual WebGL state,
the independent clear pixels, and object/resource reference counts. Exercise
A/B/A contexts using reused numeric handles and hostile host WebGL state;
record zero browser errors and no cross-context state leakage. Run affected
high-risk lifecycle gates and one final scrubbed clean-clone acceptance.

## Adversarial verification

Attack wrong-type handles, destroyed/reused objects, subcontext selection,
unsupported active flags hidden among resets, sampler swizzles, attachment
incompatibility and missing shader bindings. Late errors must not create
unreachable objects. Poison host program/VAO/FBO/texture/sampler/mask state and
require restoration. Sabotage a bound color mask or constant and require failure.

## Verification log

### 2026-10-03 — worker — activated

Follows independently verified resource transfers (`442b87c0`, PR #408). This
single state boundary integrates original decoded object/state commands with the
verified TGSI bridge and resource leases. The recorded first submission may stop
explicitly at its first unsupported DRAW_VBO; the successful prefix and subsequent
state/teardown packets are proven separately. Whole-stream draw replay remains
E6-T12d. Scoped submission gates are syntax/native resource+decoder regressions,
real hardware WebGL2 state/link/reflection/clear/lifetime attacks, source-bound
coverage and sabotage, plus one final scrubbed clean clone. The unchanged shader
compiler is built for the actual linkage proof; its previously verified language
semantics carry forward. No production device/capset or web demo activation.

### 2026-10-03 — worker — implemented

Frozen implementation/harness commit: `d530c0943c9c8bdb757e0f8ee440794d1316aea9`.

Commands:

- `EMCC=/tmp/wasm-vm-emsdk/wasm-vm-emcc VIRGL_STATE_EVIDENCE_DIR=evidence/virgl-state/worker make verify-E6-T12c`
- `python3 tools/virgl-command/state-cold.py --output evidence/virgl-state/cold-clone`

The recorded hardware run executes the original eight-submission state model,
including 207 non-draw commands, eight object types, original shader text through
the pinned Wasm translator and actual GL compile/link/reflection, raw constant
bits, real framebuffer clear pixels, and complete A/B2/A/B1/A state restoration.
The three original DRAW commands stop explicitly at their exact byte boundaries;
this is not full draw replay. All 142 submit249 cleanup packets execute once in
original order across the retained-surface observation split. Resource5 survives
public unref and surface-handle destruction until framebuffer unbind collects it.

The run passes 26,031 assertions and 51 named rejection/recovery cases, checks
6,144 independent clear pixels, and finishes with zero resource/state budgets.
It exercises typed/reused/destroyed handles, leases, lowered quotas, inactive
resets, host state poisoning, missing bindings, copied blend/raster lifetimes,
sampler-slot compaction, store-first disposal and post-allocation fault cleanup.
Trusted fault wrappers are explicitly labelled separately from actual hardware
success. The GPU is Chrome154 / ANGLE Metal / Apple M4 Max; console, page and
request errors are empty. Native decoder/resource regressions pass. Independent
wire corruptions of the first fragment constant and original color mask fail
the actual GL uniform/mask oracles as intended. The capture was visually inspected.

Evidence and SHA-256:

- `evidence/virgl-state/worker/receipt.json`:
  `94d8db69ea0ee07aff2221cc4ad73aaea3589b06d3cc7ffd8456e1381683146d`.
- `worker/hardware/report.json`, source-bound `browser-coverage.json`, and
  `browser.png`; screenshot digest
  `242adf3551eaa5534388544006e84366096387ebd2e30ad7e6da786a591156cf`.
- `renderer/virgl-command/state.mjs`: `738ed223232257ceeda2d4a49eefa444d10ef7707bd509407df76b236d13e8c7`.
- `evidence/virgl-state/cold-clone/report.json` records the identical frozen head,
  fresh dependency install, scrubbed environment and empty Git status before and
  after acceptance; receipt digest `633abb0077a5cdd416e7f06146fc0313dc93baff2dd0759289425e8694496f90`,
  cold log digest `0ed56d41f74edf7c22dd59fade328e244079e15ebaf6327da0d7165cc586209a`. The retained clone path is in that report.

This proves isolated render-state execution, not guest acceleration, live
transport, production capsets or FPS. Unchanged compiler language semantics,
resource internals and production web/Rust surfaces carry forward earlier proof.
Fresh verification must interrogate the recordings, attack the changed state
boundary and classify defensive branches not exercised by worker coverage.

### 2026-10-03 — fresh verifier — VERDICT: verified

Independent verifier, no implementation edits. Frozen source
`d530c0943c9c8bdb757e0f8ee440794d1316aea9`, diff from `442b87c0`.
Predictions P1–P12 in `evidence/virgl-state/verifier/predictions.md` all HELD;
concrete observations, pinned-reference review, per-hunk classifications and
promoted test commands are in `verifier/review.md`.

- Original 38-command prefix stops at unsupported draw byte5684; separately
  recorded state/teardown, actual original shader linkage/reflection, typed
  namespaces, raw constants, full CLEAR and retained storage lifetimes hold.
- Independent hardware attacks pass 5,342 assertions, 528 rejection/recovery cases
  across 11 attack families and three seeds, 48 A/B/A restoration rounds and 50,176
  literal clear pixels. Negative-zero/subnormal words, overwritten actual system
  UBO bytes/binding, LINK without stage bind, and simultaneous resource/surface
  ID reuse preserve actual GPU state. Zero draws, browser errors and final budgets.
- Both worker/cold wire corruptions and both independent runtime sabotages fail
  the intended actual uniform/mask/UBO oracles. Screenshots visually inspected.
- `verifier/audit.json` passes 369 exact-source/input/record/oracle/cold checks.
  Retained scrubbed clone is still clean at frozen HEAD; translator bytes match.
  All 68 state functions and the added lease resolver execute. Only two diagnostic
  fallback strings at state.mjs:89 are waived: malformed trusted releaseStorage
  responses cannot arise from the verified resource capability. No guest state
  behavior or unused semantic fallback is waived.

Commands: `node evidence/virgl-state/verifier/run-attacks.mjs`;
`python3 evidence/virgl-state/verifier/audit-evidence.py`.
Independent attacks SHA256
`29ccc226b0acad86e37a70939e8be1866e346a9e527ce5732ec00ac5057661d6`;
audit `5ce1258a510a4728c1d92d38a28bfcd21218f151ddde27d0ec13f1d335e93e1d`.
Worker/cold receipt digests match the implemented claim. Retain the acceptance
harness and independent seeded GPU/sabotage tests as permanent artifacts.
This verdict proves the isolated state boundary only; DRAW, guest activation,
capsets and FPS remain outside this task.
