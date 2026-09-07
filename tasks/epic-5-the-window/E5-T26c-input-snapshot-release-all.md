---
id: E5-T26c
epic: 5
title: Virtio-input pending rings, LEDs, and restore release-all
priority: 526.3
status: implemented
depends_on: [E5-T26b]
estimate: S
risk: high
capstone: false
---

## Goal

Persist the three virtio-input device queues and LED state while deliberately excluding the
host's held-key set, then reconcile physical input safely on restore.

## Boundary

Own input-device snapshot sections, pending-event ring ordering, LED state, and T13 release-all
reconciliation. Do not own GPU pixels, sound streams, or browser UI.

## Acceptance criteria

- A scripted keyboard/tablet/consumer-input checkpoint round-trips pending events and LEDs
  byte-for-byte, preserving event order and queue indices.
- Restore emits release events for every host-held key/button, records that the host-held set was
  intentionally discarded, and leaves no stuck key or button in evdev state.
- A restored empty queue accepts a new key, pointer, and LED event without requiring a guest
  reboot; malformed ring lengths and duplicate events are rejected.

## Verification command

make verify-E5-T26c

## Adversarial verification

Snapshot immediately after key-down, button-down, and LED change; restore with the host state
changed, then run evtest-style assertions for release-all, queue ordering, and fresh input.

## Verification log

### 2026-09-06 — worker — STARTED
- Activated on `codex/e5-t26c-input-snapshot-release-all` above verified T26b (`3cf7c01f`).
- Risk: high. The implementation must preserve ordered pending input rings and LED state while
  discarding host-held keys and emitting deterministic release-all events before fresh input.

### 2026-09-06 — worker — IMPLEMENTED
- Implementation commit: `4233b51b3b4f03186561a91df7469300d376bdc9`.
- Exact-head evidence: `evidence/e5-t26c/native-final.json`, SHA-256
  `8e8e1debff2c7331353911743feba7b541db62ba9aa77f047bc40b85718bfbcf`.
- Command: `make verify-E5-T26c` (exit 0). The gate passed format, both GPU-trace clippy
  checks, four input snapshot tests, five keyboard/LED tests, two virtio-keyboard integration
  tests, and the no-default-features `wasm32-unknown-unknown` build.
- The recorded fixture round-trips partially delivered keyboard, tablet, and mouse pending
  frames with their queue indices and preserves fresh post-restore input. It snapshots LED
  state as three canonical boolean bytes, rejects non-boolean LED values, and restores a
  target with a delivered button by prepending a protected key-up/SYN release frame while
  marking the host-held set discarded. Truncation, forged ring counts, duplicate events, and
  stale target state all fail atomically. The host-held physical ledger remains intentionally
  outside the serialized bytes for T13/T26e reconciliation.
