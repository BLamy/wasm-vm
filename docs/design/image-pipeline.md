# Disk-image build pipeline v2 (E3-T11)

One command builds the production Alpine riscv64 disk image **reproducibly**, chunks it into
the [E3-T01 chunked format](../../crates/storage/src/lib.rs), verifies integrity, and emits a
CDN-ready artifact directory:

```sh
bash tools/build_image/build.sh              # build + chunk + verify + image-info
REPRO_CHECK=1 bash tools/build_image/build.sh # + build twice and fail on manifest drift
DOCKER_BUILD_NO_CACHE=1 REPRO_CHECK=1 bash tools/build_image/build.sh # cold builder layers
```

Output (`releases/`):

| Artifact | What |
|---|---|
| `rootfs/alpine-rootfs.ext4` | the reproducible ext4 (E2-T18) |
| `chunked-alpine/manifest.json` | E3-T01 manifest (image len, chunk size, per-chunk sha256) |
| `chunked-alpine/chunks/<sha256>.bin` | one immutable, content-addressed file per chunk |
| `chunked-alpine/boot-profile.json` | ordered first-touch chunks recorded from a real boot to `login:` |
| `chunked-alpine/image-info.json` | build provenance: Alpine release, mirror, epoch, exact package versions |

## Why v2

Epic 2's image was hand-rolled. Civilization needs an image we can rebuild **byte-identically**,
so chunk hashes are stable and CDN caches stay warm across rebuilds that don't change content.
The pipeline is an orchestration of already-verified pieces:

1. `tools/build-rootfs.sh` + `tools/rootfs-inner.sh` (E2-T18) — the reproducible ext4.
2. `wasm-vm chunk` (E3-T02) — cut the image into the manifest + `chunks/` set.
3. `wasm-vm chunk-verify` / `wasm-vm chunk-churn` (E3-T11) — the integrity + CDN-churn gates,
   implemented in Rust (`crates/cli/src/chunk_verify.rs`) so the guarantees are **unit-tested**,
   not asserted in shell.
4. `tools/build_image/record_boot_profile.sh` — boots a disposable copy with the native CLI's
   `--profile-boot --blk-log`, stops at getty's `login:` marker, and maps successful virtio-blk
   reads to the browser's chunk indices. The production image itself is never boot-mutated.

## Determinism techniques (where each lives)

- **Pinned base image by digest** — `tools/rootfs.Dockerfile` (`alpine@sha256:…`).
- **Version-pinned apk tools** — `apk-tools-static`, `e2fsprogs`, `file` at exact `-rN` versions.
- **Package-set drift gate** — apk resolves "latest within v3.20", so a mirror point-release
  (a libcrypto CVE patch, a busybox `-r31→-r32`) silently changes the image. `build-rootfs.sh`
  diffs the freshly-resolved set against the committed `releases/rootfs/MANIFEST.txt` lock and
  **fails on drift**; normal builds convert every locked `name-version-rN` entry into apk's exact
  `name=version-rN` constraint. `UPDATE_MANIFEST=1` deliberately re-resolves and refreshes the lock.
  This is the exact-version record `image-info.json` reads.
- **Fixed filesystem identity** — `FS_UUID` and `SOURCE_DATE_EPOCH` (2024-11-14, matching the
  kernel banner) are constants in `build-rootfs.sh`; `mke2fs -d` packs the tree without loop
  mounts or privileges, `-O ^metadata_csum` disables the (non-deterministic-seed) metadata
  checksums, `-E root_owner=0:0` normalizes ownership, and `-E hash_seed=<FS_UUID>` fixes the
  directory-htree seed. `E2FSPROGS_FAKE_TIME` freezes e2fsprogs timestamps. A final pinned
  `debugfs` batch normalizes imported inode ctimes: `touch` can fix source mtime/atime but its
  own metadata operation advances source ctime, and `mke2fs -d` otherwise copies that real
  container-clock value into every populated ext4 inode.
- **No per-boot secrets baked in** — `/etc/machine-id`, ssh host keys, and random seeds must be
  absent or generated on first boot, never captured at build time (audited in the adversarial
  check below).

## Reproducibility gate

`REPRO_CHECK=1` builds the ext4 twice and diffs `manifest.json`. Identical manifests ⇒ identical
ordered chunk hashes ⇒ the image is byte-reproducible. Any drift fails the build, reports chunk
set churn and differing chunk indices, and preserves both ext4 files under `target/repro-*.ext4`
for `cmp`/`dumpe2fs`/`debugfs` diagnosis.

The chunking step is deterministic *given* a fixed image (pure content hashing), so the gate is
really testing the ext4 build; the `chunk-churn` metric below is what validates that a
*content* change stays local.

## CDN layout & cache headers

Every file under `chunks/` is named by its sha256 and never changes content, so serve the whole
`chunked-alpine/` tree with:

```
Cache-Control: public, max-age=31536000, immutable
```

`manifest.json`, `boot-profile.json`, and `image-info.json` are the mutable entries (they change
when the image changes) — serve them with a short max-age or an ETag so a new build is picked up
promptly while the immutable chunks stay cached.

### Churn / CDN-friendliness

A one-package change should leave *most* chunk hashes untouched — otherwise the CDN re-downloads
the whole image on every rebuild. Measure it:

```sh
wasm-vm chunk-churn --old <previous-art-dir> --new releases/chunked-alpine --max-churn-pct 50
bash tools/build_image/check-package-churn.sh # real one-package (`htop`) build + 50% ceiling
```

Churn is `old objects no longer referenced / old objects` over the distinct chunk sets: the
fraction of the existing immutable CDN cache invalidated by the rebuild. Retention and newly added
objects are reported separately; counting a replacement as both removed and added would double-count
one invalidated cache entry. A churn far above the size of the change means the ext4 **layout**
shifted (inode/block reallocation cascaded). The pipeline's 50% ceiling requires the majority of
previously cached objects to remain reusable.

## Bumping packages

1. Edit `PKGS` in `tools/build-rootfs.sh` (baseline stays lean — no `python3`; the capstone
   installs heavy packages at runtime).
2. `UPDATE_MANIFEST=1 bash tools/build_image/build.sh` to accept the new resolved set into the
   lock.
3. Run `chunk-churn` against the prior artifact dir and record the churn % — a healthy add is a
   handful of new chunks, not a rewrite.
4. Commit the new `releases/chunked-alpine/` + refreshed `MANIFEST.txt` + `image-info.json`.

## Adversarial checklist (E3-T11 verification charter)

- Rebuild on a different host / cold Docker cache → diff manifests (drift refutes reproducibility).
- `mount` the image and hunt nondeterminism: mtimes newer than `SOURCE_DATE_EPOCH`, a populated
  `/etc/machine-id`, committed ssh host keys, random seeds.
- Corrupt one chunk file → `chunk-verify` must catch it (`HashMismatch`).
- Add one package → churn must stay small (<50%); a >50% rewrite means the layout isn't stable.
