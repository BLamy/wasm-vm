---
id: E5-T05
epic: 5
title: Kernel rebuild with the graphics/input/sound/console driver stack
priority: 505
status: pending
depends_on: [E4]
estimate: M
capstone: false
---

## Goal
A rebuilt riscv64 kernel artifact whose config enables every guest-side driver Epic 5
needs — virtio-gpu DRM/KMS with fbdev emulation and fbcon, virtio-input evdev, virtio-snd
ALSA, virtio-console multiport — while still booting the Epic 3/4 images unchanged when
no display device is present.

## Context
Bet #3 says we never write a guest driver; this task turns the ones Linux already ships
on. Required (all =y, no module loading complexity in initramfs): `CONFIG_DRM`,
`CONFIG_DRM_VIRTIO_GPU`, `CONFIG_DRM_FBDEV_EMULATION`, `CONFIG_FB`,
`CONFIG_FRAMEBUFFER_CONSOLE` (+`_DETECT_PRIMARY`), `CONFIG_FONT_8x16`,
`CONFIG_VIRTIO_INPUT`, `CONFIG_INPUT_EVDEV`, `CONFIG_SND`, `CONFIG_SND_PCM`,
`CONFIG_SND_VIRTIO`, `CONFIG_VIRTIO_CONSOLE`, plus `CONFIG_VT`/`CONFIG_VT_CONSOLE` for
fbcon VTs. `CONFIG_LOGO` optional but a nice first-light beacon. Watch image growth: DRM
adds ~2 MiB. The build pipeline is the Epic 2 kernel-build tooling; this is a config
delta + artifact bump, not a new pipeline.

## Deliverables
- Updated kernel config fragment under `guest/kernel/` (checked-in diffable fragment,
  merged via `scripts/kconfig/merge_config.sh`, not a hand-edited monolith).
- Rebuilt `Image` artifact + updated artifact manifest/hash used by the loader.
- `guest/kernel/README` note: exact config symbols added and resulting size delta.
- CI/native boot regression: E3 headless image boots to login with the new kernel with
  zero new error lines in dmesg (allowlist file for benign new lines).

## Acceptance criteria
- [ ] `zcat /proc/config.gz | grep` (or the build tree `.config`) shows every symbol
      above as `=y`.
- [ ] New kernel boots the existing E3/E4 rootfs to `login:` with serial console intact;
      boot time within 10% of the E4 baseline measurement.
- [ ] With no virtio-gpu device on the bus, dmesg contains no DRM probe errors.
- [ ] Kernel image size increase is recorded and ≤ 4 MiB over the E4 artifact.
- [ ] `ls /dev/dri` (device present, after T07) and `dmesg | grep -i "virtio.*input\|snd"`
      show the drivers registered — deferred check, noted for T07/T11/T19 verifiers.

## Adversarial verification
Refute by regression: diff full dmesg (headless boot, new vs old kernel) and flag any new
warning/error not in the allowlist. Boot with `console=tty0` only (no serial arg) — the
kernel must not hang pre-fbcon (it will be blind until T07; hang vs. silent-alive is
distinguishable via the E4 trace/instruction-counter tooling — a livelocked idle loop vs
progressing PID 1). Verify the config fragment actually produces the shipped artifact:
rebuild from a clean tree and compare the kernel's build-id/hash to the manifest — a
mismatch (hand-patched artifact) is a refutation. Confirm compliance suite still passes
under JIT with the new kernel image in the boot-bench harness.

## Verification log
(empty)
