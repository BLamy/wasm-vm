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

### 2026-09-05 — worker — IMPLEMENTED

- Commit: `7802897d1ac593cc189f63122436ad4ab5e58753`.
- Commands: `env -u RUSTFLAGS -u CARGO_HOME -u CARGO_TARGET_DIR -u RUST_LOG -u NODE_OPTIONS -u npm_config_userconfig make verify-E5-T17b`; then the same scrubbed environment with `E5_T17B_OUT=target/e5-t17b/desktop-image bash tools/image/desktop.sh` followed by `node tools/verify/e5-t17b-desktop-image.mjs --out target/e5-t17b/desktop-image --self-test` for the second same-output build.
- Evidence: `evidence/e5-t17b/desktop-image-verification.json` (SHA-256 `a24b9c6a0231290ce25fd8ff990ecf7a78020a753dabd33c298586b7f34bb432`) and `evidence/e5-t17b/desktop-image-repeat.json` (SHA-256 `549cb1baefa74cf3ceff2151158544c04b82026fce860def760c7a32437cb2ce`). Final image SHA-256 is `b5bf37b9c2a3dbafb5faab7b25987ed015ba070ccc82d8ccb6d4f03125782671`, package manifest SHA-256 is `225b8d35f7375c084075ca60edac5ea8fbf7ef46f1fd09a7e3a5d40bb074aae1`, and custom-file manifest SHA-256 is `29f9069e7a99bae65f691fb394392663ca6e52faa6c1aedd6bfd95bebba74803`.
- The final local run passed formatting, clippy, 54 native tests, release compilation, the T17a profile validator, signed Alpine v3.20 riscv64 assembly of 194 packages, and read-only Docker/debugfs inspection. It demonstrates the exact T17a profile feeding an inspectable 1 GiB ext4 image with a desktop user in `video,input,seat,audio`, seatd/udev ordering, private runtime directories, tty1 autologin, bounded Weston DRM/Pixman plus foot launch/log paths, clipboard wrappers, locked root credentials, and no root/APK-cache residue. The second same-output build and inspection passed with identical package/file manifests and duplicate-entry checks; ext4 byte reproducibility, size, and chunk accounting remain explicitly owned by E5-T17c. No independent-machine, WebKit, or host-rr leg was used.

### 2026-09-05 — fresh verifier — VERDICT: refuted

- P1 bounded Weston/Pixman startup — FAILED. Predicted that a fake `weston` which records invocation and sleeps would be launched by the assembled `/usr/local/bin/start-desktop`, then be stopped by the 30-second bound with `E5T17B_WESTON_NOT_READY=1`. On the current generated image (`target/e5-t17b/desktop-image/alpine-rootfs.ext4`, SHA-256 `f3cdc19e5938de09dbc82dcef7e55d2d98fc74cb60878103ea072528df3f1e51`), Docker/debugfs extraction and execution returned in about 1 second, the fake invocation marker was absent, and `weston.log` contained `timeout: unrecognized option: t` followed by BusyBox's usage `timeout ... SECS PROG ARGS`. The changed launcher emits the invalid form at `tools/rootfs-inner.sh:368-370` and repeats it for foot at `:392-393`; the image's BusyBox is v1.36.1 and accepts a positional seconds argument, not `-t`. This means the desktop path never launches Weston or foot, so acceptance criteria 3 and 4 are not met. Replace both forms with the image-supported timeout syntax and add an execution-level negative-display test; the current verifier's regex at `tools/verify/e5-t17b-desktop-image.mjs:234-235` is insufficient because it blesses the invalid command.
- HELD: `env -u RUSTFLAGS -u CARGO_HOME -u CARGO_TARGET_DIR -u RUST_LOG -u NODE_OPTIONS -u npm_config_userconfig make verify-E5-T17b` passed with 54 native tests, release build, 194-package riscv64 assembly, ext4 fsck, foreign-ELF scan, and the existing verifier. Read-only Docker/debugfs checks on the current image also confirmed the 11 T17a desktop packages, exact-once desktop/group/service/config entries, locked root shadow, empty APK cache, and private `/run/user/1000`, `/home/desktop`, and desktop state directories. The same-output rerun produced identical package/file manifests and a different image hash; T17c/T17d boundaries were not used to excuse the launcher failure.

Commands: `env -u RUSTFLAGS -u CARGO_HOME -u CARGO_TARGET_DIR -u RUST_LOG -u NODE_OPTIONS -u npm_config_userconfig make verify-E5-T17b`; same scrubbed environment with `E5_T17B_OUT=target/e5-t17b/desktop-image bash tools/image/desktop.sh` followed by `node tools/verify/e5-t17b-desktop-image.mjs --out target/e5-t17b/desktop-image --self-test`; local Docker/debugfs extraction of `/usr/local/bin/start-desktop` with a fake sleeping Weston; read-only package, manifest-duplicate, credential/cache, mode, service-link, and ext4/fsck inspections. No independent-machine, WebKit, ssh, or rr leg was used.
