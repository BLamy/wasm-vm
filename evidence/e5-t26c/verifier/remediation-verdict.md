VERDICT: refuted

Date: 2026-09-06
Submitted head: `be6d61351b0f98930e4200f9df029876dbcfc8ea`
Runtime/test remediation: `7c2a61aec9fe81c46da37bbcd0db279aaaf86d73`
Review range: `4233b51b3b4f03186561a91df7469300d376bdc9..be6d61351b0f98930e4200f9df029876dbcfc8ea`

## Terminal finding

- **P4 release-growth atomicity — FAILED.** Predicted that restoring a valid payload containing
  exactly 65,536 serialized event records over a target with delivered `BTN_LEFT` and `KEY_A`
  would reject the three-record release frame before mutation with
  `TooManyEvents { found: 65539, maximum: 65536 }`. Observed `Ok(InputRestoreReport)` with release
  events `BTN_LEFT up`, `KEY_A up`, `SYN_REPORT`. The new preflight at
  `crates/core/src/dev/virtio/input/snapshot.rs:205-223` adds the release count only to
  `decoded.pending_event_count`; that count excludes staged records and consumed frame prefixes,
  even though encode/decode apply the 65,536 cap to all serialized records. The deterministic
  promoted regression fails at `crates/core/src/dev/virtio/input/snapshot.rs:1010`. Demand: base
  release-growth admission on the decoded total serialized-event count and preserve the complete
  target state/physical ledgers on refusal; do not weaken the 65,536 cap or the release-all frame.

## Predictions and observations

- **P1 exact-head gate — HELD.** Before verifier test edits, `make verify-E5-T26c` at exact HEAD
  `be6d6135` exited zero: 9 snapshot tests, 6 keyboard/LED tests, 2 virtio-keyboard integration
  tests, zero failed/ignored, both clippy modes, format, and wasm32 no-default-features build.
- **P2 evidence binding — HELD with a sufficiency qualification.** The committed and working-tree
  `native-final.json` both hash to
  `cf3f1286da0fe022859e0e455bc11c7805ded038f91e28688303978059105d62`, identify `7c2a61ae`, and
  report the exact gate/counts independently reproduced above. It is a summary, not a raw command
  transcript, so it is corroborative only; no verdict relies on it as the semantic oracle.
- **P3 consumed-record cap — HELD.** The new test constructs a frame whose 65,536 records are all
  consumed (`next == len`, declared pending count zero). Exact-cap encode/decode/re-encode is
  byte-identical; record 65,537 is rejected on encode and forged decode before mutation, and the
  target's unserialized delivered-key ledger remains capable of producing its expected release.
  Command exited zero:
  `cargo test -p wasm-vm-core --lib --features gpu-trace dev::virtio::input::snapshot::tests::verifier_fully_consumed_records_still_obey_total_serialized_cap -- --exact --nocapture`.
- **P5 malformed atomicity — HELD for the promoted cases.** The exact-head gate replayed zero
  length, `next > length`, count mismatch, invalid boolean/reserved bytes, trailing byte,
  truncation, duplicate event and oversized combined-count attacks. The regression also verifies
  the original delivered-key ledger survives refused decode.
- **P6 ordering/protection/fresh input — HELD.** The replay preserved multi-frame bytes, indices,
  staged work and drain order; emitted descending `BTN_LEFT`, `KEY_A`, then `SYN_REPORT`; retained
  the protected release frame through budget/suppression pressure; and accepted fresh keyboard,
  tablet, and mouse frames after empty restore.
- **P7 LED bytes/status — HELD.** The gate asserted exact `[1, 0, 1]` num/caps/scroll bytes,
  rejected a non-boolean without changing the source, and accepted a fresh caps status producing
  `[1, 1, 1]`.
- **P8 coverage/staleness — FAILED only at the refuted runtime boundary.** Encode's validation,
  full-length calculation, one-shot reserve and total cap execute in normal and cap tests;
  decode's total cap executes in both the worker and consumed-prefix attacks. Restore's normal
  preflight executes in release tests, but its claimed total-cap refusal was absent from worker
  evidence and is now disproven. `keyboard.rs` and the remaining `snapshot.rs` additions are
  test-only and all ran. `native-final.json`, prior plans/review, task log and queue are
  evidence/declarative hunks; their hashes, history and generated status were inspected. The old
  `4233b51` digest appears only in the explicitly historical refutation entry; the replacement
  file is not stale. No expected order/LED/cap value is generated solely by the implementation:
  the regression pins the externally claimed limit to literal 65,536.

## Commands

- `make verify-E5-T26c` — pass at exact submitted HEAD before verifier test edits.
- `shasum -a 256 evidence/e5-t26c/native-final.json` and committed-blob hash — both expected digest.
- Full `git diff`/hunk audit for `4233b51..be6d6135`; `git diff --check` scoped to task changes.
- Consumed-prefix cap regression above — pass.
- `cargo test -p wasm-vm-core --lib --features gpu-trace dev::virtio::input::snapshot::tests::verifier_release_growth_at_serialized_cap_is_atomic -- --exact --nocapture` — fail as observed.
- `cargo fmt --check -p wasm-vm-core` — pass after verifier test addition.

## Suite and waivers

Promote both cap regressions. The consumed-prefix test prevents recurrence of the original bypass;
the release-growth test remains red until semantic remediation. Existing promoted malformed,
order/protection, fresh-input and LED tests remain useful and held. Independent machines, WebKit,
and host rr are waived by explicit user/repository policy.
