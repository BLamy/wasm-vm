---
id: E5-T17e
epic: 5
title: Prove desktop image persistence and publish the final artifact handoff
priority: 517.5
status: implemented
depends_on: [E5-T17d]
estimate: S
risk: high
capstone: false
---

## Goal

Close the T17 image lane by proving E3 overlay persistence on the desktop image and publishing a
clean, documented artifact/chunk handoff for E5-T18 and later desktop work.

## Boundary

This slice owns persistence/reload, final image hygiene, artifact publication, and `docs/images.md`.
It does not add new display features or bypass the T17a-d gates.

## Deliverables

- E3 snapshot/reload smoke evidence on the final desktop image, including a guest-side extra-package
  install that survives reload.
- Final image, package/file/chunk manifests and hashes published through the existing E3 artifact
  flow, with no APK cache, root history, or temporary build debris.
- `docs/images.md` contents, budget accounting, rebuild instructions, and T18 handoff details.
- A deterministic `make verify-E5-T17e` target covering the final publication boundary.

## Acceptance criteria

- [ ] The desktop image's writable overlay survives snapshot/reload with a sentinel file and its
      package database intact; the smoke test records matching pre/post state.
- [ ] One extra signed `apk add` in the running riscv64 guest succeeds through the E3 network and
      persists after reload, without changing the committed base profile.
- [ ] Published artifact/chunk manifests identify the final image and dedupe against E3; docs
      record the measured delta, package profile, startup path, and exact rebuild command.
- [ ] Final-image inspection finds no leftover build cache, `/root` history, credentials, or other
      undeclared payload, and `make verify-E5-T17e` passes.

## Adversarial verification

Reload repeatedly at the snapshot boundary, corrupt/truncate the sentinel, attempt an unsigned
extra package, and compare the published chunk manifest against the actual image. Verify that a
full re-upload or a package mutation outside the profile fails closed, and that the documented
artifact hashes resolve to the exact image under test.

## Verification log

### 2026-09-05 — worker — implemented

- Implementation commit: `8a49a9a73d304845c45975dc3065ec7aac900b58`. Added the deterministic
  `make verify-E5-T17e` target, the native guest persistence runner/verifier, and `docs/images.md`.
  The runner keeps the T17c publication image read-only, boots a clean copy through the local
  riscv64 emulator, installs signed `htop` through the guest slirp network, writes a sentinel,
  and saves/reloads the machine twice before a final `poweroff -f`.
- Exact worker gates: `cargo fmt --check -p wasm-vm-cli`; `cargo clippy -p wasm-vm-cli --bin
  wasm-vm --features gpu-trace -- -D warnings`; `cargo build --release -p wasm-vm-cli
  --features gpu-trace`; shell/JS syntax checks; `make verify-E5-T17c`; and
  `node tools/run-e5-t17e-desktop-persistence.mjs`. The standalone verifier also passed
  `node tools/verify/e5-t17e-desktop-persistence.mjs --self-test`.
- Evidence: `evidence/e5-t17e/desktop-persistence.json` and its console/stderr logs,
  `evidence/e5-t17e/reload-two-guest-evidence.txt`, and
  `evidence/e5-t17e/final-image-inspection.log`. The final image is
  `target/e5-t17c/repro-b/alpine-rootfs.ext4`, SHA-256
  `467306a5d842f95927c1f5823363271b55854517f6318576a6a137f5615a5c1e`; the publication record
  independently matched the E3 base and desktop chunk manifests, including 3,211 reused positions
  and 803 new objects. The guest recorded `htop` present plus identical sentinel and
  `/lib/apk/db/installed` hashes before and after both reloads; the malformed unsigned package
  probe returned 99 and was rejected.
- Claim: the final T17c desktop artifact is cleanly published through the E3 chunk flow, the
  writable overlay preserves a guest package mutation and sentinel across repeated native
  save/resume cycles, and the final image's root credentials/cache/history hygiene remains intact.
  This local guest proof intentionally has no independent-machine, WebKit, or host-rr leg.
