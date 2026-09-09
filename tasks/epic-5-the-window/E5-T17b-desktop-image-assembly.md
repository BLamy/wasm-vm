---
id: E5-T17b
epic: 5
title: Assemble Alpine desktop image and startup configuration
priority: 517.2
status: verified
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

### 2026-09-05 — worker — REMEDIATION

- Commit: `0a64512` (`fix(e5-t17b): use supported timeout syntax`), on top of verifier refutation commit `690bfa9`.
- Commands: `env -u RUSTFLAGS -u CARGO_HOME -u CARGO_TARGET_DIR -u RUST_LOG -u NODE_OPTIONS -u npm_config_userconfig make verify-E5-T17b`; then the same scrubbed environment with `E5_T17B_OUT=target/e5-t17b/desktop-image bash tools/image/desktop.sh` followed by `node tools/verify/e5-t17b-desktop-image.mjs --out target/e5-t17b/desktop-image --self-test` for the second same-output build.
- Evidence: refreshed `evidence/e5-t17b/desktop-image-verification.json` (SHA-256 `2409458fdfd436a5c600ddbefe7cba465c2382f0636e46a671daea7a988e648a`) and `evidence/e5-t17b/desktop-image-repeat.json` (SHA-256 `e43cda8a18d602628fdf51a1893cc34857ed35d2de39102de5c18fff4dedaedb`). Final image SHA-256 is `59780504eaef13b093053b5bb99d556058b96af8ed226baa89fb20d132f4ddf1`, package manifest SHA-256 is `225b8d35f7375c084075ca60edac5ea8fbf7ef46f1fd09a7e3a5d40bb074aae1`, and custom-file manifest SHA-256 is `c66d92365bdbb8b59a3aa63ade045e7da7096afd51039cfb36bc6b32fbee05ea`.
- The corrected launcher uses Alpine BusyBox's positional `timeout 30` syntax for both Weston and foot. The rebuilt image passed native formatting/clippy/tests, release compilation, signed profile-driven assembly, ext4 fsck/foreign-ELF checks, read-only image inspection, duplicate-entry checks, and the execution-level no-display test: a fake sleeping Weston was invoked and the bounded path produced `E5T17B_WESTON_NOT_READY=1` before returning. The same-output rebuild also passed with identical package/file manifests; byte reproducibility, size, and chunk accounting remain T17c scope. No independent-machine, WebKit, or host-rr leg was used.

VERDICT: verified

### 2026-09-05 — independent fresh verifier

- P1 prior timeout refutation — HELD after remediation. Prediction: a fake Weston that sleeps beyond the display wait must be invoked by the assembled launcher, the launcher must return at the 30-second bound, and `weston.log` must contain `E5T17B_WESTON_NOT_READY=1`. Observed on the current generated image (`target/e5-t17b/desktop-image/alpine-rootfs.ext4`, SHA-256 `5680ac904ff93e474358abfe50e7c7c68d1832824b2f128788df4fbdfac98adb`): the fake was invoked, the command returned in `30s`, and the log contained `E5T17B_WESTON_INVOKED=1` plus `E5T17B_WESTON_NOT_READY=1`; no BusyBox `unrecognized option: t` output occurred. This exercises `tools/rootfs-inner.sh:368-388`, so the fix is behavioral rather than regex-only.
- P2 ready-socket/foot bound — HELD. Prediction: when fake Weston creates the requested Wayland socket and sleeps, fake foot must be invoked through the ready path and the compositor/terminal session must still return at the 30-second bound. Observed in local Docker in `30s`: `E5T17B_FAKE_WESTON_INVOKED=1`, `E5T17B_WESTON_READY=1`, `E5T17B_FAKE_FOOT_INVOKED=1`, and `E5T17B_WESTON_EXIT=143`. This executes both current positional BusyBox forms at `tools/rootfs-inner.sh:368` and `:392`.
- P3 acceptance/coverage — HELD. Prediction: the current target must remain a 194-package riscv64 ext4 image driven by the 11-entry T17a profile, with exact-once desktop identity/groups/services/configuration, explicit DRM/Pixman startup, locked credentials, empty APK/root-history surfaces, and private runtime directories. `make verify-E5-T17b` passed at the frozen head: fmt, clippy, 54 native tests, release build, profile validation, 194-package signed assembly, clean ext4 fsck, riscv64-only ELF scan, debugfs inspection, manifest checksums, duplicate-path checks, and verifier self-tests. Direct checks found 194 package-manifest lines, all 11 profile package IDs, 33 custom-file entries with no duplicate paths, `desktop` uid/gid 1000 in `video,input,seat,audio`, seatd/default plus udev ordering, tty1 autologin, DRM/Pixman-only Weston configuration, locked root, no APK/root-history residue, and mode 0700 for `/run/user/1000`, `/home/desktop`, and desktop state.
- P4 post-install idempotence — HELD. Prediction: two executions of the post-install script against one root tree must not duplicate the tty1 line. In a disposable local Docker build container, two `/rootfs-inner.sh` invocations both exited 0 and the final count was `E5T17B_TTY1_COUNT=1`; the ordinary same-output rebuild plus verifier also passed. The runtime-directory initializer is likewise guarded by `mkdir -p`, mode reset, and ownership reset.
- Carried forward only unchanged HELD results from the prior verifier for the profile/manifests, identity/groups, seatd/udev ordering, autologin, credentials/cache cleanup, private directories, and duplicate-entry inspection; the previously FAILED timeout claim was re-executed above. T17c-owned byte reproducibility, size/chunk accounting, repeated boot races, persistence, independent machines, WebKit, and host rr were not used.

Commands: `env -u RUSTFLAGS -u CARGO_HOME -u CARGO_TARGET_DIR -u RUST_LOG -u NODE_OPTIONS -u npm_config_userconfig make verify-E5-T17b`; the same scrubbed environment with `E5_T17B_OUT=target/e5-t17b/desktop-image bash tools/image/desktop.sh` followed by `node tools/verify/e5-t17b-desktop-image.mjs --out target/e5-t17b/desktop-image --self-test`; local Docker/debugfs content inspection; local Docker fake-sleeping-Weston no-display execution (35-second fake, observed 30-second return); local Docker fake-ready-Weston/fake-foot execution (both 35-second fakes, observed 30-second return); and a disposable local Docker container running `/rootfs-inner.sh` twice against one root tree (both exit 0, tty1 count 1). Evidence refreshed at `evidence/e5-t17b/desktop-image-verification.json`; generated target manifests are `target/e5-t17b/desktop-image/MANIFEST.txt`, `FILE-MANIFEST.txt`, and `SHA256SUMS`.
