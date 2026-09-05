---
id: E5-T17e
epic: 5
title: Prove desktop image persistence and publish the final artifact handoff
priority: 517.5
status: in-progress
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

(empty)
