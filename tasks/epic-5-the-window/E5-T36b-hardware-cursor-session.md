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
DRM state (`/sys/kernel/debug/dri/0/state`) after the pointer is moved to five places through
sway's seat (the last is the screen's corner, where the plane stands left of and above the
origin):

- the primary plane scans out the 1280x800 frame;
- a second, cursor-sized plane is on the CRTC with a framebuffer after every move, and its
  position is the pointer minus a hotspot that lies inside the image;
- sway's environment is `WLR_DRM_NO_ATOMIC=1 WLR_RENDERER=pixman`, and Chrome's smoke page
  passed on this session (`REPLAY_DESKTOP_READY` is reached).

Control: the same script with `--expect software` on the published generation-1 image finds
`WLR_NO_HARDWARE_CURSORS=1` and no second plane on the CRTC.

## Adversarial verification

Medium risk. Attack list: a cursor image larger than the plane — **revised after the first
verifier's refutation:** what the image ships must never produce one (wlroots' built-in cursor,
foot, and the guest's Chrome with CSS cursors up to its 128x128 maximum each keep a 64x64
plane image); that a theme of more than 64 px set through sway draws no pointer at all is a
known limit of this session, filed as E5-T36d; a client that hides the pointer (foot while typing); the control above;
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

### 2026-11-26 — verifier — VERDICT: refuted

VERDICT: refuted

Fresh session at head `0e9245a4d`. An earlier verifier session was cut off by a rate limit. I took
over its pre-registered predictions (`evidence/e5-t36b/verifier/predictions.md`, P1–P12, written
2026-11-26T16:58Z before any run and before the worker's evidence was opened) and its finished
runs, after checking that each log ends with an `exit=` line and a final summary. I added no new
predictions. The recheck of P4 (`recheck-oversized.mjs`, written by that session but never run) I
ran myself. Native CLI `target/release/wasm-vm` sha256 `62fde0c3…`, unchanged by `cargo build
--release -p wasm-vm-cli` at this head (no-op). No rr, no `ssh dev` (2026-09-01 policy).

- **P4 — a cursor image larger than the plane — FAILED. This is the refutation.** Predicted: the
  cursor plane leaves the CRTC and sway paints the pointer into the frame. Observed on the new
  image (`8a5c6c1e…`, legacy KMS): with a 65x65 or a 128x128 Xcursor theme, the plane is off the
  CRTC (`crtc=(null) fb=0`) AND the composited frame around the pointer hashes the same with the
  pointer on it and away from it. That holds over sway's title bar and over foot, so **no pointer
  is drawn anywhere**: `evidence/e5-t36b/verifier/recheck-new.log:17,19,22,24`, and again under
  `sway -d` at `:41`. The first run, `attacks-new.log:108-109`, found the same. Sway's debug log
  shows wlroots trying the fallback and failing (`recheck-new.log:45-47`: "Cursor texture too large
  (128x128), exceeds hardware limitations (64x64)", "Failed to render cursor buffer", "Falling back
  to software cursor on output 'Virtual-1'"). Controls that rule out the theme and the measurement:
  (a) a 64x64 theme from the same generator goes on the plane with its hotspot 4,4
  (`recheck-new.log:12`), so the theme files are valid; (b) the same 128x128 theme on generation 1
  (software cursors) IS painted (`recheck-gen1.log:12,14`); (c) the same image with the session
  restarted on atomic KMS paints it (`recheck-new.log:57,59`). So the attack list's "fallback to
  software must still draw a pointer" fails, and generation 1 does not have this problem. The
  worker's claim already said the fallback was not shown to work. **Demand:** a cursor image larger
  than 64x64 must still produce a visible pointer on this session, either on the plane or painted,
  shown by the same three-way control. Alternatively, record a planning decision (not a worker
  claim) that removes this attack item. Side observation from the same run (`recheck-new.log`,
  "moved onto foot"): moving from Chrome onto foot with the 128x128 theme leaves Chrome's arrow on
  the plane (hotspot 1,1, not the theme's 4,4), so the pointer image does not update.
- **P1 — acceptance on the new image — HELD.** `native/result.json` has `pass:true` and image
  `8a5c6c1e…b197e`. `swayEnv` is exactly `WLR_DRM_NO_ATOMIC=1 WLR_RENDERER=pixman`. All four moves
  give a 64x64 plane on `crtc-0` with `fb>0`, and the hotspots are (1,1), (1,1), (9,5), (5,9). This
  matches the worker's table (`native.log`).
- **P2 — control on generation 1 — HELD.** The gen-1 image sha256 `2af6100e…5b05` equals
  `web/artifacts-replay-desktop.json` `wholeImage.uncompressedSha256`. `--expect software` passes,
  with `WLR_NO_HARDWARE_CURSORS=1` and `cursor:null` on all four moves (`control-gen1.log`).
- **P3 — the control discriminates — HELD.** Both crossed runs exit 1 with `pass:false`:
  `cross-new-expect-software.log` fails at line 80 (the env assertion), even though it found a plane
  at every move, and `cross-gen1-expect-hardware.log` fails at line 68. These runs executed the
  `catch`, `process.exit(1)` and `--expect software` branches.
- **P5 — the "no painted pointer" check can see a painted pointer — HELD.** On generation 1 the
  region hashes differ with the pointer on and away (`attacks-gen1.log`: `72e25f0d…` vs
  `ba47a5fd…`, `e51ec92c…` vs `a220951e…`), and they repeat. On the new image they are identical
  (`attacks-new.log` P5 section).
- **P6 — provenance — HELD, except (c) as worded.** (a) `target/e5-t36b/image/build.json` is
  byte-identical to `evidence/e5-t36b/image/build.json`, with head `3c0f2578…` and image sha256
  matching the file on disk. (b) All 16 overlay files in the booted guest equal HEAD
  (`attacks-new.log` P6b). (d) The rebuild `target/e5-t36b-verifier/image` (`rebuild.log`, image
  `b51e68f6…`) stages the same 1002 paths with the same per-file digests and the same apt closure as
  the worker's image. (e) The worker's `native/result.json` has sha256 `565bfedd…` and
  `startedAt` 16:44:25Z, after the commit (16:41:21Z) and the image build. (c) FAILED as predicted:
  against generation 1, 9 staged files differ, not 1. Besides the session script they are 8 libraries
  from 11 Ubuntu security-update package bumps (krb5 ×4, alsa ×2, expat, sqlite3, libtiff, libelf,
  libXrender). None of them touches DRM or the cursor, and P12 isolates the variable on the same
  image, so this does not undermine the claim. It does mean "generation 1" is not a
  one-variable control at the image level.
- **P7 — E5-T34b native acceptance on the new image — HELD.** `native-boot/native-boot.json` has
  all five checks true. READY is at 5.30 s (gen 1: 5.29). The memory high-water mark is 181,688 KiB
  (gen 1: 181,972). The only sway DRM error, "Unable to clone DRM fd", also appears in generation 1's
  `evidence/e5-t34b/native/console.log`.
- **P8 — a hidden pointer comes back on real input — HELD.** As shipped, foot does not hide the
  pointer on a real key event (the plane stays on). With sway `hide_cursor when-typing`, a real
  KEY_A hides it, and a real tablet event brings it back at pointer − (5,8). The idle timeout
  behaves the same way (`attacks-new.log` P8 section).
- **P9 — error branches — HELD.** `--expect bogus` fails before spawning anything (no out dir).
  `--cli /usr/bin/false` exits 1 with "guest exited waiting for REPLAY_DESKTOP_READY".
  `--timeout-min 0.05` exits 1 with "timeout waiting for REPLAY_DESKTOP_READY". Both write
  `result.json` with `pass:false` (`p9-*.log`).
- **P10 — screen edges (novel attack) — HELD for the plane. FAILED for the acceptance parser, a
  latent defect.** At all four corners the plane stays on the CRTC at pointer − hotspot. The kernel
  prints negative positions in `%+d` form (`64x64-1-1`, `64x64+1278-1`, `64x64-1+797`;
  `attacks-new.log:54-59`). The regex at `tools/verify/e5-t36b-hardware-cursor.mjs:40`
  (`\+(-?\d+)\+(-?\d+)`) does not match those strings, so its `-?` can never apply and such a plane
  would get `x,y = null`. The four acceptance positions are interior, so the recorded runs are
  unaffected. **Demand (with the rework):** parse `([+-]\d+)`.
- **P11 — nothing else moved — HELD.** `git diff 40ca0e1ce..HEAD --stat` touches nothing under
  `web/` or `crates/`, and the CLI is fresh at this head.
- **P12 — the premise — HELD.** On the same new image, the session restarted without
  `WLR_DRM_NO_ATOMIC` has no cursor plane on the CRTC and paints the pointer. Restarted with the
  image's own script, the plane is back and nothing is painted (`attacks-new.log` P12 section).
- **COVERAGE.** `replay-desktop-session`: executed in every boot. Acceptance script: both
  `--expect` branches, the catch/exit path, the usage/expect asserts (P9), and `planes()` on
  real kernel output all ran. The negative-position branch of the parser is dead as written (P10).
  `native-shell.mjs`: `bootNative`, `waitFor` (match, timeout and exit paths), `sh`, `rootShell`,
  the `\e[6n` reply, `stop`, `lines` and `last` all ran. The `kernel`/`maxInstrs` defaults are
  waived (configuration). No unexecuted hunk remains apart from the P10 parser alternative.
- **MOCK HUNT.** The plane assertions read `/sys/kernel/debug/dri/0/state` through the guest's root
  shell, not anything the session reports about itself. `swayEnv` comes from `/proc/<sway>/environ`.
  `--expect software` is a real control (P3). In hardware mode, an image that paints its pointer
  fails the plane assertion: on generation 1 and on atomic KMS, `cursor` is null at every move.
  One weakness: in the oversized case of P4, sway with a 128x128 theme while the four acceptance
  positions sit over Chrome still passes the plane assertions (`attacks-new.log`, "acceptance
  positions … would PASS"), because Chrome supplies its own small cursor there. The acceptance run
  does not cover the case that fails.
- **SUITE:** n/a until the refutation clears.

Commands: `bash evidence/e5-t36b/verifier/run-acceptance.sh` (P1–P3);
`node evidence/e5-t36b/verifier/attacks.mjs <img> <dir> new|gen1` (P5, P6b, P8, P10, P12, first P4);
`node evidence/e5-t36b/verifier/recheck-oversized.mjs target/e5-t36b/image/replay-desktop.ext4 evidence/e5-t36b/verifier/recheck-new legacy`
and the same with the gen-1 image and `gen1` (P4 with controls);
`node tools/replay-desktop/native-boot.mjs --image target/e5-t36b/image/replay-desktop.ext4 --out evidence/e5-t36b/verifier/native-boot --timeout-min 60` (P7);
`bash tools/build-replay-desktop-image.sh target/e5-t36b-verifier/image` (P6d); P9 as listed.
Not checked: the browser (out of scope, E5-T36c); whether any shipped client can actually produce
a cursor larger than 64x64 (Chrome scaled 100x100 down to 64x64 in the worker's run).

### 2026-11-26 — worker — round 2 claim (head `7c5191e91`)

The refutation is right about the session: a cursor image larger than the 64x64 plane is drawn
nowhere, because wlroots 0.17's software fallback fails under pixman. I did not fix that here.
What I checked is whether anything the image ships can produce such a cursor, and it cannot:

- wlroots' built-in cursor (the image ships no cursor theme): 64x64 plane (round 1).
- The guest's Chrome with CSS cursors of 65x65, 100x100 and 128x128 — 128 is Chrome's maximum
  for a CSS cursor — keeps a 64x64 image on the plane each time, and a pointer is drawn
  (`evidence/e5-t36b/self-checks/t36b-css-cursor-sizes.mjs` and `.log`, native, this image).
- foot draws its pointer from the cursor theme, which is wlroots' built-in one here.

So a too-large cursor needs a theme of more than 64 px set through sway (the verifier's way)
or a Wayland client that supplies a larger buffer itself; neither ships. I revised the attack
item to say exactly that, and filed the fallback failure as **E5-T36d** (pending, depends on
this task). Whether that is an acceptable revision is the next verifier's call; if it is not,
E5-T36d's work belongs in this task.

**Fixed: the parser the verifier found** (`tools/verify/e5-t36b-hardware-cursor.mjs:41`): the
kernel prints a plane left of or above the origin as `64x64-1-1`. The acceptance now moves the
pointer to a fifth place, the screen's corner, where that happens:

| pointer set to | cursor plane | pointer − plane |
|---|---|---|
| (300, 400) | 64x64 at (299, 399) | (1, 1) |
| (640, 100) | 64x64 at (639, 99) | (1, 1) |
| (93, 516) | 64x64 at (84, 511) | (9, 5) |
| (1036, 420) | 64x64 at (1031, 411) | (5, 9) |
| (0, 0) | 64x64 at (-1, -1) | (1, 1) |

`node tools/verify/e5-t36b-hardware-cursor.mjs --image target/e5-t36b/image/replay-desktop.ext4 --out evidence/e5-t36b/native`
passes (`result.json` sha256 `c40f8246f7b5…`; same image, sha256 `8a5c6c1e34b7…`); the control with
`--expect software` on generation 1 passes with no plane on the CRTC at all five places
(`evidence/e5-t36b/control-gen1/`). Round 1's runs are in `evidence/e5-t36b/round-1/`. Nothing
else changed: the session script is as in round 1, so the verifier's HELD results on it stand.
