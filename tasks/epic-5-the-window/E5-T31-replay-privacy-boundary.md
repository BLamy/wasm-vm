---
id: E5-T31
epic: 5
title: Enforce the Replay backend privacy boundary on PRs, guest images and deploys
priority: 0.3815
status: implemented
depends_on: [E5-T30d]
estimate: S
risk: medium
capstone: false
---

## Boundary

wasm-vm is public and its guest OS images are downloaded by every visitor. Normal
Replay Chromium / Replay Node builds may ship to the client. Nothing built from
Replay's private backend `src/cpp` (recording driver, linker, recording reader,
interceptors) may enter a public PR, a guest image, `web/dist` or a Cloudflare
deploy. Recording evidence metadata in task logs is allowed; private build
identifiers, source and binaries are not.

The identifying markers and driver digests are private and live in
`local/private-boundary/` (now covered by a whole-`/local/` gitignore rule).

## Deterministic acceptance

`python3 tools/privacy/check-no-replay-backend.py --git-range origin/main..HEAD`
and `python3 tools/privacy/check-no-replay-backend.py web/dist releases tools docs tasks`
both pass. The same check must reject the real driver raw, renamed and recompressed,
must accept the real unbundled-driver Chromium binary, must fail closed without the
private lists, and must run from the pre-commit hook (`--staged`) and from
`tools/deploy-cloudflare.sh` over the Pages tree and every R2 upload source.

## Adversarial verification

Medium risk: try one bounded evasion (for example a different compressor or a
split file) and confirm the result is either caught or recorded as a stated limit.
Compressed filesystems (EROFS/squashfs) must be scanned at their source tree before
packing; that is a requirement on the image builders (E5-T33b), not this guard.

## Verification log

### 2026-11-22 — worker — audit and guard

Audit of PRs #631–#638 (`origin/main..codex/replay-driver-recording`, 119 files):
no driver, linker or reader source or binary is present. Layers #635–#638 change only
task markdown. One private item was found: the E5-T30d log quoted the private
driver's linker build identifier. It is scrubbed forward in this layer; the older
commit remains visible in PR #638's history. `local/` held a non-ignored
subdirectory and is now ignored as a whole. Unpushed local checkpoint refs that
touch `local/` were confirmed absent from the remote.

Checks (2026-11-22, this layer):
- `check-no-replay-backend.py web/dist releases tools docs tasks`: OK, 25,573 files.
- Real RISC-V driver raw, renamed+gzip, zstd -19, xz and a 1 MB split (both halves):
  all rejected (exit 1). Real unbundled-driver Chromium 108 `chrome`: accepted.
  Missing private lists: exit 2 (fail closed).
- Pre-commit decoy staged with a backend path: commit refused.
- `--git-range origin/main..HEAD` at the frozen head: see the commit for this entry.

Stated limits: a marker split exactly across a file boundary, encryption, or a
compressor the guard does not decode (brotli, compressed-filesystem blocks) is not
detected by byte scanning. Image builders must therefore scan the source tree before
packing (E5-T34b). Driver digests catch only exact known binaries.

### 2026-11-22 — fresh verifier — VERDICT: refuted

Head `9d6340130`, base `origin/main` = `24e2a1a63`. Predictions were written before each
check. Markers are cited by index only. All decoys and scratch files were removed and the
index was left clean.

- P1 acceptance scans: HELD. `--git-range origin/main..HEAD` returns 0 (131 files, 12
  markers, 11 digests). `web/dist releases tools docs tasks` returns 0 (25,582 files).
- P2 real driver: HELD. Raw, renamed `.bin`, bzip2 -9 (new), gzip -1, xz and zstd all
  return 1. The renamed copy hits the digest, and every compressed form hits "decompresses
  to a private driver binary". The real build20 `chrome` returns 0.
- P3 fail closed: HELD. `--markers /nonexistent` and `--digests /nonexistent` each
  return 2 with FAIL CLOSED.
- P4 pre-commit hook: HELD. With `core.hooksPath=tools/git-hooks`, staging a decoy that
  holds the public path marker made `git commit` return 1. HEAD did not move and the
  decoy was removed.
- P5 deploy ordering: HELD (by reading the script). The guard runs over `$DIST` plus
  every `$R2_QUEUE` source, after the last validate step and before `ensure_r2_object`
  and `wrangler pages deploy`. It exits 1 on failure under `set -euo pipefail`. It was
  not run, as instructed.
- P6/P7 diff and ignore audit: HELD at the tip. The stack has no `.so`, ELF or
  `.cc`/`.h` blobs. The `RecordReplay*` hits are public Chromium-side patches. Nothing
  under `local/` is tracked. `git check-ignore` matches `/local/` (.gitignore:8) for
  `local/*`.
- FAILED: type changes escape `--staged` and `--git-range` (my novel attack).
  `scan_git_range` uses `--diff-filter=AMR`, which drops `T`. In a scratch repo I
  committed a symlink `asset.bin`, then replaced it with a regular file holding the public
  marker. `--staged` returned 0 with "0 file(s) scanned", and after commit
  `--git-range HEAD~1..HEAD` also returned 0. The control (the same content as a new
  file) returned 1. Demand: include `T` (and any copy status) in the filter, or scan
  every non-deleted path, and add a regression test.
- FAILED: symlinks are skipped in scanned trees, but wrangler uploads their targets.
  `scan_paths` skips `p.is_symlink()`. A tree whose only entry is a symlink to the real
  driver returned 0 with "0 file(s) scanned". The cached wrangler `pages deploy` walk
  (`wrangler-dist/cli.js` ~line 307713) calls `fs.stat`, which follows links, so its
  `isSymbolicLink()` skip never fires. Node `statSync` on that link reports
  `isFile true, size 1413712`. The deploy would therefore upload the driver bytes past
  the guard. Demand: follow symlinks (or reject any symlink) under scanned roots.
- FAILED: a bad zstd stream fails open. `open_stream` falls back to `zstd -dc` without
  checking its exit status, so a decode failure yields an empty stream instead of the raw
  scan. A file made of the 4-byte zstd magic followed by the full real driver returned 0.
  A zstd-magic file holding the public marker in raw bytes also returned 0. The gzip
  equivalent is caught (returns 1 via the raw fallback). Demand: treat a non-zero
  subprocess exit as undecodable and rescan the raw bytes.
- FAILED (boundary claim; disclosed by the worker): `--git-range` scans only blobs at
  the range tip, so it cannot see private material in intermediate commits. Running the
  guard per commit over `origin/main..HEAD` gives exit 1 at `8551c8d7e` and `4fd6a7ac7`
  (private marker #5 in the E5-T30d task file). Both commits are on the pushed
  `origin/codex/replay-driver-recording`, so the item is still in a public PR, which the
  Boundary forbids. Demand: make `--git-range` scan every commit's changed blobs
  (`git rev-list` + per-commit diff). Purging history (rewrite and force-push of the
  stack) is the user's decision and outside this guard.
- COVERAGE: executed: the gzip, xz, bzip2 and zstd-CLI branches, the undecodable-gzip raw
  fallback (bad gzip holding a marker returns 1), the SELF skip, `--staged`,
  `--git-range`, `--allow-missing-private` (returns 0 with 2 public markers), FAIL
  CLOSED, and the hook hunk. Not executed: the `zstandard` module branch (module not
  installed here; needs evidence or a test with the module) and the deploy hunk
  (waived: deliberately not run, read only).
- SABOTAGE: HELD. A copy with marker matching and both digest checks disabled accepted
  the renamed real driver (returns 0), so the acceptance checks can fail.
- SUITE: none promoted until the refutations clear. There are no committed tests for
  the guard; the fix should add them for the four cases above.

### 2026-11-22 — worker — rework after refutation

All four findings are fixed in `c64905af1`, with one regression test per finding
(`python3 tools/privacy/test_check_no_replay_backend.py`, 12 tests, synthetic marker):
1. Type changes: staged and range scans use `--diff-filter=ACMRT`.
2. Symlinks: trees are walked with `followlinks=True` and cycle protection; a link
   to a private file or directory is rejected, labelled `link -> target`.
3. Compression: raw bytes are always scanned, and decoded bytes are scanned in
   addition. A zstd decoder failure now raises instead of reading nothing. Real
   driver behind a fake zstd header: rejected.
4. History: `--git-range` scans every blob each commit in the range introduced.
   At the user's direction, the two pushed commits holding the private build
   identifier were rewritten (see the E5-T30d log) and force-pushed.

Sabotage: reverting each fix in a scratch copy fails exactly its test. Real data:
driver raw, copied, symlinked and fake-zstd all exit 1; real Chromium 108 `chrome`
exits 0; `web/dist releases tools docs tasks` OK (25,582 files);
`--git-range origin/main..HEAD` OK (190 blobs, every commit). The `zstandard`
module path is waived (module absent here; the CLI path is exercised by the fake-zstd
test and the real `zstd -19` stream).

### 2026-11-22 — fresh verifier (r2) — VERDICT: refuted

Head `831a46ce5`, base `origin/main` = `24e2a1a63` (fetched). Predictions were written before
each check. Markers are cited by index only. Scratch work stayed outside the repo; the index
was left clean.

- P1 acceptance scans: HELD. `--git-range origin/main..codex/replay-private-boundary` returns 0
  (193 blobs over every commit, 12 markers, 11 digests). `web/dist releases tools docs tasks`
  returns 0 (25,582 files). Control: the same range against
  `backup/replay-private-boundary-pre-scrub` returns 1 at `8551c8d7e` and `4fd6a7ac7`
  (private marker #5), so the per-commit scan is live.
- P2 real driver / Chromium / fail closed: HELD (re-run, since the guard changed). Real `zstd -19`
  and `xz` streams of the driver return 1. The real build20 `chrome` returns 0.
  `--markers /nonexistent` returns 2.
- Finding 1 (type change): FIXED, own repro. In a scratch repo a symlink was replaced by the
  real driver (`git diff --cached --name-status` shows `T`). `--staged` returns 1, and after
  commit `--git-range` returns 1 on the type-change commit.
- Finding 2 (symlinks): FIXED, own repro. A tree with only a symlink to the real driver returns 1,
  labelled `link -> target`. A tree holding a symlinked directory with a driver copy returns 1.
  A dangling link is skipped (returns 0, nothing to upload).
- Finding 3 (fake header fail-open): FIXED as stated. The zstd, xz and bzip2 magic bytes each
  followed by the real driver return 1 (raw scan).
- Finding 4 / history rewrite: HELD. After `git fetch`, `origin/codex/replay-driver-recording`
  = `8f346d217`. Neither `8551c8d7e` nor `4fd6a7ac7` is an ancestor of it or of this branch, and
  no ref from `git ls-remote origin` points at either. The rewritten pairs are
  8551c8d7e→0b241368c, 4fd6a7ac7→8f346d217, 9d6340130→000a0d18c, 300db8b8b→d1c952c64 and
  70e0b9eee→c64905af1. For each pair, `git diff old new` is either one line (`@@ -77 +77 @@` in
  the E5-T30d task file; the removed line holds private marker #5 and the added line holds
  none) or empty for the later three. Messages and author/date match. Old SHAs may stay
  fetchable on GitHub until it runs GC; that is the user's call, not this guard's.
- Committed tests: HELD. `python3 tools/privacy/test_check_no_replay_backend.py` gives 12 OK.
  They are not self-licking: they use an independent synthetic marker and digest, and they
  assert exit codes from the CLI.
- COVERAGE: executed: `_ProcStream` error path (fake zstd, bad zstd), symlink follow,
  `seen_dirs` cycle skip (committed test), dangling-link skip, `ACMRT` in both git modes,
  `diff-tree -m` on an evil merge (a marker added only in the merge resolution returns 1), and
  the `local/` history path rule (returns 1). Waived: the `zstandard` module branch (module
  absent here).
- NOVEL ATTACK (valid compressed stream plus trailing junk, or truncation): FAILED. This is
  not a stated limit, because gzip and zstd are decoders the guard claims to handle.
  Predicted: exit 0, because `scan_file` discards the decoded-stream findings when the decoder
  raises after emitting data. Observed with the real driver:
  - `gzip.compress(driver, mtime=0) + 8 junk bytes` returns 0. `gunzip -c` of that file
    recovers bytes whose sha256 equals the driver's.
  - `zstd -c driver` plus 8 junk bytes returns 0. `zstd -dc` writes the full driver (same
    sha256) and then exits 1.
  - gzip truncated by 100 bytes returns 0. `gunzip` still recovers 1,376,256 of 1,413,712
    bytes.
  - `PRIVACY_VERBOSE=1` shows "undecodable gzip/zstd ...; raw bytes scanned" for each case.
  Synthetic repro without private bytes: driver = `\x7fELF` + `A`*4096 + marker + `B`*4096,
  gzip-compressed (the marker is absent from the compressed bytes). Clean returns 1, plus
  8 junk bytes returns 0, truncated by 12 bytes returns 0.
  Root cause: the `except (OSError, EOFError, lzma.LZMAError, ValueError)` branch in
  `scan_file` returns without reporting the markers `scan_stream` had already matched in the
  decoded prefix. Demand: keep and report the markers (and any digest) found before a decode
  error, or treat a recognised-but-undecodable compressed file as a failure. Add regression
  tests for junk and truncation with a compressible synthetic driver. (Random-filled synthetic
  data hides this, because deflate stores it uncompressed and the raw scan then sees the
  marker.)
- Commit messages in the range: no marker hits (checked off-tree). The guard scans blobs only;
  this is not raised, since no message carries a marker.
- SUITE: none promoted until the refutation clears.

### 2026-11-22 — worker — rework after r2 refutation

Finding: a gzip or zstd stream that decodes partway then fails (junk suffix,
truncation) lost the markers in its decoded prefix. Fix: gzip, xz and bzip2 now
decode incrementally with decompressor objects, which return every decoded byte,
follow concatenated members and stop quietly at junk or truncation. The zstd CLI
path, and any decoder that raises, reports markers found before the error
(`partial decode`). Five regression tests use compressible synthetic data whose
compressed form provably lacks the raw marker: gzip clean, gzip with a junk
suffix, truncated gzip, truncated xz plus junk bzip2, and zstd with a junk suffix
(17 tests total, OK). Sabotage: with reporting of the partial set disabled, the
zstd test fails, and against the previous `gzip.open` decoder the gzip
junk/truncation tests failed. Real driver: gzip with a junk suffix, truncated
gzip and zstd with a junk suffix all exit 1. Acceptance re-run: Chromium 108
`chrome` OK; public trees OK (25,582 files); `--git-range origin/main..HEAD` OK
(every commit). The verifier's real-driver scratch copies were deleted.

### 2026-11-22 — fresh verifier (r3) — VERDICT: refuted

Head `fa08ba5e8`, base `origin/main` = `24e2a1a63` (fetched). Predictions were written before
each check. Markers are cited by index only. Scratch work (including every real-driver copy)
was deleted, and the index was left clean.

Carried forward unchanged from r2 (code and evidence not touched by `fa08ba5e8`): the history
rewrite, r1 findings 1–4 (type change, symlinks, fake-header fail-open, per-commit range scan)
and the deploy-ordering read. All HELD.

- (a) r2 partial-decode finding: FIXED, own real-driver repros. Predicted exit 1 for each;
  observed 1 for gzip -9 plus 8 junk bytes, gzip truncated by 100 bytes, gzip cut to half its
  length, `zstd -19` plus junk, `zstd -19` truncated by 100 bytes, xz truncated by 100 bytes,
  xz plus junk, bzip2 -9 truncated by 100 bytes, bzip2 plus junk, a benign gzip member followed
  by the driver member, and the driver member followed by a bogus member header.
  `PRIVACY_VERBOSE=1` on the truncated zstd shows "zstd stopped decoding (decoder exited 1)",
  then "(zstd, partial decode): contains private marker #N" lines.
- (b) No regression: HELD. Real build20 `chrome` returns 0. `--git-range
  origin/main..codex/replay-private-boundary` returns 0 (199 blobs). `web/dist releases tools
  docs tasks` returns 0 (25,582 files, 45.8 s, max RSS 1.45 GB). `--markers /nonexistent` and
  `--digests /nonexistent` each return 2 (FAIL CLOSED). Pre-commit hook: a staged decoy holding
  the public path marker inside a gzip stream with a junk suffix was refused, reported as
  "(gzip): contains" plus the public path marker. HEAD did not move, and the decoy was unstaged and
  removed. `test_check_no_replay_backend.py`: 17 OK.
- (c) Adversarial decoder input: no hang, but memory is unbounded (non-blocking). Predicted
  that peak memory tracks the expansion of one 8 MiB input chunk, because `decompress(data)`
  is called without `max_length`. Observed: a 1.0 MB gzip of 1 GiB of zeros used 1041 MiB RSS
  in 1.5 s; a 153 KiB xz of 1 GiB used 1048 MiB; a 610 KiB xz of 4 GiB used 4121 MiB in 23 s.
  The old `gzip.open(...).read(CHUNK)` was bounded at about 8 MiB of output. Concatenated
  empty gzip members (20 B each) are quadratic within each chunk, from copying `unused_data`
  for each member: 1 MiB took 0.7 s, 2 MiB 2.7 s, 4 MiB 10.3 s (about 40 s per 8 MiB chunk,
  linear across chunks). Both fail closed: a MemoryError is uncaught, so the exit is non-zero,
  and an OOM kill is also non-zero, which the hook's `||` and deploy's `set -e` both refuse.
  The real public trees peak at 1.45 GB. No budget is stated, so this is not a refutation.
  Suggested follow-up: `decompress(data, max_length)` plus `unconsumed_tail`, and a
  memoryview offset instead of re-slicing `unused_data`.
- (d) COVERAGE: every changed hunk ran. Of `_IncrementalStream`, the end-of-file
  path ran on truncation, the decoder-error path on junk, the `eof`/`unused_data` member
  follow on concatenation and on many tiny members, and the `if out` return on all inputs.
  The xz and bzip2 factories ran on cut/junk xz and bz2. The `found`-in-place parameter and
  the partial-report branch in `scan_file` ran on cut/junk zstd. The `zstandard` module branch
  is still waived (module absent). SABOTAGE: HELD. With partial reporting disabled and
  incremental errors re-raised in a scratch copy, 3 of the new tests fail (gzip junk, xz/bz2,
  zstd junk), so the tests can fail.
- (e) NOVEL ATTACK (nested or embedded compression): FAILED. Predicted exit 0, because only
  files whose magic is at offset 0 are decoded, and decoding goes one level deep. Observed with
  the real driver (each case alone in a scratch tree):
  - gzip(gzip(driver)) returns 0.
  - gzip(xz(driver)) returns 0.
  - xz(bzip2(driver)) returns 0.
  - A `.tar.gz` holding `lib/x.so.xz` returns 0.
  - An uncompressed `img.tar` holding `lib/mod.so.xz` returns 0.

  Control: the same tar holding `mod.so.gz` from `gzip -c` returns 1, but only by accident,
  because the gzip FNAME header stores the original public filename. The same tree before
  packing returns 1 (all digests and markers).

  This is not a stated limit. The stated limits are markers split across files, encryption,
  compressors the guard does not decode (brotli) and compressed-filesystem blocks. Here every
  layer is gzip, xz or bzip2, which the guard claims to decode. The acceptance says
  "recompressed", and the usage docstring claims tar/cpio/ext4 images are scanned. A guest
  rootfs tar or ext4 image that ships a compressed `.so.xz` passes the guard. Demand: decode
  nested decoded-compressor streams to a bounded depth, and either scan compressed members
  inside tar/cpio images (by magic at any offset or by tar member walking) or state
  "compressed files inside archives or images are not decoded; scan the source tree before
  packing" as an explicit limit next to the existing ones. Then add a synthetic regression
  test (compressible data, as in the r2 tests) for whichever is chosen.
- SUITE: none promoted until the refutation clears.

### 2026-11-22 — worker — rework after r3 refutation

The decoder core is restructured, not patched:
- **Carving:** gzip, xz, bzip2 and zstd signatures are found at every offset of
  every file (binwalk-style), so compressed members inside tar, cpio or ext4
  images are decoded.
- **Recursion:** each decoded layer is scanned the same way (raw markers, digest,
  carving) to a depth of 4. Deeper nesting fails closed.
- **Bounded:** decoded output streams to a temp file. Input is fed in 16 KiB
  slices with `max_length`/`unconsumed_tail`, so memory is bounded and
  concatenated members are followed (a marker split across gzip members is
  caught). A layer past `PRIVACY_MAX_DECODED` (default 8 GiB) fails closed. Byte
  ranges already consumed are skipped, so many tiny members stay linear. A zstd
  stream with no available decoder now fails closed.
- **Missing path:** a nonexistent path now fails instead of reporting "0 files OK".
  This was found by the worker when a mis-quoted path passed.

Tests: 27 (`tools/privacy/test_check_no_replay_backend.py`, OK). New ones cover
nested gzip(gzip), gzip(xz) and xz(bzip2), an xz member inside a tar and a tar.gz,
a zstd member inside a tar, a marker split across gzip members, nesting too deep,
the decode cap with bounded memory, 100,000 tiny members within 20 s, a clean
tar.gz and a missing path. Sabotage: offset-0-only carving fails 3 tests, removing
recursion fails 5, and not following concatenation fails 2.

Real driver: gzip(gzip), gzip(gzip(xz)), gzip(xz), xz(bzip2), a tar holding
`x.so.xz` and a tgz holding `x.so.xz` all exit 1, each in 0.3 s or less, with the
decode chain in the label. Acceptance: Chromium 108 `chrome` OK (4.6 s); public
trees OK (25,582 files, 167 s); `--git-range origin/main..HEAD` OK (every commit).

The r3 memory note is addressed by bounded decoding. Remaining stated limits: a
marker split across separate files, encryption, compressors not decoded (brotli,
lz4, compressed-filesystem blocks) and fragmented files inside filesystem images.
For those, image builders scan the source tree before packing (E5-T34b).

### 2026-11-22 — fresh verifier (r4) — VERDICT: refuted

Head `311321a75`, base `origin/main` = `24e2a1a63` (fetched). Predictions were written before
each check. Markers are cited by index only. Scratch work (including every real-driver copy and a
32 MiB RAM disk) was deleted, and the index was left clean.

Carried forward unchanged from r2/r3: the history rewrite, the pre-commit hook and deploy-script
wiring (`tools/deploy-cloudflare.sh:226-229`, hook lines 12-13), all HELD.

- (a) r3 nested and in-archive findings: FIXED, own real-driver repros. Predicted exit 1 for each;
  observed 1, each in 0.4 s or less, with the decode chain in the label: gzip(gzip), gzip(xz),
  xz(bzip2), gzip(gzip(xz(bzip2))) (depth 4, digest hit at `@0:gzip@0:gzip@0:xz@0:bzip2`), a tgz
  holding `lib/x.so.xz`, a plain tar holding `lib/mod.so.xz`, a tar holding a `zstd -19` member,
  a tar holding a nameless gzip member (no FNAME hint), an xz-compressed tar holding a zstd member,
  and a newc cpio holding `lib/m.so.xz`.
- (b) r1/r2 findings: HELD. Symlink to the driver: 1. Symlinked dir holding a copy: 1. Symlink
  replaced by the driver (`T` in `--name-status`): `--staged` 1, and `--git-range` over
  add-then-delete commits 1 (the tip-only range returns 0, so the per-commit scan is live). gzip
  plus junk, gzip truncated by 100 bytes, `zstd -19` plus junk, xz truncated by 100 bytes, and a
  zstd magic followed by the raw driver: all 1. `--markers /nonexistent`: 2. Nonexistent path: 1.
- (c) No regression: HELD. Real build20 `chrome` is accepted (checked by the worker at this head;
  not re-run). `web/dist releases tools docs tasks` returns 0 (25,582 files, 186 s, max RSS
  164 MB). `--git-range origin/main..codex/replay-private-boundary` returns 0 (205 blobs).
  `test_check_no_replay_backend.py`: 27 OK. The tests are not self-licking: they drive the CLI with
  an independent synthetic marker and digest. SABOTAGE: with the recursion call disabled in a
  scratch copy, 14 of the 27 tests fail.
- (d) Consumed-range skip abuse: FAILED. Predicted exit 0, because the gzip decoder consumes the
  gzip header's FEXTRA field (up to 65,535 arbitrary bytes, never written to the decoded output),
  `covered` is set to the member end, and any stream carved inside the field is skipped. Observed:
  the real driver was cut into 10 slices, each xz-compressed into the FEXTRA field of its own gzip
  member, with benign text as the deflate payload. The 10 members were concatenated (321,782 bytes,
  `CHANGELOG.gz`). The guard returned 0 ("1 file(s) scanned") in 0.11 s, and also returned 0 when
  the file sat inside a plain `rootfs.tar`. `gunzip -t` accepts the file, and carving the xz streams
  back out gives bytes whose sha256 equals the driver's. Control: in a scratch copy with only the
  `offset < covered` skip disabled, the same file returns 1. Synthetic repro without private bytes:
  one gzip member whose FEXTRA holds `xz(b"\x7fELF" + b"A"*4096 + <public path marker #0> +
  b"B"*4096)` returns 0. Demand: skip only ranges whose bytes were emitted as decoded output, or
  carve the gzip header's FEXTRA/FNAME/FCOMMENT bytes separately (or carve every offset, including
  inside consumed ranges, and bound the cost another way). Add a regression test.
- (f) NOVEL ATTACK (temp-space exhaustion): FAILED. Predicted exit 0, because `_write_capped`'s
  `out.write` runs inside the `except errors` block of `_decode_at`, and `errors` includes `OSError`.
  A disk-full ENOSPC is therefore treated as a truncated stream, and only the prefix that was written
  gets scanned. Observed: `gzip(60 MiB of zeros + driver)` (453,652 bytes) returns 0 with
  `TMPDIR` on a 32 MiB RAM disk, and returns 1 with the normal `TMPDIR`. This is reachable without
  a special `TMPDIR`. This Mac has 41 GiB free, and a decoded layer may grow to 8 GiB
  (`PRIVACY_MAX_DECODED`), with up to 4 nested layers holding temp files at the same time. A gzip of
  tens of GiB of zeros followed by the driver is a few tens of MB. Demand: let write errors (and any
  `OSError` not raised by the decoder) fail closed. Add a test, for example with a tiny cap on the
  temp filesystem or a patched writer.
- Robustness (non-blocking, no budget stated): memory is now bounded. A 1 GiB-zeros gzip peaks at
  574 MB max RSS (the r3 run used 1,041 MB) in 9 s. A fan-out bomb (12 junk-separated members per
  layer, 4 layers, 1,308 bytes) runs 20,736 decodes in 12.8 s, so cost grows as N^4. Each carved
  zstd magic starts a `zstd` subprocess and sets no `covered`. 1,000 magics (4 KB) take 10 s.
  20,000 (80 KB) did not finish in 120 s. `MAX_CARVES` = 200,000 implies roughly 30+ minutes for an
  800 KB file. These hang rather than pass, so they fail safe. Suggested follow-up: a global decode
  budget per scanned file.
- (e) COVERAGE: executed: carving at nonzero offsets (tar/cpio members), recursion, the depth-4
  path, concatenated-member follow, the `covered` skip (the FEXTRA case and the committed
  tiny-members test), the zstd CLI path, the zstd "decoder unavailable" fail-closed path
  (`PATH=/usr/bin:/bin`: 1), the missing-path failure, and the `_LayerTooLarge` path (committed
  test). Not executed: `MAX_CARVES` overflow (too slow, see above) and the `zstandard` module branch
  (waived; module absent).
- Stated limits (split across files, encryption, brotli/lz4, compressed-filesystem blocks,
  fragmented image files): HELD as stated. Note that zip/jar/wheel members use raw deflate without a
  gzip header and are not decoded. That falls under "compressors not decoded", but it should be
  listed explicitly.
- SUITE: none promoted until the refutations clear.

### 2026-11-22 — worker — rework after r4 refutation

1. **Header-field hiding.** Only compressed-payload ranges are now skipped by later
   carving. Each gzip member's FEXTRA, FNAME, FCOMMENT and FHCRC bytes are parsed
   and left carvable, so streams hidden there are decoded. A member's own start
   offset is marked covered, which keeps long member chains linear (100,000 members
   in about 1 s). Covered ranges use bisected disjoint intervals.
2. **Staging-write failure.** Temp-file writes raise `_Unprovable`, which is not an
   `OSError`, so ENOSPC or EFBIG can no longer read as end of stream. Any staging
   failure fails closed with its cause.
3. **Budgets** (r4's non-refuting slow inputs). Decode attempts are capped at 50,000
   and zstd CLI decodes at 20,000 per top-level file, across all layers
   (`PRIVACY_MAX_ZSTD_SPAWNS`). Both caps fail closed.

Tests: 30 OK. New: a complete xz stream in one member's FEXTRA among benign
members (direct and inside a tar), staging failure via `RLIMIT_FSIZE`, and the zstd
budget. Sabotage: skipping gzip headers fails the FEXTRA test; treating a write
failure as EOF fails the staging test.

Real driver: the r4 construction (24 FEXTRA slices, each xz, benign member bodies;
reassembly verified to match the driver's SHA-256) exits 1 directly and inside a
tar. 60 MiB of zeros plus the driver, gzipped, under a 32 MiB file-size limit,
exits 1 ("could not stage decoded bytes (File too large)"). Acceptance: Chromium
108 `chrome` OK; public trees OK (25,582 files); `--git-range origin/main..HEAD`
OK (every commit).

Stated limits, adding r4's note: zip, jar and wheel members (raw deflate without a
gzip header) and other undecoded formats are not decoded.
