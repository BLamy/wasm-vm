---
id: E0-T16
epic: 0
title: Instruction-level trace records — structured, toggleable, canonically serializable
priority: 16
status: verified
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

### 2026-07-03 — adversarial verifier (fresh session) — VERDICT: refuted
- P1 format-drift — HELD. Regen byte-identical to committed golden (cmp), git clean; trace_golden 6/6.
- P2 observer (all 3 goldens) — HELD. trace-on (VecSink+step_traced) == trace-off (NullSink via run) on regs+console+exit for hello/loops/memops (identical dumps, console bytes, Exited(0)).
- P3 store-value width grammar — HELD. Char-by-char mask value&((1<<8*len)-1), width 2*len; sb 0x00→"0x00", sd 0x5→16 digits; confirmed LIVE in memops trace (sb 0x80/sh 0xbeef/sw 0xdeadbeef/sd 0x0123456789abcdef).
- P4 LIE DETECTION — HELD (records truthful). 248 real retired instrs (hello 83, loops 48, memops 117) all truthful via independent reg-diff (rd) + opcode-decode/memory-readback (mem). ld x14,0x5c(x14) (rd==rs1) logs LOADED value not address; 25 stores/18 loads consistent; x0-target + branches correct.
- P5/P6 native vs wasm all 3 — HELD. native==wasm for hello(83)/memops(117)/loops(golden).
- P7 zero-cost — HELD. --selftest exit 0; null-probe asm has ZERO call/bl; no MemOp/TraceRecord leaked into the NullSink path.
- COVERAGE — REFUTED. Mutations: (a) unmask store value → RED; (b) always-emit x0 → RED; (c) fire-on-trap → RED (trace_retire.rs). SURVIVORS: (D) store logs ADDRESS not value → committed suite GREEN; (E) drop mem field on stores → committed suite GREEN. Root cause: NO committed test EXECUTES a load/store and asserts the emitted record's mem field — store_value_is_masked/load_emits_rd_then_mem operate on HAND-BUILT records (test fmt_canonical, not the hart's 11 capture arms); loops.trace has no mem lines; observer/1M execute the path but assert nothing about mem. Same shape as E0-T15 Mutation C. DEMAND: execution-level mem golden/assertion.
- MOCK/HONESTY — clean. Golden spot-check vs Docker objdump (auipc sp / addi t0→0x68 / add a0,a0,t0 / blt-no-rd) all match; no self-licking; CLI json shapes match doc; cold clone scrubbed.
- NOVEL — independent replay lie-detector (reg-diff for rd, opcode-decode+readback for mem, never reusing the crate decoder) + exit-code observer arm + all-3 wasm parity. All held; exposed D/E.
- SUITE: promote an execution-level mem assertion (memops golden OR the lie-detector probe) — makes D/E red. discard nothing.

### 2026-07-03 — rework after refutation (worker)
Applied the demand: added crates/core/tests/trace_mem_exec.rs (feature=trace) — EXECUTES
sb/sh/sw/sd through the hart and asserts the emitted MemOp{addr,len,is_store,value} at
every width; executes ld (incl. rd==rs1) and asserts rd=loaded-value + mem=non-store at
the effective addr; loads at every width; a compute op asserts mem=None. Re-ran the
verifier's exact survivors: Mutation D (sd logs address) KILLED, Mutation E (sd drops mem)
KILLED, plus a load-drops-mem variant KILLED; each reverted, hart/mod.rs clean. The
hand-built-record fmt tests remain (correctly scoped as fmt_canonical unit tests). Gates:
clippy exit 0, full crate (default + trace) 0 FAILED. Status implemented; re-verification
requested.

### 2026-07-03 — adversarial verifier (re-verification) — VERDICT: verified
- (a) Mutation D (stores log addr `a` not the reg value) — RED, killed by executed_stores_record_masked_value_at_every_width; Mutation E (drop mem on all 4 store arms) — RED, same test. Both reverted clean.
- (b) Invented Mut 1 (Sh captures len:4 not len:2 — width lie) — RED, same test. Invented Mut 2 (store addr drops the immediate: capture r.read(rs1) not ea(base,imm)) — SURVIVED at imm=0 only; benign single-source (one `a=ea(base,imm)` feeds both capture and bus access). RESIDUAL noted.
- (c) trace_mem_exec.rs genuinely executes: hand-encodes i_type/s_type words into RAM and calls hart.step_traced, capturing via the One sink — binds to the real capture arms (impl-only mutants flip it red), not hand-built records.
- (d) fmt tests in trace_golden.rs correctly scoped as fmt_canonical unit tests (TraceRecord literals); no double-count with execution coverage.
- (e) cargo test --features trace fully green (0 FAILED workspace-wide: trace_mem_exec 4/4, trace_golden 6/6, trace_retire 3/3); check-zero-cost --selftest exit 0, null path still trace-free.

### 2026-07-03 — residual closed (worker)
Hardened trace_mem_exec.rs: store cases now use imm=0x20 and the load-widths case imm=0x18,
asserting addr == ea(base,imm) = DATA+imm. This kills the one benign survivor (capture base
instead of the effective address). Re-ran: trace_mem_exec 4/4, full --features trace 0 FAILED.
E0-T16 VERIFIED.
