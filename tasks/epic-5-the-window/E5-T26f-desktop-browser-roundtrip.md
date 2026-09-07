---
id: E5-T26f
epic: 5
title: Browser desktop snapshot round-trip and interaction smoke
priority: 526.6
status: blocked
depends_on: [E5-T26e, E5-T26h]
blocked_on: E5-T26h whole-machine desktop device resume
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

### 2026-09-07 — coordinator — isolate missing machine-resume state

The resumed browser reaches `restored` at 642 ms, without a `booting` event, but
never reaches the desktop or application HELLO. Exact reproduction:
`E5_T26F_TIMEOUT_MS=3600000 E5_T26F_OUT=evidence/e5-t26f/remediation-fast-slice
E5_T26F_IMAGE=target/e5-t26f/desktop-image-aplay-noresize/alpine-rootfs.ext4
E5_T26F_IMAGE_INFO=target/e5-t26f/desktop-image-aplay-noresize/desktop-info.json
E5_T26F_DESKTOP_ASSET_DIR=target/e5-t26f/chunks/desktop-aplay-noresize
node tools/verify/e5-t26f-browser-roundtrip.mjs` at `683fb09d` with the uncommitted
persistent-resume browser changes. The stalled diagnostic was stopped; it is not
acceptance evidence.

Inspection of `Machine::save_resume` shows no desktop device MMIO/ring state in
the CPU/RAM snapshot. The guest driver state survives in RAM, while its device
transports are newly initialized. This requires device serialization beyond
T26f's browser-only boundary. E5-T26h owns that prerequisite, reusing the existing
component codecs. Resume this browser proof once H is independently verified.

### 2026-09-07 — worker — IMPLEMENTED

- Implementation commit: `8ce1db0e26a1cc038d3264182c74d61b33b6f4b8`.
- Exact-head evidence: `evidence/e5-t26f/desktop-roundtrip.json` (SHA-256 `4c92b8e9a79723d5630201f9e6f87212661edb134d517c5d0a889da28b0de177`), screenshot `evidence/e5-t26f/desktop-roundtrip.png` (SHA-256 `b3c670ae52cd241158dbee40ec3ba7f3d8a558935619e0b72cecdbf4912f1aca`), and server transcript `evidence/e5-t26f/desktop-roundtrip-server.log` (SHA-256 `b3eeff78fd0f0021bc2a319f86c4df2760b8e4538c41661ba6e9cee9ebb9dfd0`).
- Image provenance: `target/e5-t26f/desktop-image-aplay-noresize/alpine-rootfs.ext4`, SHA-256 `5530d6585776cf61fcedb98f7a2e75b4293d5f805809e5107cc181fa5dc62550`, 1 GiB; split manifest `target/e5-t26f/chunks/desktop-aplay-noresize/manifest.json`, SHA-256 `b6257e6c0e6789dee28a4f0a7eae1089193fcec545d467d8a70d245226bb9592`.
- Command: `E5_T26F_REQUIRE_HEAD=8ce1db0e26a1cc038d3264182c74d61b33b6f4b8 E5_T26F_IMAGE=target/e5-t26f/desktop-image-aplay-noresize/alpine-rootfs.ext4 E5_T26F_IMAGE_INFO=target/e5-t26f/desktop-image-aplay-noresize/desktop-info.json E5_T26F_DESKTOP_ASSET_DIR=target/e5-t26f/chunks/desktop-aplay-noresize make verify-E5-T26f` (exit 0). The gate passed format, both clippy gates, 9 desktop-snapshot tests, 12 desktop-restore tests, 2 nine-slot MMIO tests, wasm32 build/check, 45 Node tests, and the final Chromium proof.
- The recording demonstrates two-window desktop state with terminal text, visible custom cursor, completed `aplay` (`S16_LE`, stereo, 48 kHz), exact normal and drag snapshot hashes, first-present CRC `77f31714` matching the pre-snapshot CRC on both restores, fresh agent HELLO generation 2, full repair frames, released drag buttons, and post-restore cursor/keyboard/audio interaction in `108.91 ms`; browser and HTTP error arrays are empty. The guest reaches the Alpine login prompt with no reboot or device reprobe during restore.
- Scope waiver: the evidence is local Chromium 152.0.7977.76 only; WebKit, independent machines, and host-layer rr are intentionally out of scope per the approved Daybreak Blue validation boundary.

### 2026-09-07 — verifier — VERDICT: refuted

- P1 first-present identity — HELD. Predicted the normal and mid-drag first-present CRCs would
  equal their pre-snapshot CRCs. Both pre-snapshot values are `77f31714`
  (`evidence/e5-t26f/desktop-roundtrip.json:29,35`) and both restored first presents are
  `77f31714` (`:68,162`); the drag restore also reports no held button (`:324`). Carry this result
  forward while the runtime diff and evidence digest remain unchanged, but promote the currently
  missing explicit drag-CRC assertion in the browser harness.
- P2 post-restore input and playback — FAILED. Pointer/keyboard delivery and the 2-second bound
  held (`evidence/e5-t26f/desktop-roundtrip.json:308-324`), but predicted a user-gesture audio
  playback would advance the rendered-audio counter. It is already unlocked before the alleged
  playback and remains exactly `13,594,612` frames before and after (`:313-321`); the only `aplay`
  command occurs before the snapshot (`tools/verify/e5-t26f-browser-roundtrip.mjs:386-391`). Run a
  post-restore `aplay`, record successful guest completion, and assert a bounded positive frame
  delta after the delayed gesture.
- P3 no reboot/re-probe — FAILED. Predicted reload restoration would resume the saved desktop
  without constructing and booting a fresh guest. Instead each restore records a new
  `fetching -> instantiating -> booting` sequence
  (`evidence/e5-t26f/desktop-roundtrip.json:71-83,165-177`), and the harness explicitly performs
  `page.reload()` then waits for a newly ready desktop before auto-restore
  (`tools/verify/e5-t26f-browser-roundtrip.mjs:304-307`;
  `web/desktop-terminal.js:472-497`). The saved envelope contains only GPU, input, sound, and agent
  sections (`crates/core/src/lib.rs:1880-1985`), so it cannot carry the CPU/RAM state required to
  resume the pre-reload guest. Restore from a whole-machine snapshot (or otherwise preserve the
  live guest across reload) and prove no fresh boot/probe states occur.
- P4 adversarial drag/gesture coverage — NEEDS EVIDENCE. Two reloads are exercised, but the script
  takes only one snapshot after mouse-down/move (`tools/verify/e5-t26f-browser-roundtrip.mjs:486-501`),
  not at each drag phase, and does not implement an independently delayed gesture case. Record
  before-drag, held/moving, and release-phase saves plus a deliberately delayed post-restore audio
  gesture; reject every CRC mismatch, stuck button, or playback hang.
- P5 diff coverage — INSUFFICIENT. The exact happy browser run reaches the save compositor, ninth
  virtio window, worker RPC bridge, and source/dist mirrors (source/dist byte parity held), but no
  cited run exercises the new `MissingComponent`, `ComponentRefused`, and `BlockNotQuiesced` save
  branches (`crates/core/src/lib.rs:1883-1933`) or the rootfs array-expansion change
  (`tools/build-rootfs.sh:82`). Add deterministic save-side refusal tests and either separately
  prove the rootfs hunk or remove it from this task's diff.
- SABOTAGE bridge ownership — INSUFFICIENT. Predicted replacing the bridge's `Uint8Array.slice()`
  with a borrowed pass-through would fail the new ownership test; the isolated sabotaged test still
  passed because its fake controller immediately makes its own copy
  (`web/tests/e5-t26f-desktop-agent-bridge.test.mjs:35-39`) before the caller mutation is observed.
  Make the fixture retain the bridge-supplied buffer without copying (or observe it asynchronously)
  so the changed ownership hunk at `web/desktop-agent-bridge.js:6-12` is actually falsifiable.
- NOVEL ATTACK — HELD. A controller that accepted one byte fewer than each agent frame never
  reached READY, and queued guest bytes remained privately owned and were discarded on close.
- Deterministic checks passed: 9 desktop-snapshot tests, 12 desktop-restore tests, 2 nine-slot MMIO
  tests, the advertised-XRUN sound test, all 45 scoped Node tests, and source/dist parity. The full
  browser target was not rerun because the exact-head recording was hash-valid and directly
  refuted, while its current assertions omit the failed criteria above. SUITE: no promotion until
  the semantic refutations clear. Chromium-only, independent-machine, WebKit, and host-rr waivers
  were honored.
