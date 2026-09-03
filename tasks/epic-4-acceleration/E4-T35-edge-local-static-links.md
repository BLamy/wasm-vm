---
id: E4-T35
epic: 4
title: Edge-local static links for memory-aware traces
priority: 435
status: verified
depends_on: [E4-T34]
estimate: S
risk: high
capstone: false
---

## Goal

Remove dormant cross-module touch overhead and extend only the already-audited SharedReadTlb-safe
intra-block eligibility to useful static cross-module edges.

## Acceptance criteria

- Warm load/store two-module chains execute in one engine call with exact interpreter parity.
- Cold target, precise fault, and SMC unlink/reinstall preserve PC, retired, block, and device counts.
- A fresh short Node run reaches at least 5 logical blocks per engine call before a full run is allowed.

## Adversarial verification

Run Flat-memory rejection, op-zero target miss/refund, target fault, store provenance invalidation,
and an unarmed linked module; the latter must show no link-touch traffic.

## Verification log

### 2026-09-03 — verifier — VERDICT: verified (user-directed local-only closure)

Implementation commit: `6b3cca5`. Detailed evidence: `evidence/e4-t35/README.md`.

- **Warm load/store parity — HELD.** Predicted a linked two-module caller/target chain would retire
  the same eight instructions and leave the same registers and RAM as the interpreter. The Node
  browser parity test observed exactly that, including the data word changing from `5` to `8`.
- **Bounded chain — HELD.** Predicted one warm engine call would cross at least five static edges.
  Six separately installed modules traversed five edge-local links, retired 12 instructions, and
  recorded at least five logical direct-chain entries and links.
- **Cold/op-zero and unarmed target — HELD.** Predicted an unarmed static word would return the
  caller's `BranchTaken` exit without entering the target. The observed exit retired exactly 2
  caller instructions, resumed at the target PC, and left the target register at zero; the final
  unarmed edge in the six-block run likewise returned without an extra target entry.
- **Precise target fault — HELD.** Predicted a fault in the linked target would preserve the caller
  prefix and report the target PC. The observed exit was `Trap`, `next_pc = TARGET`, `retired = 2`,
  with no target destination register write.
- **Store provenance and SMC unlink/reinstall — HELD.** Predicted a raw store to the compiled target
  page would stop before stale target code, identify exactly that page, clear the source link before
  table-index reuse, and allow a republished target to run. The dedicated Node tests observed the
  exact target page frame, a cleared link and removed target, then a successful rearmed execution.
- **Flat-memory rejection — HELD.** Predicted static reservations would have no effect on the
  frozen SoftMMU ABI. The validator-backed translator test observed zero static `call_indirect`
  operations; the inline static test observed zero dynamic virtual-target hash-probe shifts.
- **Coverage — HELD.** The recorded Node suite exercised static translation, slot publication,
  chain guards, load/store slow and fast paths, precise faults, code-page invalidation, target
  removal, table reuse, and reinstallation. The full native core and translator suites also passed.

Per the user's explicit direction, independent-machine, WebKit, and rr host-layer evidence are not
claimed. The full all-features workspace clippy command was attempted but remains blocked by
pre-existing macOS `wvseccomp` libc errors (and, after exclusion, pre-existing `live_blocks` /
`fetch_phys` dead-code diagnostics); the changed crates' strict local gates pass.

Commands:
`cargo fmt --all --check`; `cargo clippy -p wasm-vm-core -p wasm-vm-jit-translate -- -D warnings`;
`cargo clippy --target wasm32-unknown-unknown -p wasm-vm-wasm --lib -- -D warnings`;
`cargo test -p wasm-vm-core`; `cargo test -p wasm-vm-jit-translate`;
`cargo test -p wasm-vm-jit-translate --test batch`; `wasm-pack test --node crates/wasm
--test jit_browser_parity` (`31 passed, 0 failed, 1 ignored`); `bash tools/build-web-dist.sh`;
`git diff --check`.
