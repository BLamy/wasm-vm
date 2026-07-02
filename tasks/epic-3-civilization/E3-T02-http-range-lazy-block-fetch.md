---
id: E3-T02
epic: 3
title: Lazy chunk fetching over HTTP with Range and streaming support
priority: 302
status: pending
depends_on: [E3-T01]
estimate: M
capstone: false
---

## Goal
The VM boots from a chunked image fetched on demand: a guest disk read touching an absent
chunk triggers an HTTP fetch (per-chunk file for `split` layout, `Range: bytes=` request for
`blob` layout), verifies the hash, and completes the pending virtio-blk request when the
bytes arrive. No full-image download, ever.

## Context
This wires T01's format into the browser. The core crate exposes an async `ChunkSource`
trait; the wasm layer implements it with `fetch`. virtio-blk requests must be able to stay
in-flight: the used-ring completion for a read is deferred until the chunk resolves, without
blocking the emulation loop (Epic 2's device model must already tolerate async completions —
if it doesn't, fixing that is in scope). Handle the ugly HTTP realities: a server that
ignores `Range` returns 200 with the full body (detect via status != 206 and abort or
degrade explicitly, never silently buffer 400 MB); CORS on a CDN origin; concurrent guest
reads hitting the same chunk must coalesce into one fetch (in-flight dedup map).

## Deliverables
- `ChunkSource` trait (core) + `HttpChunkSource` (wasm layer, `fetch` via `web-sys`),
  supporting both manifest layouts, hash verification on arrival, in-flight dedup.
- Deferred virtio-blk completion path: read requests park until chunk resolution; ordering
  of completions per virtqueue documented in code comments.
- Retry policy: N retries with backoff on network error / hash mismatch, then a typed
  permanent error (surfaced later by T25).
- Native tests with a mock `ChunkSource` (delayed/failing responses); a browser integration
  test page booting Alpine from the chunked image served by the dev server.

## Acceptance criteria
- [ ] Alpine boots to login in the browser from the chunked image; DevTools network tab
      shows only per-chunk (or 206 Range) fetches, no full-image request.
- [ ] Total bytes transferred to reach the login prompt is under 40% of the image size
      (recorded number goes in the log).
- [ ] Two simultaneous guest reads of the same absent chunk cause exactly one fetch
      (assert via fetch-count instrumentation).
- [ ] A 200-instead-of-206 response on `blob` layout produces a typed error, not a hang or
      a silent full download.
- [ ] Hash-mismatched chunk triggers refetch, then hard error after retries — guest sees an
      I/O error, VM does not panic.

## Adversarial verification
Serve chunks through a throttling/faulting proxy: inject 500s, truncated bodies, and
corrupted bytes on random chunks mid-boot — any wasm panic, hung boot with no error, or
silently wrong data read by the guest (compare a file's sha256 inside the guest against the
source image) is a refutation. Point `blob` layout at a server with Range disabled and
confirm the explicit error path. Issue 64 concurrent reads over the same chunk and check the
fetch counter. Verify the used-ring is never completed with a buffer that failed hash check.

## Verification log
(empty)
