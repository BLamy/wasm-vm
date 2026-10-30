---
id: E9-T09
epic: 9
title: Place recorded events at exact guest execution boundaries
priority: 524.909
status: verified
depends_on: [E9-T01, E9-T02]
estimate: S
risk: high
capstone: false
---

## Goal

Give recording and replay one exact instruction position and ordered delivery mechanism.

## Boundary

The single-hart event clock, ordered queue and bounded run-to-event fence across interpreter and JIT. Host callbacks stage data rather than mutate guest state at unrecorded moments.

## Acceptance criteria

- [x] Equal-position events preserve a monotonic tie-break sequence, including timer delivery and WFI/idle advancement.
- [x] A JIT block cannot run past a pending event boundary; interpreter/JIT and varied run quanta reach identical state at that boundary.
- [x] Counters survive snapshot/restore and values above 2^53; sequence exhaustion or an unsupported scheduling mode fails explicitly.

## Deterministic acceptance

`make verify-E9-T09` records the high-risk native, Wasmtime, wasm32 and built-browser gates at a clean source head, including independent raw-state decoding and the existing checkpoint/GPU regressions. `E9_CLOCK_EVIDENCE_DIR` selects a new output directory.

## Adversarial verification

Deliver events at a block edge, inside a compiled block and across WFI. Vary browser callback order and run quanta; a shifted injection point or duplicated event is a refutation.

## Verification log

### 2026-10-18 — worker — started

Selected from Next up after E9-T08's independent verified verdict and public catalog
publication. High risk: this slice changes execution boundaries and snapshot semantics.
Implement the non-wrapping single-hart clock, owned ordered delivery queue, and exact
interpreter/JIT fences; keep later input logging, observation adapters, and replay in their
own tasks. Record affected native/JIT/wasm gates, deterministic guest-state evidence,
built-browser proof, the retained GPU regression, and one final pristine-clone proof before
submission to a fresh adversarial verifier. No implementation claim yet.

### 2026-10-18 — worker — implemented claim

Runtime candidate: `b75afc6cf7e5037abbf206b838019d228c60a00a`.
Final source/harness head: `be521e3ebca19089471c3b5a22c924916e953187`.
Only the fresh critic's promoted test, its register-index correction, proof retention and
the generated-documentation preflight ordering changed between those heads. Runtime and
committed browser bytes stayed identical: build
`2e6885223bffce8b13f3ba0b5a287e380aa3c615f2f32bc34076cc8d17b4b616`,
Wasm SHA-256 `b07d03ffc0176ced185137f2d6982819765d0bba23b306e62da93a795d309932`.

The common single-hart ICount boundary owns non-wrapping transition/retirement counters,
ordered immutable payloads and delivery receipts. Interpreter and real compiled execution
stop before a pending effect or explicit target; code writes invalidate stale execution.
Paused controls, WFI retirement/idle/interrupt transitions, timer fences, native restore,
values above 2^53 and transactional refusal/exhaustion are covered. Delivered receipts
must drain before a keyframe. The browser exposes a keyboard-accessible boundary check
using actual Wasm/JIT. This completes the common engine and bare-board ABI; Linux input,
observation providers and continuous replay admission remain gated on T10–T14.

Recorded commands and originals:

- `GIT_OPTIONAL_LOCKS=0 E9_CLOCK_EVIDENCE_DIR=target/evidence/e9-t09-worker-final make verify-E9-T09`
  passed all **21** gates at `b75afc6c`: format; clippy for affected crates/all targets;
  core/execution/JIT/native-Wasm tests; no-std wasm32 build and wasm32 clippy; web build,
  protocol, documentation, contract and retained-factory checks; actual boundary browser,
  two-guest checkpoint regression and actual retained GPU boot. Report
  `target/evidence/e9-t09-worker-final/report.json`, SHA-256
  `403cf05f7a082ca0c74c9d58e8a9d2a98ec765bc3bf893f2a72fb4bc7d5db021`;
  **963** original files, compact authenticated copies in `evidence/e9-t09/worker-final/`.
- `GIT_OPTIONAL_LOCKS=0 python3 -u target/e9-t09-cold-wrapper.py` passed the same **21**
  gates plus the promoted critic within `jit-native`, at the final `be521e3e` head.
  Pristine detached source, no Git alternates/inherited target/node_modules, scrubbed
  `RUSTFLAGS`, `RUSTDOCFLAGS`, `RUST_LOG` and all inherited `CARGO_*`/`GIT_*`; the fresh,
  empty compiler target lived on a task-owned RAM volume, while every recording remained
  on persistent storage outside the checkout. Receipt
  `target/evidence/e9-t09-cold-final-3/receipt.json`, SHA-256
  `d430cff9a6fc68119d20e4bc62d04e3923e98ad9747c4607e1229c078ceff4d0`;
  acceptance report SHA-256
  `b9454ecaf1b508645f0c7a1f17fcbbffaa406ca5e36a465b48675ed4d74d33ee`.
  The **964** original acceptance files, exact wrapper/RAM-volume receipt, both early
  failed preflights and corrected critic prechecks are linked from
  `evidence/e9-t09/cold-final/`. Early failures were a generated-doc check before its
  build and a promoted-test `u32`/`u8` compile error; neither changed runtime semantics.
- `GIT_OPTIONAL_LOCKS=0 bash tools/deploy-cloudflare.sh` published the committed dist to
  production and deployment `https://86bbe4ef.wasm-vm.pages.dev`. A stalled unchanged R2
  read failed before the first publication; the successful retry authenticated every
  pinned remote object. Full **734**-file payload: **729** tracked identities, five
  normalized manifests and five exact release extras. Capture receipt
  `target/e9-t09-full-deploy/receipt.json`, SHA-256
  `2b042261bd2d8c2b7b1d8ca0903bfe89276c38595448cb9585ef463337e74ac3`.
- `GIT_OPTIONAL_LOCKS=0 python3 -u target/e9-t09-public.py` passed the actual production
  boundary and retained GPU drivers at `be521e3e`. Report
  `target/evidence/e9-t09-public-final/report.json`, SHA-256
  `07d6410e1d7652be28246870dea0a4210758c7de5bd06439e887e294cdd53ef0`;
  **522** originals, compact packet `evidence/e9-t09/public-final/`, including deployment
  receipt, transport-attempt log and exact helper sources.

The independent worker decoder checks **48** native frames and **28** browser frames
against CPU/PC arithmetic, timer/WFI state, receipts, memory/code writes and wide counters;
**31** native and **12** browser guest traces are retained for the critic's separate
line-by-line interrogation. Built/local, pristine and production browser runs
report **127 passed, 0 failed**, no unexpected errors, **16** boundary cases/**10**
explicit refusals, live pips, keyboard operation and no mobile overflow. The original
and pristine checkpoint regressions boot distinct Alpha/Beta guests and independently
read exact ext4 file bytes after reload/restore/quota/deletion. The pinned 47-file GPU
factory is unchanged; original/pristine/production boots retire real guest instructions
and draw in fresh epoch 4, qualified with no loss/poison. The fresh critic's permanent
six-seed scalar/JIT/pending-restore test executes **709** actual compiled blocks. Its
adversarial verdict remains independent and pending; acceptance boxes are unchanged.

### 2026-10-18 — fresh verifier — VERDICT: verified

Read the task, replay contract and full `2dafe690..b75afc6c` diff before inspecting
evidence. Wrote falsifiable predictions first; the retained prediction history, independent
raw-state decoder, hunk audit, attacks and authenticated receipts are in
`evidence/e9-t09/verifier-final/` (`verdict.json`, `coverage.md`, `manifest.json`).
Carried HELD results forward only after confirming unchanged runtime/dependency boundaries
and artifact digests through `be521e3e` and the metadata-only `e44ed547` submission.

- **P1/P14 identity and pristine proof — HELD.** Independently hashed all 963 worker,
  964 cold acceptance and 522 production artifacts, and matched all source identities to
  their declared Git objects. Cold receipt `d430cff9a6fc68119d20e4bc62d04e3923e98ad9747c4607e1229c078ceff4d0`
  and acceptance report `b9454ecaf1b508645f0c7a1f17fcbbffaa406ca5e36a465b48675ed4d74d33ee`
  bind a clean detached `be521e3e` checkout, no alternates/inherited target or node_modules,
  scrubbed environment and a proven empty compiler target. All 21 gates passed, including
  the corrected permanent critic. All 119 bare-guest frames/traces are byte-identical to
  the original held evidence. Earlier documentation-preflight and test-cast failures are
  retained; their final complete rerun passed.
- **P2/P3 exact compiled fences and owned order — HELD.** Independently decoded all
  48 native/28 browser frames and checked all 31 native/12 browser traces against arithmetic
  and PC predictions. Real Wasmtime/browser blocks execute, stop before targets 600/601/605,
  and deliver equal-position immutable bytes once in admission order despite differing
  callback/run quanta. The mailbox-only code mutation executes at
  `worker-final/native/jit-mailbox-q1024.trace:218` (relative to `evidence/e9-t09/`, SHA-256
  `d2721d3eb2d6c3138b03e6ecea9eefbb160dba117019a6d09a1b3e88d5a77126`);
  its native frame ends at transition/retired 1000 with x2=1573, marker `later` and sequence2.
- **P4/P5/P12 timer, WFI and restore — HELD.** The timer oracle predicts and observes
  transition592/retired591, mtime197 and handler PC `0x80002000`;
  `worker-final/native/jit-timer-q31.trace:207`, SHA-256
  `cc830071629fbe612fa39bd6b4785581bfe0dca2f94eac1667dcc0d46863029e`,
  ends at the preceding retirement. WFI record
  `worker-final/native/jit-wfi-q7.trace:217`, SHA-256
  `03a78b741422c50136a627c6f6a331be175d19639d8882fd6f10eef023321587`,
  is followed by separate idle/interrupt positions 602/603 while retirement stays601.
  Restored pending idle state agrees. Twelve additional seeded divider/deadline/reversed
  pending-control cases prove both inhibited retirement and nonretiring idle/IRQ behavior.
- **P6/P11/P13/P15 precision and refusal — HELD.** Independently checked
  9007199254740993→9007199254740996 positions, exact receipt sequence9007199254740994,
  MAX transition/sequence/ordinal limits, paused controls and 23 malformed/inactive/step
  refusals without destination mutation. Checked 256-event and 4MiB owned-byte limits
  before/after delivery, exact outbox backpressure and capacity release on drain. A warmed
  compiled CSR-observation loop matches independently counted pre-retirement values at five
  stops, exercising bounded interpretation of observable blocks. Unsupported scheduling
  and an unbound event clock in the checkpoint-only Linux envelope refuse explicitly.
- **P8/P9a independent attack and sabotage — HELD.** Six independent seeds, variable
  block lengths, nonmonotonic target admission, self-modifying writes, independent scalar
  PC/register arithmetic and pending-queue restore matched at every stop/receipt; 709 real
  compiled blocks ran. In an ignored core copy, disabling only the seek fence makes the
  unchanged new test fail at `crates/core/tests/e9_event_clock.rs:171`: transition1000,
  expected10, exit101 (`seek-fence-sabotage.patch`, `sabotage.log`). P9a replaced the larger
  planned JIT-specific mutation before execution; that abandoned mutation is not claimed.
- **P7/P10 browser, regressions and coverage — HELD.** Built/pristine/production runs
  show 127/0, 16 boundary cases, 10 explicit refusals, live pips, keyboard activation, no
  mobile overflow and errors[]. The two-guest ext4/file/RAM/input/quota/deletion regression
  passes. Authenticated all 734 deploy payloads and 11 actual production responses; public
  capture `07d6410e1d7652be28246870dea0a4210758c7de5bd06439e887e294cdd53ef0` binds
  9 current and 58 current/archive GPU assets. The pinned47 factory remains unchanged and
  public guest retirement/current-epoch draw is qualified, not lost or poisoned. Every
  changed runtime hunk has executing evidence; `coverage.md` gives the narrow declarative,
  diagnostic and unavailable-admission waivers. No ignored test/debug-disable addition or
  unproven runtime hunk remains.
- **SUITE.** Promoted `crates/jit-runtime/tests/e9_event_clock_critic.rs` (SHA-256
  `8216a282f29db856f37848df1aa1023d5614ece23b4e8c9df6b690ada270a02d`) into
  `make verify-E9-T09`; final cold clippy and execution pass. Retained original traces,
  frames, browser profiles and all failed/passing receipts. After audit, released only
  reconstructible checkouts and the task-owned RAM compiler volume; cleanup receipts are
  retained. No runtime implementation changed during verification.

Commands: the recorded `make verify-E9-T09` gauntlets and production drivers above; independent
`inspect_frames.py` raw-frame/trace checks; the retained standalone six-seed native attack;
`node target/e9-t09-verifier/wasm-{negative,wfi-attack,observe-attack,mailbox-bounds}.mjs`;
unchanged core fence test against the isolated sabotage. Linux provider capture/continuous
replay and accelerated replay admission remain gated to their successor tasks. No merge.
