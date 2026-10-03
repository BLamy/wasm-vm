# E6-T11c independent predictions

Prepared at activation `3695b900`, before inspecting T11c execution results or
worker evidence. This session has not implemented T11c. It read the complete task,
the verified B2 transport and the existing presentation/readback contracts.
Predictions are immutable; later observations or supplemental predictions go in
separate files. Writes here do not advance task status.

## Carry-forward and scope

B2 verifier commit: `ab5f3a85cbf25dd151b6ae74904dd5e1fc793820`.
Its manifest SHA-256 is
`f6f6063975c59cd121c7c424ec85e6a72158be8906d82e06cd5b41c3f2d97aa1`;
review SHA-256 is
`602ccffd9b9afe186a510c7f056c6bd11a30a49c5962234bdb9055d07cd086de`;
audit SHA-256 is
`89bedcf6170d8a0fb1bc504f47464e47a023f56fea4f60264832af5660d80a47`.
Carry HELD findings only across unchanged source/dependency boundaries. New
scanout leases, snapshot readiness, generation routing and presentation changes
need new proof; a changed resource-store file does not invalidate unrelated
unchanged decoder/shader/renderer behavior by itself.

The accepted initial profile is scanout 0, existing single-level RGBA8 2D textures,
whole-resource SET_SCANOUT, bounded GPU staging and one pending presenter frame.
This is test-negotiated VirtIO-to-canvas, not production VIRGL, live Mesa or a
zero-copy/performance claim. Guest FLUSH success means ready snapshot plus owned
presenter acceptance. Actual canvas draw has a separate correlated outcome.

## Falsifiable checkpoints

1. **S01 — default capability remains off.** Ordinary construction/build still
   advertises VIRGL off and no production capsets. Any new proof export appears
   only in explicit proof builds. The ordinary demo and desktop use their existing
   2D capability and do not silently activate the new renderer.
2. **S02 — literal wire/preflight.** Exact SET_SCANOUT and RESOURCE_FLUSH fields,
   lengths, flags, full fence IDs and reply capacity validate before host side
   effects. Incomplete writable response capacity or invalid descriptor ranges
   cannot install a binding, issue readback or queue a canvas frame. Explicit
   failures preserve the previous valid binding/display generation.
3. **S03 — narrow profile.** Nonzero scanout indices, buffer/staging targets,
   unsupported formats/mips/samples, zero/oversized rectangles and cropped
   SET_SCANOUT rectangles reject before replacing the old binding. Resource ID 0
   disables according to the documented VirtIO contract and revokes old frame
   authority. An unsupported resource cannot fall through to a stale 2D shadow.
4. **S04 — global generation authority.** A binding is identified by the accepted
   Rust resource identity and the already established JS storage generation,
   never numeric ID alone. Global display retention is independent of context
   membership; it must not weaken context-scoped rendering/transfer checks. A
   wrong/stale expected generation rejects without retaining another allocation.
5. **S05 — binding lifetime.** Public unref prevents new lookup but does not free
   an existing authorized binding/capture prematurely. Reusing the same numeric
   resource ID creates a different generation and cannot redirect retained work.
   Context detach/destruction cannot turn an old lease into a new resource.
   The final documentation must distinguish new FLUSH admission after public
   removal from already accepted binding/capture/frame authority; no ambient
   numeric-ID lookup may silently decide the latter.
6. **S06 — independent capture ownership.** Each issued readback has a bounded
   retained allocation and staging token. Rebinding/releasing the binding while
   the GPU waits either explicitly cancels that capture or leaves only its own
   retained snapshot valid, as documented. No released native texture/PBO/sync is
   read, no frame ticket claims completion before its native fence, and every
   terminal path releases exactly once.
7. **S07 — snapshot versus mutable revision.** Issue capture A, then change the
   same live texture to content B before A's collection. An already issued GPU
   snapshot must have the declared A lifetime/bytes rather than becoming B or
   failing merely because contents changed. Revocation still cancels obsolete
   display authority. Conversely, unchanged draw/index-bound validation must
   continue rejecting stale mutable-storage revisions; adding a snapshot policy
   must not disable those checks globally.
8. **S08 — command order.** A draw/upload ahead of FLUSH affects the captured
   pixels; a later queued command cannot overtake the one owned head or substitute
   later contents. Submission/flush/rebind responses obey epoch/internal sequence
   order independently of duplicate/decreasing/high-bit guest fence IDs. Cursor
   and browser-task progress continue while capture readiness is withheld.
9. **S09 — actual hardware readiness.** GPU readback uses owned PBO/fence staging,
   zero-timeout polling outside Machine.run, and post-signal collection. Capture
   admission, issuing GL commands, and a pending frame are not GPU completion.
   While delayed, response/used/IRQ sentinels remain appropriate to the pending
   flush. Context loss/wait failure has an explicit terminal failure/revocation.
10. **S10 — exact pixel contract.** Independent asymmetric corner and alpha
    literals arrive on the actual built canvas in top-down orientation. Canonical
    numeric words are 0xAARRGGBB (little-endian BGRA bytes); conversion occurs once
    before the existing controller contract. No double Y inversion or R/B swap is
    hidden by a symmetric texture. Canvas readback, not enqueued source data,
    decides the actual display oracle. Semi-transparent 0/255 channels avoid
    unrelated premultiplication rounding; transparent RGB expectations are honest.
11. **S11 — owned asynchronous crossing.** Mutate/detach supplied arrays and grow
    Wasm memory after GPU collection/presenter acceptance but before scheduled
    rAF. The accepted frame's pixels remain unchanged. The controller owns its
    pending bytes; no guest or Wasm-memory view survives as borrowed authority.
12. **S12 — acceptance is not paint.** Hold rAF after a successful ready capture
    and presenter enqueue. The guest may receive FLUSH success, but its frame
    ticket remains pending, actual-draw counter stays unchanged, and the canvas
    remains at the previous pixels. Releasing rAF must correlate that exact
    frame/generation to a real backend draw before marking it drawn.
13. **S13 — bounded frame outcomes.** At most one pending presenter frame exists.
    Queue A then B without rAF: the documented newer-frame policy explicitly
    retires A as superseded/cancelled rather than drawn, and B draws once when
    allowed. Every accepted ticket reaches drawn/superseded/cancelled/failed once;
    duplicate or stale acknowledgement cannot retire a current replacement ticket.
14. **S14 — stale display rejection.** Accept A, then rebind/disable/reset or switch
    to 2D before A's delayed rAF. A must not overwrite the new display. Changing
    binding away and back to the same resource ID/dimensions cannot revive A's old
    generation. Unref alone has its separately defined retention effect and must
    not be confused with a rebind generation change.
15. **S15 — one display owner across modes.** Exercise 3D→2D→3D with pending work
    and differing dimensions. Both routes use the existing built presentation
    controller and one display generation authority. Queued 2D cannot overpaint a
    newer 3D binding, nor vice versa. Valid resize presents the correctly sized
    latest source; rejected resize/rebind preserves the prior valid binding.
16. **S16 — public reuse isolation.** Unref a pending frame's public resource,
    recreate its numeric ID with different dimensions/colors, and bind it later.
    The old retained image may only finish under its original still-current
    authority; it cannot read replacement pixels, carry replacement metadata or
    repaint after the new binding. Other contexts' render memberships stay isolated
    even though display leases are global.
17. **S17 — failure semantics.** Readback, conversion, presenter acceptance and
    actual draw failures are separately identified. A throwing/malformed/async
    trusted enqueue result cannot be reported as accepted pixels. A draw failure
    after an already accepted guest completion records a failed frame outcome; it
    cannot retract that completion or relabel the frame drawn. Reset permits a
    new valid request; old completion/frame tickets cannot publish into new state.
18. **S18 — bounded budgets and disposal.** Alternate dimensions/bindings and
    schedules with a fixed small operation count. Texture/lease/PBO/sync/CPU-frame
    budgets stay bounded, superseded work releases ownership, and final
    disable/reset/dispose returns newly owned allocations/tickets to zero (with
    any retained controller latest-frame copy explicitly accounted for). Do not
    infer GPU completion from disposal or WebGL context loss.
19. **S19 — measured copy accounting.** Evidence reports the actual PBO readback,
    conversion, owned handoff/controller copies and presentation upload bytes.
    Counts match frame dimensions and successful operations, distinguish rejected
    or superseded frames, and name any unavoidable duplicate copies. No reduced-copy
    claim is accepted without the measured browser path supporting it.
20. **S20 — ordinary 2D regression and real cold desktop.** A cold load of the
    actual built Epic5 desktop, with its boot snapshots disabled by the existing
    route, boots the authenticated expected artifacts and draws the unchanged 2D
    desktop. Guest progress/proof, canvas pixels/dimensions, console errors and a
    screenshot are recorded. Fixture-generated scanout pixels or a warmed snapshot
    do not substitute for this required boot. Default demo/deployment checks follow
    the task's actual browser-artifact changes.
21. **S21 — evidence sufficiency.** Final receipts bind frozen sources, actual
    built JS/Wasm, independent pixel oracle, native/Wasm records, screenshots and
    precise coverage. The final exact-head scrubbed clone is clean before/after.
    Audit every changed reachable runtime hunk; explicitly justify only narrow
    defensive/type/logging waivers. Carry unchanged prior HELD proof forward.
22. **S22 — falsification controls.** A served-source Y-conversion omission must
    fail the literal actual-canvas corner oracle. A separate bounded stale-frame
    or premature-drawn control must fail generation/ticket/canvas assertions;
    otherwise those assertions are not accepted as proof of presentation lifetime.

## Independent bounded adversarial schedule

Use literal asymmetric 3×2 and 2×3 images, including 85/170/255 alpha with 0/255
RGB channels. Queue/upload A, bind it, and hold GPU readiness. Mutate contents B
after A's snapshot has actually issued. After collection/enqueue, hold rAF,
unref/recreate the numeric resource ID, and mutate old guest/Wasm arrays. Exercise
both (a) no rebind, where the authorized old frame survives; and (b) rebind to the
replacement, where old frame delivery is explicitly obsolete. Then switch to
ordinary 2D and back, alternate dimensions, and release retained callbacks in a
non-FIFO order. Old acknowledgements cannot affect current tickets or canvas.
Repeat a fixed set of three GPU/rAF delay schedules without a throughput claim.

Drive actual Machine RAM/MMIO queues through the explicit Wasm proof. Use literal
VirtIO wire builders and the independent pixel oracle here; do not import worker
encoders or conversion helpers. Observe capture issue, real GL fence signal,
owned queue acceptance, used/IRQ publication and actual canvas delivery as distinct
points. Inspect the final worker's actual 2D desktop recording and cold proof only
after the frozen submission. No verdict or status update before that handoff.
