---
id: E5-T09b
epic: 5
title: Virtio-gpu dirty-tile upload planner
priority: 509.2
status: verified
depends_on: [E5-T09a]
estimate: S
risk: high
capstone: false
---

## Goal

Track which 64x64 tiles became dirty through TRANSFER_TO_HOST_2D and intersect them with the
coalesced flush plan so a cursor blink or one-cell update uploads only the necessary bytes.

## Boundary

This slice owns the core dirty bitmap, transfer marking, flush intersection, tile clipping, and
upload-byte accounting. It does not own rAF/timer scheduling or browser DOM wiring.

## Deliverables

- A 64x64 tile-grid planner sized from the current resource dimensions.
- TRANSFER marking and flush intersection that clips partial edge tiles and clears only consumed
  dirty state.
- Deterministic counters for selected tiles, uploaded bytes, and full-frame comparison mode.

## Acceptance criteria

- A full-screen flush after one 1x1 transfer selects only the intersecting 64x64 tile, while a
  full-screen transfer selects every required tile and reports exact byte counts.
- Boundary rectangles crossing `x=63,w=2`, the right/bottom edge, and a mid-frame resize select
  the same tiles as an independent cell-mask reference and never select outside the resource.
- Repeated transfer/flush cycles do not retain stale dirty bits; disabled-tiling mode produces the
  same final shadow bytes and exposes a comparable full-frame counter.

## Verification command

`make verify-E5-T09b`

## Adversarial verification

Run 10,000 seeded transfer/flush sequences with random resource sizes and compare selected upload
regions and final shadow bytes against a reference planner; fail on any stale tile or byte-count
drift.

## Verification log

### 2026-09-04 — verifier — VERDICT: verified

- P1 tile selection — HELD. Predicted a 1x1 transfer would select exactly its containing 64x64
  region and a full-resource transfer would select the complete row-major grid; the focused tests
  observed both with exact selected-tile and byte counters.
- P2 boundaries and lifecycle — HELD. Predicted `x=63,w=2`, right/bottom edge tiles, out-of-range
  rectangles, partial edge clipping, flush intersection, and resize would never select outside the
  resource or retain old bits; explicit tests and the seeded 10,000-operation transfer/flush/resize
  reference planner held those predictions.
- P3 A/B shadow correctness — HELD. Predicted tiled and full-frame planning would preserve the
  same host shadow bytes across boundary transfers; `gpu_transfer_tiled_and_full_frame_plans_keep_shadow_bytes_identical`
  passed and verified the expected tile regions for each cycle.
- P4 changed-code coverage — HELD. Predicted all new planner methods and the Resource transfer/flush
  seam would execute; the six planner unit tests, the Resource parity test, the existing GPU
  tracking test, and the full core suite covered the changed paths (263 passed, 0 failed).
- P5 target build — HELD. Predicted the bounded bitmap and public plan types would compile for the
  wasm target; `cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown` passed, and the
  generated browser wasm bundle was refreshed in the implementation commit.

Exact final implementation head: `f97aaab0628946ff481495fe5a2cd2de09ed01a7`.
Exact acceptance command: `make verify-E5-T09b`.
Evidence: `evidence/e5-t09b/dirty-tiles.json` (SHA-256
`32d9d03ff4babdae8ee3f2739c07f319452432a451a90a2cd223563f311ed745`), whose recorded head,
proof-file digests, and five passing commands match this claim. Scope follows the task boundary and
user direction: browser scheduler/DOM wiring is reserved for T09c–T09e; independent machines,
WebKit, and host rr were not required.
