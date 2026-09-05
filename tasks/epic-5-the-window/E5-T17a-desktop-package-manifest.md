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

### 2026-09-05 — worker — IMPLEMENTED

- Commits: `9df46b08243624905e4e472657e26f31125ff678` (profile/validator) and
  `3ab104b05f305a5719476402be40e52f31ecaa52` (artifact/index digest pinning).
- Commands: `env -u RUSTFLAGS -u CARGO_HOME -u CARGO_TARGET_DIR -u RUST_LOG -u NODE_OPTIONS -u npm_config_userconfig make verify-E5-T17a`.
- Evidence: `evidence/e5-t17a/package-profile-verification.json` (SHA-256 `6a58a03a26cf762e63d82ff9ae6afacfc35755796678ae4db8e38a9643c3e715`); frozen profile `tools/image/e5-t17a-desktop-packages.json` (SHA-256 `177d2f563f92efc37ac92f78aade7801a7d03110580cbe48328f90c9f903b1d7`); package artifact source digest manifest `evidence/e5-t17a/package-artifact-digests.json` (SHA-256 `c647a1af6079c17fc7380493ac400309ae67e49902565f104f9ee9aef6f34c94`).
- Source bindings checked by the validator: T16e decision SHA-256 `d7e7c3b4a18f09af7d9132f7b75f1dfe0a6b3d191eed6e9db52182ca24029b18`, T16d package-audit SHA-256 `c08fced3877b9aab3bb7b37d044232f9b23e01482612f40093e76266591e574b`, and T16d audit-verification SHA-256 `e76b1a52ec8428d92f906842285a55fb1c1a14a32d2ed7c67ece0228a7ce207d`.
- The recorded run proves the exact 11-package Weston DRM/Pixman profile is bound to Alpine v3.20 riscv64 main/community repositories, pins every APK's repository, size, and SHA-256, pins both signed-tar APKINDEX digests, checks the embedded trusted signature member and riscv64 trusted-key directory, contains no `--allow-untrusted` token, declares explicit online-or-offline resolution, and refuses missing or tampered cached APKs/indexes/keys. The validator's deterministic self-test rejected wrong architecture, repository, missing/drifted package version and digest, package source/trust/artifact provenance drift, non-fail-closed cache, missing offline APK, and invalidated index mutations before image assembly.

### 2026-09-05 — fresh verifier — VERDICT: refuted

- P1 trusted-key identity — FAILED. Predicted that offline mode would reject a cache whose required
  `keys/riscv64` directory no longer contained the trusted key. Starting from a disposable cache
  populated with the recorded Alpine v3.20/riscv64 indexes and all 11 APKs, I moved the key out of
  the directory and left only `README`; `node tools/verify/e5-t17a-desktop-package-manifest.mjs
  --offline-cache <cache>` returned `TRUSTED_KEY_REPLACED_BY_README=UNEXPECTED_PASS`. The changed
  validator only checks `readdir(keyDir).length > 0` at
  `tools/verify/e5-t17a-desktop-package-manifest.mjs:312-314`, so missing/invalid key material is
  accepted. Require the checked-in trusted key member(s), valid key material, and a signature
  verification bound to those keys; add a negative test for replacement by unrelated files.
- P1 embedded index signer — FAILED. Predicted that an invalid signer member would not satisfy the
  offline signature policy. The bounded mutation `.SIGN.RSA.attacker.rsa.pub` was accepted by the
  exact pattern used at `tools/verify/e5-t17a-desktop-package-manifest.mjs:325-332`:
  `{"member":".SIGN.RSA.attacker.rsa.pub","requiredMemberPattern":"^\\.SIGN\\.RSA\\..+\\.rsa\\.pub$","validatorPatternAccepts":true}`.
  The check requires only a filename-shaped member and does not compare it with the recorded
  `.SIGN.RSA.alpine-devel@lists.alpinelinux.org-60ac2099.rsa.pub` signer or verify the member using
  trusted key material. Bind the required member/signature to the artifact evidence and verify it
  cryptographically (or fail closed on any non-exact member), with a mutation test.
- HELD: the intact-cache replay passed against the recorded artifact sizes/digests; missing APK,
  missing index, wrong APK, digest-tampered index, and an empty trusted-key directory were rejected.
  `make verify-E5-T17a` also passed from the worker's scrubbed environment, and the profile/package
  cross-checks matched the T16e handoff and T16d `weston-pixman` list. These held results do not clear
  the trust-boundary failures above. No runtime or unrelated files were changed.

Commands: `env -u RUSTFLAGS -u CARGO_HOME -u CARGO_TARGET_DIR -u RUST_LOG -u NODE_OPTIONS -u npm_config_userconfig make verify-E5-T17a`; local disposable-cache replay with `node tools/verify/e5-t17a-desktop-package-manifest.mjs --offline-cache <cache>` and the two bounded mutations above.

### 2026-09-05 — worker — REMEDIATION

- Commit: `5dbd4c9e23db84b90cdff48f473899211382d986`.
- Command: `env -u RUSTFLAGS -u CARGO_HOME -u CARGO_TARGET_DIR -u RUST_LOG -u NODE_OPTIONS -u npm_config_userconfig make verify-E5-T17a`.
- Evidence: profile SHA-256 `5e0ede77a0fe30fe2268a2a3b9bc322146e67cf128d9b15e6808cfa69cfb1a67`, artifact/key evidence SHA-256 `fdfb37b68a96456f4b0935895e278bc5e1b89830afd4fa1567dea67710ae3a01`, and verification output SHA-256 `06db58ea0a80189b5493df39f35d4fa60e8a18881592d3941c9b17d77d9c0d74`.
- The remediation binds offline mode to the exact `alpine-devel@lists.alpinelinux.org-60ac2099.rsa.pub` key path, size, SHA-256, and PEM format, rejects symlink/unrelated-file replacements, and requires exactly that signer member in each signed APKINDEX tar. The self-test now covers trusted-key replacement, attacker signer-member substitution, missing APK, and index-byte tampering; the bounded gate passes without independent-machine, WebKit, or host-rr legs.
