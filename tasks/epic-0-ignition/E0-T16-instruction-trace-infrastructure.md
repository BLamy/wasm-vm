---
id: E0-T16
epic: 0
title: Instruction-level trace records — structured, toggleable, canonically serializable
priority: 16
status: pending
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
(empty)
