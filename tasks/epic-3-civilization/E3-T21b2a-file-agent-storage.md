---
id: E3-T21b2a
epic: 3
title: Crash-safe guest file-agent storage engine
priority: 321.221
status: implemented
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
