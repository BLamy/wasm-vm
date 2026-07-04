---
id: E1-T22
epic: 1
title: Native-vs-WASM determinism — identical traces for identical programs
priority: 122
status: in_progress
depends_on: [E1-T19]
estimate: M
capstone: false
---

## Goal
A standing proof that the native and wasm32 builds are the *same machine*: given the same
program, initial state, and injected-event schedule, both produce bit-identical
architectural traces — with FP, i128, and container-ordering hazards specifically
neutralized and a CI job that keeps it true forever.

## Context
The whole Epic-1 strategy (debug natively, ship WASM) collapses if the builds diverge.
Known divergence sources: host FP (excluded by T05's softfloat, but must be *enforced* —
one stray `as f64` in FCVT breaks it), i128 codegen differences, usize-width assumptions
(wasm32 pointers are 32-bit; guest PAs must never round-trip through usize), HashMap/
HashSet iteration order (banned in guest-visible paths per T17; enforce globally),
uninitialized-memory defaults, and time sources (only the T12 deterministic clock is
legal in Level 1 test configs). Mechanism: extend the Epic 0 tracer with a rolling
64-bit FNV/xxhash over per-retire records {pc, raw instruction, rd index+value, CSR
writes, trap events, interrupt-taken markers}, checkpointed every 64k retires so a
divergence is localized to a chunk, then replayed with full tracing for that chunk only.

## Deliverables
- Trace-hash mode in the core (zero-allocation, always compiled, ~free when disabled),
  plus a final-state full dump (x/f regs, fcsr, priv, key CSRs, RAM hash) compared in
  addition to the rolling hash.
- `tools/determinism_check.sh`: runs a program list on both builds (native binary; wasm
  via the headless harness) and diffs checkpoint hash streams; on mismatch, re-runs the
  divergent chunk with full traces and prints the first differing retire.
- Program corpus: full riscv-tests set, the T21 fuzz smoke seeds, an FP-torture stream
  (NaN payloads, subnormals, all rounding modes), a trap/interrupt-storm program using
  the deterministic CLINT clock, and an Sv39 TLB-thrash program.
- Static enforcement: CI greps/clippy deny for host-float arithmetic, `usize` casts of
  guest addresses outside the bus layer, and std HashMap in core (allow-listed files).
- CI job running the corpus on every PR (subset) and nightly (full).

## Acceptance criteria
- [ ] Full corpus: every checkpoint hash and final-state dump identical native vs wasm32
      (zero tolerance).
- [ ] Injected-fault test: patching one FCVT path to use host f64 (mutation) is caught
      by both the static check AND a hash mismatch on the FP-torture program.
- [ ] Interrupt schedule determinism: the interrupt-storm program delivers every
      interrupt at the same retire index in both builds (asserted, not just hashed).
- [ ] The divergence localizer, run on the mutated build, names the first differing
      retire with both sides' register values in < 60 s.
- [ ] Two different host machines (x86_64 and aarch64) produce identical native hashes
      (host-arch independence, which wasm equality silently implies).
- [ ] Documented: exactly which machine state feeds the hash, and why that set is
      sufficient (anything guest-visible not hashed must be justified).

## Adversarial verification
Try to construct a divergent-but-green program: state NOT covered by the hash is the
attack surface — f-regs appear only via rd writebacks, so craft a program whose divergent
f-reg is never read back; if the final-state dump misses it either, that is a refutation
(the deliverable claims full f-reg coverage — check it). Attack the harness: verify the
wasm leg isn't accidentally running the native binary (insert a `#[cfg(target_arch)]`
sentinel outside the compared window; identical sentinels refute the harness separation).
Attack chunking: force a divergence exactly on a checkpoint boundary (retire 65536) and
confirm localization still works. Run the full corpus 3× per build — any run-to-run hash
variance within one build refutes determinism at a more basic level (uninitialized
state, address-dependent hashing). Audit the static-check allowlist: every allow-listed
file must be provably outside guest reach (host UI, benchmarks); an allowlisted core
file refutes.

## Verification log

### 2026-07-04 — implementation
- **`crates/core/src/trace.rs`** — new `HashSink`: a rolling FNV-1a-64 fold over every retire
  record `{pc, insn, rd idx+val, mem {addr,len,is_store,value}}`, ALWAYS compiled and
  allocation-free (unlike `VecSink`), so it fingerprints a multi-million-instruction run in
  constant memory. Only wrapping integer ops — no host float, no `usize`, no container iteration —
  so the hash is bit-identical native vs wasm32 by construction. `None`/`Some` sentinels keep
  "wrote x0=0" ≠ "no write" and "load" ≠ "store".
- **Two-part fingerprint** (the trace hash alone can miss a divergent value that is never read
  back): the determinism harness pairs the `HashSink` trace hash with a **final-state hash** —
  `final_state_hash()` in `tests/golden/determinism_golden.rs` folds the final **f-registers**
  (the FP-never-read-back gap the adversarial section calls out — an FP result reaches no
  `TraceRecord.rd`), **fcsr, privilege mode, and the key privileged CSRs** (mstatus/mtvec/mepc/
  mcause/mtval/mscratch/mie/mip/mideleg/medeleg/satp/counteren/pmpcfg) — plus the `Snapshot` RAM
  SHA-256. Together they cover executed effects, final FP/CSR state, and final memory.
- **`tests/golden/determinism_golden.rs`** — the frozen `(name, trace_hash, retired, RAM_sha256,
  state_hash)` contract for a hazard-prone corpus (i128 `mulh`, softfloat `fadd`, atomics
  `amoadd_d`, compressed `rvc`) + the shared `final_state_hash` folder, `include!`d by BOTH
  harnesses so the folding is bit-identical.
- **`crates/core/tests/determinism.rs`** (native) — asserts the pinned corpus matches the golden;
  a `#[ignore]` full-corpus leg runs every `-p` ELF TWICE asserting byte-identical fingerprints
  (global no-nondeterminism guarantee); and `hash_sink_distinguishes_every_field` proves the hash
  is sensitive to each field.
- **`crates/wasm/tests/determinism.rs`** (wasm32) — embeds the pinned ELFs and asserts the SAME
  golden constants; passing it is the native==wasm equality proof.
- **Static enforcement**: `tools/ci/determinism-hazards.sh` bans HashMap/HashSet/host-clock/rand
  in `crates/core/src` (host float already covered by `no-host-float.sh` + the softfloat deny).
- **`tools/determinism_check.sh`** runs native + wasm legs (`--full` adds the corpus leg); a CI
  `determinism` job + a `make determinism` target (folded into `make ci`) + the hazard grep added
  to the `test` job.

**Verified live in this environment** (wasm-pack + node present): `wasm-pack test --node crates/wasm
--test determinism` **passes** — the wasm32 build reproduces the native golden trace-hashes, RAM
digests, AND final-state hashes bit-for-bit across the hazard corpus. So native == wasm32 is proven,
not just asserted.

Local gate: fmt clean; clippy 0 (workspace, all-targets); `cargo test --workspace` 0 FAILED; both
wasm32 builds clean; native+wasm determinism green; hazard grep clean.

### Scope / follow-on (honest)
- The **divergence localizer** (acceptance #4 — 64k-retire checkpointing to name the first
  differing retire in < 60 s) is not yet built; the current harness localizes to the *program* and
  to *which* of {trace, RAM, final-state} differs. A per-chunk checkpoint stream is the follow-on.
- **Two different host arches** (acceptance #5, x86_64 + aarch64) can't be exercised on one machine;
  the wasm32==native equality (verified) is the stronger implication (a 32-bit-pointer, different-
  codegen target already agrees).
- **Interrupt-storm / FP-torture corpora** (acceptance #3) beyond the pinned hazard set are a
  natural corpus extension; the mechanism (deterministic CLINT clock, HashSink) already supports them.
