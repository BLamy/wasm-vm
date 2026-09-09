---
id: E5-T17e
epic: 5
title: Prove desktop image persistence and publish the final artifact handoff
priority: 517.5
status: verified
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

### 2026-09-05 — verifier — VERDICT: verified

- P1 persistence — HELD. Predicted the same sentinel bytes/hash and APK database hash after both
  reloads; `evidence/e5-t17e/desktop-persistence.json:194-217` records
  `E5T17E-SENTINEL-42`, 19 bytes, sentinel SHA-256 `c07685d3…0c99a`, and APK DB SHA-256
  `0b2e52ba…00b21` identically in pre-snapshot, reload-one, and reload-two state. The native
  transcripts corroborate this at `cold-install-snapshot-console.log:201-207`,
  `reload-one-snapshot-console.log:11-12`, and `reload-two-poweroff-console.log:12-13`.
- P2 signed package/network/profile boundary — HELD. Predicted successful network update and
  signed `htop` install, persistence, and no base-profile mutation; the cold transcript records
  `T17ENETREADY`, update/add return codes 0, `htop=present`, and unsigned return code 99 with
  rejection (`cold-install-snapshot-console.log:181,201-207`), while the report binds the package
  contract and `profileMutation:false` (`desktop-persistence.json:95-100,225-231`).
- P3 publication/docs/hash resolution — HELD. Predicted the exact tested image and chunk manifests
  would match their objects and the E3 dedupe accounting. The report records image SHA-256
  `467306a5…5a5c1e`, desktop/base manifest SHA-256 `1be3c299…fb4827` / `bf6a2c61…c8c46`,
  3,211 reused positions, 19 reused objects, 803 new objects, and 105,250,816 fetched bytes
  (`desktop-persistence.json:34-78`); independent `sha256sum` resolution matched all of them.
  `docs/images.md:9-22,36-55` documents the profile, startup path, measured delta, budget, and
  exact `make verify-E5-T17e` rebuild command.
- P4 hygiene/acceptance gate — HELD. Predicted no root credential/history, APK cache, or build
  debris and a passing deterministic verifier; `final-image-inspection.log:1-65` shows locked
  root, empty `/root` history-sensitive entries, empty APK cache and `/tmp`, expected startup/
  repositories, and an intact installed database. The required verifier self-test exited 0 and
  reported all five mutation checks rejected. The Makefile recipe is a harness only
  (`Makefile:865-880`); its behavior-bearing runner/verifier commands are covered by the submitted
  exact-head run and the fresh verifier run.
- Adversarial attacks — HELD. Repeated reload state held at both boundaries; the verifier's
  self-tests rejected chunk truncation, full-upload accounting mutation, sentinel truncation,
  unsigned acceptance, and hygiene mutation (`tools/verify/e5-t17e-desktop-persistence.mjs:402-425`).
  The independent bounded sabotage copied the report to a temporary path, changed only
  `publication.desktopChunkManifest.sha256`, and the evidence-mode verifier rejected it with
  exit 1: `AssertionError [ERR_ASSERTION]: desktop chunk manifest digest is stale`. The source
  validator also rejects `htop` leaking into the committed base manifest
  (`tools/verify/e5-t17e-desktop-persistence.mjs:68-91`).
- Coverage — HELD. The runner's phase/publication/persistence paths are exercised by the exact-head
  native evidence (`tools/run-e5-t17e-desktop-persistence.mjs:76-161,238-355`), the verifier's
  evidence path and adversarial checks are exercised fresh (`tools/verify/e5-t17e-desktop-persistence.mjs:29-47,68-425`),
  and the `Exited(0)` compatibility hunk is exercised by `reload-two-guest-evidence.txt:6`.
  Documentation, task/queue JSON, and Makefile orchestration are metadata/harness and are waived
  as runtime coverage; no changed implementation hunk is unaccounted for.

Commands: `node tools/verify/e5-t17e-desktop-persistence.mjs --self-test`; independent temporary
report sabotage with `--evidence <temp-report>` (expected exit 1); direct SHA-256/path audit;
`python3 tools/check_task_policy.py`; `python3 tools/build_queue.py`; `make tasks-json`.
