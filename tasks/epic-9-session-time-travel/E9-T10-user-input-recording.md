---
id: E9-T10
epic: 9
title: Record user and host-control inputs at delivery
priority: 524.910
status: evidence-needed
depends_on: [E9-T09]
estimate: S
risk: high
capstone: false
---

## Goal

Capture actual user inputs and host actions as guest-visible ordered events.

## Boundary

UART, keyboard, absolute/relative pointer, resize and offered clipboard/file-transfer ingress through the common delivery queue. Store large payloads by content hash; explicitly gate unsupported input channels.

## Acceptance criteria

- [ ] Record exact delivered bytes/events, including releases, modifiers, pointer mode changes and a file upload, with event clock keys rather than DOM timestamps alone.
- [ ] Repeated input and same-position sequences retain their original order and payload identity across store/reload.
- [ ] Pause/resume/stop boundaries and failed or cancelled transfers produce a documented, replayable prefix; no hidden live input may enter replay.

## Deterministic acceptance

`make verify-E9-T10`. Records the delivery assertions above, independent native/browser object checks, affected native/wasm gates and real browser captures required by AGENTS.md. A passing result must name its frozen source head.

## Adversarial verification

Use rapid typing, focus loss with a held key, duplicate-position pointer events and a cancelled partial upload. Compare guest-observed events and file bytes, not just host event counts.

## Verification log

### 2026-10-18 — worker — started

E9-T09 is independently verified at `3434d69d069dce7a0fdc52162b7a9c21a3db53a9`; its final published catalog and stack head is `b25fb9de9e04b8be20a95ed1747066c1617e49b9`. This high-risk slice records owned, normalized input through the actual device delivery boundary, retaining an explicitly incomplete input prefix until all replay adapters are installed. No implementation or verification claim yet.


### 2026-10-18 — worker — recording-only proof repair

Runtime and original harness freeze: `dc5fab60d1b0e4c6c92bc78169232c9d3622825e`.
Both the worker and pristine-clone risk runs passed all 682 native tests, wasm builds,
protocol checks and the real browser capture: 127/0 suite, exact completed 131129-byte
upload, retained cancelled 65528-byte prefix, unchanged published manifest under a
retention failure, retry and concurrent save/release/stop ending at sequence 77.
Originals: `target/evidence/e9-t10-worker-final-2` and
`target/evidence/e9-t10-cold-final-2/acceptance`.

Their independent object parser then rejected an overly strict harness assumption:
it required the pre-capture UART marker to be the queue's suffix. The UI may also append
its legitimate directory-listing RPC. In both original witnesses the marker is present
and the FIFO receipts reproduce **the entire initial pending queue byte for byte**.
The parser now permits those additional bytes while retaining that exact comparison.
This is a proof gap, with no runtime refutation or runtime change. Only the corrected
parser, proof reuse safety and unrun remainder need new evidence; passed unchanged
runtime checks are carried forward under AGENTS.md's incremental rule. No implemented
or verified verdict is claimed yet.
