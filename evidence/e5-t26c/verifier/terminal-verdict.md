VERDICT: verified

Date: 2026-09-07
Submitted exact head: `0dcc764462348e96ef59d89deb325e14747b9704`
Runtime/test commit: `30b7d6936a8cf06a1cd1157ccd45d6f35355c61f`
Inclusive task review range: `4233b51b3b4f03186561a91df7469300d376bdc9^..0dcc764462348e96ef59d89deb325e14747b9704`

## Predictions and observations

- **P1 exact-head gate — HELD.** With `RUSTFLAGS`, `RUST_LOG`,
  `CARGO_ENCODED_RUSTFLAGS`, `CARGO_BUILD_TARGET`, and `CARGO_TARGET_DIR` removed from the
  environment, `make verify-E5-T26c` exited zero at unchanged `0dcc7644`. It ran 11 snapshot
  tests, 6 keyboard/LED tests, and 2 `virtio_keyboard` integration tests with zero failed or
  ignored, plus format, both GPU-trace clippy modes, and the no-default-features wasm32 build.
- **P2 evidence binding — HELD.** Both the working file and `git show
  0dcc7644:evidence/e5-t26c/native-final.json` hash to
  `3fa79264342ebc265dda07042b4b8836c55550780c50bf6c5b6ed6c5d2a96763`. The JSON identifies
  `30b7d6936a8cf06a1cd1157ccd45d6f35355c61f`, which is an ancestor of `0dcc7644`, and its
  command, counts, and outcomes match the independently replayed gate. The only committed change
  above `30b7d693` is the final evidence/task resubmission; no later runtime change is hidden by the
  binding. The JSON is a corroborative summary, not the semantic oracle.
- **P3 cap-exact refusal and target atomicity — HELD.** The promoted
  `verifier_release_growth_at_serialized_cap_is_atomic` test constructs 65,536 records in a fully
  consumed frame (`next == len`, pending zero) and restores over delivered `BTN_LEFT` and `KEY_A`.
  Restore returns exactly `TooManyEvents { found: 65539, maximum: 65536 }`. The target's encoded
  snapshot, non-empty delivered ledger, and now explicitly non-empty suppressed ledger remain
  unchanged. This exercises the repaired preflight at `snapshot.rs:205-234` before
  `take_release_frame`.
- **P4 both cap boundaries — HELD.** The focused verifier replay proved that an exact 65,536-record
  consumed payload round-trips byte-for-byte into an empty target, while record 65,537 is rejected
  atomically on encode and forged decode. The fresh bounded attack
  `verifier_release_growth_that_exactly_reaches_serialized_cap_succeeds` trims the consumed payload
  to 65,533 records, restores it over two delivered keys, and observes successful admission at
  exactly 65,536 after `BTN_LEFT up`, `KEY_A up`, and `SYN_REPORT`. It also proves the physical
  ledgers clear only on success. A deliberate reversed-order sabotage failed with observed codes
  `[272, 30, 0]` against `[30, 272, 0]`; restoring the independent expected order made the test and
  full gate pass.
- **P5 malformed-input atomicity — HELD.** The focused verifier group replayed zero frame length,
  `next > len`, pending-count mismatch, invalid boolean, nonzero reserved byte, trailing byte,
  truncation, duplicate event, and oversized combined staged/frame record attacks. Every refusal
  preserved the target's queue bytes and delivered-key ledger; the cap refusal additionally pins
  preservation of the suppressed ledger.
- **P6 release ordering/protection — HELD.** Multi-key reconciliation emits deterministic
  descending codes (`BTN_LEFT`, then `KEY_A`) and one `SYN_REPORT`, prepends the release frame
  before saved work, clears delivered/suppressed state, is idempotent, survives budget eviction and
  key-up pruning, and suppresses a host re-down until the protected releases drain. These checks
  directly exercise the `PendingFrame::release_all` protections in `input/mod.rs`.
- **P7 fresh input and LEDs — HELD.** Restored empty keyboard, tablet, and mouse devices each
  accepted a new event and drained exactly `[event, SYN_REPORT]`. LED tests pinned canonical
  `[num,caps,scroll]` bytes `[1,0,1]`, rejected byte value `2` without changing the source, applied
  a fresh caps-lock status event, and produced `[1,1,1]`. The two integration tests also retained
  LED status order across queue reset/re-setup.
- **P8 full changed-hunk and staleness audit — HELD.** The inclusive diff and each remediation
  commit were inspected. The Make target executed directly. Snapshot encode/header/frame/index,
  byte-exact re-encode, combined-record cap, validated length reservation, decode/reader malformed
  paths, restored counters/kick state, release admission, ordering, and atomic mutation boundaries
  all map to the exact gate or focused promoted attacks. The `input/mod.rs` API/export, release
  ledger, and protected-frame hunks map to round-trip and pressure tests; keyboard LED codec hunks
  map to exact-byte and status tests. Error/type declarations, comments, test fixtures, task/queue
  metadata, and prior verifier reports are declarative/test/evidence hunks and were inspected rather
  than treated as runtime behavior. `LengthOverflow`/`OutOfMemory` remain defensive checked-arithmetic
  and allocator-failure branches whose deterministic fault injection is outside this task; no
  acceptance claim depends on forcing them. Old `4233b51` and `7c2a61ae` digests occur only in
  explicitly historical entries. Task-scoped `git diff --check` passed; the global check found only
  an unrelated pre-existing E6-T22 trailing-space edit, which was left untouched.

## Commands

- Scrubbed `make verify-E5-T26c` at exact `0dcc7644` — pass, 11/6/2 tests.
- Focused snapshot filter `dev::virtio::input::snapshot::tests::verifier_` — pass, 7 tests.
- Exact LED/status verifier test — pass, 1 test.
- Promoted release-growth refusal plus exact-boundary tests — pass, 2 tests.
- Sabotage run with intentionally reversed release order — failed as predicted; assertion restored.
- Scrubbed `make verify-E5-T26c` after verifier-only test promotion — pass, 12/6/2 tests.
- Working/committed SHA-256 checks, ancestry check, inclusive diff/hunk audit, and task-scoped
  `git diff --check` — pass.

## Suite and waivers

Retain the fully-consumed cap, cap-growth refusal, and new cap-exact success regressions. Together
they pin both sides of the repaired admission boundary and the target-ledger atomicity requirement.
Retain the malformed, order/protection, fresh-input, and LED attacks already promoted by the prior
verifier. Independent-machine, WebKit/browser, and host-rr attacks are waived by repository policy
and the user's explicit scope.
