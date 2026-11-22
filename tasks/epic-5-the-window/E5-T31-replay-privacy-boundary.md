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
