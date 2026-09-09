# E5-T26n — provisional frozen-handoff audit

**PROVISIONAL ASSESSMENT: correctness and scoped coverage hold at frozen worker head
`84fd5190832924a0f609b4a10d1bfaee2704dc0e`. No correctness refutation found. Final verdict is
withheld until the promoted SSIP test is on the exact final head and Main records the one prescribed
pristine-clone run at that head.**

This is not a task verdict and does not authorize a status change. It audits the exact diff from
activation `fbf21d4c1e0e10705e515986080f5015715e3b0f` through the frozen worker handoff, the worker's
final evidence, Main's frozen gates/demo/SUM sabotage, and the critic-owned SSIP attack. It makes no
latency or F-causality claim.

## Prediction results

- **P0 — HELD.** The sole runtime semantic change adds only mstatus bit 8 (SPP) to the existing
  ignored set `{1,3,5,7}` in `INLINE_TLB_MSTATUS_CONTEXT_MASK`. The diff does not change live CSR
  state, current-mode comparison, satp/PMP/flush/trigger authority, SRET/trap/CSR semantics,
  translation, clocks, polling, images, or F's harness. Frozen source digest:
  `62f0599f20d8faeb26dcb6d0664b795bf27daed562d27ce86b29860bb42fc7b0`.

- **P1 — HELD.** The existing actual-WASM 64-bit matrix is extended in place to exactly bits
  1/3/5/7/8; all other single bits clear R/W/EXEC sentinels, a mixed ignored-plus-retained mutation
  clears them, and live mstatus remains the complete mutation. The test is part of the 12-test lib
  run that passed in `worker/wasm-focused-final.log:16-79` and Main's independent frozen run at
  `main-gates/05-frozen-runtime.log:86-149`.

- **P2 — HELD.** Existing generated static and dynamic partitions now execute bit 8; SUM remains
  retained, and the combined five ignored bits plus SUM still invalidates both publication classes.
  The 38-test parity suite passed at `worker/wasm-focused-final.log:161` and independently at
  `main-gates/05-frozen-runtime.log:231`. Architectural equality and JIT-only counters are asserted
  separately; no interpreter/JIT-counter equality is claimed.

- **P3 — HELD.** The S case executes encoded guest SRET `0x1020_0073` with MPRV=0, checks the
  immediate post-SRET S/SPP0 state before compiled entry, then proves the compiled target, static
  link, and dynamic link execute without loss of authority. Exact architectural state and all RAM
  match the interpreter; JIT reuse is independently asserted. Record:
  `worker/wasm-focused-final.log:29-34`.

- **P4 — HELD.** The U case executes encoded guest SRET into a U-fetchable, already-compiled landing
  block. The BrowserExecutor records an actual U-mode compiled entry before the S-only store faults;
  no stale S side effect, indirect dispatch, or PIC hit occurs, and all inline/static/dynamic
  authority is cleared. Exact trap state (`scause=15`, `sepc=landing`, `stval=DATA`), architectural
  state, and all RAM match the interpreter. Record: `worker/wasm-focused-final.log:23-28`.

- **P5 — HELD.** The delegated STIP sequence uses encoded guest SBI TIME `set_timer(0)` to create the
  source and `set_timer(u64::MAX)` to cancel it. The next real timer boundary derives STIP low while
  STIE remains enabled; there is no direct mip/pending-bit clear. Cause 5 preempts immediately after
  outer SRET and before compiled entry, then encoded nested SRET returns to the saved S target and
  reuses both link classes. Record: `worker/wasm-focused-final.log:35-42`.

- **P6 — HELD.** The critic-owned variant was run only in a git-archive scratch made from frozen
  `84fd5190`. Encoded guest `csrrs x0,sip,x5` asserts delegated SSIP; cause 1 preempts before compiled
  entry; encoded guest `csrrc x0,sip,x5` clears SSIP while SSIE remains enabled; encoded nested SRET
  returns to S/SPP0/SIE1/SPIE1; the compiled static/dynamic chain then executes with unchanged
  authority. Interpreter and JIT architectural snapshots plus all RAM are equal at baseline,
  preemption, guest clear, nested return, and final effect; JIT counters are separate. The single
  targeted test passed at `verifier/ssip-attack.log:83-94`.

  Raw attack log SHA-256:
  `be337c8f8b19f21f35e2eb11ebd7660a706eb597db523b77f6b9bdfbc4e4892e`.
  Reusable promoted patch SHA-256:
  `b126e309c249505837e5bd3c75ae00ca49b5a3e2f05e58d5bf6b993418eb0a3b`.
  The patch passes `git apply --check` against an untouched archive of `84fd5190`; applying it
  produces the exact tested `jit_browser.rs` SHA-256
  `b6d8b61b83baf35b0fb333a2b77f6b379d02162bd35fb78108012cbc084780f3`.

- **P7 — HELD.** Main added SUM bit 18 to the ignored mask only in an isolated git-archive scratch.
  The private exact partition failed (`main-gates/02-sum-sabotage-private.log:137-146`), and the
  generated dynamic SUM control failed with 4 retired rather than 2
  (`main-gates/03-sum-sabotage-dynamic.log:15-20`). Both child commands exited 1. Scratch and shared
  source were restored to frozen digest `62f0599f...` as recorded in
  `main-gates/07-restored-source.log:1-2`.

- **P8 — HELD/CARRIED.** E5-T26m's unchanged M/MTIP, old PMP/SUM/SFENCE, mode/satp/flush/trigger,
  old F/image, and harness boundaries remain carried rather than replayed. Main's frozen scoped gate
  passed 29 native tests plus 12 WASM lib and 38 WASM parity tests, with one unchanged ignore;
  `main-gates/05-frozen-runtime.log` SHA-256 is
  `afdbf4431d99274d09fdcc6e5ba49b23f9b434cf6d530b871afe7b1c69378d96`.

## Evidence and changed-hunk coverage

- The runtime mask and exact-partition hunk execute in the actual-WASM lib matrix and all three
  guest SRET fixtures.
- Every new guest fixture executes in the final 12-test lib record: encoded S-to-S, encoded S-to-U,
  and pending delegated STIP/nested return. Their shared construction, architectural oracle,
  authority observations, and positive/negative assertion paths are exercised across those cases.
- All parity additions execute in the final 38-test parity record: bit-8 static reuse, bit-8 dynamic
  reuse, retained SUM, and the mixed five-bit-plus-SUM invalidation case.
- The new Make target executes through Main's frozen runtime log and resolves to the unchanged
  E5-T26m runtime gate plus the E5-T26n completion marker.
- The generated `web/dist` artifact was loaded by Main's single built demo capture. The capture
  visibly shows E5-T26n in progress and a completed 126/0 suite; JSON records pass=126, fail=0,
  done=126 and empty browser/HTTP error arrays at `demo-84fd5190/demo-suite.json:4-11`. JSON SHA-256
  is `a458cbf70dc97312e4859c43ac23ecfdacd71deb189711fda8536aacd66a5be3`; viewed PNG SHA-256 is
  `9c180395102fa34e02feaabab09468a02f97de467f71c64ff9d0858b18c0420d`.
- Evidence prose/log additions are nonruntime records and are waived from execution. The final-clone
  script is **NEEDS EVIDENCE**, not dead: it must execute once at the final promoted head.
- `verifier/ssip-promoted-test.patch` is the reusable suite artifact. It is proven in the frozen
  archive attack but is not yet part of the shared test head; the final exact-head gate/clone must
  execute it before verdict.

## Superseded serialization mismatch audit

The superseded `sret-check-2.log` compared full serialized CPU objects and differed only in the
cached CSR `time` shadow (values 6 and 8) while both actual CLINT mtime values were 9. The task
does not claim full serialized-CPU equality. Final tests compare the requested architectural PC,
mode, all integer registers, full mstatus, S and M trap CSRs, minstret/mcycle, plus actual CLINT
mtime and all RAM. No clock is normalized or written to manufacture parity. Because the cached
polling shadow is neither live SPP/current-mode authority nor a stated acceptance field, and the
underlying timer source agrees, this mismatch is explicitly scoped out rather than hidden. It is
not a correctness refutation of E5-T26n.

## Promoted-source audit before final clone

Main applied the exact promoted SSIP patch and then ran rustfmt only. Relative to frozen worker
head `84fd5190832924a0f609b4a10d1bfaee2704dc0e`, the resulting source diff is one 103-line insertion:
`browser_guest_sret_pending_ssip_guest_clear_variant` inside the existing private
`#[cfg(all(test, target_arch = "wasm32"))]` module. `Makefile`, parity tests, the mstatus mask, and
all other runtime lines are unchanged. The promoted `jit_browser.rs` SHA-256 is
`0b0830a1ea2f0c979ca4ae662b281b5e6c0044b7ce6964a52715ed887861deb8`.

The formatting claim was independently reproduced without changing shared source: an archive of
`84fd5190` received patch
`b126e309c249505837e5bd3c75ae00ca49b5a3e2f05e58d5bf6b993418eb0a3b`, then standalone rustfmt
for edition 2024. Its result was byte-identical (`cmp` exit 0) to the promoted shared file and had
the same `0b0830a1...` digest. Thus the difference from the already-passing attack source is
formatting only.

The promoted test still contains every predeclared P6 discriminator: encoded guest CSRRS assertion
of delegated `sip.SSIP`; SIE-disabled pending baseline; immediate cause-1 trap with `sepc=LAND` and
no target effect; encoded guest CSRRC clear; architectural SIP low while SSIE remains enabled;
interpreter/JIT equality at baseline, trap, clear, nested return, and final effect; encoded nested
SRET with exact S/SPP0/SIE1/SPIE1 state; unchanged inline/static/dynamic authority before resumed
execution; and separate JIT entry/retire/PIC assertions. No direct mip write or pending-bit setter
appears. **No source or coverage issue is identified before Main's incremental harness and one
final clone.**

## Remaining condition before verdict

**NEEDS FINAL EVIDENCE, not a semantic failure:** freeze the promoted exact head and source/test
digests, record the incremental affected harness, then run Main's one pristine-clone acceptance at
that head so the permanent SSIP test, the five-bit matrix, both encoded SRET mode cases, STIP,
parity, and scoped build gates are all recorded together. The implemented metadata must cite that
exact final record before verdict. No second clone, old F/image/latency run, or new requirement is
requested.
