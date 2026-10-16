---
id: E6-T11
epic: 6
title: virtio-gpu 3D context plumbing — decomposed into ordered S tasks
priority: 611
status: cancelled
depends_on: [E6-T10c]
estimate: L
capstone: false
---

## Replacement plan

This L planning container is cancelled, not verified. Its transport and live
Mesa milestones are preserved by ordered S tasks against the verified WebGL2 /
ESSL300 contract. The shared portable JS decoder is E6-T12a; the old proposal
for a separate Rust VirGL decoder and successful unknown-opcode skipping is
superseded by bounded shared decoding and explicit unsupported-command errors.
A null sink cannot justify production capabilities or Mesa acceleration claims.

1. [E6-T11a — contexts and resources](E6-T11a-virtio-3d-control-resources.md)
   follows captured command replay E6-T12d: validate guest control commands,
   resource identities/generations and scatter/gather backing at the renderer
   interface, with appropriate spec error responses.
2. [E6-T11b — submissions, transfers and fences](E6-T11b-virtio-3d-submit-fences.md)
   adds SUBMIT_3D, both transfer directions and ordered asynchronous completion,
   including 100 fenced submits immediately followed by CTX_DESTROY, backing
   detach while queued, cursor progress and submit/fence/byte instrumentation.
3. [E6-T11c — scanout](E6-T11c-virgl-scanout.md) presents retained 3D resources
   through the existing canvas and preserves the Epic5 desktop/2D behavior.
4. After required renderer/shader/cache slices, [E6-T11d — truthful capabilities
   and guest Mesa](E6-T11d-truthful-guest-virgl-bringup.md) generates typed pinned
   capsets, negotiates VIRGL and proves actual dmesg/card0/renderD128,
   eglinfo/es2_info, intended renderer identity, llvmpipe-removal no-fallback,
   reference QEMU initialization coverage and at least 1000 correctly framed
   kmscube submits containing contexts/resources/transfers/DRAW_VBO. Includes
   pinned guest package/kernel and modeset bring-up documentation.
5. [E6-T11e — hostile input and context-loss survival](E6-T11e-virgl-failure-survival.md)
   closes the combined 10^6-case submission/backing/transfer fuzz gate, repeated
   asynchronous lifetime attacks and actual WebGL context loss with queue
   progress, explicit failure/2D fallback and reset/snapshot generation safety.

## Preserved acceptance and policy

These replacements retain all original live guest, framing, fuzz, fence,
resource-lifetime, reference-comparison and 2D regression oracles. Production
VIRGL and positive capsets stay disabled until executable prerequisites and
actual guest tests support the complete advertised profile; WebGL2 host limits
replace the obsolete WebGPU adapter assumptions. Unsupported opcodes are
reported with their original packet provenance and rejected, never silently
skipped to make a trace appear successful.

Each replacement has one acceptance command and a bounded evidence boundary.
E6-T12a starts this chain after verified E6-T10d; later prerequisite edges are in
the S task frontmatter. E6-T13 waits on final E6-T12m, which transitively includes
all transport and renderer milestones. No runtime or capability changes occur
in this decomposition, and cancelled containers do not satisfy dependencies.

## Verification log

Planning-only decomposition; no implementation or verification claim.
