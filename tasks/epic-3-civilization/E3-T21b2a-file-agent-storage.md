---
id: E3-T21b2a
epic: 3
title: Crash-safe guest file-agent storage engine
priority: 321.221
status: in-progress
depends_on: [E3-T21b1]
estimate: S
risk: high
capstone: false
---

## Goal
Implement the filesystem transaction boundary used by the guest WVFT peer without coupling it to
cross-compilation, init scripts, or a boot image.

## Deliverables
- Fixed pre-opened inbox/outbox roots with normalized basename, no-follow, regular-file,
  link-count, and no-replacement checks.
- Streaming partial writes, incremental hash validation, quota/concurrency/timeout enforcement,
  commit records, atomic promotion, directory fsync, interruption outcomes, and startup recovery.
- A source handle that detects mutation/link changes before and after streaming.

## Acceptance criteria
- [ ] A focused native filesystem-model test covers 0 and 100 MiB transfers, every hostile protocol
  name, symlink and hard-link attacks, quota, two concurrent transfers plus a third rejection,
  source mutation, and bounded memory.
- [ ] Deterministic kill-point tests cover every transition before/after rename and directory fsync;
  recovery never exposes incomplete or unvalidated bytes as complete.
- [ ] The storage API contains no absolute-path, URL, command, listener, or destination capability.

## Adversarial verification
Race final-name and link replacement, exhaust quota/concurrency, corrupt every commit-record field,
kill at each visibility/durability boundary, and mutate the held download descriptor. Any
out-of-root access, incomplete final name, false COMPLETE, or unbounded buffering refutes.

## Verification log

### 2026-07-27 — worker — implemented

Commit `972d62c` adds the standalone `wasm-vm-file-agent-storage` crate. Trusted startup opens and
identity-checks fixed inbox/outbox directory descriptors; transfer APIs accept only normalized
basenames, lengths, hashes, chunks, and monotonic time. Uploads stream to exclusive no-follow
partials, reserve shared quota/concurrency, hash incrementally, persist a bounded commit record,
publish with atomic no-replace `linkat`, fsync the directory, and recover or quarantine every
interruption. Downloads hold a no-follow regular-file descriptor with link count one, pre-hash it,
revalidate identity/link metadata during streaming, and independently rehash at EOF.

The deterministic suite covers empty and 100 MiB uploads without engine-owned file buffering,
hostile Unicode/path names (including every Unicode noncharacter class), NFC active-name aliases,
existing/symlink/hard-link attacks, exact offsets, 1 GiB bounds, shared quota, two transfers plus a
third rejection, idle timeout release, cancellation before/after data, in-place source mutation,
all five commit kill points, corrupt record fields, mismatched-final quarantine, private epoch
recovery, and aliased roots. Quarantine names are hidden, bounded, collision-safe, and created with
no-replace linking.

Exact-head evidence:

- `cargo fmt --all --check` — passed.
- `cargo clippy -p wasm-vm-file-agent-storage --all-targets -- -D warnings` — passed.
- `cargo test -p wasm-vm-file-agent-storage -- --nocapture` — 9 passed, 0 failed; the 100 MiB case
  completed in 70.92 seconds.
- `bash tools/verify/e3-t21b2a-capability.sh` — `OK (15 public methods, no
  network/process/path transfer authority)`.
- `cargo check --workspace --all-targets` — passed in 7m16s.
- `git diff 972d62c^..972d62c --check` — passed.

This slice is native filesystem logic and does not change the wasm/demo surface; cross-compilation,
rootfs installation, and browser/boot proof are deliberately isolated in E3-T21b2b/c.

### 2026-07-27 — verifier — VERDICT: refuted

- **P1 held partial identity — FAILED.** Predicted publication would prove that the private
  `.part` pathname still identified the already-open descriptor whose bytes were streamed and
  hashed. After the last DATA, the attack unlinked `.wvft-0000000000000001.part` and replaced it
  with a hard link to an out-of-root file containing `attacker`; `Upload::commit()` returned
  `Ok(())` because it links the pathname without an identity/link-count recheck at
  `crates/file-agent-storage/src/lib.rs:484-486`. The promoted regression fails at
  `crates/file-agent-storage/src/lib.rs:1006` with `commit must reject a partial pathname that no
  longer identifies the held, hashed inode`. Link from the held descriptor (or atomically rename a
  descriptor-identity-verified pathname) and reject any inode/link-count substitution before
  visibility.
- **P2 persistent quota — FAILED.** Predicted retained interrupted partials would remain charged to
  the configured storage quota across restart. A two-byte interrupted partial filled a two-byte
  quota, but reopening `Storage` reset `reserved_bytes` to zero at
  `crates/file-agent-storage/src/lib.rs:177-184`; a new one-byte upload was accepted. The promoted
  regression fails at `crates/file-agent-storage/src/lib.rs:1036` with `retained interrupted bytes
  must remain charged to the configured storage quota`. Recover and account retained artifacts
  before accepting another transfer, or enforce bounded cleanup without promoting them.
- **COVERAGE — INSUFFICIENT.** The worker tests exercised representative hostile names and a
  pre-existing hard link, but did not exercise pathname substitution after validation or retained
  quota across process epochs. Both missing attacks directly cover the task's link-race and quota
  criteria and are now committed as deterministic rejection tests.
- **SUITE:** promoted
  `replaced_partial_name_cannot_publish_unvalidated_out_of_root_inode` and
  `retained_interrupted_partials_count_against_storage_quota_after_restart`. Each fails against
  submission head `666af6e`, so no broad suite, sabotage mutation, workspace gate, or pristine-clone
  proof was run; verifier policy stops expensive proof once correctness is refuted.

Commands:

- `cargo test -p wasm-vm-file-agent-storage
  replaced_partial_name_cannot_publish_unvalidated_out_of_root_inode -- --nocapture` — failed as
  predicted (1 failed).
- `cargo test -p wasm-vm-file-agent-storage
  retained_interrupted_partials_count_against_storage_quota_after_restart -- --nocapture` — failed
  as predicted (1 failed).

### 2026-07-27 — worker — reworked after refutation

Commit `878f802` removes both refuted assumptions. Before publication, the storage engine now
requires the private directory entry to have the exact device, inode, size, type, link count, and
timestamps of the already-open descriptor. Publication itself is bound to that descriptor:
`linkat(AT_EMPTY_PATH)` with a procfd fallback on Linux and `fclonefileat` in the macOS native
model. A pathname replacement after the identity check therefore cannot redirect the final name.

Quota accounting now represents bytes that remain resident, not merely live handles. Each lease
tracks bytes actually written, cancellation and timeout release only the unused reservation,
successful finals remain charged, and startup scans unique regular-file inodes after recovery so
retained partials, records, finals, and quarantine artifacts survive process epochs in the quota.
The verifier's two promoted attacks pass, and an additional regression proves partial and committed
bytes remain charged in-process.

Exact-head evidence:

- `cargo fmt --all --check` — passed.
- `cargo clippy -p wasm-vm-file-agent-storage --all-targets -- -D warnings` — passed.
- `bash tools/verify/e3-t21b2a-capability.sh` — `OK (15 public methods, no
  network/process/path transfer authority)`.
- `cargo test -p wasm-vm-file-agent-storage -- --nocapture` — 12 passed, 0 failed; includes both
  promoted regressions and the 100 MiB streaming case.
- `cargo check --workspace --all-targets` — passed.
- `git diff 8df133f..878f802 --check` — passed.

### 2026-07-27 — verifier — VERDICT: refuted

- **P1 pathname substitution — HELD.** The promoted
  `replaced_partial_name_cannot_publish_unvalidated_out_of_root_inode` regression passed: replacing
  the private pathname before commit is rejected and no attacker bytes become visible.
- **P2 resident quota — HELD.** The promoted restart-quota regression and the worker's new
  in-process partial/final quota regression passed. Restoring the old release subtraction made the
  new regression fail at its first over-quota assertion, so the test detects the repaired behavior.
- **P3 immutable COMPLETE bytes — FAILED.** Predicted that a successful Linux commit would leave no
  writable alias capable of changing the validated final. The Linux publication hunk calls
  `linkat(AT_EMPTY_PATH)` and then a procfd `linkat` fallback in
  `crates/file-agent-storage/src/lib.rs`; both create another hard link to the same writable partial
  inode. An adversary can open the predictable `0600` partial before commit, retain that writable
  descriptor, let commit validate and publish it, and then overwrite the inode through the retained
  descriptor. The final name consequently contains bytes that were never hash-validated while the
  commit record has already declared completion. Publish a separately validated, non-writable inode
  rather than hard-linking the upload inode.
- **COVERAGE — INSUFFICIENT.** The macOS model uses `fclonefileat`, so the worker's native run never
  exercised the Linux hard-link publication boundary that ships in the guest. The promoted
  `linux_final_cannot_be_mutated_through_a_precommit_partial_handle` regression captures the exact
  Linux attack and must pass on Linux before re-verification.
- **SUITE:** carried forward the two previously promoted regressions and added the Linux retained-fd
  mutation regression. Broad and pristine-clone gates were withheld after the semantic refutation.

Commands:

- `cargo test -p wasm-vm-file-agent-storage
  replaced_partial_name_cannot_publish_unvalidated_out_of_root_inode -- --nocapture` — passed.
- `cargo test -p wasm-vm-file-agent-storage
  retained_interrupted_partials_count_against_storage_quota_after_restart -- --nocapture` — passed.
- `cargo test -p wasm-vm-file-agent-storage
  retained_partial_and_committed_final_stay_charged_in_process -- --nocapture` — passed; sabotage
  mutation failed as predicted.
- The Linux-only promoted attack was frozen for the required Linux submission run; the local
  OrbStack/Docker daemon was unavailable.
