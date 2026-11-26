# E5-T36b — verifier predictions

Written 2026-11-26T16:58Z at head `0e9245a4dfb142ab7e73d6d3384717ec8434cd36`, before any run of
mine and before opening anything under `evidence/e5-t36b/` (the worker's logs, results and
self-check scripts are unread). What I had read: `AGENTS.md`, the task file including the
worker's claim (so the worker's four-row table is known to me and is not an independent
prediction of mine), `git diff 40ca0e1ce..HEAD -- tools`, and image sources under
`tools/replay-desktop/` (session script, `sway.conf`, `foot.ini`, `rcS`, the monitor and shot
helpers, `assemble.py`, the build script, `native-boot.mjs`).

Each prediction names the state it is about, the point where it is read and what refutes it.

## Acceptance criteria

**P1 — hardware cursor on the new image.**
`node tools/verify/e5-t36b-hardware-cursor.mjs --image target/e5-t36b/image/replay-desktop.ext4 --out evidence/e5-t36b/verifier/native`
exits 0. In `result.json`: `pass` true, `imageSha256` = `8a5c6c1e…b197e`, `swayEnv` is exactly
`["WLR_DRM_NO_ATOMIC=1","WLR_RENDERER=pixman"]`, and in each of the four moves the kernel's DRM
state has a 1280x800 plane with `fb>0` and exactly one other plane with `crtc=crtc-0`, `fb>0`,
size 64x64, at pointer − (hx,hy) with 0 ≤ hx,hy < 64. Refuted by a non-zero exit, a move with no
second plane on the CRTC, or a hotspot outside the image.

**P2 — control on generation 1.** `shasum -a 256 target/e5-t34b/image/replay-desktop.ext4` equals
`web/artifacts-replay-desktop.json` `artifacts.wholeImage.uncompressedSha256`
(`2af6100e…5b05`). The script with `--expect software` on it exits 0; `swayEnv` contains
`WLR_NO_HARDWARE_CURSORS=1`; in all four moves every plane other than the 1280x800 one has
`crtc=(null)` and `fb=0`. Refuted by a second plane on the CRTC or a digest mismatch.

**P3 — the control discriminates (and the failure path runs).** Crossed expectations both fail:
`--expect software` on the new image exits 1 with `pass:false`; the default `--expect hardware`
on generation 1 exits 1 with `pass:false`. Refuted if either exits 0. This is also the only
execution of the `catch` block and `process.exit(1)` (diff lines 84–87, 96).

## Mock hunt / sabotage

**P4 — the plane check does not lean on the environment string; an oversized cursor still
draws a pointer.** (Attack-list item 1, and the sabotage check of the acceptance script.)
In a live boot of the new image I install an Xcursor theme whose only image is 128x128 under
`/home/desktop/.icons/` (tmpfs, written with the image's own tools) and select it with
`swaymsg seat seat0 xcursor_theme <name> 128`, with the pointer over a surface whose cursor sway
itself draws. Sway's environment is unchanged (`WLR_DRM_NO_ATOMIC=1 WLR_RENDERER=pixman`).
Predicted: wlroots refuses a texture larger than the 64x64 plane, so the cursor plane leaves the
CRTC (`crtc=(null)`, `fb=0`) and the pointer is painted — a region of the composited output
around the pointer differs between "pointer on it" and "pointer away". The unmodified
assertions of the acceptance script, run against that session, FAIL at "a second plane is on
the CRTC with a framebuffer after every move".
Refuted (a real defect) if the plane is off the CRTC AND the composited region is identical
with the pointer on and off it: no pointer is drawn anywhere. Also a finding if the acceptance
assertions pass on that session. If the plane stays on the CRTC I record what it shows.

**P5 — "no painted pointer" is only a check if it can see a painted pointer.** The same
region-hash procedure (fixed region of the composited output, pointer inside it vs far away,
over a surface with no hover effect) gives IDENTICAL hashes on the new image and DIFFERENT
hashes on generation 1. Refuted for the worker's check if generation 1 also gives identical
hashes (then grim does not capture the pointer at all and the check proves nothing).

## Provenance

**P6 — the tested image is the image this head builds.**
(a) `target/e5-t36b/image/build.json` is byte-identical to `evidence/e5-t36b/image/build.json`,
its `head` is `3c0f2578661f6bfec3b1fbf4f2169dfdf9ea09b4`, its `image.sha256` is the digest of the
file on disk and of the `imageSha256` in the worker's `native/result.json`.
(b) In the booted guest `sha256sum` of each of the 16 files of the repo overlay
(`tools/replay-desktop/rootfs/**`) equals the digest of the same file at HEAD.
(c) `stage-manifest.json` of the new image against generation 1's
(`target/e5-t34b/image/stage-manifest.json`): the file lists are the same and exactly ONE file
differs in content, `usr/local/bin/replay-desktop-session`; the apt closure (package, version)
is identical. Refuted by any other differing file or package version — then the comparison
with generation 1 is confounded and the "one variable" claim does not describe the image.
(d) A rebuild at this head into `target/e5-t36b-verifier/image` stages the same file list with
the same per-file digests as the worker's image.
(e) The worker's `native/result.json` has sha256 `565bfedd539c…`; its `startedAt` is after the
commit time of `3c0f25786` (2026-11-26T16:41:21Z) and after the image's build.

## Attack list

**P7 — E5-T34b native acceptance on the new image.**
`node tools/replay-desktop/native-boot.mjs --image target/e5-t36b/image/replay-desktop.ext4 --out evidence/e5-t36b/verifier/native-boot --timeout-min 60`
exits 0 with all five checks true (title, page, sandboxed renderer, `KEYBOARD_a`, `v26.13.1`).
READY guest uptime is within 0.10 s of generation 1's 5.29–5.30 s (E5-T34b log), the RAM
high-water mark is within 2 % of generation 1's 181,972 KiB (≤ 185,600), `get_outputs` reports
1280x800, and `grep -i -E 'error|fail' sway.log` shows no line about DRM, KMS, page flips or the
cursor that generation 1 does not also show.

**P8 — a hidden pointer comes back on real pointer input.** `foot.ini` sets no
`hide-when-typing` (foot's default is off), so with the pointer over foot a real key event
(evdev injection into the virtio keyboard's node) leaves the cursor plane ON the CRTC. With
sway's `seat seat0 hide_cursor when-typing enable`, the same key event takes the plane off the
CRTC (`crtc=(null)`, `fb=0`), and the next real pointer event (evdev injection into the virtio
pointer's node) puts it back at the new pointer − hotspot. Refuted if the plane does not
return after real pointer input.

## Novel attack

**P10 — screen edges.** With the pointer at the four corners — (0,0), (1279,0), (0,799),
(1279,799) — the cursor plane stays on the CRTC with a framebuffer at pointer − hotspot, i.e.
partly off-screen and, at the top-left, at a NEGATIVE position. I predict the kernel prints
that position in `%+d` form (`crtc-pos=64x64-1-1`), which line 40 of the acceptance script
(`/^(\d+)x(\d+)\+(-?\d+)\+(-?\d+)$/`) does not match: its `-?` alternatives can never match
kernel output, so a cursor at a negative position is read as `x,y = null`. Refuted (for the
plane) if the plane leaves the CRTC or stops following at an edge; refuted (for the parser
claim) if the kernel prints `+-1`.

## Coverage of the changed code

**P9 — error branches.** `--timeout-min 0.05` exits 1 with `timeout waiting for
REPLAY_DESKTOP_READY`, writes `result.json` with `pass:false`, and leaves no `wasm-vm boot`
process; `--cli /usr/bin/false` exits 1 with `guest exited waiting for REPLAY_DESKTOP_READY`;
`--expect bogus` fails before anything is spawned.

**P11 — nothing else moved.** `git diff 40ca0e1ce..HEAD --stat` touches nothing under `web/` or
`crates/`; `cargo build --release -p wasm-vm-cli` at this head leaves `target/release/wasm-vm`
byte-identical (the binary the worker used is the one this head builds).

**P12 — the premise.** On the new image, the session restarted from the root shell WITHOUT
`WLR_DRM_NO_ATOMIC` and without `WLR_NO_HARDWARE_CURSORS` (atomic KMS, hardware cursors
allowed) has no cursor plane on the CRTC: dropping the old variable is not enough, the new one
is what does it. Refuted if a cursor plane appears under atomic KMS.
