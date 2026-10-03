# E6-T11b2 independent predictions

Recorded before inspecting worker execution results or evidence. Activation:
`d3f5e73372f25cb0d540dd76f6f7916cfa34571a`. The verifier read the task,
the previously verified interfaces, and the developing adapter's public types.
It has not implemented this task. Predictions remain immutable; later additions
and results belong in separate files.

## Scope and carry-forward

The target is actual Machine RAM/MMIO virtqueues through Rust/Wasm, the adapter,
and the already verified asynchronous renderer. It is not production negotiation,
scanout, live Mesa, FPS or MIPS. B1's unchanged resource/state/GL ownership results
carry forward when source hashes match its verified dependency:

- resources.mjs: `7c7a1d62b7649e058d3b406ea42289286f487b55f7f55623f850ee030453b1e2`
- state.mjs: `4b9fe2d4985a71ba8c873104910c8273abba35213d84fcb983a5a9001bf74436`
- B1 verifier commit: `3e5bf674b019d3055bc880ffeb48f8bd4d8d7102`
- B1 audit: `5e560aaf3eb504ae7f99a90faace0c9cceb678cd0a705789074d4792ddfd6ae7`

## Falsifiable checkpoints

1. **P01 — explicit feature boundary.** The ordinary constructor/build still
   advertises VIRGL off and no production 3D capability. Proof-only opt-in enables
   only its named boundary. Unsupported requests produce explicit errors without
   silently activating the renderer or mutating an unrelated resource.
2. **P02 — exact wire admission.** Independent literal SUBMIT and outer-transfer
   encodings, split across readable descriptors, decode identically in native and
   Wasm. Truncated/extra bytes, inconsistent lengths, invalid flags/padding,
   excessive command bytes and a malformed command tail reject before host command
   mutation. Full u64 offset high bits are checked before any narrowing.
3. **P03 — reply preflight.** A response chain with less than the full required
   reply capacity, or an invalid writable range, causes no host admission/DMA.
   Its protocol error/used behavior is explicit and leaves the next valid head
   serviceable; an error response is not a license for partial host execution.
4. **P04 — one owned head.** After a kick with multiple available requests, the
   transport owns at most one pending request. Its command/header and response
   segment metadata are immutable snapshots. Mutating those guest bytes or the
   descriptor table after admission cannot redirect that request. Later entries
   remain unconsumed and are snapshotted only upon their own admission.
5. **P05 — no lost continuation.** Completing the pending head causes service of
   later available requests without a second guest kick. No request is admitted
   twice after a wakeup, duplicate kick or ring-index wrap within legal bounds.
6. **P06 — order is internal identity.** Completion order follows epoch plus
   monotonic internal request sequence. Fence IDs 0, 1, 0xffffffffffffffff,
   0x8000000000000001, repeated IDs and decreasing IDs echo unchanged as full u64
   values when FENCE is present; no ordering or uniqueness rule uses fence IDs.
7. **P07 — capacity-one mailbox.** Wrong-epoch, wrong-request, stale, duplicate or
   out-of-order completion/exchange identities reject without replacing the valid
   mailbox entry, writing guest RAM, consuming another request or changing used
   indices. Terminal uncertain failures have only their documented narrow path;
   they cannot be relabelled successful GPU completion.
8. **P08 — reentrant post is independent.** A begin callback can synchronously post
   a completion through the independent mailbox without borrowing the running
   Machine again or triggering a RefCell panic. A contradictory post followed by
   callback failure cannot publish success; it follows the poisoned/error path.
9. **P09 — real readiness precedes success.** Issuing commands or observing
   needs-output is insufficient to finish a guest command. Before a real final
   GPU signal, response sentinels, used.idx and IRQ remain unchanged. A fabricated
   early success/early-readback source mutation fails the sequencing oracle.
10. **P10 — publication order.** At each accepted completion, all acknowledged
    output rows are visible before response bytes; response bytes precede the
    used element/index; trace records the published index; IRQ follows publication.
    Suppressed interrupts remain suppressed. Parking after earlier synchronous
    completions must not lose their pending IRQ.
11. **P11 — idle and wakeup.** While a job is waiting with no ready mailbox, repeated
    bounded Machine runs neither poll WebGL nor busy-service the pending head.
    A completion posted between runs wakes the next nonzero bounded run without a
    new guest kick. Browser-task heartbeats continue while readiness is withheld.
12. **P12 — cursor independence.** Cursorq can update and complete while controlq
    waits for the host. Control queue head blocking never prevents cursor service
    or consumes cursor descriptors under the control queue's identity.
13. **P13 — fresh input DMA.** Change actual guest backing bytes after attachment
    and after submission admission but before needs-input. The upload uses bytes
    gathered at that exchange, not either older snapshot. Outer transfers and
    embedded TRANSFER3D/COPY_TRANSFER3D obey the same rule.
14. **P14 — owned crossings.** Original callback request arrays and gathered input
    arrays remain valid after Wasm memory growth. Detaching/mutating arrays after
    a handoff cannot change the admitted commands or already accepted upload.
    No borrowed guest/Wasm view is retained across a browser yield.
15. **P15 — precise actual output.** Readback bytes come from actual GPU storage.
    For a partial texture box, nonzero offset and padded stride, only dense dirty
    rows reach the actual guest SG spans. Concurrent edits to padding and unrelated
    guest bytes survive. A whole-backing restore or reference-output initialization
    fails the literal byte oracle.
16. **P16 — validate before any scatter.** Wrong output byte length, bad final row,
    overflowing row arithmetic, stale context/resource/backing identity or invalid
    RAM span rejects the entire current exchange before its first write. An earlier
    acknowledged exchange may remain committed; no whole-job rollback is claimed.
17. **P17 — backing authority mapping.** Attach-time Rust resource/attachment
    generations map to JS storage/backing generations. Neither numeric resource
    equality nor a later renderer request can establish that mapping. A reused
    resource or replacement backing cannot receive an old exchange. COPY_TRANSFER
    maps the secondary backing owner, not merely the primary GPU resource.
18. **P18 — ordered lifetime.** Queue 100 fenced commands followed immediately by
    context destruction. All 100 commands finish exactly once in queue order before
    destruction applies, with correct responses and no access to freed backing.
    The one-head implementation does not claim all 100 are already snapshotted.
19. **P19 — queued lifetime changes.** Detach/unref/destroy placed behind pending
    control work cannot overtake it. If backing/context is changed through an
    explicitly allowed host path while paused, old exchanges reject or retain only
    their already valid original allocation according to the established lease
    contract; they never target a reused numeric identity.
20. **P20 — independent contexts.** Interleaved requests from different contexts
    preserve global control queue order and context-specific resource membership.
    An error in one context cannot authorize an exchange against the other's SG.
21. **P21 — reset revokes first.** STATUS reset clears pending queue/mailbox
    authority before host cancellation/disposal callbacks run. Old completion,
    gather and scatter calls after reset cannot change RAM or old/new used rings,
    including when the guest recreates identical queue addresses and public IDs.
22. **P22 — reconfiguration is revocation.** Queue ready/address/size changes revoke
    the pending queue generation. Changing configuration away and back cannot make
    an old callback current again. No new Virtqueue starts with reset indices while
    retaining an old pending head.
23. **P23 — failure is explicit and recoverable as specified.** Expected host errors
    return one structured guest error; malformed, asynchronous or throwing host
    outcomes poison the appropriate owner until reset. Failure after applied work
    preserves prefix diagnostics. Reset permits a new valid request and rejects old
    callbacks without duplicate RAM publication.
24. **P24 — DMA bus side effects.** Readback to executable guest RAM participates in
    the bus's code-write invalidation. A later guest instruction fetch sees the new
    bytes, including when resuming a previously cached block. This is a check of
    the new DMA write path, not a rerun of unrelated ISA semantics.
25. **P25 — native/Wasm parity and counters.** Independent little-endian decoding
    of literal response and ring bytes agrees in native/Wasm for valid, rejected,
    delayed, duplicated and reset schedules. Trace/head/fence/submit/byte counters
    correspond to actual admitted/completed/exchanged work, not fabricated logging.
26. **P26 — evidence sufficiency.** The final receipt, captures, native records,
    precise coverage and source hashes bind the frozen implementation. Every new
    reachable runtime hunk executes or has an explicit narrow permitted waiver.
    The final pristine clone is clean before/after with scrubbed build overrides;
    unchanged B1 proof is carried forward by digest rather than rerun by habit.
27. **P27 — product surface and scope.** The ordinary built demo remains functional,
    zero-console-error and truthful about production 3D. Changed default artifacts,
    if any, receive the task's deployment proof. No output from this isolated
    submission fixture is presented as guest Mesa, scanout or throughput evidence.

## Independent bounded attack planned before results

Admit a readback using a two-segment SG whose split falls inside a dirty row.
While the GPU waits, mutate the admitted request and writable descriptor table,
change unrelated destination sentinels, and queue another request plus context
destruction. The first result must use captured response metadata and current
approved dirty rows, preserve unrelated bytes, and complete before the queued
requests. Then reset/recreate the same public IDs and ring addresses; replay the
old output/complete identities and prove all replacement RAM/ring sentinels remain
unchanged. Repeat with duplicate high-bit fence IDs and three deterministic
callback-delay schedules. Test queued-but-not-admitted request mutation separately
and expect its later admission to observe the new bytes, as documented.

## Planned methods and falsification controls

Use independent literal wire builders and a byte-by-byte SG row oracle (no import
from implementation encoders/layout helpers). Drive actual native Machine and
explicit Wasm proof exports; record RAM/ring snapshots before/after each host
operation, callback identity, command trace and actual GL signal/collection events.
Inject a bounded wrong-completion identity/order and an early-readback signal in
isolated served source copies; require their intended oracles to fail. Audit
changed Rust/JS ranges against exact-source coverage. Writes remain verifier-only;
no task status or final verdict until frozen worker submission and cold proof.
