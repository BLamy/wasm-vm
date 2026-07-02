---
id: E2-T21
epic: 2
title: Browser loading pipeline — fetch kernel and disk image with progress, instantiate WASM
priority: 221
status: pending
depends_on: [E2-T10, E2-T15]
estimate: M
capstone: false
---

## Goal
The browser page's cold-start path: stream-fetch the kernel, initramfs, and disk image
with real progress UI, instantiate the WASM module, hand the bytes to the machine, and
start execution — the scaffolding every browser-side task (T22, T23, T26) builds on.

## Context
Artifacts are large (Image ~20 MB, rootfs up to 512 MB): use `fetch` +
`response.body.getReader()` ReadableStream chunks accumulating into a preallocated buffer
sized from `Content-Length` (handle its absence and `Content-Encoding: gzip` interactions
— a gzipped transfer reports compressed length or none; progress must degrade to
indeterminate, not lie). Serve artifacts with correct `Content-Type` and long-cache
headers + content-hashed filenames (the SHA256 from releases/ doubles as the cache
buster). WASM side: `WebAssembly.instantiateStreaming` with a non-streaming fallback;
module served with `application/wasm`. Memory discipline (32-bit address space): the
rootfs must land in wasm memory exactly once — fetch into a JS ArrayBuffer, then one copy
into the E2-T10 MemBackend via a `wasm-bindgen` `&[u8]` constructor; document measured
peak JS-heap + wasm-memory during load. Run the machine loop off `requestAnimationFrame`
or a chunked `setTimeout` executor for now (workers/SAB are Epic 4; keep the executor
behind an interface). UI: minimal but honest — per-artifact progress bars, bytes/total,
overall state machine (fetching → instantiating → booting), and an error panel that shows
real failure causes (HTTP status, hash mismatch).

## Deliverables
- `web/` page: loader module (TS or JS), progress UI, artifact manifest (URLs + sha256 +
  sizes) generated from `releases/`.
- Integrity check: computed sha256 of fetched bytes vs manifest before boot.
- `tools/serve-dev.sh` (correct MIME types, cache headers) + a Playwright test driving a
  full load to the "booting" state with the busybox artifact set.

## Acceptance criteria
- [ ] Cold load (devtools cache disabled) shows monotonic per-artifact progress and boots
      to the E2-T15 busybox banner rendered in the page (raw pre-xterm.js output is fine).
- [ ] Hash mismatch (serve a corrupted image) produces a visible, specific error — the
      machine must not boot corrupt bytes.
- [ ] Measured and documented: peak memory during a 512 MB image load, number of full
      image copies == 1 on the wasm side.
- [ ] Reload with warm cache skips re-download (verified via devtools network panel /
      Playwright request assertions).
- [ ] Playwright test passes headless in CI.

## Adversarial verification
Throttle to "Slow 3G" in devtools and load: progress must keep moving and the page must
stay responsive (no main-thread freeze > 200 ms during fetch — measure with Long Tasks
API; violations refute). Kill the connection mid-fetch (devtools offline toggle): the
error panel must show a retryable failure, not a hung bar. Serve without Content-Length
(chunked): progress degrades gracefully or the claim is refuted. Memory audit: take a heap
snapshot + `performance.memory`/`wasm memory.buffer.byteLength` after boot with the 512 MB
image and compare against the documented figure — an extra image-sized allocation refutes
the single-copy claim. Load the page twice in two tabs simultaneously — shared nothing,
both must work.

## Verification log
(empty)
