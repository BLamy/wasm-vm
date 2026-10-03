# E6-T11b1 independent predictions

Recorded before inspecting any E6-T11b1 implementation or result. Baseline activation:
`5ec8846b`; task: `tasks/epic-6-transcendence/E6-T11b1-async-renderer-jobs.md`.
The verifier read AGENTS.md, the task and the pre-existing synchronous resource/state
engine. These predictions are immutable; results and additions belong in separate files.

## Scope and falsifiable checkpoints

1. **P01 — complete decode precedes mutation.** A syntactically valid state-changing
   command followed by malformed tail bytes is rejected at job admission. Immediately
   after rejection, renderer/store canonical inspection and GL command counters equal
   their pre-admission values. No job/scratch/staging ownership remains.
2. **P02 — owned submission.** After successful admission, overwriting/detaching the
   caller's original command buffer cannot change the admitted command stream, command
   offsets, draws, transfers, or final pixel bytes. Shared backing inputs are rejected.
3. **P03 — bounded admission and scheduling.** A second overlapping job fails explicitly
   while the first remains intact. Command-byte, CPU scratch, GPU staging and outstanding
   output limits reject before exceeding documented accounting. A long submission with
   only ordinary commands stops after the configured deterministic step budget and a
   browser macrotask heartbeat can advance before the next step.
4. **P04 — fresh upload request.** At each upload command, the paused job exposes the
   exact current resource/backing identities and dense-row input length. Changing the
   store's attachment-time byte snapshot does not determine upload contents: only the
   owned input provided for that exchange reaches the actual GPU allocation.
5. **P05 — owned and single-use input.** Mutating/detaching bytes after the input handoff
   cannot alter the upload. Wrong lengths/types, foreign or stale exchange tokens and
   duplicate handoffs fail without advancing the active command or consuming another
   job's valid exchange. At most one exchange exists.
6. **P06 — PBO texture staging.** Actual GL instrumentation shows the readback texture
   attached to a framebuffer, PIXEL_PACK_BUFFER allocated/bound, and readPixels called
   with a numeric byte offset into that PBO before its fenceSync. It never uses a CPU
   typed-array readPixels overload on this asynchronous path.
7. **P07 — buffer classes and private staging.** Buffer/index staging uses copyBufferSubData
   into separately owned buffers; element-array source/destination objects obey WebGL's
   persistent element/other-data class rules. GPU index validation reads the private
   copied bytes rather than an attachment-time CPU mirror.
8. **P08 — zero-wait GPU progress.** Every observed clientWaitSync has flags 0 and
   timeout 0. No finish call or positive-timeout wait occurs. TIMEOUT_EXPIRED keeps the
   job pending without getBufferSubData; a later browser task can advance heartbeat
   before the next readiness poll. WAIT_FAILED/context loss fails explicitly.
9. **P09 — collection after signal.** Every getBufferSubData collecting asynchronous
   staging has a matching prior fence and a subsequent successful signal observation.
   It never collects after only issuing the copy/readPixels or after a timeout. A
   source sabotage omitting required waiting must fail this sequencing oracle.
10. **P10 — completion means GPU completion.** Even a submission with no readback or
    draw remains pending after its commands issue until its final completion fence
    signals. The final successful record retains full applied-command and draw totals.
11. **P11 — precise output and acknowledgement.** Actual readback output is owned
    dense rows plus exact destination offset/stride/row-byte metadata and resource and
    backing generations. A padded two-row readback changes only its designated bytes;
    sentinels before/between/after rows are preserved. Commands following readback do
    not execute before acknowledgement. Wrong/duplicate/stale/foreign acknowledgements
    cannot advance the job or acknowledge a later exchange.
12. **P12 — generation revalidation after every yield.** Destroy/reuse of a context,
    subcontext, public resource ID, membership or backing during a wait/input/output
    pause causes explicit stale/cancelled failure before later draw, upload or output
    acknowledgement can act on the replacement. Identity checks are object/generation
    based, never public numeric ID equality alone.
13. **P13 — staged index validation stays applicable.** If a public upload attempts to
    replace index contents between GPU staging and draw, ownership rejects the mutation
    or a revision check refuses the pending draw. No draw uses unvalidated replacement
    indices. Include an in-range staged index changed to an out-of-range live value.
14. **P14 — whole-submission quota and prefix.** Step/yield boundaries do not reset
    draw or index quotas. A semantic failure after N successful commands returns N,
    the exact failing byteOffset/opcode and the successful draw prefix; later commands
    remain unapplied. No rollback of an already successful prefix is claimed.
15. **P15 — cancellation and terminal cleanup.** Cancel, renderer/store context
    destruction, renderer/store disposal, GPU failure and context loss each release
    job-owned staging buffers, syncs, CPU/output scratch and leases. Repeated/stale
    operations cannot double-delete resources, resurrect a job or affect a successor.
    Final allocation/accounting counters return to their fixture baseline and then 0
    when the complete fixture is disposed.
16. **P16 — original command replay.** All eight original submissions execute 210
    commands, three actual draws and original readbacks on headed hardware WebGL2.
    Every one of the 768 literal interior pixels matches the independent expected
    colors. Poisoning reference output snapshots leaves this result unchanged because
    those snapshots neither initialize inputs nor define the literal oracle.
17. **P17 — deterministic schedules.** At least three independent schedule seeds vary
    step, readiness-delay, input and acknowledgement interleavings while preserving
    exact successful bytes/diagnostics/accounting. No schedule escapes quotas or hangs.
18. **P18 — synchronous compatibility.** Unchanged public synchronous resource/state/
    draw acceptance commands pass against the frozen runtime with their established
    semantics. New async ownership must fail explicitly where necessary without
    silently changing synchronous results outside an active async job.
19. **P19 — evidence binds the diff.** Recorded reports name the frozen commit and
    SHA-256 of every served changed source. Report/capture/coverage/receipt digests
    match files on disk. The final pristine clone has scrubbed Rust/Cargo/log overrides,
    no inherited generated source substitution, and succeeds with the same command.
    Every changed runtime hunk is exercised or receives a scoped written waiver.
20. **P20 — limited product claim.** No production VIRGL negotiation, virtqueue/RAM
    publication, scanout, FPS or MIPS assertion is introduced. The ordinary demo still
    advertises no production VIRGL and its existing suite has zero console errors.

## Independent bounded correctness case (planned before results)

Use a partial rectangular texture readback with nonzero x/y, an offset that crosses a
scatter/gather boundary and a destination row stride larger than the dense row width.
Drive the job through multiple forced timeout macrotasks. Change unrelated destination
sentinels while it waits, then scatter only the acknowledged dense rows. Assert exact
literal GPU colors and unchanged unrelated bytes; cancel a sibling attempt before
acknowledgement and prove its stale token cannot publish into a new backing generation.

## Review methods

Inspect frozen diff before reports, independently rehash evidence, audit actual GL calls
and changed-hunk V8 coverage, run independent hardware attacks with original fixture
input bytes, and source-sabotage a required fence wait in an isolated served source copy.
No runtime or worker-test edits by this verifier. Final findings cite concrete source
lines and recorded operation/event indices plus evidence digests.
