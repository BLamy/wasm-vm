# Epic 3.6 Phase 2 — browser Alpine restore-on-load (RAM snapshot + COW overlay-delta)

**Goal:** restore the container-capable Alpine host in ~1s in the browser instead of the ~15-min cold
boot, mirroring the shipped busybox restore. Native viability was proven in
`alpine-snapshot-native.md` (0.62s RAM restore vs 921s boot, disk-coherent, `wvrun` present). This
document is the browser wiring: what was built, the ext4↔chunked-base binding, the coherence guard, and
the measured browser restore.

## The hard difference from busybox

Busybox boots from an initramfs (no disk); its restore is RAM-only. Alpine boots in the browser from a
**chunked read-only base** (130 MB, on R2, fetched lazily) + an **IndexedDB copy-on-write overlay**. So
an Alpine restore needs BOTH, captured in lockstep:

1. **RAM snapshot** (~15 MB gz) — the whole-machine resume blob (RAM + hart + CSR + devices + page cache).
2. **Overlay-delta** (~1 MB) — every 4 KiB disk block the boot dirtied vs the chunked base, seeded into
   the IndexedDB overlay so a restored guest's cache-miss disk reads return post-boot content.

## What was built

- **`crates/storage/src/overlay_delta.rs`** — the shipped `WVOD1` overlay-delta format (`OverlayDelta`):
  magic + block_size + image_len + `base_binding` (the chunk manifest's `base_hash`) + `generation` +
  `count` + `count × (u64 block_index, 4096-byte block)`. Bound-checked, 32-bit-safe parser; unit-tested
  (round-trip, bad-magic, truncation, hostile count).
- **`crates/wasm` `seedOverlayDelta(manifestJson, deltaBytes)`** — seeds the delta into a **brand-new**
  IndexedDB overlay for the matching base BEFORE machine construction (so `newChunkedDiskPersistent`'s
  `load_blocks()` picks it up). Rejects a delta whose `base_binding`/`image_len` don't match the manifest
  (before any I/O); returns `false` (no-op) if an overlay already exists, so a user's durable disk is
  never clobbered. wasm-pack resume test extended to the overlay-delta case.
- **`web/loader.js`** — the chunked/persistent restore path: fetch+verify+gunzip the RAM snapshot + the
  overlay-delta, `seedOverlayDelta`, construct the persistent machine, then `loadSnapshotBlob` the RAM —
  all gated by `restoreDecisionCode` (core-hash + base + overlay-generation). Any failure falls through
  to the normal chunked cold boot (never a broken state). `markGuestReady()` + prompt-nudge on
  `"restored"` already applied via the existing busybox wiring.
- **`web/main.js`** — Alpine boot now defaults to `persist=1` (the restore needs the IndexedDB overlay);
  `?persist=0` forces the non-persistent lazy boot; `?noSnapshot` forces the cold-boot baseline (A/B).
- **`tools/build-alpine-snapshot.sh`** — native capture (runs on `dev`): boot Alpine to a **post-login**
  container-ready shell marker, snapshot RAM (stamped core-id + chunk `base_hash`), compute the
  overlay-delta against the **chunk base**, gzip both, refresh `web/artifacts-alpine.json`.
- **`gen-alpine-manifest.sh` / `deploy-cloudflare.sh`** — ship `bootSnapshot` + `overlayDelta` on Pages
  (each < 25 MiB; URLs relative).

## Device topology + marker (must match the browser exactly)

- **Devices:** the browser Alpine machine always attaches virtio-blk (slot 0) + virtio-net (slot 1,
  loopback by default) + virtio-rng (slot 2). The native capture boots with `--drive --net --virtio-rng`
  so the snapshot's device sections match; a topology mismatch would fail `load_resume`.
- **Marker (post-login):** the getty "Welcome to Alpine" banner lands at `login:`, not a shell. The
  capture drives `root\n` (+ an empty line for a possible password prompt), then an **output-only** marker
  (`echo WVSNAP"READY"` — the typed echo carries a quote between `P` and `R`, so only the command's
  STDOUT prints `WVSNAPREADY`), triggering the snapshot at a genuinely idle, logged-in, container-capable
  shell.

## The ext4 ↔ chunked-base binding (drift-proof delta) — a real landmine found

The browser fetches the pristine base as **chunks** described by `chunked-alpine/manifest.json`; its
`base_hash` (= SHA-256 of the manifest's compact JSON, here `03a8026f…`) is the coherence identity the
RAM snapshot is stamped with (`--snapshot-base-id`) and the overlay store is namespaced by. The **R2
manifest is byte-identical to the committed local manifest** (both `base_hash 03a8026f`), so the stamped
snapshot is accepted (not `foreign_image`) against the deployed base.

**Finding — the pristine ext4 has drifted from the chunked base:** hashing every pristine 4 KiB chunk
against the manifest, **42 of 6144 chunks differ** (chunk 0 = the ext4 superblock, plus ~41 others). So
the image the R2 chunks reassemble to is NOT byte-identical to the on-disk `alpine-rootfs.ext4` we boot.
A naïve delta (post-boot vs pristine) would MISS these untouched-but-drifted blocks: a restored guest
reading one cache-miss would get the R2 base's drifted bytes — **incoherent** with what it booted from.

**Fix — delta = writes ∪ drifted-chunk coverage, coherent against R2 without fetching R2.** For every
4 KiB block, include its POST-BOOT content when EITHER (a) the boot wrote it (post-boot ≠ pristine), OR
(b) it lies in a chunk whose pristine SHA-256 ≠ the manifest's chunk hash. (b) overlays the exact set of
blocks where the R2 base disagrees with the booted image (post-boot == pristine there, since untouched),
so every cache-miss read returns the byte the restored guest expects. **Measured:** 42 drifting chunks
covered → **1437 dirtied 4 KiB blocks (5.9 MB raw → 296 KB gz)**. This is what makes the restore byte-exact
on disk against the deployed base. (R2 chunk objects are not directly hotlinkable — 403 to `curl` — so
reassembling the R2 base to diff against it is not an option; the hash-comparison approach needs only the
manifest, which IS public.)

## Coherence guard (rejected → cold boot)

Reused unchanged from E3-T12d (`crates/core/src/resume.rs`, already tested): the restore is accepted only
when `restoreDecisionCode(ram, overlayGeneration()) === "resume"`, which validates the triple
**core-hash** (build) + **base_image_hash** (chunk `base_hash`) + **overlay generation**. A foreign build
→ `foreign_build`; a different chunked base → `foreign_image`; a mismatched overlay generation → `stale`.
The RAM snapshot and the overlay-delta share **generation 0** (fresh restore-on-load); `seedOverlayDelta`
additionally refuses a delta whose `base_binding` ≠ the manifest `base_hash`.

## Gates

- **Storage/wasm build:** `cargo test -p wasm-vm-storage overlay_delta` green (3/3);
  `cargo check`/`clippy -p wasm-vm-wasm --target wasm32-unknown-unknown` clean; `cargo fmt` clean.
- **Node tests:** `node --test web/tests/*.test.mjs` → 88 pass (boot-path + cpu-isolation unaffected).
- **Native capture (dev):** boots Alpine to a post-login shell (`wasm-vm login: root` → `wasm-vm:~#` →
  `WVSNAPREADY`), snapshots at that idle shell. **RAM snapshot 60,430,185 B raw → 15,292,188 B gz**
  (`sha256 827c4962…`); **overlay-delta 5,897,509 B raw → 303,356 B gz** (`sha256 117a82c0…`, 1437 blocks).
  Both stamped `core_id=302e302e31…` (v0.0.1) + `base_id=03a8026f…` (chunk manifest `base_hash`, == R2).
- **Browser restore (Playwright):** _(see status below)_

## Status / what remains

- Implementation, native capture, and coherent artifacts (bound to the deployed R2 base `03a8026f`) are
  **done**; the manifest advertises them and the deploy script ships them on Pages.
- The RAM snapshot (15.3 MB gz) is < 25 MiB so it ships on Pages like busybox; the overlay-delta (296 KB)
  is committed. The 130 MB chunked base stays on R2 (unchanged; the delta is bound to it).
- **Remaining:** the deployed-site Playwright measurement (restore vs cold `?noSnapshot`) — requires
  `bash tools/deploy-cloudflare.sh` to publish the new `artifacts-alpine.json` + the two snapshot files,
  then a Playwright run asserting `window.__linux.restoredFromBootSnapshot() === true`, a ready shell
  (not a login prompt), and `wvrun` availability, with wall-time A/B.
