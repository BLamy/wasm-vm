---
id: E5-T17b
epic: 5
title: Assemble Alpine desktop image and startup configuration
priority: 517.2
status: in-progress
depends_on: [E5-T17a]
estimate: S
risk: high
capstone: false
---

## Goal

Build one E3-derived Alpine riscv64 desktop image with the pinned Weston/Pixman stack, correct
desktop identity, and an explicit serial-safe startup configuration.

## Boundary

This slice owns image assembly and post-install configuration. It does not own two-build
reproducibility, size/chunk accounting, repeated boot race testing, or persistence proof.

## Deliverables

- `tools/image/desktop.sh` or an equivalent profile-driven builder extending the E3 image flow.
- Desktop user/group setup, seatd and udev/OpenRC configuration, `/run/user/1000` initialization,
  tty1 autologin, `start-desktop`, Weston DRM/Pixman launch, foot, and clipboard configuration.
- Timestamp-independent package and file manifests for the produced image, with no build cache,
  root history, or untracked post-install inputs included.

## Acceptance criteria

- [ ] A single `make verify-E5-T17b` build consumes only the T17a profile and emits an inspectable
      riscv64 ext4 image plus package/file manifests.
- [ ] The image contains the selected package set, a desktop user in `video,input,seat,audio`,
      seatd enabled in the intended runlevel, and an idempotent runtime-directory init path.
- [ ] tty1 autologin invokes a bounded `start-desktop` path with logs; it cannot hang init if
      Weston cannot open the guest display.
- [ ] Startup configuration names Weston DRM/Pixman explicitly and contains no GL/fbdev fallback
      hidden behind an automatic renderer choice.

## Adversarial verification

Run the builder twice in the same disposable output location and inspect the resulting rootfs for
root history, APK cache, credentials, world-writable runtime directories, or an autologin shell
that runs before seatd is configured. Re-run the post-install step and check that it does not
duplicate users, services, or config lines.

## Verification log

(empty)
