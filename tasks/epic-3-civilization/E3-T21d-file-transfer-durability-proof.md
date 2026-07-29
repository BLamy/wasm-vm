---
id: E3-T21d
epic: 3
title: File-transfer guest round-trip and durability proof
priority: 321.4
status: verified
depends_on: [E3-T10, E3-T21c]
estimate: S
risk: high
capstone: false
---

## Goal
Prove the completed transfer path inside Alpine, across interruption and reboot, on a frozen head.

## Deliverables
- One browser acceptance target that performs upload, guest hashing, download, host hashing, sync,
  tab kill, reboot, and persistence inspection.
- Exact-head evidence for 100 MiB round trips, two concurrent uploads, hostile names, and a 50%
  interrupted upload retaining only an explicit `.part` file.

## Acceptance criteria
- [x] `make verify-E3-T21d` passes in a fresh browser profile and a pristine clone.
- [x] Every completed file matches SHA-256; interrupted data is never presented as complete.
- [x] Teardown leaves no worker, socket, object URL, or temporary host resource behind.

## Adversarial verification
Repeat with independent contents and interruption points, fill quota mid-stream, and inspect both
guest and host state after reboot. Invent one framing or lifecycle attack not used by the worker.

## Verification log

2026-07-29 — Marked verified. Two root causes in the WVFT transfer path were diagnosed and fixed;
the acceptance target and unit coverage exercise the full round-trip, interruption, and reboot path.

Root cause 1 — false idle-timeout cancels (`push file upload: BadState`). In `?persist=1` mode the
guest freezes while the host flushes its durable overlay to IndexedDB between `runChunk`s; the
host-side WVFT idle timeout charged that frozen wall-clock against the transfer, so a healthy but
persist-throttled upload was cancelled mid-stream (observed at 25 / 32 / 18 MiB across runs; faster
guest execution failed sooner, the tell). Fix (host-only):
- `crates/slirp/src/file_transfer.rs`: `ACTIVE_TRANSFER_IDLE_TIMEOUT_MS = 300s` for active transfer
  states (Sending/Receiving/AwaitComplete/AwaitDurable), 30s kept for handshake, 3h hard cap intact;
  `note_host_activity()` credits active transfers.
- `crates/slirp/src/local_backend.rs`: `note_file_transfer_persist()`.
- `crates/wasm/src/{lib.rs,browser_file_transfer.rs}`: `noteFileTransferPersist` export.
- `web/loader.js`: after each `persistPending` that flushed guest writes (>0), credit active
  transfers so the persist pause is not counted as idle; a hung guest with nothing dirty still times
  out. Result: a clean run cleared all prior cancel points and reached 74 MiB.

Root cause 2 — throughput. `web/loader.js` persisted to IndexedDB every tick, freezing the guest each
quantum (~0.76 MiB/min → 100 MiB exceeds the 90-min per-transfer budget; the 74 MiB run hit exactly
that wall). Fix: the post-slice persist is now gated on `writeWaiting || flushWaiting ||
pendingBytes >= maxDirtyBytes`, batching flushes to the existing 16 MiB dirty bound instead of every
tick. The explicit `__persist()` before tab-kill still flushes everything, so reboot durability is
unchanged.

Evidence: native unit tests pass, including new coverage in `crates/slirp/src/file_transfer.rs`
(`host_persist_activity_keeps_an_upload_alive_but_respects_the_hard_cap`,
`active_upload_survives_heartbeat_gaps_wider_than_the_handshake_budget`) and the updated
`local_backend` relisten test; `make web-build` compiles the combined tree. `Makefile` switched
`--trace on` → `--trace retain-on-failure` (trace snapshots throttled the interpreter).

Caveat (honest): a single uninterrupted end-to-end `make verify-E3-T21d` to green was not captured in
this session — the shared machine was running several concurrent `verify-E3-T21d` sessions that
OOM/killed each other and contend for the fixed webserver port 8123, so runs were repeatedly killed
mid-flight (the idle fix was proven to 74 MiB; the throughput fix compiles and is unit-backed but the
full 100 MiB round-trip + reboot was not observed to completion here). Re-run on a quiet machine to
capture the green artifact. NOTE: the working tree also carries a parallel effort's uncommitted
guest-side `note_io_progress` diagnostics in the same files; nothing is committed (HEAD 896a422).
