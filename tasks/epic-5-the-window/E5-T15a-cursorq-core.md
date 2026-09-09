---
id: E5-T15a
epic: 5
title: Cursorq core state and command handling
priority: 515.1
status: verified
depends_on: [E5-T03c]
estimate: S
risk: high
capstone: false
---

## Goal

Make virtio-gpu cursorq UPDATE_CURSOR and MOVE_CURSOR real, bounded, and canvas-free by maintaining
validated per-scanout cursor state and notifying the host sink when that state changes.

## Boundary

This slice owns command decoding, resource/position/hotspot validation, cursor state lifetime, and
the core callback contract. PNG/CSS conversion and DOM mode selection belong to E5-T15b/c.

## Deliverables

- Cursor UPDATE/MOVE protocol structs and handlers with malformed-chain/error coverage.
- Per-scanout `{ resource_id, hot_x, hot_y, pos }` state with resource 0 hide semantics.
- A canvas-free cursor-state callback and native tests for update, move, hide, reset, and invalid data.

## Acceptance criteria

- A valid UPDATE_CURSOR records resource id and hotspot; a valid MOVE_CURSOR changes only position.
- Resource id 0 hides the cursor; reset clears every scanout without retaining guest buffers.
- Invalid scanout, resource, dimensions, hotspot, and descriptor lengths return a protocol error and
  do not mutate prior state.
- The same deterministic command sequence produces identical state and callback records natively and
  in the wasm build.

## Verification command

`make verify-E5-T15a`

## Adversarial verification

Feed truncated, oversized, and repeated UPDATE/MOVE chains, alternate hide/show 1,000 times, and
attempt to move an unbound scanout. Any state leak, callback reordering, or guest-memory read past
the checked descriptor refutes the slice.

## Verification log

### 2026-09-04 — worker — IMPLEMENTED

- Commit: `dd7b670c295fafe7aa2a90a71c309af93a2fe50a`.
- Exact submission gate: `make verify-E5-T15a` (format check; native core clippy/tests; native
  machine-boundary tests; wasm32 core build/clippy; and `wasm-pack test --node crates/wasm --test
  gpu_protocol`).
- Results: 267 native core tests passed; 3 native machine tests passed; 5 wasm GPU protocol tests
  passed; wasm32 build and both clippy invocations passed with `-D warnings`.
- Evidence: [`evidence/e5-t15a/cursorq-core.json`](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t15a/cursorq-core.json),
  SHA-256 `8da5232b92e9e2052c499abd18a8df28cf89f3914e42997ef64a42aface8ad83`.
- Claim: the recorded native and wasm32 Machine-boundary sequence exercises valid UPDATE/MOVE/hide,
  malformed/truncated input, invalid scanout/resource dimensions/hotspots, and rejected moves without
  state mutation. Both targets publish the same three canonical callback records and eight used-ring
  completions; the native suite additionally exercises reset cleanup and 1,000 alternating hide/show
  transitions with one bounded callback per command. Cursor handling retains ids/coordinates only and
  never retains guest buffers. Independent-machine, WebKit, and host-rr checks are waived per the
  repository policy and the user's explicit direction.

### 2026-09-04 — verifier — VERDICT: verified

- Falsification prediction: the eight-command queue should publish exactly eight used entries, three
  callbacks in order, and leave the hidden state `(resource=0, position=(42,52))` after the rejected
  commands. HELD: native and wasm32 Machine-boundary tests observed those exact values; see evidence
  observations and `crates/core/tests/virtio_gpu_machine.rs` / `crates/wasm/tests/gpu_protocol.rs`.
- Validation prediction: truncated input, hidden MOVE, bad hotspot, invalid scanout, oversized cursor,
  and repeated hide/show must either return the specified protocol error or complete without leaking
  state. HELD: the native direct queue suite checks all errors and the 1,000-transition bound; the
  eight-command wasm32 replay matched the same callback/state result.
- Coverage: HELD. Protocol encoding/decoding, queue dispatch, validation, callback publication,
  reset cleanup, and machine run-loop wiring are all exercised by the recorded tests. The evidence
  digest is `8da5232b92e9e2052c499abd18a8df28cf89f3914e42997ef64a42aface8ad83`; no unexecuted runtime
  hunk remains. SUITE: the native and wasm deterministic tests plus `verify-E5-T15a` are retained.
