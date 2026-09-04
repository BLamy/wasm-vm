---
id: E5-T15b
epic: 5
title: Cursor-resource RGBA conversion and CSS/overlay sink
priority: 515.2
status: implemented
depends_on: [E5-T15a]
estimate: S
risk: medium
capstone: false
---

## Goal

Turn a checked cursor resource into a bounded RGBA image for browser presentation, preserving alpha
and hotspot coordinates while providing an overlay fallback when CSS cursor limits are exceeded.

## Boundary

This slice owns resource-to-RGBA/PNG conversion, CSS cursor syntax, hotspot math, and the sink's
bounded CSS-versus-overlay choice. Core cursorq parsing and input-mode wiring are upstream/downstream.

## Deliverables

- Checkerboard-safe BGRA-to-RGBA conversion and deterministic PNG/data-URL encoder.
- CSS cursor descriptor `url(...) hot_x hot_y, none` with checked hotspot bounds.
- DOM overlay descriptor for images larger than the CSS cursor limit, with no guest-memory reference
  retained after conversion.

## Acceptance criteria

- A 64×64 checkerboard round-trips byte-for-byte with alpha preserved.
- Hotspot `(10,3)` appears in the CSS descriptor exactly as `url(...) 10 3, none`.
- 256×256 images choose the overlay fallback; dimensions and all allocation limits are explicit.

## Verification command

`make verify-E5-T15b`

## Adversarial verification

Attack odd dimensions, transparent pixels, maximum/negative hotspots, zero-sized resources, and
malformed pixel lengths. Repeat conversion 1,000 times and inspect that no data URL or source buffer
grows without bound.

## Verification log

### 2026-09-04 — worker — IMPLEMENTED

- Implementation commit: `9f171ab`.
- Exact-head checks: `node --check web/src/sink/cursor.js`; `node --test web/tests/e5-t15b-cursor-sink.test.mjs` — 5 passed, 0 failed; `make verify-E5-T15b` — passed.
- Evidence: [`evidence/e5-t15b/cursor-sink.json`](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t15b/cursor-sink.json), SHA-256 `f086be4ac81af06e05f77ed7c90c20f86613429e2d8c9a69fa47352e3ccd8e9a`.
- Claim: the exact-head proof copies checked virtio-gpu words into alpha-correct RGBA, round-trips a transparent/opaque 64×64 checkerboard through a deterministic PNG byte-for-byte, emits the exact `(10,3)` CSS hotspot descriptor, selects the bounded overlay path at 256×256, rejects malformed dimensions/hotspots/pixels/formats, and keeps only one bounded current descriptor across 1,001 updates.
- Scope notes: DOM mode/lifecycle wiring is downstream in E5-T15c. Per user direction, independent-machine and WebKit proof were not run; host rr is waived by repository policy.
