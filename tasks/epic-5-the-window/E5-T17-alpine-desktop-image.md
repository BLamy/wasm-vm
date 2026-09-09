---
id: E5-T17
epic: 5
title: Alpine riscv64 desktop disk image — reproducible build within size budget
priority: 517
status: cancelled
depends_on: [E5-T16e]
estimate: L
risk: high
capstone: false
decomposed_into: [E5-T17a, E5-T17b, E5-T17c, E5-T17d, E5-T17e]
---

## Goal
A reproducible, scripted build of the desktop disk image: Epic 3's Alpine rootfs plus
the T16-chosen display stack, terminal, fonts, seat/udev machinery, and an autostart
path — within a hard size budget so the streamed-chunk loading from Epic 3 stays
tolerable on first visit.

> **DECOMPOSED 2026-09-05.** This L-sized image container is cancelled before implementation as
> required by task policy and replaced by five ordered S slices. E5-T17a freezes the signed package
> manifest and offline profile; E5-T17b assembles the image and startup configuration; E5-T17c
> proves reproducibility, budget, and chunk deduplication; E5-T17d proves headless boot ordering;
> and E5-T17e proves E3 persistence and publishes the final artifact/documentation handoff.

> **DECOMPOSED 2026-09-05.** This L-sized image container is cancelled before implementation as
> required by task policy and replaced by five ordered S slices. E5-T17a freezes the signed package
> manifest and offline profile; E5-T17b assembles the image and startup configuration; E5-T17c
> proves reproducibility, budget, and chunk deduplication; E5-T17d proves headless boot ordering;
> and E5-T17e proves E3 persistence and publishes the final artifact/documentation handoff.

## Context
This is an image-engineering task, not a Linux-from-scratch adventure: extend the Epic 3
image builder (`tools/mkimage` or equivalent) with a desktop package set. T16e selected
Weston with its DRM/Pixman renderer, `foot` (terminal), `seatd`, `eudev` +
`udev-init-scripts`, `wl-clipboard`, `font-dejavu`, and `xkeyboard-config` (compositors
need XKB data); optional T22 tooling and the T19 audio test asset must be separately
pinned if they are added. Services: seatd in the boot
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
  (`/etc/inittab` autologin, `start-desktop`, Weston configuration, udev rules).
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

## Execution slices

This L-sized desktop-image container is cancelled before implementation and replaced by five
ordered S tickets. Each slice owns one falsifiable image boundary and one deterministic
`make verify-E5-T17*` command; the final child carries the completed image handoff to T18.

1. **E5-T17a — signed package manifest and offline profile.** Freeze the T16e-selected Weston,
   Pixman, foot, clipboard, seat, udev, font, and XKB package versions, repositories, hashes, and
   cache contract in a machine-readable builder profile. Reject unsigned or ambiguous package
   sources before any image assembly.
2. **E5-T17b — image assembly and startup configuration.** Extend the E3 image flow with the
   pinned profile, the desktop user/groups, seatd/udev setup, runtime-directory initialization,
   tty1 autologin, Weston DRM/Pixman startup, foot/clipboard configuration, and post-install file
   manifests. This slice builds one inspectable image; reproducibility and runtime boot loops are
   separate slices.
3. **E5-T17c — reproducibility, size budget, and streaming chunks.** Build twice from the same
   committed profile, compare timestamp-normalized package/file manifests, enforce the real
   uncompressed ext4 delta <=350 MiB, and prove the chunk manifest deduplicates unchanged E3 base
   chunks rather than re-uploading the whole image.
4. **E5-T17d — headless boot ordering.** Boot the final image repeatedly over serial, proving
   autologin, seatd-before-start-desktop ordering, the desktop user's 0700 XDG runtime directory,
   bounded startup failure logging, and no init hang. This is the race-focused runtime boundary.
5. **E5-T17e — persistence and final artifact handoff.** Run the E3 snapshot/reload smoke test,
   install one extra package in the running guest and verify it persists, inspect the image for
   build debris, and publish the final image/chunk manifests plus the `docs/images.md` section.

## Verification log

### 2026-09-05 — coordinator — decomposed

This L-sized desktop-image planning container is cancelled before implementation as required by
task policy and replaced by five ordered S tickets. The chain is package profile → image/config →
reproducibility/budget/chunks → boot ordering → persistence/publication; E5-T18 is rewired to the
final proof slice so bring-up cannot bypass the image's persistence and artifact handoff.
