# E5-T26p fresh-verifier pre-results plan

Status: frozen before admission of any E5-T26p candidate result, compiled artifact, test
output, browser capture, clone result, sabotage result, or implementation diff.

Verifier independence: this session did not implement E5-T26p. Luna owns the two core
runtime files and new `retirement_capture` tests. Main owns the retained baseline/candidate
compiled-artifact proof, independent baseline outcomes, gate, one demo capture, and one
final clone. This verifier will inspect supplied evidence and the exact owned diff; it will
not treat an implementer summary as evidence.

## Frozen scope and anchors

- Source baseline: `d7d308a58825e6856db532822e36e1681230027a`.
- Retained baseline web runtime WASM SHA-256:
  `20f58e0d44cc94f9d0629478789680e4a87345ba800162aa0737ddc763bfd238`.
- Narrow design SHA-256:
  `8f493e2b1196abcdfa94164819d17d5500de793276dcd3f225b03ecf1ad70891`.
- Critic preflight SHA-256:
  `de0d2d43ee454e604384b13601dd56c3af6fcfcd848bdadeea43d7f17047d897`.
- The only optimization claim in scope is elimination of returned retirement-metadata work
  from the unit capture used by actual `Hart::step` and `Machine::run`, including its
  ordinary and cached interpreter dispatch. There is no F, Omarchy, browser-latency,
  guard, timing, clock, or budget claim.
- Public `step_traced`/`run_traced`, including a custom sink whose `wants_records()` is
  false, remain recording paths. `wants_records()` continues to govern JIT admission only.
- `exec_oracle` uses the candidate's shared semantics and is therefore never an independent
  baseline. Its compatibility can be covered, but candidate-vs-`exec_oracle` agreement is
  not acceptance evidence.
- No prior E5-T26f/F proof is rerun or rebound. No image, clock, budget, guard, timing,
  TraceSink API, JIT policy, snapshot, ISA, independent-machine, or Epic 6 scope is admitted.

## Phase order and stop rule

1. Admit provenance and the exact owned diff, without running anything.
2. Inspect matched optimized native and actual-WASM artifacts first.
3. **STOP** before broad gates, the demo, the final clone, or another F boot unless both
   native and actual-WASM evidence demonstrate eliminated return-buffer/retirement-metadata
   work on the reachable unit paths, while recording paths remain a positive control.
4. Only after artifact admission, inspect the retained-baseline semantic matrix, focused
   native/WASM results, isolated sabotage, scoped gate, single demo, and single final clone.
5. Render a verdict from exact-head evidence. Missing or ambiguous proof is
   `needs-evidence`; conclusive absence of the required elimination or a semantic mismatch is
   `refuted`.

Nothing in this plan authorizes this verifier to run tests, builds, a browser, a clone, or
sabotage at the current stage.

## Compiled-artifact admission criteria

Artifact evidence is admissible only if all of A1-A7 hold.

### A1 — reproducible identity

For baseline and candidate, and separately for native and WASM, the evidence must record:

- exact source commit/tree and dirty-overlay digest, if any;
- identical proof-harness source digest on both sides;
- dependency lockfile digest;
- exact `rustc`, Cargo, LLVM, wasm-bindgen/wasm-pack and binary-inspection tool versions as
  applicable;
- target triple, profile, features, `RUSTFLAGS`, link/LTO/codegen settings and complete build
  command;
- original artifact path, byte size, section sizes and SHA-256.

The native comparison must be native machine code. The WASM comparison must inspect the code
section of the actual `wasm32-unknown-unknown` artifact used by the relevant WASM caller, not a
native proxy, WAT reconstructed from source, or a symbol-reference scan. The retained WASM
digest above must be tied to a named artifact and its provenance; a bare matching hash is not
enough.

### A2 — actual caller-to-callee reachability

Each side must identify, by native address/symbol and WASM function index/name mapping, the
actual reachable chain for:

- `Hart::step` unit ordinary dispatch;
- `Machine::run` unit ordinary dispatch;
- `Machine::run` unit cached dispatch;
- `Hart::step_traced` recording positive control;
- `Machine::run_traced` ordinary and cached recording positive controls.

Disassembly must include the caller and the specialized execute/capture callee. If inlining,
ICF, or LTO removes a named boundary, the evidence must map the inlined region and its call
site unambiguously rather than substituting a source-level argument. Synthetic probe wrappers
alone do not prove the actual production caller.

### A3 — mandatory unit-path elimination

For both native and actual WASM, the candidate unit path must eliminate observable generated
work used only to return retirement metadata `(rd, value, Option<MemOp>)`: no return-area
traffic, stores/copies/packing, or construction/branch whose sole consumer is that retirement
metadata. A legitimate return area or discriminant for the still-required `Result<_, Trap>`
contract may remain and must be distinguished instruction-by-instruction from retirement
metadata storage; its mere presence is not a failure. Internal `rd`, `value`, successor PC and
successful-store range calculations that still drive architectural writeback or reservation
effects are not claimed removable.

The comparison must count and annotate the relevant instructions/stores in baseline and
candidate at the reachable caller and callee, not merely show that a constructor or trace
symbol disappeared. Elimination must be demonstrated on both ordinary and cached unit
dispatch; proving only one is insufficient.

### A4 — recording positive control

The candidate recording specializations must remain reachable and must still materialize and
deliver exact `TraceRecord` data. Native and WASM evidence must show the recording caller/callee
path retains the return/capture work absent from the unit path. A custom false-requesting sink
must not be folded into the unit specialization merely because `wants_records()` is false.

### A5 — one semantics body

The owned source diff must contain one instruction match and one architectural commit. Capture
policy may specialize only the returned representation and private dispatch. No instruction
arm, store operation, trap path, counter action, or writeback may be duplicated between unit
and recording modes. Source inspection establishes this structural condition; it does not
replace A1-A4's generated-code proof.

### A6 — explicit code-size tradeoff

The report must give baseline and candidate bytes for the relevant native text and WASM code
sections, each identified caller/callee, and whole artifacts. It must separately state:

- bytes removed from unit caller/callee work;
- bytes retained in recording paths;
- bytes added by capture-mode specialization or duplicated machine code;
- net native and WASM artifact deltas.

There is no invented byte budget and no speed inference. A size increase is reported as a
tradeoff; it does not excuse failure to demonstrate the mandatory elimination.

### A7 — artifact decision

- Both targets show A3 and A4 with unambiguous A1/A2 provenance: proceed to semantics.
- Proven no elimination on either target: stop and refute the candidate.
- Missing, mismatched, source-only, symbol-scan-only, or ambiguous evidence: stop with
  `needs-evidence` and name the absent caller/callee view.

## Precommitted semantic state vector

For every retained-baseline/candidate case, compare the exact terminal tuple:

`(RunOutcome or raw Trap, all x registers, all raw f registers, PC, privilege/CSR state,
counter state and suppression flags, reservation, RAM bytes/digest, ordered MMIO transcript,
trace callback transcript, code-write/invalidation observations)`.

Guest traces and state digests must be bound to fixture, baseline/candidate source, mode,
artifact and SHA-256. Candidate recording-vs-unit agreement is a useful cross-check but is
not the independent oracle; the authoritative expected tuple is retained from the baseline
binary at the frozen source.

## Falsifiable predictions

Each prediction is evaluated independently as `HELD`, `FAILED`, or `NEEDS EVIDENCE`.

### P1 — routing and public compatibility

Only actual `Hart::step` and `Machine::run` choose unit capture through private ordinary or
cached dispatch. `Hart::step_traced`, `Machine::run_traced`, arbitrary sinks, and
`exec_oracle` choose recording semantics. The exact diff contains no TraceSink/object-safety or
JIT-admission reinterpretation and no second instruction match.

### P2 — independently retained 2 x 2 interpreter matrix

With JIT disabled, ordinary/cached x recording/unit candidate cases equal their corresponding
independently retained baseline tuples byte-for-byte. The matrix must exercise actual
`Machine::run`/`run_traced`; direct calls to a new shared executor or comparison with
`exec_oracle` cannot stand in for it. Direct `Hart::step`/`step_traced` fixtures additionally
cover their public routing.

### P3 — false-requesting custom sink remains observable

For successful direct and run-loop traced execution, a custom sink returning
`wants_records() == false` receives the same callback count, order and payload as the retained
baseline in both ordinary and cached modes. On a trapping instruction it receives no retire
callback. Its false request permits compiled JIT admission but never suppresses interpreter callbacks or
select unit capture.

### P4 — retirement, x0 and counters

For a successful integer instruction, architectural writeback and successor PC match baseline;
a destination of x0 remains zero and recording emits `rd: None`. `retire_tick` occurs exactly
once after successful execute and never on a fault. Writes to `mcycle`/`minstret` retain their
own-instruction suppression behavior, while ordinary instructions increment the same counters
as baseline. Ordinary/cached control-flow seams (sequential, taken/not-taken, jump/return) and
WFI/xRET outcomes remain identical.

### P5 — scalar and FP successful-store ranges and metadata

For successful `SB/SH/SW/SD`, recording reports lengths `1/2/4/8`, the effective address and
the full integer source value retained by baseline. For `FSW`, it reports length 4 and the raw
low 32-bit FP payload zero-extended to `u64`; for `FSD`, length 8 and the raw 64-bit payload.
All report `is_store: true` and `rd: None` where no integer destination exists.

An overlapping successful scalar/FSW/FSD store clears an existing reservation; a
nonoverlapping successful store preserves it. Unit mode performs the identical reservation
effect despite producing no metadata. RAM bytes, PC, counters and MMIO order equal baseline.

### P6 — ordinary/FP faulting stores do not become successful effects

A faulting scalar or FP store emits no record, does not advance PC or retirement counters,
writes no RAM, and does not run successful-store overlap invalidation. Its reservation state and
ordered MMIO transcript equal the retained baseline. Tentative recording metadata, if any, is
not evidence of a successful store.

### P7 — SC timing is distinct from overlap invalidation

- Misaligned `SC.W/SC.D` traps before reservation consumption: reservation and memory remain
  unchanged, with no record or retire tick.
- An aligned SC with a matching reservation consumes the reservation before its fallible store.
  If that store access-faults, the reservation is therefore `None` even though memory, rd, PC,
  counters and trace remain unretired/unchanged.
- An aligned SC reservation mismatch retires with rd = 1, writes no memory and consumes the
  prior reservation.
- A successful SC retires with rd = 0, writes the requested width, leaves reservation `None`,
  and records one successful store (`len` 4/8 and baseline value semantics).

The aligned access-fault result must not be explained by the success-only overlap tail. An
isolated successful-store sabotage must not alter this pre-fault SC prediction.

### P8 — LR and AMO semantics

LR success installs the exact address/width reservation and records a non-store memory op;
misalignment/access faults do not install one. Successful AMO.W/AMO.D returns the old value
(including W sign extension), writes the computed new value, records that new value at width
4/8, and clears only an overlapping reservation. A nonoverlapping successful AMO preserves it.
AMO misalignment/access faults produce no successful-store effect, memory write, retire record,
PC/counter advance, or reservation invalidation beyond independently retained baseline effects.

### P9 — misaligned and physical cross-page writes

Supported misaligned scalar/FP writes preserve baseline bytes and trace metadata. A successful
write crossing a physical page boundary updates both page fragments in order and causes both
physical frames to appear in the write/invalidation evidence; recording still emits one memory
operation with the original effective address and full width. Faulting cross-page cases match
baseline partial/no-effect rules exactly and never fabricate retirement.

### P10 — ordered MMIO effects

For scalar, FP, LR/SC and AMO fixtures that reach MMIO, the complete ordered read/write/fault
transcript matches the retained baseline in all four modes. Equality of final RAM alone is
insufficient. Recording metadata describes the retired architectural operation and never changes
bus call count or order.

### P11 — SMC, DMA, cache drain and FenceI

After a successful cached guest store into code, physical write logs are drained after retirement
and stale decoded/compiled entries and cursor state are invalidated exactly as baseline. A
cross-page code write covers both pages. DMA between bounded runs is drained before reuse of a
saved cursor. `FenceI` retains its existing cursor/note behavior. Unit capture cannot gate any
drain, and faulting stores cannot masquerade as successful writes.

### P12 — traps and raw compressed tval

Fetch/decode/execute faults preserve the baseline raw trap cause and `tval`. An illegal compressed
instruction reports its original zero-extended 16-bit parcel, not its 32-bit expansion. No trap
emits a retirement record or advances PC/retirement counters. Ordinary and cached paths agree.

### P13 — native and actual-WASM caller semantics

Focused native and actual-WASM fixtures invoke the public caller paths identified in A2 and hold
P2-P12 for their assigned cases. Passing a host-native proxy, source constructor test, trace-symbol
scan, or two candidate modes compared only to each other does not satisfy this prediction.

## Required path/behavior coverage ledger

The evidence index must map every owned runtime hunk to at least one row below and to a concrete
fixture/result location.

| Public path | Dispatch | Capture | Required observation |
|---|---|---|---|
| `Hart::step` | ordinary | unit | direct successful and trapping retirement |
| `Hart::step_traced` + recorder | ordinary | recording | exact positive-control records |
| `Hart::step_traced` + false-requesting custom sink | ordinary | recording | observable callbacks retained |
| `Machine::run` | ordinary | unit | real run-loop outcome/state |
| `Machine::run` | cached | unit | real cached execute plus unconditional drain |
| `Machine::run_traced` + recorder | ordinary/cached | recording | exact records and terminal state |
| `Machine::run_traced` + false-requesting custom sink | ordinary/cached | recording | callbacks retained with JIT disabled |
| `exec_oracle` | shared recording semantics | unit public return only | compatibility coverage; never baseline |

Behavior coverage must include successful and faulting integer/FP stores, LR/SC/AMO,
overlap/nonoverlap, misaligned/cross-page, x0, counters, compressed trap tval, ordered MMIO,
SMC, DMA, control flow and the cache drain. Every changed executable hunk must be executed or
classified as `needs-evidence`, `dead`, or narrowly `waived` with a reason. Types/configuration may
be waived only when they contain no runtime behavior. Any duplicated instruction match is a
structural failure, not a coverage waiver.

## Evidence-source rules

- Baseline outcomes must come from a binary built from the frozen baseline and an identical,
  digest-bound external fixture. Expected values may not be generated through candidate capture
  types or `exec_oracle`.
- Candidate-vs-candidate parity, source constructor counts and `tools/check-zero-cost.sh` are
  supplemental only. The existing zero-cost selftest remains a later gate but is not A3 proof.
- Every artifact/result must identify exact head, command, exit status and digest. A summary with
  no raw output or caller/callee citation is not admitted.
- No old seal, prior F result, timing sample, or implementation-owned assertion is promoted to an
  independent oracle.

## Later bounded checks, only after artifact admission

The later evidence set must contain, without this verifier initiating it at the planning stage:

1. Focused `retirement_capture` native and actual-WASM caller/callee fixtures covering the ledger.
2. The critic-named native targets:

   `cargo test -p wasm-vm-core --features trace --test hart_memory --test trace_mem_exec --test trace_retire --test rv64a --test rv64f --test rv64d --test predecode_diff --test predecode_smc_diff --test zicntr`

3. The critic-named actual-WASM targets:

   `wasm-pack test --node crates/wasm --test hart_mem --test jit_browser_parity --test rv64a --test rv64f --test rv64d --test mmio -- --nocapture`

4. Relevant format/clippy/WASM build, the existing zero-cost selftest, and the scoped
   `make verify-E5-T26p` result at the frozen candidate head.
5. One isolated scratch-copy sabotage of the successful-store reservation effect. Removing or
   corrupting the overlap range must make the focused overlap test fail for the intended reason;
   the untouched source hash must be restored and recorded afterward. The sabotage does not alter
   SC's pre-fault consumption arm.
6. Main's single built-demo capture showing 126 passed, 0 failed and zero non-favicon
   browser/HTTP errors.
7. Main's one pristine local clone at the final frozen source. No second clone, WebKit run,
   broad F boot, deployment, or production publication.

## Verdict discipline

- Any semantic mismatch to the independent baseline, lost false-sink callback, changed SC fault
  reservation state, missed successful-store overlap, duplicate semantics, or proven absence of
  required native/WASM elimination is `FAILED` and refutes the candidate.
- Missing provenance, missing mode/path coverage, an unexecuted owned hunk, or ambiguous generated
  code is `NEEDS EVIDENCE`; it does not authorize broad reruns.
- Only unchanged dependency boundaries with matching evidence digests may carry a prior `HELD`
  result forward.
- Verification can be declared only when A1-A7, P1-P13, complete hunk coverage, the isolated
  sabotage, scoped gates, one demo and one final clone all hold at the same frozen candidate head.
