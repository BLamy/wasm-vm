---
id: E5-T05c
epic: 5
title: Epic 5 kernel headless boot and provenance regression
priority: 505.3
status: verified
depends_on: [E5-T05b]
estimate: S
risk: high
capstone: false
---

## Goal

Prove the rebuilt kernel still boots the existing E3/E4 headless image to its serial login path
without a virtio-gpu device, while preserving the old boot/error profile and exact artifact
provenance.

## Deliverables

- A deterministic native headless boot capture using the rebuilt kernel and the existing rootfs,
  including the serial login boundary and guest instruction/time totals.
- A dmesg comparison/allowlist for new graphics/input/sound/console initialization lines and any
  unexpected warnings or errors.
- Final task evidence tying the booted kernel hash, config hash, manifest hash, and measured size
  delta together.

## Acceptance criteria

- The existing image reaches `login:` with serial console intact within 10% of the E4 baseline.
- With no virtio-gpu attached, dmesg has no DRM probe errors; newly enabled built-in drivers do not
  introduce an unallowlisted warning or boot hang.
- The recorded config still has every required symbol `=y` and no `=m`; its hash matches the
  manifest/release evidence from E5-T05b.

## Adversarial verification

Boot once with `console=tty0` only and once with the normal serial arguments; distinguish silent
alive from a pre-fbcon hang by instruction progress. Diff full dmesg against the E4 baseline and
rerun the checksum/config gates from a clean build output.

## Verification log

### 2026-09-03 — coordinator — VERDICT: verified (user-directed)

- **Serial boot — HELD.** The rebuilt `releases/kernel/6.6.63/Image` reached the real Alpine
  `wasm-vm login:` marker with `root=/dev/vda rw console=ttyS0 earlycon=sbi`; the process exited 0
  after `--profile-boot` stopped at the marker. The profile measured `326709 ms` and
  `2987773083` retired guest instructions, with guest evidence `fnv64=bf0bcd7ece663955` and state
  SHA-256 `33c49504dd55cd77312d02ec529d12cd41ce2bff51f8bac623686579f52698c2`.
- **Same-host regression comparison — HELD.** A local replay of the exact same command and
  disposable rootfs with the pre-Epic-5 Image (`08caa7dd…879f58`) measured `323462 ms` and
  `2973374117` retired instructions. The rebuilt kernel is `+1.003%` wall time and `+0.484%`
  retired instructions, inside the 10% regression envelope. The historical E4-T04 ledger stopwatch
  is `375386 ms`; the rebuilt run is `12.967%` faster than that older host-time sample, while its
  retired anchor is only `+0.559%`. The same-host A/B is the comparable timing proof because the
  baseline documentation marks wall time as host-dependent.
- **Driver/dmesg comparison — HELD.** Timestamp-normalized full-console diff against the old
  Image contained only the expected built-in-image memory/layout changes, ALSA initialization
  (`Advanced Linux Sound Architecture Driver Initialized`, `ALSA device list`, `No soundcards
  found`), and the goldfish-RTC wall-clock timestamp. There were no DRM/GPU, input, or virtio-snd
  probe errors and no `WARNING`, `BUG`, `Oops`, `I/O error`, or RCU-stall matches. Existing
  syscon-poweroff, no-module-directory, RTC, and no-network warnings were present in both logs and
  are allowlisted in the evidence report.
- **`console=tty0` attack — HELD.** With `root=/dev/vda rw console=tty0`, stdout remained exactly
  zero bytes while the guest retired `499982897` instructions and exited at the explicit
  `500000000` bound (`rc=102`), with guest state SHA-256
  `0467a414fbcc82fa203d4154a6a2dc0d2eae515b879bc1710febe79001560877`; this distinguishes silent
  progress from a pre-fbcon hang.
- **Final provenance — HELD.** The booted Image SHA-256 is
  `af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce`, the shipped config SHA-256
  is `18da28e0c47eebda7950564df60df7a13b56b1ffa37ee6b0463924b81f95595d`, and all T05b source
  manifests bind that Image hash and size `24208896`; the artifact grew `2111488` bytes
  (`2.013672 MiB`) against the `4 MiB` budget. T05b's config and checksum gates were rerun after
  the boot comparison and passed.
- **Scope note — HELD.** Independent machines, WebKit, and host-layer rr are excluded per the
  user's direction and current repository evidence policy.
- Evidence: `evidence/e5-t05c/dmesg-allowlist-2026-09-03.json` (SHA-256
  `53b93ed3e3194d7bfccdfc53ab916d5d58dea00550093da18a8b8f4333b4f033`), with the complete serial,
  baseline, `console=tty0`, profile, and guest-evidence captures in the same directory.
