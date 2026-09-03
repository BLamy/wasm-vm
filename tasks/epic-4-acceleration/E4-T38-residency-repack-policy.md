---
id: E4-T38
epic: 4
title: JIT residency and repack policy
priority: 438
status: verified
depends_on: [E4-T34]
estimate: S
risk: high
capstone: false
---

## Goal

Measure same-page repack and live-module pressure with identical runtime bytes before choosing a
production cap or repack policy.

## Acceptance criteria

- Compare repack-off, cap-256, and cap-1024 using the exact Node fixture and one policy change per
  run.
- Publish submitted members, compile-pause time, module count, evictions, retranslations, logical
  blocks per engine call, and JIT retired share.
- Keep a policy only when both wall time and churn improve; otherwise close it as refuted.

## Adversarial verification

Churn a smallest-cache workload, invalidate a same-page target mid-run, and verify no stale Function,
Instance, table cell, profile, or metadata accounting survives removal.

## Verification log

### 2026-09-03 — verifier — VERDICT: verified

- **Policy seam — HELD.** Predicted that each accepted label would configure exactly one live
  module cap and that an unknown label would fail before publishing an executor. The wasm wrapper
  test passed **10/10**: `repack-off=24`, `cap-256=256`, `cap-1024=1024`, all new ledger fields are
  present after execution, and `unknown-policy` leaves `hasExecutor=false`, policy `disabled`, and
  cap `0`.
- **Exact fixture and execution — HELD.** Predicted identical input bytes and an exact successful
  process frame in every leg. The Chromium capture passed **1/1** with manifest SHA-256
  `ac6a298883c36d170534a679fd976c5681a20f1fa48ef2d587e6bc124e70b1c1`, the restored snapshot,
  `whole-machine-worker`, zero non-favicon HTTP/console errors, and the exact
  `node -e 'console.log(3)'` frame (`3`, exit `0`). Every leg retired `243,490,289` guest
  instructions.
- **Measured ledger — HELD.** Predicted that the three policy rows would publish wall time,
  submitted members, compile pause, live modules, code bytes, evictions, retranslations, logical
  blocks per engine call, and JIT-retired share from the same before/after run boundary. The
  authoritative JSON records: repack-off `19,434.095 ms`, `2,304` submitted, `165.945 ms` pause,
  `22/24` modules, `441/879` evictions/retranslations, `4.29565` logical blocks/engine call,
  `0.40684` JIT share; cap-256 `17,646.450 ms`, `2,110`, `228.270 ms`, `201/256`, `260/173`,
  `3.80943`, `0.55740`; cap-1024 `17,321.400 ms`, `2,172`, `248.510 ms`, `484/1024`, `0/0`,
  `3.83243`, `0.58128`. The direct JIT pause ledger and existing profile pause ledger agree on
  submitted members and pause deltas in each leg.
- **Production decision — HELD.** Both larger caps improve wall time and cache churn counters,
  but cap-256 records four pauses over the documented 5 ms single-pause target (maximum 13.71 ms)
  and cap-1024 grows compiled code to 36.46 MiB, beyond the documented 32 MiB budget. No larger
  policy is promoted; the existing conservative repack-off/24-module production screen remains.
  The policy experiment is therefore closed as refuted while this measurement ticket is verified.
- **Adversarial coverage — HELD.** The smallest-cache retranslation/handle-bound test passed with
  `--include-ignored`; both same-page invalidation tests passed:
  `browser_inline_static_code_store_cuts_link_before_target_reuse` and
  `browser_inline_static_link_unlinks_and_rearms_after_target_reinstall`. These exercise removal
  of compiled blocks and rearming of the static link/table path rather than trusting the policy
  counters alone.
- **Coverage.** The new policy, stats, loader, main-page, roadmap, wrapper, and browser-ledger
  hunks ran in the focused wrapper/parity and exact three-leg capture. The old `enableJit` fallback
  branch is a compatibility path for older generated bindings and is waived; it remains covered
  by the existing `enableJit` callers. `web/dist` was regenerated from the same source head.

Implementation/evidence commit: `3a92f16`.

Evidence: `evidence/e4-t38/residency-policy-2026-09-03.json` (SHA-256
`70497e0b0b52e2f11f5dafe6f34e1a5d978f2d4ad77a2d8593ff28d928a77257`) and
`evidence/e4-t38/README.md`.

Commands: `cargo fmt --all -- --check`; `cargo check -p wasm-vm-wasm --target
wasm32-unknown-unknown --lib`; `cargo clippy -p wasm-vm-core --lib -- -D warnings`; `cargo clippy
-p wasm-vm-wasm --target wasm32-unknown-unknown --lib -- -D warnings`; `cargo test -p wasm-vm-core
--lib` (**175 passed**); `wasm-pack test --node crates/wasm --test wrapper` (**10 passed**);
`wasm-pack test --node crates/wasm --test jit_browser_parity` (**34 passed, 1 ignored**);
`make web-dist`; the exact Playwright command in `evidence/e4-t38/README.md` (**1 passed**);
the three adversarial commands above; `python3 tools/check_task_policy.py`; `python3
tools/build_queue.py`; and `make tasks-json`. The broad `cargo clippy --workspace --all-targets
--all-features -- -D warnings` remains blocked by pre-existing macOS `wvseccomp` libc API errors
and unrelated all-features dead-code warnings; no T38 source was changed to mask them. rr,
independent machines, and WebKit were not used per the current evidence policy and the user's
explicit direction.
