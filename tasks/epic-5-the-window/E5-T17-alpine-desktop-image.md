---
id: E5-T17
epic: 5
title: Alpine riscv64 desktop disk image — reproducible build within size budget
priority: 517
status: pending
depends_on: [E5-T16]
estimate: L
capstone: false
---

## Goal
A reproducible, scripted build of the desktop disk image: Epic 3's Alpine rootfs plus
the T16-chosen display stack, terminal, fonts, seat/udev machinery, and an autostart
path — within a hard size budget so the streamed-chunk loading from Epic 3 stays
tolerable on first visit.

## Context
This is an image-engineering task, not a Linux-from-scratch adventure: extend the Epic 3
image builder (`tools/mkimage` or equivalent) with a desktop package set. Assuming T16
picks labwc: `labwc`, `foot` (terminal), `seatd`, `eudev` + `udev-init-scripts` (or the
documented mdev alternative), `wl-clipboard`, `font-dejavu`, `xkeyboard-config`
(compositors need XKB data), `wlr-randr` (for T22 testing), a wallpaper/menu config, and
an alsa test asset for T19 (`alsa-utils`, a short wav). Services: seatd in the boot
runlevel; a `desktop` user in `video,input,seat,audio` groups; autologin on tty1 running
a `start-desktop` script (exec labwc via `dbus-run-session` if needed) with
`XDG_RUNTIME_DIR=/run/user/1000` created by an init script (no elogind unless T16's
stack demands it — prefer seatd for size). Budget: uncompressed ext4 delta over the E3
image ≤ 350 MiB; page-load-to-desktop chunk fetch measured. Everything through the
existing apk/mirror flow from Epic 3 — this image must also build offline from a
committed package-list + cached apks for reproducibility.

## Deliverables
- `tools/image/desktop.sh` (or builder profile): E3 base → desktop image, pinned
  package versions, idempotent, runs in CI.
- Committed manifest: package list + versions + post-install config files
  (`/etc/inittab` autologin, `start-desktop`, labwc rc.xml/menu.xml, udev rules).
- Image artifact + chunk manifest published the same way as the E3 image.
- `docs/images.md` section: contents, budget accounting table, rebuild instructions.

## Acceptance criteria
- [ ] Two consecutive builds from the same manifest produce images whose file listings
      and package versions are identical (`diff` of `apk info -v` and `find -type f`
      manifests; timestamps excluded).
- [ ] Size budget met: builder fails loudly if the delta exceeds 350 MiB; current
      numbers recorded in the doc.
- [ ] Image boots headless (serial) to the autologin user with seatd running and
      `$XDG_RUNTIME_DIR` correct (`ls -ld` 0700, right owner) — desktop start itself
      may still fail (that's T18's job) but must fail with logs, not hang init.
- [ ] All packages installed from riscv64 repos with verified signatures (no
      --allow-untrusted anywhere in the builder).
- [ ] E3 persistence still works: the desktop image's overlay survives reload
      (smoke-tested via the E3 snapshot test rig).

## Adversarial verification
Refute reproducibility: build on a second machine / clean container from the committed
manifest with the package cache — any content divergence beyond the documented exclusion
list refutes. Refute the budget: `du` the real ext4 delta, not the sparse file size;
check the chunk manifest actually dedupes against E3 base chunks (a full re-upload of
unchanged base chunks refutes the streaming claim). Attack boot ordering: boot 20 times
and check seatd is up before the autologin shell runs `start-desktop` every time (an
OpenRC race here becomes T18's "sometimes black screen"). Verify no leftover build
artifacts (apk cache, /root history) bloat the image. Attempt `apk add` of one extra
package in the running guest to prove the E3 network+persistence path still functions
on this image.

## Verification log
(empty)
