---
id: E5-T17a
epic: 5
title: Freeze signed Alpine desktop package manifest and offline profile
priority: 517.1
status: in-progress
depends_on: [E5-T16e]
estimate: S
risk: medium
capstone: false
---

## Goal

Turn the E5-T16e Weston decision into one pinned, machine-readable Alpine riscv64 package profile
that the desktop image builder can consume online or from a committed offline cache.

## Boundary

This slice owns package names, versions, repository/architecture binding, hashes, and cache policy.
It does not assemble the ext4 image or prove boot, reproducibility, chunking, or persistence.

## Deliverables

- A committed desktop package/profile manifest containing the exact E5-T16e Weston DRM/Pixman,
  foot, wl-clipboard, seatd, eudev, udev-init-scripts, Pixman, XKB, and font packages.
- Repository and architecture metadata bound to the verified Alpine v3.20 riscv64 audit, with a
  documented offline APK cache layout and signature-verification policy.
- A deterministic profile validator and `make verify-E5-T17a` target; no `--allow-untrusted` path.

## Acceptance criteria

- [ ] The validator resolves every required package to the T16e decision/audit and rejects a
      missing version, repository, architecture, digest, or signature policy.
- [ ] The profile has an explicit online/offline mode and fails closed when a required cached APK
      or its trusted index/key is absent.
- [ ] The exact requested package set has no silent dependency substitution; optional T22 tooling
      is separately labelled and pinned if included.
- [ ] `make verify-E5-T17a` passes from a scrubbed environment and the profile contains no
      `--allow-untrusted` token.

## Adversarial verification

Copy the profile and mutate one version, repository, architecture, digest, or trust flag; the
validator must fail before image assembly. Remove one cached APK and invalidate one index signature;
offline mode must refuse to proceed rather than silently reaching the network or selecting a newer
package.

## Verification log

(empty)
