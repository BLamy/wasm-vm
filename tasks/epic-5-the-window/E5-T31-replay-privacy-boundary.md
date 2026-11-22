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
