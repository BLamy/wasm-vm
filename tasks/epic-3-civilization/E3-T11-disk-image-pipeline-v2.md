---
id: E3-T11
epic: 3
title: Reproducible Alpine disk-image build pipeline v2 with chunking
priority: 311
status: verified
depends_on: [E3-T01]
estimate: M
capstone: false
---

## Goal
One command builds the production Alpine riscv64 disk image reproducibly — pinned package
versions, preinstalled baseline, deterministic bytes — then chunks it, generates the T01
manifest and the T03 boot profile, and emits a CDN-ready artifact directory with
content-addressed, immutably-cacheable files.

## Context
Epic 2's image was hand-rolled; Civilization needs an image we can rebuild byte-identically
(so chunk hashes are stable and CDN caches stay warm across rebuilds that don't change
content). Build via Docker (or apko/alpine-make-rootfs) against a *pinned* Alpine snapshot
mirror or an explicit apk-versioned world file; set `SOURCE_DATE_EPOCH`, normalize
timestamps/uids in the ext4 image (mke2fs `-d` with fixed hash seed via `-U` and
`E2FSPROGS_FAKE_TIME`). Baseline packages: alpine-base, agetty/openrc bits from Epic 2,
ca-certificates, curl, nano or vim — lean; python3 stays *out* (the capstone installs it).
`/etc/apk/repositories` must point at the HTTPS mirror the Tailscale transport and the relay
fallback will both reach (see T17/T20); do not couple the production image to the optional
browser-fetch fast path. Artifacts: `manifest.json`, `chunks/{sha256}.bin`, `boot-profile.json`,
`image-info.json` (build inputs, versions) — all safe to serve with
`Cache-Control: immutable` because names are content hashes.

## Deliverables
- `tools/build_image/` (Dockerfile + script or Makefile): rootfs build → ext4 → chunk +
  manifest + boot-profile generation, one entrypoint `./build.sh`.
- Reproducibility check built into the script: build twice, diff manifests, fail on drift.
- Pinning mechanism (snapshot mirror URL or committed `world` + explicit versions) checked
  into the repo.
- `docs/design/image-pipeline.md`: inputs, determinism techniques, how to bump packages,
  CDN layout and cache-header guidance.
- The built artifact set adopted as the image the web app loads by default.

## Acceptance criteria
- [x] Two consecutive `./build.sh` runs on the same commit produce identical
      `manifest.json` (hence identical chunk set) — asserted by the script itself.
- [x] The image boots to login through the T02/T03 streaming path and `apk update`
      succeeds through the T17 Tailscale provider once networking exists (until then:
      `apk version` runs and the repositories file matches the documented HTTPS URL).
- [x] No chunk file exceeds the manifest's chunk size; every file in `chunks/` is
      referenced by the manifest and vice versa (script-asserted).
- [x] `image-info.json` records the Alpine release, mirror snapshot, and package list with
      exact versions.
- [x] A one-package change (add `htop`) rebuilds with the majority of chunk hashes
      unchanged (record the churn percentage in the log — this validates CDN-friendliness).

## Adversarial verification
Rebuild on a *different machine/OS* (or at least a different Docker cache state) and diff
manifests — any drift refutes reproducibility. `mount` the assembled image and hunt for
nondeterminism sources: timestamps newer than SOURCE_DATE_EPOCH, random seeds, `/etc/
machine-id`, ssh host keys (must be absent/generated-on-first-boot). Corrupt one chunk in
the artifact dir and confirm the manifest hash check catches it at load. Verify the churn
claim: if adding one package rewrites >50% of chunks, the ext4 layout isn't stable — refute
and demand investigation (e.g., fixed inode allocation via `-d` ordering).

## Verification log

**2026-07-06 — pipeline orchestration + integrity/churn gates + a real reproducibility bug (pass 1).**
`tools/build_image/build.sh`: one command → reproducible ext4 (E2-T18) → `wasm-vm chunk` →
`chunk-verify` integrity gate → `image-info.json` (Alpine release, mirror, epoch, exact package
lock) → optional `REPRO_CHECK=1` double-build/diff gate. The integrity + CDN-churn logic is native
Rust (`crates/cli/src/chunk_verify.rs`: `chunk-verify` = manifest↔chunks/ mutual consistency
[missing/corrupt/orphan/oversized → nonzero exit, reusing `ImageManifest::verify_chunk`];
`chunk-churn --old --new [--max-churn-pct]` = (added+removed)/union over chunk sets, the
CDN-friendliness metric). `docs/design/image-pipeline.md`: determinism techniques, CDN cache
headers (immutable content-addressed chunks), package-bump flow, adversarial checklist.

**Native acceptance MET (`crates/cli/tests/chunk_verify.rs`, 5 passed):** clean dir verifies;
a flipped chunk byte → `HashMismatch`; a removed chunk → `MissingChunk`; an extra file →
`OrphanChunk`; identical rebuilds → 0.0% churn while a one-region change stays small and the
`--max-churn-pct` ceiling both passes (50%) and trips (1%). Also ran `chunk-verify` on the REAL
committed `releases/chunked-alpine` → OK, 87 distinct chunks.

**The REPRO_CHECK gate caught a genuine nondeterminism bug (the charter's point):** two builds
produced DIFFERENT manifests — **11.2% churn, 10 of 84 chunks** — because `mke2fs` pinned the fs
UUID (`-U`) but NOT the directory-htree **hash seed**, which it randomizes per build (the churned
chunks were the directory-index blocks). E2-T18 only ever claimed package-level reproducibility,
not byte-identical ext4 — this gate is what forces the stronger guarantee. Attempted fix in
`tools/rootfs-inner.sh` (`-E hash_seed=$FS_UUID`, kept as legit hardening) — but the RE-RUN
churn was UNCHANGED (still 11.2%, the SAME 5 chunk indices: 0, 2, 3, 1024, 3072). Those offsets
are the primary superblock + block-group descriptors + backup superblocks at group boundaries
(128 MB, 384 MB) — i.e. a random field REPLICATED across every superblock copy, almost certainly
`s_hash_seed`, which the `-E hash_seed=` option did not visibly pin (mke2fs accepted it without
error yet the bytes didn't change — needs a `dumpe2fs -h` diff of the two images to confirm which
field, done in pass 2). **So byte-identical reproducibility is NOT yet achieved** — honest status:
the pipeline, the integrity/churn checker, and the reproducibility GATE are done and tested (the
gate correctly refuses to pass a non-reproducible build), but the ext4-metadata determinism fix
is unfinished. `build.sh` now dumps the differing chunk indices + keeps both `.ext4` images on a
failed REPRO_CHECK so pass 2 can `dumpe2fs`-diff and pinpoint the field.

Gates: clippy(all-features) 0, fmt, determinism, cli tests. **Remaining (pass 2):** finish the
byte-repro fix (dumpe2fs-diff → pin the residual superblock field); cross-host rebuild diff;
mount-and-hunt (machine-id / ssh keys / mtimes > epoch); adopt the rebuilt artifact as the web
default + regenerate web/artifacts-alpine.json; boot-through-streaming acceptance.

**2026-07-06 update — root-caused via dumpe2fs; 11.2% → 4.7%, residual parked.**
`dumpe2fs -h` on the built image showed the Directory Hash Seed WAS correctly pinned to FS_UUID
(my first fix worked) — the churn was the superblock **"Last write time"** (`s_wtime`), stamped
with the real wall clock and replicated into every backup superblock (chunks 0/2/3/1024/3072).
`E2FSPROGS_FAKE_TIME=$SOURCE_DATE_EPOCH` froze it → churn dropped to **4.7% (chunks 2, 3 only)**.
Normalizing the source tree's mtimes (`find -exec touch -d @epoch`) did NOT clear the last 2
chunks — they are the **inode table**, and the residual is almost certainly `mke2fs -d`
**inode-allocation ORDER** (nondeterministic directory-walk order → shifted inode numbers), a
known-hard reproducible-builds problem that needs a mke2fs-level fix (sorted walk / a different
packer), not an env var. **PARKED** here: byte-repro is NOT on the container critical path (the
E3.5 OCI importer unpacks *pulled* layers, not this base image), and Brett reprioritized toward
`wvrun postgres`. Net verified progress: superblock determinism fixed + root-caused (95.3%
reproducible), the pipeline/checker/gate all done and tested. Resume: pin inode order (e.g.
`mke2fs`'s deterministic-`-d` behavior or a pre-sorted tar → `mkfs`), then flip to byte-identical.

### 2026-07-17 — worker — implemented

Commit: `280c3a9` (`feat: finish reproducible Alpine image pipeline`). Claim: E3-T11 is now a
one-command production pipeline, not a parked partial. Exact-version Alpine installation, pinned
ext4 metadata (including imported inode ctime), chunk integrity, a real login-derived prefetch
profile, browser-default adoption, and the one-package cache-retention attack all execute and pass.

- **Cold reproducibility + final artifacts.** `DOCKER_BUILD_NO_CACHE=1 REPRO_CHECK=1 bash
  tools/build_image/build.sh` performed two independent 84-package Docker builds, fsck and
  riscv64-only ELF scans, and reported `reproducibility OK: identical manifest across two builds`.
  Rootfs SHA-256 is `4786d34965ed86d9b85209ad0c96552a1690dbe1a743e63b4a54622057ebd756`;
  manifest SHA-256 is `fb28a05ac1ff1810c55decc8dbaeb6ea9f9ea0d15973188c4d2683ec7cefe650`.
  The default pipeline then booted a disposable copy to `login:` and wrote a 92-entry ordered
  profile (`b27bee116801e380f1db958f6f951d0ebc694eef54e605f2a3d4e2829caf9acd`). A current-tree
  `SKIP_BOOT_PROFILE=1 bash tools/build_image/build.sh` metadata pass reproduced the same image and
  emitted `image-info.json` with Alpine v3.20, both HTTPS repositories, epoch 1731542400, 84 exact
  package versions, 4,096 manifest positions, and 215 distinct content objects. Restoring the
  profile for that identical image and rerunning `chunk-verify` passed.
- **Mounted-image/nondeterminism hunt.** A read-only Docker `debugfs` extraction found no machine
  ID, SSH host key, random-seed file, or Python; curl and nano are executable and
  `/etc/apk/repositories` contains the v3.20 main and community HTTPS URLs. A direct all-inode
  `debugfs` audit found zero mtimes newer than the epoch (maximum exactly 1731542400); representative
  regular files and symlinks also had ctime/atime/mtime/crtime pinned to that epoch.
- **CDN churn attack.** `bash tools/build_image/check-package-churn.sh` rebuilt the exact base then
  added only `htop-3.3.0-r0`: 96 of 215 old objects invalidated (**44.7% churn**), 119 shared
  (**55.3% retained**), 99 added, 218 new total. The 50% ceiling passed and the production image was
  restored to the exact rootfs hash above. The metric now measures old-cache invalidation rather
  than double-counting one replacement as both removed and added.
- **Browser proof.** `make web-build` passed. A one-load Playwright proof ran all in-page binaries:
  **126 passed, 0 failed**, zero console errors, suite-bound roadmap pips `live`, E3-T11 `verified`;
  screenshot: `web/test-results/e3-t11-browser-proof.png`. `npx playwright test
  tests/roadmap-oci.spec.js` passed. The final tracked `chunked-boot.spec.js` pass booted the
  production default to root login in 13.8 minutes, ran `LAZY_42_OK`, ran `apk version --test 1.0
  1.0` with exit 0, observed both HTTPS repository URLs in-guest, made no whole-image request, and
  fetched 120 immutable chunks / 15,728,640 bytes (**2.9%** of 512 MiB) with zero console errors.
- **Code gates.** `cargo fmt --all -- --check`; `cargo clippy --workspace --all-targets
  --all-features -- -D warnings`; `cargo test --workspace -- --skip
  file_backend::tests::kill_mid_write_no_torn_sectors`; `cargo build -p wasm-vm-wasm --target
  wasm32-unknown-unknown`; shell/JS syntax checks; and `git diff --check` all passed. The single
  filtered native test is a pre-existing macOS `abort()` helper hang (an orphaned helper from a
  prior run was still present); all other production-feature workspace tests, including real local
  TCP/UDP/WebSocket relay tests, ran green. Corrupt/missing/orphan chunk rejection passed in the
  focused CLI tests, while storage/wasm tests proved hash-mismatched bytes are never cached/served.

Host rr is unavailable on this Apple Silicon Mac per the repo platform policy; evidence is the
deterministic guest/image hashes, block trace-derived profile, full native/wasm gates, and browser
recordings above. Fresh adversarial verification is still required before `verified`.

### 2026-07-17 — verifier

VERDICT: verified

- **P1 cold reproducibility — PASSED.** Predicted two verifier-owned cold Docker builds would
  produce the same ordered manifest and the claimed rootfs hash. `DOCKER_BUILD_NO_CACHE=1
  REPRO_CHECK=1 SKIP_BOOT_PROFILE=1 bash tools/build_image/build.sh` rebuilt all 84 exact packages
  twice with no Docker layer cache; both fsck and foreign-ELF gates passed, the script reported
  `reproducibility OK: identical manifest across two builds`, and the adopted image/manifest were
  `4786d34965ed86d9b85209ad0c96552a1690dbe1a743e63b4a54622057ebd756` /
  `fb28a05ac1ff1810c55decc8dbaeb6ea9f9ea0d15973188c4d2683ec7cefe650` exactly. The diagnostic
  profile skip was deliberate for this duplicate rebuild; the original profile was restored and
  independently checked below.
- **P2 artifact integrity and corruption — PASSED.** Predicted 4,096 manifest positions, 215
  referenced distinct objects, every object no larger than 131,072 bytes, and nonzero rejection of
  a corrupt/orphan object. The current artifact reports exactly those counts and `chunk-verify`
  passes. In `/tmp/e3-t11-corrupt`, flipping byte zero of a referenced copy produced
  `HashMismatch { index: 228, ... }`, exit 2; adding `not-in-manifest.bin` produced
  `OrphanChunk`, exit 2. `cargo test -p wasm-vm-cli --test chunk_verify` passed 5/5 after the
  verifier attack.
- **P3 mounted-image hygiene — PASSED.** Predicted all inode clocks at or before epoch 1731542400,
  no machine ID/SSH host key/random seed/Python, executable curl+nano, exact HTTPS repositories,
  and an exact installed-package lock. A read-only `debugfs rdump` plus a 32,768-inode `stat`
  sweep in the pinned builder found maximum ctime/atime/mtime/crtime all exactly 1731542400 with
  zero newer values. The forbidden-file hunt returned empty; curl/nano were mode 755; repository
  lines were exactly v3.20 main and community; `apk.static --root ... info -v | sort` diffed
  byte-for-byte against the committed 84-line `MANIFEST.txt`.
- **P4 provenance/profile — PASSED.** Predicted `image-info.json` would agree with the actual image
  and manifest and the boot profile would be nonempty, unique, and in range. It records v3.20, the
  two HTTPS repositories, epoch 1731542400, 84 exact packages, image size 536,870,912/hash above,
  chunk size 131,072, 4,096 positions, and 215 objects; direct jq comparisons all passed. The
  profile hash is `b27bee116801e380f1db958f6f951d0ebc694eef54e605f2a3d4e2829caf9acd`:
  92 unique indices, min 0/max 4095. Recomputing the ordered first-touch set from
  `target/e3-t11-boot-profile.blklog` reproduced the JSON exactly, and the paired console contains
  the `wasm-vm login:` marker.
- **P5 real one-package churn — PASSED.** Predicted adding only htop would retain a majority of old
  distinct chunk hashes and restore the production image afterward. Verifier-owned `bash
  tools/build_image/check-package-churn.sh` installed only `htop-3.3.0-r0`: 96/215 invalidated
  (44.7%), 119/215 retained (55.3%), 99 added, 218 new total; the 50% gate passed. The trap restored
  the production rootfs to the exact `4786...d756` hash.
- **P6 browser adoption — PASSED.** Predicted the primary Alpine button would boot the chunked
  production image, reach a live root shell, execute apk, expose both repositories, avoid a whole
  image request, stay under 40%, and emit no console errors. `npx playwright test
  tests/roadmap-oci.spec.js` passed. A fresh tracked `chunked-boot.spec.js` run passed in 18.0m:
  login/root/`LAZY_42_OK`, `apk version --test 1.0 1.0` exit 0, both repository assertions, 120
  immutable requests / 15,728,640 bytes (2.9%), no whole-image request, and zero console errors.
  Screenshot: `web/test-results/chunked-boot-E3-T02-Alpine-777cd-hunks-under-40-of-the-image/test-finished-1.png`.
- **P7 novel attacks — PASSED.** Predicted every package-lock line would convert losslessly to an
  exact apk `name=version-rN` constraint and an inconsistent manifest shape would fail before any
  chunk load. All 84 lines converted with no unconstrained entry and round-tripped byte-exactly.
  Increasing only `image_len` by one made `chunk-verify` fail with
  `BadManifest("ChunkCountMismatch { declared: 4096, derived: 4097 }")`, exit 2.
- **COVERAGE — SUFFICIENT.** Rootfs/build/image-info/gen-manifest hunks executed in the cold gate;
  locked and extra-package branches executed in the base/churn builds; ctime normalization was
  interrogated across every inode clock. CLI verification/churn hunks executed in focused tests and
  real artifacts. Profile generation was held against its block log. Primary browser/roadmap hunks
  executed in Playwright. Documentation, lifecycle/queue text, and selector-only updates in the
  longer pre-existing persistence/crash suites are waived as non-runtime or mechanical consumers
  of the same live `#boot-alpine` path; the explicit full-image debug fallback and maintainer-only
  `UPDATE_MANIFEST` branch are outside this task's production acceptance and preserve existing
  behavior. `tools/demo-capstone.sh`'s one-line delegation is covered by direct execution of its
  `gen-alpine-manifest.sh` target.
- **SABOTAGE + SUITE.** In a detached scratch worktree, forcing `removed = 0` made
  `churn_zero_for_identical_builds_and_measured_for_a_small_change` fail on the missing `5.0%
  churn` assertion; the clean implementation then passed all five tests. `cargo test -p
  wasm-vm-storage` also passed 86/86, including manifest-hostility and verified-byte cache tests.
  The existing CLI tests, tracked browser boot, artifact integrity gate, and profile are the
  promoted permanent suite; no additional production test was needed. Host rr remains unavailable
  on this Mac; no concurrency behavior changed.
