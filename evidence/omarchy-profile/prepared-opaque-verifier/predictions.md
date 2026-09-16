# E5.5-T03ag — independent preparation verifier predictions

Recorded before inspecting any new T03ag runtime evidence or creating a verifier
recording. Initial task head: `e66dee94` (task activation only). Base for the task
implementation: `5f623add`. The worker will supply the frozen implementation head
and final recording paths. This session did not implement the task.

## Falsifiable predictions

1. **P1 — fixed scope and provenance.** The frozen diff changes only the bounded
   preparation harness and its direct tests/evidence/task metadata. Runtime/R3,
   original 1280×800 geometry, cap256, recyclingOFF, and ICount64 remain unchanged.
   The recording binds the exact head/source digests and pinned R3 inputs.
2. **P2 — pre-navigation host input fence.** A recorded successful CDP input
   suppression acknowledgment precedes navigation, and every page/session used
   for preparation remains covered. No physical keyboard/pointer/nonce event is
   sent by the harness. A failed fence produces no usable exported pair.
3. **P3 — actual property readback.** Serial/wire evidence contains the exact
   T03af update-then-readback command in that order. Actual returned Foot
   properties are `opaque=true`, `force_rgbx=true`, and `opacity=1`; an update
   acknowledgment or a pre-update property response cannot satisfy the gate.
4. **P4 — one valid active-window observation.** Exactly one active-window query
   is used for preparation. Its returned JSON identifies a mapped, visible Foot
   window with finite positive geometry inside the original 1280×800 frame and
   a valid terminal-interior ROI. Missing/hidden/unmapped/foreign/out-of-bounds
   windows cannot authorize export.
5. **P5 — fresh real pixels.** Export is preceded by a genuinely new presented
   frame at 1280×800 after the opaque/window observations, with nonblank native
   terminal-interior pixels. The stored screenshot hashes match the recording;
   its actual image visibly contains the real Foot prompt. Old/stale pixels or
   only bar/border content cannot pass. A bounded stale-pixel mutation must fail.
6. **P6 — phase deadlines and cleanup.** Preparation succeeds or fails within
   one fixed 900-second phase. Pair export is a separate, fixed 180-second phase
   that begins only after P2–P5 hold and pauses/drains the guest. A final owned
   cleanup has a fixed 30-second bound. Time elapsed, renewed timers, and partial
   diagnostic progress do not extend or satisfy a failed phase.
7. **P7 — coherent complete pair.** If export occurs, full snapshot and overlay
   bytes satisfy the unchanged exact-seeded validator: every delta block is
   bound, core/base/generation/header IDs agree, raw/compressed lengths and hashes
   match the actual files, and the recorded resume decision is coherent. A
   foreign or corrupted pair cannot become usable. Artifacts remain private in
   `target/` and all incomplete/failed pair outputs remain unusable.
8. **P8 — narrow claim and result semantics.** Any failure records a negative
   result with no usable pair and no physical-input admission. A positive result
   authorizes only the separate T03ah physical-input trial; it makes no
   responsiveness, publication, release, or deployment claim.
9. **P9 — diff coverage and deterministic gates.** The final recording and
   deterministic direct tests execute each new behavioral hunk. Any unexecuted
   changed behavior receives an explicit evidence gap; declarative metadata,
   comments, and logging can be individually waived. Tests cannot count their
   own fabricated expected observations as real browser proof.

## Scope carried forward

Previously verified runtime/export behavior is carried forward only after source
identity and boundary checks. This medium-risk harness task requires direct
acceptance plus one bounded novel stale-image/foreign-pair attack. It does not
justify a new guest/browser launch, heavy build, runtime gauntlet, or cold clone
without a concrete changed portability/deployment claim. The worker owns the
single new real recording. This verifier will write only evidence/review files
and will send the verdict to the parent for repository lifecycle updates.
