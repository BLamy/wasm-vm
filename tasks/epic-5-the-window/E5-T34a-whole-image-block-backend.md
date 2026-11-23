---
id: E5-T34a
epic: 5
title: Whole-image single-fetch block backend for the browser runtime
priority: 0.3871
status: verified
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

### 2026-11-23 — fresh verifier — VERDICT: verified

Verified on branch head 308d1d3dc (implementation 197c09be2). Built wasm sha256 `c6cc6692…ddd5` is the same in
`web/pkg` and `web/dist/pkg`. `web/{whole-image,loader,main}.js` are byte-identical to their `web/dist` copies.
No rebuild was needed. Host load average was 16 to 99 during the runs because of the concurrent Docker build. Verifier artifacts are in
`evidence/e5-t34a/verifier/`. Predictions were written before each observation.

- **P1 acceptance (prefill in the browser): HELD.** Prediction: exactly 1 `.img.gz` request, 0 chunk or `Range`
  requests, `localHits == 113`, `fetches == 0`, and the same login plus marker as lazy. I re-ran this with my own
  driver (`verifier/diag.mjs`, system Chrome headless, `tools/serve-dev.sh 8123`), which records serial progress every 60 s.
  - `run1/prefill-result.json`: login and `PREFILL_42_OK`. Requests: whole=1, chunkOrRange=0, total=170. Stats:
    `localImage:true`, `localHits:113`, `localBytes:14811136`, `fetches:0`, `bytes:0`, `error:null`.
  - `run{1,2}/lazy-result.json`: same login and marker. Requests: whole=0, chunkOrRange=113. Stats: `fetches:113`,
    the same 14811136 bytes, `localHits:0`.
  - These shapes and counts match the worker's `prefill-*`/`lazy-*` evidence exactly: 170 requests, 113 chunks, 14811136 bytes.
  - The only console error was `/favicon.ico` 404. The server log shows 404s for favicon only, which is the allowed exception.
  - My first attempt used the committed `tools/verify/e5-t34a-whole-image-prefill.mjs size prefill lazy`. `size`
    passed (2261 ms), but prefill timed out at its 1800 s login wait at load average about 99
    (`verifier/acceptance-script-timeout.log`).
  - The instrumented rerun shows why. Run 1: prefill logged in at 822 s, and its 60 s polls stretched to about 400 s of
    wall time, so the browser was starved. Run 2 ran in the reverse order (lazy, then prefill) at load 16 to 18. Lazy
    logged in by 180 s and prefill also by 180 s (`run2/*-progress.json`), at 60 s polling granularity, with prefill
    ahead at every poll.
  - The slow runs (worker's 1725 s, my 822 s and timeout) track host load, not the prefill mode. They do not contradict
    the claim, and timing is not an acceptance criterion.
- **P2 the image stays out of linear memory: HELD.** Code: `FetchState` keeps the `Uint8Array` handle, and
  `fetch_local` copies only `image.subarray(start,end).to_vec()`. Measured with the built wasm (`verifier/mem.mjs`,
  `mem.out`): a 256 MiB + 4 KiB image left `memory.buffer.byteLength` at 11534336 before `setLocalImage`, after it,
  and after serving 3 chunks (growth 0). `localBytes` was 266240 = 2×128 KiB + the 4 KiB short tail.
- **P3 a different corruption fails closed with no network fallback: HELD.** I made two new browser attacks
  (`verifier/atk.mjs`, `atk.out`), each served with the GENUINE sha256 and size:
  - (a) The `.img.gz` truncated at half its bytes → `cannot boot: TypeError: Compressed input was truncated.`
  - (b) A gzip that decompresses to exactly 805306368 bytes with the LAST byte (in the short-tail region) flipped →
    `whole image: integrity check failed: expected 58f3…57db, got f3a3…da48`.
  - Both made 1 image request and 0 chunk or Range requests.
  - Wasm-level, same corruption with a self-consistent admission: only the last (short) chunk corrupt, requested
    twice → `localHits:0`, `fetches:0`, `resident:0` (`mem.out`). It was never cached and never fetched from the network.
- **P4 lazy and non-opted profiles unchanged: HELD.** Lazy boots still fetch 113 chunks per-chunk (`run{1,2}/lazy-*`).
  `fetch_local` returns `None` without a local image, so `fetch_one` follows its pre-existing path.
  `wholeImageUrl` is set only by the `?testHooks=1` `__bootAlpineChunkedCold` hook (`grep` over `web/*.js`).
- **P5 unit tests are real and not self-licking: HELD.**
  - `cargo test -p wasm-vm-storage --lib local_image`: 6/6 pass.
  - `node --test tests/e5-t34a-local-image-wasm.test.mjs tests/e5-t34a-whole-image.test.mjs`: 9/9 pass.
  - Expected values come from independent sha2 and node:crypto hashing, not from the code under test.
  - Sabotage: `chunk_range` `end = start + len - 1` made 3 of the 6 tests fail (`chunk_ranges_match…`,
    `local_hit_serves…`, `hash_mismatch…`). Restored with `git checkout`. The file sha256 `e42945f2…` matches HEAD.
- **COVERAGE.**
  - Executed in the browser: `fetch_local` hit path, `set_local_image`/`has_local_image`, fetchStats fields,
    `setLocalImage` success, loader size check (`size` mode), and `fetchWholeImage` gzip, SHA-mismatch and
    truncated-stream paths.
  - Executed via the built wasm in node: the `setLocalImage` SizeMismatch error and the corrupt-chunk refusal.
  - Waived (unit-tested only):
    - Non-gzip/`Content-Encoding` pre-decoded branch. Node test `accepts a body the server already gzip-decoded`;
      CDN behaviour is disclosed as not proven, and the SHA/size gate still applies.
    - Oversize branch. Node test `long decompressed image`.
  - Waived (unreachable or trivial):
    - `TooLarge` from JS: a browser Uint8Array length is ≤ 2^32−1 and the manifest bound is tested natively.
    - `setLocalImage: not a chunked boot`: the loader only calls it when `isChunked`.
    - Loader `wholeImageUrl`-without-sha and manifest-without-`image_len` guards: argument validation.
    - The `fetchStats` `None` branch: constant fields.
    - `LocalImage::image_len()`: a public accessor with no caller.
    - `gpu-checkpoint-build.js`: generated.
  - `tools/build-whole-image.sh` output: the gzip sha256 matches the sidecar `gzipSha256` (`7ab0c395…`), and the
    browser verified the decompressed sha256 on every prefill boot.
- **Novel attack:** the linear-memory measurement (P2) plus last-short-chunk and truncated-gzip corruption (P3). All held.
- **SUITE:** No new promoted tests. The committed native and node tests already pin hit, mismatch, size, tail-extent,
  and no-fallback behaviour. The diagnostic driver (`verifier/diag.mjs`) is kept as evidence. Suggested follow-up,
  not filed: raise the acceptance script's 1800 s login timeout or poll progress, so it is robust on a loaded host.

Commands: `cargo test -p wasm-vm-storage --lib local_image`; `cd web && node --test tests/e5-t34a-*.test.mjs`;
`bash tools/serve-dev.sh 8123`; `node tools/verify/e5-t34a-whole-image-prefill.mjs size prefill lazy`
(size PASS, prefill timed out under load); `node evidence/e5-t34a/verifier/diag.mjs <out> prefill lazy` and
`… lazy prefill`; `node evidence/e5-t34a/verifier/atk.mjs` (attack files built under `releases/chunked-alpine/`
and deleted afterwards); `node evidence/e5-t34a/verifier/mem.mjs`.
