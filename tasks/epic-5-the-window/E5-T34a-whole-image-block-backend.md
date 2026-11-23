---
id: E5-T34a
epic: 5
title: Whole-image single-fetch block backend for the browser runtime
priority: 0.3871
status: in-progress
depends_on: [E5-T31]
estimate: S
risk: medium
capstone: false
---

## Boundary

Design (2026-11-23, from `web/loader.js` and `crates/wasm/src/http_fetch.rs`): the
desktop paths (worker mode, virgl) require the chunked boot, and chunked manifests
already support the single-file `blob` layout (`chunk_request` uses `Range`). Add an
opt-in **whole-image prefill** to chunked mode:

- **Loader:** before boot, one streamed request fetches the whole blob (served
  gzip-compressed and decoded with the browser's native `DecompressionStream`) into
  a JS-side buffer outside wasm linear memory, so it does not compete with guest RAM.
  It checks the declared size and SHA-256 of the decompressed image.
- **Wasm:** the fetch layer gets an optional local image source. When it is set,
  `fetch_one` takes the chunk's byte range from it, verifies it with
  `manifest.verify_chunk`, and inserts it without any network request. A hash
  mismatch is a hard error. Counters distinguish local from network chunks.
- **Unchanged:** worker and virgl boots, overlays, persistence, boot profiles, and
  every profile that does not opt in (all keep lazy loading).

## Deterministic acceptance

A Playwright run of the built page boots the Alpine chunked image in prefill mode.
It must record exactly one network request for the disk image, zero chunk or
`Range` requests during boot, and every chunk served locally with hashes verified.
It must reach the same guest login or ready marker as lazy mode, with zero console
errors and the unchanged live ISA suite total. Native/wasm unit tests cover the
local-source path: hit, hash mismatch, and size mismatch.

## Adversarial verification

Medium risk: check the acceptance criteria against recorded evidence and run one
bounded novel attack.

## Verification log

(empty)
