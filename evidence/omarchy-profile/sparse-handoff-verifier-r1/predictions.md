# E5.5-T03be adversarial predictions

Written before opening worker evidence on 2026-10-01. Fresh verifier session;
the verifier did not implement this task. Read AGENTS.md, the complete task,
and `git diff ec178d57..2f9b5b36` first. Runtime candidate under examination:
`2f9b5b36ec91b2d3540cc710e0587e209dc8a6e8`. No tests, builds, timings, or other
CPU-heavy work are authorized until the worker releases the quiet machine.

## P0 — provenance and bounded diff

Prediction: source/artifact receipts identify baseline main `0a5f7bd7` and
candidate `2f9b5b36`; baseline core runtime is identical to parent `ec178d57`.
The only changed production Rust hunk is
`XRegs::jit_commit_words_mask` in `crates/core/src/hart/regs.rs`. Public handoff
layout, generated code, PC ownership, chaining policy, clocks, and snapshot
serialization are unchanged. Frozen-head, served artifact, and recorded source
hashes must agree with their actual bytes. A stale or unidentifiable recording
fails provenance. Build/test-only source additions are not runtime changes.

## P1 — independent mask and transport oracle

Prediction: the shared native/wasm full-array fixture executes 10,534 masks
(six named masks, 32 one-bit masks, 496 two-bit masks, 10,000 varied masks).
After each commit, x0 is zero; selected x1..x31 equal that round's distinct
full-width source words; every unselected word retains its previous value;
PC remains `0xffffffff80000000`; the source handoff bytes are unchanged.
Native and wasm runs produce the same independently recomputable state digest.
Stamp increment is exactly one iff `mask & 0xfffffffe != 0`, even when a selected
word already equals its old value. Empty and x0-only masks increment zero.

## P2 — highest bit, dense path, and stamp wrap

Prediction: starting at stamp `u64::MAX` with zero words, masks 0 and 1 leave
every word and the stamp unchanged. Committing all-ones words with mask
`0x80000003` sets x1 and x31 to `u64::MAX`, leaves x0/x2 zero, and wraps stamp
to zero. A following `u32::MAX` commit sets all writable registers, preserves
x0, and advances stamp to one. Both full masks `0xfffffffe` and `0xffffffff`
must take the existing bulk copy with exactly one stamp increment.

## P3 — bounded real compiled execution and guest state

Prediction: cumulative budgets `[0,1,2,3,31,127,128,129,4096,4097]` retire
8,614 instructions for each register-loop fixture. Each resume snapshot must
equal the independently run interpreter snapshot, and the recorded trace must
account for exactly 8,614 retired instructions. Compiled block count is positive.
Final explicit expectations with initial `xN = u64::MAX-N`:

- x0-only loop: x31 remains `0xffffffffffffffe0`, x0 stays zero, PC `DRAM_BASE`.
- x31 loop: x31 = 4,275, x1 unchanged, PC `DRAM_BASE`.
- x1/x7/x31 loop: x1 = 2,152, x7 = 2,146, x31 = 2,121,
  PC `DRAM_BASE+8`.
- dense x1..x31 loop: x1 = 268, x6 = 263, x7 = 261, x31 = 237,
  PC `DRAM_BASE+24`.

The no-CLINT fixture proves this boundary only. Production-module benchmark
evidence must separately match baseline/interpreter CPU, CLINT, clock, and RAM
state, so removing the timer cannot conceal a changed production clock result.

## P4 — precise fault prefixes

Prediction: `bulk_handoff_preserves_all_registers_and_virtual_pc_on_precise_fault`
returns `LoadAccessFault` with tval `0x50000000` and next PC `0x40001078`;
caller-owned PC stays `0x40001000`; x1..x29 equal seed+1, x30=`0x50000000`,
x31 retains its seed, x0 stays zero. In same-module and cross-module FP direct
successors at budget 6 with a fault: retired=4, next PC=`DRAM_BASE+16`, x5=0,
x14=1, x31=1, x11=x13=99, fflags=17; no state after the fault commits.
Budgets 2 and 3 must preserve the documented zero/three-instruction prefixes.

## P5 — paired measurement and real-workload gate

Prediction: timing records contain raw alternating baseline/candidate pairs,
unmeasured state assertions, excluded warmups, real compiled instruction counts,
and matching guest state. I will independently recompute each arm's median and
the median of per-pair speed ratios; these need not equal one another.
Repeated sparse browser measurements must improve (harness's prespecified gate
is paired speedup >1.02). Dense outcomes and real busybox boot/shell measurements
must not demonstrate a material regression. Missing real-workload measurements
are a proof gap. Native handoff microbenchmarks do not establish native emulator
or general Omarchy responsiveness gains.

## P6 — gates, isolation, and delivered page

Prediction: final-runtime-head logs show affected acceptance, native core/JIT,
wasm build, and browser fixtures passing. `make ci` failures may be waived only
where an untouched baseline reproduces the same macOS limitation. A scrubbed
pristine clone at the final runtime head must pass the acceptance command.
Roadmap text must state only the measured handoff outcome; committed dist,
local/live page artifact hashes, ISA suite completion, zero relevant console
errors, screenshot, and Cloudflare publication must refer to the delivered
candidate. Publication evidence may be supplied after runtime verification.

## P7 — coverage and harness credibility

Prediction: each changed production branch is exercised by an identifiable
deterministic recording: empty/x0, sparse iteration (including bit31 and multiple
bits), full-mask bulk copy, and non-empty stamp. No ignored tests or disabled
debug assertions have been introduced. Independent oracle computation does not
call the production commit method for its expected state. Metadata/comments,
benchmark reporting, and build recipes can be waived with explicit reasons;
unexecuted runtime code cannot.

## P8 — new bounded attack and sabotage

Prediction: an independently seeded register-mask composition attack will hold
for rotating missing-register masks, complements, all dense/sparse transitions,
repeated identical values, and poisoned x0 sources. Two disjoint mask commits
must equal one union commit in architectural words/PC while their stamps differ
by exactly the number of nonempty commits. Clearing each bit from a dense mask
must preserve precisely that excluded destination, including x31.

Sabotage prediction: a scratch-only mutation that drops bit31 or includes x0,
or corrupts the full-mask stamp, must make the new regression fail. The product
runtime and branch will never be edited for sabotage; preserve the mutant input,
test output, and original source hashes as verifier evidence. If permissions
exclude any scratch mutation, request the worker to produce that sabotage and
verify the recording instead.

All predictions are currently PENDING. Results will be recorded as HELD,
FAILED, or NEEDS EVIDENCE with exact file/line or digest citations.

## Candidate revision notice — before inspecting results

The worker reports that expanded density measurements reject runtime
`2f9b5b36`: paired sparse speedup 1.0088 fails the harness's >1.02 gate,
half-dense 0.9851, and near-dense 0.9314. The verifier has not inspected the
recorded raw results yet and does not accept this candidate. Preserve these
measurements as rejected-candidate evidence; do not overwrite their artifacts.

The worker proposes a new frozen candidate with early empty/x0 return, full
mask bulk copy, set-bit iteration for at most eight writable dirty registers,
and a retained scan for other densities. Before reading that candidate's
evidence, add the following branch predictions to P2/P7/P8:

- Masks with zero writable bits take no write/stamp path; x0 does not contribute
  to the density decision or write set.
- Exactly eight writable bits, including bit31 and alternating low/high indices,
  use sparse iteration; exactly nine use the scan. Both copy exactly their
  selected words and increment once, with and without a poisoned x0 bit.
- All 31 writable bits take the full copy, preserving x0 and incrementing once.
  Every 30-bit writable mask preserves its single excluded register exactly.
- Rotating contiguous masks of every writable population 0 through 31, repeated
  with x0 toggled, produce equal architectural state and stamp outcomes in the
  untouched baseline and the new candidate. Same-value commits still increment.
- Recompute performance for all advertised density shapes and preserve the
  original sparse gate; a performance regression cannot be excused by a passing
  correctness oracle. No held result is claimed for uninspected new evidence.

The new runtime hash and exact diff remain to be supplied. All CPU-heavy work
continues to wait for the worker's explicit release of the quiet machine.

## Frozen r5 predictions — 29980ba5

Read `git diff ec178d57..29980ba5` before inspecting r5 final evidence. The
runtime is the proposed empty/full/sparse<=8/fixed-slice-scan selection with
`#[inline(always)]`. P0 must now match this exact frozen runtime instead of the
rejected 2f9 candidate. P1's fixture now has 64 additional density cases, making
10,598 masks total. All architectural and stamp predictions remain unchanged.

The task now makes its non-regression thresholds explicit: repeated sparse
paired speedup >1.02, every density paired speedup >=0.98, and real workloads
>=0.95. The original sparse gate is unchanged. I will recompute these gates
from raw measurements and will not treat a single passing screen as repeated
proof. Source/harness equality must relate the screening and final recordings.
If retained, the precise fault/resume fixtures must also be recorded in actual
headless Chrome; Node's BrowserExecutor tests will be cited as wasm/Node tests.

## Restored final outcome — e925f992

After r5's identical-source/artifact repeat missed the unchanged sparse gate,
the worker restored production at `e925f9923ab0edcfde82b69ea7a3c75d0bfcd9cd`.
Read the final task and diff before testing this head. The final claim is a
negative investigation, with no retained performance optimization. P5 is HELD
only as a reproducible rejection of the candidates; it cannot substantiate a
speedup. All original numerical rejection criteria remain intact.

Final restoration prediction: the complete production portion of regs.rs before
`#[cfg(test)]` matches parent ec178d57 byte-for-byte, and the rebuilt shipped wasm
matches main and parent SHA256
`f8b40d93039a9bb454250df40592e8c1d62144cac600bdcd82ea74098d7bb516`.
The net Rust source hunk is a test. No rejected source change may survive in the
served artifact. The final report, roadmap, and task must consistently say no
additional speedup was retained.

The promoted independent composition attack will check 5,952 cases (three
independent nonzero xorshift seeds, 32 writable populations, 31 rotations, two
x0-bit settings). Each split mask and its complement must produce the same final
registers as a full mask with exact independent selected-word assertions at the
intermediate state; their mutation stamps must count nonempty commits, including
same-value repeats. PC and source bytes remain unchanged. A scratch-only bit31
mutation must be rejected by a new regression. Production sources remain frozen.

## Resolution

`VERDICT.md` records the final outcomes with citations. P0–P4 and P6–P8 are HELD
for the restored final code and retained evidence. P5's retained-optimization
eligibility is FAILED by the decisive recordings; the negative-investigation
conclusion is HELD. Earlier density-branch implementation predictions are no
longer final-runtime claims because every candidate was removed. No open proof
gap remains for the final scoped claim.
