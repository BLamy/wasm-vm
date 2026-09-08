VERDICT: verified

# E5-T26n — fresh critic final verdict

Exact implementation/test head:
`b50491ceafc5be9029ee96dc9229085efd354e22` (parent frozen runtime head
`84fd5190832924a0f609b4a10d1bfaee2704dc0e`; activation
`fbf21d4c1e0e10705e515986080f5015715e3b0f`). The evidence fails to refute the narrowly bounded
claim: cache-context equality may additionally project out mstatus bit 8 (SPP) while live SPP,
current mode, every retained authority input, and guest SRET/trap behavior remain authoritative.

No correctness, source-safety, evidence-sufficiency, mock/environment, or changed-hunk coverage
finding remains. Task-state and generated-metadata mutation are intentionally deferred until Main
provides the committed implemented submission containing the final evidence mirror.

## Falsifiable predictions

- **P0 — HELD: exact semantic scope.** The complete implementation diff adds only bit 8 to
  `INLINE_TLB_MSTATUS_CONTEXT_MASK`. No CSR/SRET/trap, translator, current-mode comparison,
  satp/PMP/flush/trigger authority, polling, budget, clock, scheduling, snapshot, image, helper, or
  F-harness runtime line changes. The only post-freeze source change is the promoted private SSIP
  test. Final source SHA-256:
  `0b0830a1ea2f0c979ca4ae662b281b5e6c0044b7ce6964a52715ed887861deb8`; unchanged parity SHA-256:
  `ecaca332a6d0474eb67614c2dd7e295de8da0b14520d8d43f8ca5f5d6fad3016`; unchanged Makefile
  SHA-256: `c4a4da2a59db318ddc90d49244db7f5f92d4b3f3ff511e1785ba31399afe691f`.

- **P1 — HELD: exact five-bit partition.** The existing private actual-WASM 64-bit matrix, rather
  than a duplicate, preserves R/W/EXEC sentinels only for bits `{1,3,5,7,8}`, clears them for every
  other single bit and the ignored-plus-retained mixture, and checks that live mstatus retains the
  complete requested mutation. It passes at the final-clone record
  `main-gates/09-final-clone.log:354-357`.

- **P2 — HELD: generated reuse and retained SUM authority.** Existing generated static and dynamic
  loops execute bit 8, while SUM still refuses stale static/dynamic authority and the mixed five
  ignored bits plus SUM invalidates both classes. The final parity run executes these cases at
  `main-gates/09-final-clone.log:394-427` and passes 38/38 at line 439. Architectural equality is
  never fabricated from JIT counters; JIT host-entry, retire, publication, live-entry, dispatch,
  and PIC-hit state is asserted separately.

- **P3 — HELD: encoded SRET-to-S.** With mode S, SPP1, SPIE1, SIE0, and MPRV0, encoded guest SRET
  `0x1020_0073` retires once and reaches the saved compiled S target with SPP0/SIE1/SPIE1. The
  immediate checkpoint precedes compiled entry; PC, mode, all integer registers, full mstatus,
  S/M trap CSRs, minstret/mcycle, and all RAM match the interpreter. The subsequent target effects
  occur, and inline/static/dynamic authority plus PIC reuse remains unchanged. Final clone:
  `main-gates/09-final-clone.log:298-303`.

- **P4 — HELD: encoded SRET-to-U mode guard.** Encoded SRET with SPP0 lands in U at an already
  compiled, U-fetchable page-tail block. BrowserExecutor records a real U-mode compiled entry
  before the S-only store faults; no stale target/data effect, indirect dispatch, or PIC hit occurs,
  and inline/static/dynamic words and authority are cleared. Interpreter parity holds with
  `scause=15`, exact `sepc`/`stval`, SPP0, and no fault retirement. Final clone:
  `main-gates/09-final-clone.log:292-297`.

- **P5 — HELD: authentic pending STIP and nested return.** Guest SBI TIME `set_timer(0)` creates
  STIP; pending cause 5 preempts at the first boundary after outer SRET and before compiled entry,
  with exact S/SPP1/SIE0/SPIE1 trap state and absent target effect. Guest SBI
  `set_timer(u64::MAX)` cancels the timer; the next authentic timer-device boundary derives STIP
  low while STIE remains enabled. Encoded nested SRET returns to S/SPP0/SIE1 and the compiled chain
  reuses both links. No raw mip or pending-bit mutation remains. Final clone:
  `main-gates/09-final-clone.log:304-311`.

- **P6 — HELD: independent SSIP pending-source attack.** The critic's frozen git-archive attack
  passed 1/1 (`verifier/ssip-attack.log:83-94`, SHA-256
  `be337c8f8b19f21f35e2eb11ebd7660a706eb597db523b77f6b9bdfbc4e4892e`). Encoded guest CSRRS
  asserts delegated SSIP; cause 1 preempts before compiled entry; encoded guest CSRRC clears
  `sip.SSIP` while SSIE stays enabled; encoded nested SRET returns to S/SPP0/SIE1/SPIE1 and the
  compiled static/dynamic chain resumes with unchanged authority. Architecture and all RAM match
  the interpreter at all five checkpoints, with JIT counters separate. The exact reusable patch
  (SHA-256 `b126e309c249505837e5bd3c75ae00ca49b5a3e2f05e58d5bf6b993418eb0a3b`) was promoted and
  rustfmt-only; the promoted permanent test passes again at final-clone lines 312-320.

- **P7 — HELD: SUM sabotage discriminator.** Exactly one isolated git-archive sabotage added SUM
  bit 18 to the ignored mask. The private partition failed as predicted
  (`main-gates/02-sum-sabotage-private.log:137-146`), and the existing generated dynamic control
  failed with 4 retirements versus the required 2
  (`main-gates/03-sum-sabotage-dynamic.log:15-20`). Both children exited 1. The scratch EXIT trap
  and real workspace restored the correct frozen source digest, recorded at
  `main-gates/07-restored-source.log:1-2`. The earlier unsafe in-place command was rejected before
  execution and is not counted as a sabotage run.

- **P8 — HELD/CARRIED: unchanged authority boundaries.** The final scoped target passes 13 native
  interrupt, 1 adversarial PMP, 4 PMP audit, and 11 privilege tests. These retain M/MTIP,
  mode/satp/PMP/flush/trigger, SUM, and SRET authority without reopening old F/image/harness tasks.
  The single unchanged E4-T33 long-churn ignore is neither new nor used as proof. Old F/image and
  performance evidence remain outside this task.

## Coverage and evidence sufficiency

- **Runtime mask and matrix hunk — executed.** The actual-WASM matrix exercises every one of 64
  mstatus bits, including the added SPP partition and retained mixed controls. The three worker
  SRET tests and independent SSIP test additionally exercise context synchronization through real
  Machine/BrowserExecutor boundaries.
- **Guest fixture hunk — executed.** Final-clone lib lines 292-320 execute SRET-to-U, SRET-to-S,
  pending STIP/cancel/nested SRET, and pending SSIP/guest-clear/nested SRET. Shared encoded-block,
  interpreter-oracle, all-RAM, authority-read, warm/clear, and JIT-reuse paths are exercised across
  their positive and negative cases.
- **Parity hunks — executed.** Final-clone lines 394-427 execute static bit-8 reuse, dynamic bit-8
  reuse with SUM negative behavior, and the combined five-bit-plus-SUM invalidation case.
- **Make hunk — executed.** `make verify-E5-T26n` reaches its completion marker at final-clone line
  441 after format, clippy, 29 native tests, both wasm32 builds, and 51 actual-WASM passes.
- **Promoted test hunk — executed twice.** It passed in the independent frozen archive and again in
  both the 51-test incremental record and exact-head pristine clone. Patch-plus-rustfmt was
  independently reproduced byte-for-byte before the clone; it yielded final source digest
  `0b0830a1...` without any runtime change.
- **Clone script — executed.** The sole final clone uses `--no-local`, detached exact head, checks no
  object alternates, starts with a fresh target, scrubs compiler/test overrides, and checks clean
  state before and after. No second clone is needed.
- **Generated demo/dist — covered.** The frozen production WASM digest remains
  `84b2c17c9b6ab9d86c85912f82bd0b4b4533178fc27a0724d47565cb40974b4d`. Main's one built demo
  capture shows E5-T26n and 126 passed/0 failed/126 done with empty collected browser/HTTP errors;
  JSON SHA-256 `a458cbf70dc97312e4859c43ac23ecfdacd71deb189711fda8536aacd66a5be3`, viewed PNG SHA-256
  `9c180395102fa34e02feaabab09468a02f97de467f71c64ff9d0858b18c0420d`.
- **Evidence prose and raw retained attempts — waived.** They are records, not executable behavior.
  Raw failed/superseded logs are explicitly excluded from final proof and retained for auditability,
  not silently rewritten.

## Final exact-head proof

The one prescribed pristine-clone command retained
`/private/tmp/e5-t26n-final.s8BFQMCn/repo` and exited 0 at exact detached head
`b50491ceafc5be9029ee96dc9229085efd354e22`. The raw record confirms initial clean checkout, no
alternates, fresh target, scrubbed overrides (`main-gates/09-final-clone.log:1-8`); 29/29 native
passes (`:156-207`); both target builds (`:209-261`); 13/13 lib and 38/38 nonignored parity passes
(`:284-439`); target completion and final clean state (`:441-442`). Log SHA-256:
`d58a1ff05e933b7f28dc9d9563702e7e5bf534cf2db2dcb89b17173bc2f86b06`.

The promoted incremental record independently passes 13 lib plus 38 parity tests and scoped
fmt/clippy at the same final head; SHA-256
`e4703396e8b1f5d8d7d1d7da7d69444efb8ddd14cc72684ed65fe8310dcf6c9a`.

## Bounded comparison and claim scope

The superseded full-serialization attempt differed only in cached CSR `time` shadow values 6 and
8 while both actual CLINT mtime values were 9. Final evidence claims and compares the acceptance
fields: PC, current mode, all integer registers, complete live mstatus, S/M trap CSRs,
minstret/mcycle, all RAM, and actual CLINT mtime where present. It does not claim full serialized
CPU equality or cached polling-shadow equality; no clock was normalized or modified. That explicit
boundary does not weaken SPP/current-mode/cache-authority safety and is not a refutation.

This verdict is limited to E5-T26n source safety and its stated acceptance. It does **not** establish
that SPP invalidation caused F's latency, prove a speedup, satisfy or weaken F's timing gate, verify
F, complete Epic 5, authorize deployment, or authorize any stack/merge operation.

## Suite disposition

- **Promote:** the SSIP guest-set/guest-cleared nested-SRET test is already a permanent private
  actual-WASM regression at final head `b50491ce...`.
- **Retain:** the extended exact five-bit matrix, generated static/dynamic SPP cases, SUM negative
  controls, and encoded S/U/STIP guest tests remain in the scoped gate.
- **Discard:** no additional ad-hoc fixture or second clone. The isolated sabotage is retained as
  raw negative evidence, not production test code.
