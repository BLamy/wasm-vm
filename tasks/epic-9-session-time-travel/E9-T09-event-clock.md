---
id: E9-T09
epic: 9
title: Place recorded events at exact guest execution boundaries
priority: 524.909
status: implemented
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

- [ ] Equal-position events preserve a monotonic tie-break sequence, including timer delivery and WFI/idle advancement.
- [ ] A JIT block cannot run past a pending event boundary; interpreter/JIT and varied run quanta reach identical state at that boundary.
- [ ] Counters survive snapshot/restore and values above 2^53; sequence exhaustion or an unsupported scheduling mode fails explicitly.

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
