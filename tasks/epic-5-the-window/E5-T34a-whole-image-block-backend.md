---
id: E5-T34a
epic: 5
title: Whole-image single-fetch block backend for the browser runtime
priority: 0.3871
status: implemented
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

### 2026-11-23 — worker — submitted at 197c09be2

**Claim.** Chunked boots accept an opt-in whole-image prefill (`wholeImageUrl`, `wholeImageSha256`,
`wholeImageSize`). The loader (`web/whole-image.js`, called from `web/loader.js`, which runs inside
the whole-machine worker, so no transfer step is needed) makes one streamed request for the gzip of
the raw image. It decodes it with `DecompressionStream` into a `Uint8Array(image_len)` allocated up
front, rejects a size or SHA-256 mismatch, then calls the new `machine.setLocalImage(u8)`. The array
stays in JS memory. `FetchState::fetch_one` (`crates/wasm/src/http_fetch.rs`) slices exactly
`[i*chunk_size, i*chunk_size + chunk_len(i))` out of that buffer, verifies it with
`manifest.verify_chunk`, and inserts it. It never issues a request in this mode. A mismatch is a
permanent `FetchFailure::LocalImageCorrupt` and never falls back to the network. Admission, chunk
extents and verification live in `wasm_vm_storage::LocalImage`, which has native tests.
Admission requires `len == image_len` and an image no larger than `u32::MAX`. `fetchStats` gains
`localImage`, `localHits` and `localBytes`. Profiles that do not opt in are unchanged: no shipping
caller sets the option. Only the `?testHooks=1` hook `__bootAlpineChunkedCold` does.

**Artifact.** `bash tools/build-whole-image.sh releases/rootfs/alpine-warm-rootfs.ext4
releases/chunked-alpine/manifest.json releases/chunked-alpine/alpine-rootfs.img.gz`. The script
checks the size and all 6144 chunk hashes against the manifest before it writes anything. Result:
805306368 bytes decompressed, sha256 `58f3f9a4…57db`, 13970446 bytes gzipped. Gitignored, not
committed.

**Commands (exact head 197c09be2, wasm sha256 `c6cc6692…ddd5` in both web/pkg and web/dist/pkg):**
- `cargo fmt --check -p wasm-vm-storage -p wasm-vm-wasm`;
  `cargo clippy -p wasm-vm-storage --all-targets -- -D warnings`;
  `cargo clippy -p wasm-vm-wasm -- -D warnings`;
  `cargo clippy -p wasm-vm-wasm --target wasm32-unknown-unknown -- -D warnings`. All clean.
- `cargo test -p wasm-vm-storage`: all pass. That includes 6 new `local_image::tests`: exact-size
  admission, the u32 bound, chunk extents including the short tail, local hit for every chunk, hash
  mismatch as a permanent failure, and a short buffer.
- `cd web && node --test tests/e5-t34a-local-image-wasm.test.mjs tests/e5-t34a-whole-image.test.mjs`:
  9 pass (`evidence/e5-t34a/unit-tests-node.log`). These run the BUILT wasm: setLocalImage size
  mismatch throws; a local hit serves 3 of 3 chunks with `fetches == 0`; a corrupt chunk is never
  cached or fetched from the network. Loader cases: gzip decode, a pre-decoded body, short, long,
  SHA mismatch, HTTP 404, bad arguments.
- `make web-build`, then the pre-commit hook rebuilt and staged `web/dist`.
- `bash tools/serve-dev.sh 8123 &` and `node tools/verify/e5-t34a-whole-image-prefill.mjs`, which
  drives system Chrome headless through `size`, `corrupt`, `prefill` and `lazy` and passed all four
  (`boot-run.log`).
- ISA suite on the built `web/dist`: `evidence/e5-t34a/demo-suite-only.mjs`. This is
  `tools/verify/e5-t18e-demo-smoke.mjs` without its roadmap-search step, because `#rm-search` is not
  visible on the current roadmap page. Result: 127 passed, 0 failed, 127 done, zero console or HTTP
  errors, unchanged from E5-T18e (`demo-suite.json`, `demo-suite.png`).

**Evidence (`evidence/e5-t34a/`).**
- `prefill-requests.json`: 170 requests in total. Exactly 1 request for `alpine-rootfs.img.gz`, and
  0 requests to `/chunked-alpine/chunks/` or with a `Range` header. Worker requests are included:
  the kernel and manifest fetches made inside the worker appear in the log.
- `prefill-fetchstats.json`: `localImage: true`, `localHits: 113` (14811136 bytes), `fetches: 0`,
  `bytes: 0`, `error: null`.
- `prefill-serial.log` and `prefill-login.png`: `wasm-vm login:`, then root login, then
  `PREFILL_42_OK`. Zero console errors apart from the favicon 404.
- `lazy-*`: the same cold boot without prefill. 113 chunk requests, `fetches: 113`, the same 14811136
  bytes, `localHits: 0`, the same login and `PREFILL_42_OK` marker.
- `corrupt-*`: attack 1. The image has one byte flipped at offset 0 and its declared sha256 is the
  corrupted image's own hash, so the loader admits it. Wasm reports `chunk 0: LocalImageCorrupt` and
  the machine halts with `lazy chunk fetch failed`. There is 1 image request and 0 chunk or Range
  requests, so there was no network fallback.
- `size-mismatch.json`: attack 2. `wholeImageSize = image_len - 1` is refused before any image
  request.
- `server.log`: the dev server's own request log, which corroborates the counts on the server side.

**Not proven / caveats.**
- Login time is unreliable. The final-head prefill run reached login after 1725 s, while the earlier
  run took 135 s and a rerun at the same head took 141 s (`rerun/`). Lazy mode took 124 to 146 s.
  The host load average was 16 to 21 because of a concurrent Docker Chromium build. The guest saw
  the same 113 chunks in every run. The 1725 s outlier is unexplained.
- On localhost, prefill is not measurably faster than lazy. The benefit is removing about 113
  network round trips, which only matters against a remote CDN.
- No R2 or Cloudflare deployment was made, and the `.img.gz` is not published. A CDN that applies
  `Content-Encoding: gzip` is handled by gzip-magic sniffing, which is unit-tested only.
- `wholeImageUrl` was not exercised with virgl, persistence or a warm snapshot (out of scope; the
  path is the same `setLocalImage` after construction).
- The `@playwright/test` runner hangs at collection under Node 24 on this machine, so the acceptance
  runs as a standalone Playwright-library script, the pattern used in `tools/verify/`.
