---
id: E6-T12c
epic: 6
title: Execute the captured eight-object VirGL state model
priority: 525.02694
status: pending
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

(empty)
