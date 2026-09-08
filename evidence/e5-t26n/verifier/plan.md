# E5-T26n — fresh critic pre-evidence plan

Prepared before inspection of any worker diff, frozen-head record, test output, browser capture, or
other E5-T26n result. These are falsifiable predictions, not captions. The source preflight in
`evidence/e5-t26f/spp-context-candidate/critic-preflight.md` is adopted only as permission to test
the proposal; it is not implementation evidence.

Activation baseline: `fbf21d4c1e0e10705e515986080f5015715e3b0f`. Luna Hegel owns the three
implementation files; Main owns frozen gates, demo evidence, and the single pristine clone. This
plan predates and will not inspect either stream until the frozen worker handoff.

## Scope prediction

**P0 — the frozen semantic diff is exactly one authority-equivalence extension.** I predict the
only runtime semantic change will add mstatus bit 8 (SPP) to the existing ignored set
`{1,3,5,7}` in `INLINE_TLB_MSTATUS_CONTEXT_MASK`. Live `hart.csr.mstatus`, current mode, satp, PMP
revision, TLB flush count, trigger-idle state, SRET/CSR/trap logic, translator support, and every
other mstatus bit will remain unchanged and authoritative. Test/Make/demo-manifest/evidence changes
may implement the task's prescribed proof but may not broaden runtime behavior.

Refutation: any additional projected bit or runtime change; any projection written back into live
CSR state; removal of the separate mode comparison; translated SRET/CSR support; skipped context
sync; or any timing, polling, clock, budget, image/helper, snapshot, or F-harness change.

## Predeclared correctness predictions

### P1 — exact five-bit partition

The one existing actual-WASM private 64-bit matrix will be extended, not duplicated. For each
single-bit mutation from an identical baseline:

- bits 1, 3, 5, 7, and 8 will report no context change and preserve the seeded read, write, and
  execute sentinel words exactly;
- every other bit, including MPP, MPRV, SUM, MXR, FS, TVM, TW, and TSR, will report a context
  change and clear all three sentinel classes; and
- live architectural `mstatus` will remain the complete unprojected mutation in every case.

One mixed ignored-plus-retained mutation will clear all sentinels. I will reject a second matrix
that leaves the old four-bit test in place while adding a disconnected bit-8 spot check.

Refutation: bit 8 clears any sentinel; any sixth bit preserves one; a retained mixed bit fails to
dominate; or live mstatus differs from the requested mutation.

### P2 — generated static and dynamic bit-8 reuse, with SUM retained

The existing real generated-link cases will include bit 8. For an SPP-only change with all actual
authority unchanged, the static target will remain published and execute, and the dynamic target
will remain live and record its predicted hit. The existing SUM leg will still clear/refuse both
publication classes and prevent the forbidden target effect. Architectural `mstatus` will remain
exact in all legs.

These JIT observations are independent assertions. They are not fields in an interpreter-oracle
snapshot: the interpreter has no static-publication, dynamic-hit, live-entry, host-entry, authority-
check, or indirect-dispatch counters.

Refutation: failure to execute either generated link class for bit 8, stale target entry for SUM,
or any test that claims equality between BrowserExecutor counters and nonexistent interpreter JIT
counters.

### P3 — encoded SRET-to-S preserves cache authority and live SPP semantics

The positive fixture will execute encoded guest `SRET` (`0x1020_0073`), not replace it with a host
assignment to SPP. Immediately before SRET I predict mode=S, SPP=1, MPRV=0, SPIE=1, and an explicitly
chosen SIE value, with `sepc` naming the compiled return path and read/write/execute inline authority
plus static and dynamic links prewarmed.

At the post-SRET checkpoint I predict:

- current mode remains S and PC equals the prior `sepc`;
- SPP=0, SIE=old SPIE=1, SPIE=1, and MPRV remains 0;
- the encoded SRET retired exactly once; and
- PC, mode, integer registers, RAM, full mstatus, sepc/scause/stval, and architectural retire/cycle
  state equal the interpreter oracle under the same guest program and bounded execution.

At the subsequent compiled checkpoint I predict the target's architectural side effect occurs and
still matches the interpreter. Separately, the BrowserExecutor assertions must prove compiled code
actually ran, inline authority was preserved, static publication remained armed, and the dynamic
case gained the predeclared hit while retaining its live entry. A live CSR read or exact CSR
snapshot must observe SPP cleared; the projected cache value must never become architectural state.

Refutation: host-only SPP mutation, MPRV=1 in the claimed SPP-only positive, wrong SRET field
shuffle, oracle mismatch, target nonexecution, silent cache invalidation, or failure to exercise
both link classes.

### P4 — encoded SRET-to-U reaches context sync and refuses stale S authority

The negative fixture will also execute encoded guest SRET. Immediately before it I predict mode=S,
SPP=0, MPRV=0, and prewarmed S-mode inline authority plus both publication classes. After a bounded
stop containing SRET alone I predict mode=U, PC=`sepc`, SPP=0, SIE=old SPIE, SPIE=1, and exact
interpreter parity.

The landing block must be both U-fetchable and already compiled. On the next bounded run it will
therefore reach `BrowserExecutor::execute_with_budget` and context synchronization; a landing-fetch
denial is not acceptable coverage. The block will then attempt the fixture's declared S-only data
access or S-only linked successor. I predict the separate mode mismatch clears inline read/write/
execute words and clears/refuses both static and dynamic publication before stale S authority can
execute. The forbidden side effect remains zero, and the precise fault/non-entry PC and trap state
match the interpreter oracle. If the fixture delegates the expected U fault to S, I additionally
predict `sepc` names the faulting U instruction, `stval` names the denied VA, `scause` is the exact
declared exception, mode becomes S, and SPP=0 because the trapped prior mode was U.

Refutation: a denied initial landing fetch offered as candidate coverage, no compiled entry,
stale-S data or target effect, uncleared publication after reached sync, or any architectural oracle
mismatch.

### P5 — worker STIP sequence: pending source, legitimate clear, nested SRET

For the worker's delegated supervisor-timer variant, immediately before the outer guest SRET I
predict mode=S, SPP=1, SPIE=1, SIE=0, STIP pending and enabled, and the return target precompiled.
SRET will return to S, clear SPP, and restore SIE=1. At the very next dispatch boundary, before the
compiled target executes, the pending interrupt will enter S.

At the first stop I predict exactly:

- `scause = (1 << 63) | 5`, `sepc = return_target`, and `stval = 0`;
- current mode=S, SPP=1, SIE=0, and SPIE=1; and
- the compiled target side effect is absent.

The STIP source must then be cleared through the timer fixture's legitimate architectural/device
authority. Guest timer/SBI cancellation is one excellent route; an authentic timer-device clear
through the fixture's real device authority is also valid even if the fixture initiates it from the
host. What is not valid is direct pending-bit surgery that bypasses the source, such as mutating
`mip`/the CSR backing state or calling a raw pending-bit setter solely to force STIP low. After the
clear, encoded nested guest SRET will return to the saved target with mode=S, SPP=0, SIE=1, and
SPIE=1; the compiled target will then produce its expected side effect. Full architectural
snapshots at both stops must match the interpreter. JIT publication/hit observations remain
separate BrowserExecutor assertions.

Refutation: target execution before interrupt delivery, direct pending-bit mutation masquerading as
a source/device clear, wrong cause/EPC/trap-stack bits, wrong nested return, source still pending
after the claimed clear, or oracle divergence.

## Critic-owned bounded novel attack after freeze

### P6 — delegated SSIP variant with guest `sip` clear

I reserve exactly one novel pending-source variant: supervisor software interrupt, cause 1. I will
apply it only after the worker freezes the diff/evidence, using the existing nested-SRET fixture
without changing runtime scope.

Preconditions are fixed now: delegate SSIP in `mideleg`, enable SSIE, begin the outer SRET with
mode=S/SPP=1/SPIE=1/SIE=0, and make SSIP pending through the fixture's legitimate software path.
After outer encoded SRET restores SIE, SSIP must preempt the precompiled return target at the next
dispatch boundary.

Before inspecting the attack result, I predict the first stop has
`scause = (1 << 63) | 1`, `sepc = return_target`, `stval = 0`, mode=S, SPP=1, SIE=0, SPIE=1, and
zero target side effect. The nested S handler must clear SSIP with an encoded guest write/RMW to
delegated `sip.SSIP` (for example `csrrc x0, sip, mask`), and a guest-visible `sip` read must show
bit 1 clear. A host `set_mip_bit(..., false)` or direct CSR mutation is not a legitimate clear.
Encoded nested SRET must then produce mode=S, PC=`return_target`, SPP=0, SIE=1, SPIE=1, followed by
the expected compiled target effect. Both architectural checkpoints must equal an interpreter
oracle; JIT-only counters/publication are asserted independently.

Refutation: any STIP reuse disguised as the novel attack, wrong cause/EPC/stack, early target
effect, non-guest SSIP clear, re-pending SSIP, failed nested return, or oracle mismatch.

## Sabotage prediction

### P7 — overbroad SUM mask is detected

With SUM bit 18 temporarily added to the ignored mask, I predict both the exact partition test and
the existing generated SUM negative control fail: the former because bit 18 wrongly preserves
sentinels, the latter because stale generated authority permits or retains behavior the control
forbids. The accepted frozen source must restore the five-bit mask, and its digest must match all
final records. Sabotage may not alter identities, helpers, clocks, polling, budgets, images, or F's
deadline.

Refutation: sabotage passes either discriminator, only a synthetic helper fails while the real
generated SUM control passes, or final evidence uses the sabotaged source.

## Carried boundaries and evidence audit

### P8 — unchanged held results remain incremental

I carry E5-T26m's verified four-bit behavior, generated static/dynamic cases, M/MTIP and delegated-S
interrupt precedence, retained mode/satp/PMP/flush/trigger authority, SUM sensitivity, and combined
ignored-plus-SUM attack when their dependency source and evidence digests are unchanged. I also
carry the already-held old F/image/harness and existing PMP, execute-remap, SUM, and SFENCE
boundaries. They do not prove bit 8, but E5-T26n need not redesign or replay those full historical
tasks.

After freeze I will audit the complete task, exact diff, changed-hunk execution, source/test/log
digests, scoped `make verify-E5-T26n` record, the single task-prescribed pristine clone, and the
task-prescribed local-demo 126/0 capture. I will not add a second clone, a new performance screen,
an old image rebuild, unrelated suites, or any new acceptance requirement. The final verdict will
remain limited to cache-context safety; no result can establish SPP as the cause of F's latency or
claim F's deadline.

## Awaited handoff

No evidence verdict is possible now. The next critic action is to wait for Main's frozen activation
plan and the Luna worker's frozen exact-head diff/evidence, then orient on that immutable material,
execute the single SSIP attack above, and issue the actual adversarial verdict.
