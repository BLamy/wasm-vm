---
id: E6-T11d69a
epic: 6
title: Provide original boolean GPU query lifetimes and guest results
priority: 525.027037
status: in-progress
depends_on: [E6-T11d68]
estimate: S
risk: high
capstone: false
---

## Boundary

Production original query object9/types1 and11 and commands19/20/21 provide
actual ANY_SAMPLES_PASSED and CONSERVATIVE results. Retain original custom
result resources and publish the pinned16-byte state/result-size/u64-result
layout only from real available native results. Preserve unavailable versus
false, original ignored wait/offset fields, virtual context/subcontext ownership,
resource generations, bounded polling and cleanup. Counter, timestamp, pipeline,
conditional-render and QBO types/commands remain refused. Private profiles stay
closed. Advertised boolean support must match actual GLES behavior.

## Deterministic acceptance

`make verify-E6-T11d69a` records qualified original Wasm/MMIO resource creation,
query create/begin/end/get and guest-memory result readback on hardware WebGL2.
Both boolean targets must produce independently predicted true and false results,
including depth-rejected and empty runs. Original no-wait polling exposes pending
state without publishing a fabricated false/DONE result. Check result_size4,
u64 high-half0, all16bytes, extents and poisoned padding. Interleave active queries
in virtual contexts/subcontexts; resource detach/unref/reuse, destroy, reset and
actual context loss must not mutate a different owner. Exercise invalid states,
unsupported types, exact framing, object budgets and fenced cleanup. Record all
changed paths, affected high-risk native/wasm/browser gates and one final clean
clone. The full actual GLES query probe is completed by69b;69a cannot claim TF.

## Adversarial verification

Fresh verifier predicts original ABI and actual query outcomes before reading
physical traces. Choose one novel depth/pending/interleaving schedule, prove
false differs from unavailable, and sabotage availability or result publication
to demand an oracle failure. Inspect original custom-buffer accounting and
all new positive capability fields. Every changed runtime hunk executes or has
a specific waiver.

## Evidence carried

The independent actual-GLES3 negative and pinned original ABI are preserved in
E6-T11d69 and the committed original-negative seal. Public renderer remains
virgl; no llvmpipe, invented packets, fabricated availability or CPU count may
justify a positive result. Parent default Omarchy remains a separate acceptance.
