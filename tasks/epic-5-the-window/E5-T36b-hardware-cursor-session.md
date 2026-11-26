---
id: E5-T36b
epic: 5
title: Replay desktop image — the session runs on legacy KMS with a hardware cursor
priority: 0.3876515
status: implemented
depends_on: [E5-T36a]
estimate: S
risk: medium
capstone: false
---

## Boundary

One guest image source: `tools/replay-desktop/rootfs/usr/local/bin/replay-desktop-session`
(`WLR_DRM_NO_ATOMIC=1`, no `WLR_NO_HARDWARE_CURSORS`), plus the acceptance script and the small
native serial-shell helper it shares with later image tasks (`tools/replay-desktop/native-shell.mjs`).
The image this task builds is local; E5-T41b publishes the next generation.

Why: with software cursors sway paints the pointer into the frame, so the pointer the user
steers is a picture that arrives a guest frame late, under the browser's own arrow. Linux 6.6
hides a paravirtual GPU's cursor plane from atomic KMS clients that do not declare hotspot
support (wlroots 0.17 does not); on legacy KMS wlroots finds both planes and the pointer
becomes a cursor-plane image, which the host already turns into a CSS cursor (E5-T15) with the
right hotspot (E5-T36a).

## Deterministic acceptance

`node tools/verify/e5-t36b-hardware-cursor.mjs --image <built image> --out evidence/e5-t36b/native`
boots the image on the native CLI (browser device topology) and asserts, from the kernel's own
DRM state (`/sys/kernel/debug/dri/0/state`) after the pointer is moved to four places through
sway's seat:

- the primary plane scans out the 1280x800 frame;
- a second, cursor-sized plane is on the CRTC with a framebuffer after every move, and its
  position is the pointer minus a hotspot that lies inside the image;
- sway's environment is `WLR_DRM_NO_ATOMIC=1 WLR_RENDERER=pixman`, and Chrome's smoke page
  passed on this session (`REPLAY_DESKTOP_READY` is reached).

Control: the same script with `--expect software` on the published generation-1 image finds
`WLR_NO_HARDWARE_CURSORS=1` and no second plane on the CRTC.

## Adversarial verification

Medium risk. Attack list: a cursor image larger than the plane (fallback to software must
still draw a pointer); a client that hides the pointer (foot while typing); the control above;
the E5-T34b native acceptance (`tools/replay-desktop/native-boot.mjs`) on the new image. One
bounded novel attack.

## Verification log

### 2026-11-26 — worker — claim (head `3c0f25786`)

Commits `53b1b626c` (status) and `3c0f25786`: the session script's one variable, the acceptance
script and the serial-shell helper. The image under test was built at that head
(`bash tools/build-replay-desktop-image.sh target/e5-t36b/image`; `evidence/e5-t36b/image/build.json`
names the head; image sha256 `8a5c6c1e34b7…`; the build's privacy check passed on the staged tree,
the image and the compressed image). The build is not byte-reproducible, so a rebuild has another
digest; the image is local and E5-T41b publishes the generation that carries this change.

**Acceptance**, native CLI built at this head (`cargo build --release -p wasm-vm-cli`):
`node tools/verify/e5-t36b-hardware-cursor.mjs --image target/e5-t36b/image/replay-desktop.ext4 --out evidence/e5-t36b/native`
passes (`result.json` sha256 `565bfedd539c…`). Sway's environment is `WLR_DRM_NO_ATOMIC=1 WLR_RENDERER=pixman`,
Chrome's smoke page passed, the primary plane scans out 1280x800, and after every move through
sway's seat a second plane is on the CRTC with a framebuffer:

| pointer set to | cursor plane | pointer − plane |
|---|---|---|
| (300, 400) | 64x64 at (299, 399) | (1, 1) |
| (640, 100) | 64x64 at (639, 99) | (1, 1) |
| (93, 516) | 64x64 at (84, 511) | (9, 5) |
| (1036, 420) | 64x64 at (1031, 411) | (5, 9) |

Control, the published generation-1 image (`target/e5-t34b/image/replay-desktop.ext4`, sha256
`2af6100e9b37…`, the manifest's): the same script with `--expect software` passes — `WLR_NO_HARDWARE_CURSORS=1 WLR_RENDERER=pixman`,
and the second plane is off the CRTC (`crtc=(null)`, `fb=0`) after all four moves
(`evidence/e5-t36b/control-gen1/result.json`).

**The E5-T34b native acceptance on the new image**
(`node tools/replay-desktop/native-boot.mjs --image target/e5-t36b/image/replay-desktop.ext4 --out evidence/e5-t36b/native-boot --timeout-min 60`):
passes — page title and smoke page, renderer sandboxed, the real keyboard path (`KEYBOARD_a`),
`node` v26.13.1 typed into the terminal; READY at guest uptime 5.28 s, RAM high-water mark
181932 KiB (172284 KiB at READY).

**The attack list, as far as I took it** (`evidence/e5-t36b/self-checks/`, scripts and logs; each run
is `node <script> target/e5-t36b/image/replay-desktop.ext4 <scratch dir>`):

- *No painted pointer.* `t36b-attacks.log`: a 96x96 region of the composited output (grim)
  around the pointer hashes the same with the pointer on it and away from it.
- *A client that hides the pointer.* Same log: with sway's `hide_cursor` the cursor plane leaves
  the CRTC (`crtc=(null)`, `fb=0`). `sway-gone.log`: the same when the compositor exits, and the
  plane is back at 64x64+99+99 when the session is started again — which is what E5-T36a's
  "a cursor that appears where none was shown starts over" needs from the guest. (After
  `hide_cursor`, moving the pointer through sway's IPC did not show it again; real pointer
  input does, by E5-T36a's round-5 verifier.) I did not type into foot natively.
- *A cursor image larger than the plane.* I did not manage to produce one, two ways:
  `swaymsg seat seat0 xcursor_theme default 128` leaves a 64x64 plane (the image ships no cursor
  theme at all, so wlroots uses its built-in cursor), and a page in the guest's Chrome with a
  100x100 custom cursor (`t36b-bigcursor.log`) gives a 64x64 plane 32 px up and left of the
  pointer: Chrome scales it down. So the software fallback is NOT shown to work by this claim;
  it is wlroots' own path and nothing shipped in the image reaches it that I found.

**What this claim does not cover.** The browser. The host half was proven in a browser on the
published image with exactly this variable changed from the serial shell (E5-T36a, verified:
`--legacy-kms-session`); the browser proof on a published image with this session is E5-T36c.
Nothing under `web/` or `crates/` changes here, so there is no bundle to rebuild and no
roadmap row yet.
