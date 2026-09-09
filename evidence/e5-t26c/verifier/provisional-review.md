# E5-T26c provisional verifier report — evidence refresh required

Date: 2026-09-06

No terminal verdict was issued. The task remains `implemented` because the current implementation
is not the implementation identified by the submitted evidence.

## Head mismatch

- Current committed head: `5cf56b74c0c7a6e4fb33a09cdc1165ec334fc747`.
- Worker evidence implementation head: `4233b51b3b4f03186561a91df7469300d376bdc9`.
- Submitted evidence digest still matches its citation:
  `8e8e1debff2c7331353911743feba7b541db62ba9aa77f047bc40b85718bfbcf`.
- The current pre-test runtime portion of `snapshot.rs` has an uncommitted remediation of 62
  insertions and 9 deletions across six hunks. Its unified diff SHA-256 is
  `7ee6313be76f15fe54d5b1682dd66225d26532ad323aa75abe8c7180f43e5d6e`.
- The remediation validates and pre-reserves the full encoded payload, caps the combined staged
  plus pending serialized-event count on encode/decode, and bounds release-frame addition before
  mutating the target.

## Promoted attacks

Five snapshot attacks and one LED attack were added without changing runtime implementation:

- multi-frame order, partial indices, staged work, and public wrapper byte round-trip;
- eight malformed-header/event variants preserving serialized state and the intentionally
  unserialized delivered-key ledger;
- deterministic multiple-key/button release order, idempotence, saved-work precedence, serialized
  release-frame protection, budget eviction, and key-suppression pressure;
- fresh keyboard, tablet, and mouse frames immediately after empty restore;
- exact LED bytes, malformed LED refusal, and a fresh post-restore LED status event;
- combined staged-plus-ring serialized-event cap at 65,536, including atomic encode/decode refusal.

The release-order expectation was deliberately reversed once; the promoted test failed with the
observed order `BTN_LEFT, KEY_A, SYN_REPORT`, then passed after the expectation was restored.

## Results

- Current remediated worktree: `make verify-E5-T26c` passed with 9 snapshot tests, 6 keyboard/LED
  tests, 2 integration tests, both clippy modes, format, and the no-default-features wasm build.
- Current remediated worktree: all 5 promoted snapshot attacks and the promoted LED attack passed.
- Pristine archive of committed head `5cf56b74` plus the serialized-event-cap regression: failed as
  predicted at the encode check, reporting `oversized state encoded as 524376 bytes`. This proves
  the submitted `4233b51` implementation does not contain the behavior now under review.

Required next step: freeze the remediation and promoted tests in a new implementation commit,
rerun and replace the exact-head evidence, then request a fresh terminal verification.
