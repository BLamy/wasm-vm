---
id: E3-T11
epic: 3
title: Reproducible Alpine disk-image build pipeline v2 with chunking
priority: 311
status: in-progress
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
- [ ] Two consecutive `./build.sh` runs on the same commit produce identical
      `manifest.json` (hence identical chunk set) — asserted by the script itself.
- [ ] The image boots to login through the T02/T03 streaming path and `apk update`
      succeeds through the T17 Tailscale provider once networking exists (until then:
      `apk version` runs and the repositories file matches the documented HTTPS URL).
- [ ] No chunk file exceeds the manifest's chunk size; every file in `chunks/` is
      referenced by the manifest and vice versa (script-asserted).
- [ ] `image-info.json` records the Alpine release, mirror snapshot, and package list with
      exact versions.
- [ ] A one-package change (add `htop`) rebuilds with the majority of chunk hashes
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
