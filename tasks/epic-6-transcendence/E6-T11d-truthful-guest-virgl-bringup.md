---
id: E6-T11d
epic: 6
title: Advertise proven VirGL capabilities and initialize real guest Mesa
priority: 525.02704
status: blocked
depends_on: [E6-T12i, E6-T11d1]
blocked_on: E6-T11d1
estimate: S
risk: high
capstone: false
---

## Boundary

Activate VIRTIO_GPU_F_VIRGL and GET_CAPSET_INFO/GET_CAPSET only for the qualified
WebGL2/backend profile proven by prerequisites. Generate capset bytes from typed
Rust fields with pinned independent ABI/mask checks, not hand-written hex or
native-layout assumptions. Limits, API/GLSL level, formats and every feature bit
must reflect implemented browser behavior and actual host limits. No null
renderer may justify positive production capabilities. Unsupported hosts remain
explicitly gated. Record guest package/kernel/driver pins and bring-up steps.

## Deterministic acceptance

`make verify-E6-T11d` boots the actual guest in the built browser and proves
virgl acceleration enabled in dmesg, card0/renderD128 present, and eglinfo/es2_info
finishing with the intended Mesa virgl renderer and no llvmpipe fallback. Remove
llvmpipe in a disposable guest overlay and repeat. Compare Mesa initialization
control-command coverage against QEMU plus pinned virglrenderer, allowing order
differences but no missing handshake. Run kmscube through at least 1000 submits;
the original command log must contain contexts, resource creates, transfers and
DRAW_VBO and remain correctly framed to the end with explicit errors for any
unsupported packet. A feature gap blocks bring-up until an ordered S fix is
verified; do not over-advertise to coax initialization past it.

Run affected native/wasm/browser gates and final clean clone, record guest traces
and source/image identities, and preserve the Epic5 desktop boot/2D regression.
Surface this newly proven device capability and submit/fence/byte counters in
the demo, run the repository's built-page acceptance and deploy/verify the live
site per AGENTS.md. Performance remains a later, independently measured claim.

## Adversarial verification

Probe every positive capset bit/format/limit at and beyond its boundary; compare
reported extension/API strings to executable support. Reject hidden CPU fallback,
speculative capabilities and unknown-opcode skipping. Attack unsupported browsers
and stale qualification state. Sabotage a cap bit or handshake response and
require the guest/ABI oracle to fail rather than accept an invalid profile.

## Verification log

### 2026-10-09 — worker — negative readiness; ordered prerequisite

Cache dependency E6-T12i is independently verified at
`fcb908e756a5e2fe7eb6f29864e23b0e46652b37`. The first minimum API check cannot
currently justify an ES2 profile: the ordinary vertex bridge and state reflection
stop at 46 guest constant vectors (47 including the upstream inaccessible suffix),
while GLES2 requires at least 128 vertex uniform vectors (Khronos ES2 table 6.20).
The actual generated Wasm rejects a direct slot127 read before producing ESSL.
No production capability or guest execution is claimed. The negative record
`evidence/virgl-production-readiness/constant-floor.json` binds complete source,
Wasm and source-head hashes to the result. Exact repro on this head:

```sh
node --input-type=module <<'JS'
import {createVirglShaderBridge} from './renderer/virgl-shader/index.mjs';
const bridge=await createVirglShaderBridge();
console.log(bridge.translate({stage:'vertex',text:'VERT\nDCL CONST[0..127]\nDCL OUT[0], POSITION\n0: MOV OUT[0], CONST[127]\n1: END\n'}));
JS
```

Observed `ok:false`, `unsupported-feature`, complete source rejected. Typed caps
must not overstate this backend floor. Ordered S prerequisite E6-T11d1 implements
and physically proves bounded ordinary vertex slot127 capacity while retaining
private raw/certificate limits; it grants no positive production capability by
itself. Resume bring-up after that fresh verification, then test the full actual
qualification/handshake. Normal entry also rejects complete92cb/c580 sources;
private numerical proof is not live admission. Any additional gap found during
bring-up follows the same ordered-fix rule.
