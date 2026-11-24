---
id: E5-T34e
epic: 5
title: Warm-resume the Replay desktop as soon as its single download finishes
priority: 0.38735
status: in-progress
depends_on: [E5-T34c]
estimate: S
risk: medium
capstone: false
---

## Boundary

User request (2026-11-24): the Replay desktop must fast-boot once it has finished
downloading. Today (E5-T34c) the 181 MiB whole-image prefill takes about 85 s on the
live site, and a cold guest boot then takes about 2.5 more minutes to reach the
desktop.

Reuse the verified warm-image machinery (Omarchy paired snapshots,
`tools/build-omarchy-snapshot.sh`, E5-T26 restore and reconciliation; the loader's
`bootSnapshot`). Do not build a new restore path. The Replay rootfs is mounted
read-only, so its warm image is a RAM/device snapshot taken at
`REPLAY_DESKTOP_READY` from the exact browser device topology and the exact
E5-T34b image. A disk delta is needed only if the capture proves one (the image
SHA-256 must be unchanged).

Ship the snapshot as one content-addressed artifact fetched in parallel with the
image prefill, so the whole download is still the whole OS at once. The guest
restores from the locally prefetched image with zero chunk or Range requests. The
cold boot stays as an automatic fallback when no matching snapshot exists, and as
the `?noSnapshot` diagnostic. Bind the snapshot to the image SHA-256, kernel,
device layout and wasm build, the way Omarchy's paired artifacts are bound, so a
mismatch falls back to cold boot instead of restoring wrong state. No emulator
semantic change. Run the privacy guard on the snapshot (it holds guest RAM).

## Deterministic acceptance

A Playwright script on the built page and on the live site must show:
1. The image and snapshot downloads are the only disk-related requests, with zero
   chunk or Range requests.
2. The desktop is visible within a bounded time after both downloads finish
   (target ≤ 15 s; record the measured value).
3. The restored session is live, not a picture: clicking Chrome's "Run again"
   increments `runs`, and a DOM-typed Node command prints `v26.13.1` with a fresh
   nonce.
4. Zero console errors.
5. `?noSnapshot` still cold-boots to the same result.

Record download sizes, time from end of download to desktop, and the cold-boot
comparison.

## Adversarial verification

Medium risk: check the acceptance criteria against recorded evidence. Attack the
binding by serving a snapshot that does not match the image, wasm build or device
layout: it must fall back to cold boot (or fail visibly), never restore. Try one
bounded novel attack.

## Verification log

(empty)
