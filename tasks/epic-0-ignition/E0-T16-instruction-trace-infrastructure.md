---
id: E0-T16
epic: 0
title: Instruction-level trace records — structured, toggleable, canonically serializable
priority: 16
status: implemented
depends_on: [E0-T08, E0-T09, E0-T15]
estimate: M
capstone: false
---

## Goal
Every retired instruction can emit a structured `TraceRecord { pc, insn, rd: Option<(u8,
u64)>, mem: Option<MemOp> }` into a pluggable `TraceSink`, with a precisely specified
canonical text serialization designed to be diffable against a normalized Spike
`--log-commits` log — identical bytes from native and wasm builds.

## Context
This is the observability organ the roadmap promises ("every bug is observable") and the
direct input to E0-T20 and the capstone's byte-for-byte match. Canonical line format
(one retired instruction per line, `\n`-terminated):
`core 0: 0x{pc:016x} (0x{insn:08x})` then optionally ` x{rd} 0x{val:016x}` (omitted when
rd = x0 or no rd write) then optionally ` mem 0x{addr:016x}` for loads or
` mem 0x{addr:016x} 0x{val:0width$x}` for stores. Faulting instructions do not retire and
emit nothing. The Spike normalizer (E0-T20) reduces Spike's output to this same grammar —
the format is frozen here and versioned; changing it later invalidates golden files.

## Deliverables
- `crates/core/src/trace.rs` behind `feature = "trace"`: `TraceRecord`, `MemOp { addr,
  len, is_store, value }`, `TraceSink { fn retire(&mut self, r: &TraceRecord); }`,
  `NullSink`, `VecSink`, and `fmt_canonical(&TraceRecord) -> impl Display` (no_std,
  allocation-free formatting).
- Hart/Machine plumbing: `step` records rd writes and memory ops exactly once per retired
  instruction; `WriteSink<W: io::Write>` in std builds; JSON-lines serializer in the CLI
  crate only (serde stays out of core).
- Committed golden trace: first 40 lines of `loops.elf` execution, hand-verified.
- Format spec: `docs/trace-format.md` with the grammar and the x0/fault/width rules above.

## Acceptance criteria
- [ ] `loops.elf` (first 40 instructions) produces the committed golden trace byte-for-byte.
- [ ] An instruction writing x0 emits no `x0` field; a faulting instruction emits no line;
      a load emits both rd and mem fields in that order.
- [ ] Native and `wasm-pack test --node` runs of the same blob produce byte-identical
      canonical trace strings (test transfers the wasm string out and compares).
- [ ] With `NullSink` (trace feature on) architectural end-state (register file + RAM
      digest) is identical to a `VecSink` run — tracing observes, never perturbs.
- [ ] Tracing 1M instructions into `VecSink` completes; memory cost documented.

## Adversarial verification
(1) Format-drift attack: regenerate the golden trace and `cmp` (not `diff`) — whitespace
or width drift refutes. (2) Perturbation attack: run `memops.elf` twice, trace-on vs.
trace-off, and compare final state digests — any difference refutes the observer property.
(3) Store-value semantics: for `sb` of `0xABCD` the logged value must be the single
written byte `0xcd` with width-2 hex per the spec — check the grammar doc against
implementation character-by-character for each width. (4) Lie detection: instrument a
random 1000-instruction run and re-execute it independently, replaying the trace records
against a fresh machine — any record whose rd/mem claim disagrees with re-execution
refutes (this replay tool is a legitimate verifier one-off). (5) Byte-compare native vs
wasm canonical output for all three golden binaries, not just the tested blob.

## Verification log

### 2026-07-03 — worker claim — commit 35209e2 (branch task/e0-t16-trace-records, stacked on e0-t15)
Deliverables: trace.rs evolves the E0-T15 hook into full records — TraceRecord{pc,insn,
rd:Option<(u8,u64)>,mem:Option<MemOp>}, MemOp{addr,len,is_store,value}, TraceSink::retire(
&TraceRecord), NullSink (always), and behind feature=trace: VecSink, WriteSink<W:io::Write>
(std+trace), fmt_canonical (no_std alloc-free Display wrapper). Hart::execute now returns
(rd,value,Option<MemOp>) — the 11 load/store arms capture the MemOp (addr+len+is_store+
value); step_traced builds the record and calls retire ONLY after execute()==Ok (no record
for a faulting instruction — trap-purity). Machine gained step_traced<T> + htif_exit for
trace-driven runs. ZERO-COST PRESERVED across the trait evolution: check-zero-cost.sh
--selftest still passes (null-sink step erases the whole record build incl. mem capture).
CANONICAL FORMAT frozen + versioned in docs/trace-format.md: `core 0: 0x{pc:016x}
(0x{insn:08x})[ x{rd} 0x{val:016x}][ mem 0x{addr:016x}[ 0x{sval width 2*len}]]`; rules:
faults omit line, x0/no-write omit register field, store value width-masked to 2*len hex,
loads addr-only, field order pc/insn/rd/mem, lowercase zero-padded (cmp not diff).
GOLDEN docs/golden/loops.trace.txt = first 40 retired instrs of loops.elf, HAND-VERIFIED
against loops.S (auipc sp / bss-zero loop / jal main / li a0,0 / sum loop add;addi;blt with
branches correctly emitting no rd). CLI JSON-lines serializer (crates/cli/src/trace_json.rs,
hand-rolled — serde stays out of core; --trace wiring is E0-T18).
Tests: trace_golden.rs (6) — byte-for-byte golden (cmp), x0-omit, load rd-then-mem-no-value,
store-value width-masked at all 4 widths char-exact, OBSERVER PROPERTY (memops.elf trace-on
VecSink vs trace-off NullSink → identical register dump + console output), 1M-record run;
wasm trace.rs — wasm32 canonical trace == committed golden (native==wasm transitively);
CLI json_line shape tests (3 record shapes) + newline-separated sink. E0-T15 trace_retire.rs
+ zerocost.rs migrated to retire(&TraceRecord). Feature matrix intact (all 4 native + 2
wasm32 combos build). Gates: fmt/clippy -D warnings exit 0 / native default+trace 0 FAILED /
wasm 0 FAILED / CI green run 28638769751.
rr: N/A locally (macOS); the trace IS the observability layer rr/Spike diffing (E0-T20)
consumes. Angle 4 (trace-replay lie-detector) + angle 5 (native vs wasm all-3-goldens) are
for the verifier.
