---
id: E5-T26f
epic: 5
title: Browser desktop snapshot round-trip and interaction smoke
priority: 526.6
status: implemented
depends_on: [E5-T26e]
estimate: S
risk: high
capstone: false
---

## Goal

Prove the composed desktop snapshot in the browser: reload and restore the same visible desktop,
then resume real input and audio without a guest reboot.

## Boundary

Own the browser save/reload/restore harness, pixel CRC comparison, and post-restore interaction
smoke. Do not add new device serialization semantics or stress/fuzz infrastructure.

## Acceptance criteria

- A desktop with two windows, visible custom cursor, terminal text, and completed `aplay` saves,
  reloads, restores, and has a first-present front-buffer CRC equal to the pre-snapshot CRC.
- Within 2 seconds after restore, typed text, cursor movement, window focus, and one user-gesture
  audio playback all succeed; the evidence records exact image, browser, and snapshot hashes.
- A snapshot taken during a window drag restores with no stuck button, and the browser path proves
  no guest reboot or re-probe was required.

## Verification command

make verify-E5-T26f

## Adversarial verification

Save at each drag phase, reload twice, and restore once with a delayed user gesture. Reject any
stuck button, stale cursor, CRC mismatch, or audio hang.

## Verification log

### 2026-09-07 — worker — IMPLEMENTED

- Implementation commit: `8ce1db0e26a1cc038d3264182c74d61b33b6f4b8`.
- Exact-head evidence: `evidence/e5-t26f/desktop-roundtrip.json` (SHA-256 `4c92b8e9a79723d5630201f9e6f87212661edb134d517c5d0a889da28b0de177`), screenshot `evidence/e5-t26f/desktop-roundtrip.png` (SHA-256 `b3c670ae52cd241158dbee40ec3ba7f3d8a558935619e0b72cecdbf4912f1aca`), and server transcript `evidence/e5-t26f/desktop-roundtrip-server.log` (SHA-256 `b3eeff78fd0f0021bc2a319f86c4df2760b8e4538c41661ba6e9cee9ebb9dfd0`).
- Image provenance: `target/e5-t26f/desktop-image-aplay-noresize/alpine-rootfs.ext4`, SHA-256 `5530d6585776cf61fcedb98f7a2e75b4293d5f805809e5107cc181fa5dc62550`, 1 GiB; split manifest `target/e5-t26f/chunks/desktop-aplay-noresize/manifest.json`, SHA-256 `b6257e6c0e6789dee28a4f0a7eae1089193fcec545d467d8a70d245226bb9592`.
- Command: `E5_T26F_REQUIRE_HEAD=8ce1db0e26a1cc038d3264182c74d61b33b6f4b8 E5_T26F_IMAGE=target/e5-t26f/desktop-image-aplay-noresize/alpine-rootfs.ext4 E5_T26F_IMAGE_INFO=target/e5-t26f/desktop-image-aplay-noresize/desktop-info.json E5_T26F_DESKTOP_ASSET_DIR=target/e5-t26f/chunks/desktop-aplay-noresize make verify-E5-T26f` (exit 0). The gate passed format, both clippy gates, 9 desktop-snapshot tests, 12 desktop-restore tests, 2 nine-slot MMIO tests, wasm32 build/check, 45 Node tests, and the final Chromium proof.
- The recording demonstrates two-window desktop state with terminal text, visible custom cursor, completed `aplay` (`S16_LE`, stereo, 48 kHz), exact normal and drag snapshot hashes, first-present CRC `77f31714` matching the pre-snapshot CRC on both restores, fresh agent HELLO generation 2, full repair frames, released drag buttons, and post-restore cursor/keyboard/audio interaction in `108.91 ms`; browser and HTTP error arrays are empty. The guest reaches the Alpine login prompt with no reboot or device reprobe during restore.
- Scope waiver: the evidence is local Chromium 152.0.7977.76 only; WebKit, independent machines, and host-layer rr are intentionally out of scope per the approved Daybreak Blue validation boundary.
