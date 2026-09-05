---
id: E5-T17a
epic: 5
title: Freeze signed Alpine desktop package manifest and offline profile
priority: 517.1
status: implemented
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

### 2026-09-05 — worker — IMPLEMENTED

- Commit: `9df46b08243624905e4e472657e26f31125ff678`.
- Commands: `env -u RUSTFLAGS -u CARGO_HOME -u CARGO_TARGET_DIR -u RUST_LOG -u NODE_OPTIONS -u npm_config_userconfig make verify-E5-T17a`.
- Evidence: `evidence/e5-t17a/package-profile-verification.json` (SHA-256 `b90cd3a94b4a0ad0ffff82602d98c19352493cb59153d52f508a9a9946ae12a5`); frozen profile `tools/image/e5-t17a-desktop-packages.json` (SHA-256 `a73d142d942e06e568964675323a77ccd04dceae8d51de742a13cdd753d8a3a7`).
- Source bindings checked by the validator: T16e decision SHA-256 `d7e7c3b4a18f09af7d9132f7b75f1dfe0a6b3d191eed6e9db52182ca24029b18`, T16d package-audit SHA-256 `c08fced3877b9aab3bb7b37d044232f9b23e01482612f40093e76266591e574b`, and T16d audit-verification SHA-256 `e76b1a52ec8428d92f906842285a55fb1c1a14a32d2ed7c67ece0228a7ce207d`.
- The recorded run proves the exact 11-package Weston DRM/Pixman profile is bound to Alpine v3.20 riscv64 main/community repositories, uses default APK signature verification with the riscv64 trusted-key directory, contains no `--allow-untrusted` token, declares explicit online-or-offline resolution, and refuses missing cached APKs, indexes, keys, or invalid cache policy. The validator's deterministic self-test rejected wrong architecture, repository, package version/source, trust option, non-fail-closed cache, and missing offline APK mutations before image assembly.
