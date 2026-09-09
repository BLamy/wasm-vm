# Resident playback image — offline build evidence

2026-09-08, checkout HEAD `00cad42c512bfd24012d3bce9cbef6c30faa138a`.
This proves image construction and repeatability only, not guest playback or F acceptance.
No browser, chunking, runtime/helper edits, or guest execution occurred.

Two sequential fresh builds exited 0. Independent full-file SHA256 and `cmp` both agree:

- A: `target/e5-t26f/resident-image-2ae65408-a/alpine-rootfs.ext4`
- B: `target/e5-t26f/resident-image-2ae65408-b/alpine-rootfs.ext4`
- Both: **1073741824 bytes**, SHA256 `27c2e8f2789b18efac214837c295dbfb22559beea350fb5788f71edfdc0f0a8e`.

The base SHA256 remained `5530d6585776cf61fcedb98f7a2e75b4293d5f805809e5107cc181fa5dc62550`
before/after each build and at the final comparison. Both actual helper readbacks are 7225 bytes,
identical to frozen `tools/guest/e5-t26f-resident-aplay.sh`, SHA256
`2ae65408985f18be8b1287521bad23803282d652bb8f98421a135a351dac213c`.
The new guest file is `/usr/libexec/wasm-vm/e5t26f-resident.sh`, regular, root:root, mode 0444,
one link, inode generation 0; atime/mtime/ctime/crtime are all 1731542400 with zero extra fields.
Both read-only `fsck.ext4 -f -n` checks exited 0 through all five passes.

`MANIFEST.txt` was copied unchanged (`f578113d65a0be90635d8ad9a87630583f9e4cfa49e6f50e67f606301d8f752a`).
`FILE-MANIFEST.txt` preserves the complete original bytes and appends exactly one helper entry
(`1f52824ea09c800ae8c548e047aa3004640eb9ae5cb0644050d431f00720a760`).
Metadata uses `wasm-vm.e5-t26f.desktop-image-info.v1` and `fixture.kind=resident-aplay-v1`.
The local builder ID was `sha256:0d1ead8c1106a838e478676dff113f21cdd91eb9456232ff9f6c24679a87d0eb`,
with e2fsprogs/e2fsprogs-extra both `1.47.0-r5`. Docker used no network, no pull, dropped capabilities,
a read-only container filesystem, two individual read-only source mounts, and only the fresh output RW.

## Commands and artifacts

The recording wrappers invoked the builder CLI below, first A then B:

```sh
node tools/verify/e5-t26f-resident-image.mjs --out target/e5-t26f/resident-image-2ae65408-a --helper-sha256 2ae65408985f18be8b1287521bad23803282d652bb8f98421a135a351dac213c
node tools/verify/e5-t26f-resident-image.mjs --out target/e5-t26f/resident-image-2ae65408-b --helper-sha256 2ae65408985f18be8b1287521bad23803282d652bb8f98421a135a351dac213c
node evidence/e5-t26f/resident-image/compare-builds.mjs
node --test tools/verify/e5-t26f-resident-image.test.mjs
```

These destinations and recording names are now occupied and deliberately refuse retry/overwrite.
For a new reproduction, select fresh output and evidence names. `record-build.mjs` documents the
recording procedure; `compare-builds.mjs` documents the independent byte/hash/readback checks.

Raw CLI output: `a.log`, `b.log`. `a/record.json` and `b/record.json` retain exact commands, times,
exit codes, before/after source/HEAD hashes, and SHA256/size for every copied small build artifact.
Each directory retains desktop metadata, package/file manifests, debugfs commands/log, inode stats,
helper readback, package/version output, and fsck output. No ext4 image is copied into evidence.
[comparison.json](comparison.json) retains actual image/metadata/record/log hashes and final preservation checks;
its SHA256 is `cb580ddf06f71b5a1af71256c0e54bf53857ad33d5b722f9dc5ec6375f808053`.
`tests.log` records 12 passed, 0 failed; SHA256 `3f54fa0c284387f9abb41a95141b06698c144147ceea73d376862ef9b8d315c2`.
These deterministic host tests use mocks; the separate Docker recordings supply actual ext4 evidence.

## Retained initial mechanical failure

The first A attempt installed/read back the helper and completed fsck but correctly exited 1 at
the package-version assertion: `apk info -v <package names>` returns descriptions, not versions.
The sole builder correction queries the full version listing and filters/sorts the two pinned packages;
the regression now checks that command shape. No package requirement or image assertion was relaxed.
The failed log/artifacts are preserved as `a-failed-apk-info.log` and `a-failed-apk-info/`.
Its target directory was moved intact to `target/e5-t26f/resident-image-2ae65408-a-failed-apk-info`
before recreating fresh A. Nothing was deleted or overwritten.

Final builder SHA256: `6c00973a0462847cab200a857b1946a9c54669569785dd2406d06478da5d1481`.
Final test-source SHA256: `7a06c621cf9c28455d1e91240bc6a5f243171be787a4e9e9b5fb6e0cbc466048`.
No commits or task-status changes were made by this sidecar.
