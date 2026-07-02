---
id: E6-T27
epic: 6
title: Docs site and release pipeline — semver, artifact publishing, compat matrix
priority: 627
status: pending
depends_on: [E6-T21, E6-T26]
estimate: M
capstone: false
---

## Goal
The project ships like a platform: a public docs site aggregating the epic's design and
user documents, and a tag-driven release pipeline producing versioned, checksummed,
immutable artifacts — core wasm bundle, npm SDK, images — under a written semver policy
that covers the three independently-versioned surfaces (crate API, embed protocol,
snapshot format).

## Context
By this point the epic has produced load-bearing documents (memory-model, gpu-3d-decision,
embed-protocol, embed-security, snapshot-format, self-hosting, privacy, port-forwarding)
and three compatibility surfaces that version independently: the Rust crate API (plain
semver), the `wvm/N` embed protocol (major = refuse, minor = ignore-unknown, per E6-T19),
and the snapshot format (E6-T16's required-flag policy). The docs site (mdBook or
Starlight — pick and record) publishes these plus the embedding guide and API reference
from CI on every main merge, versioned per release. Release pipeline on git tag
`vX.Y.Z`: pinned-toolchain build of the wasm artifact (reproducible: two CI runs of the
same tag produce identical hashes), `npm publish` of `@wasm-vm/sdk` with provenance
attestation, GitHub Release with sha256 manifest, CDN upload to immutable versioned
paths (`/releases/vX.Y.Z/...`, far-future cache headers; `latest` is a pointer, never
overwritten content). A `CHANGELOG.md` gate (git-cliff or a CI check that the tag's
section exists) and a compat-matrix page (SDK version × protocol version × snapshot
version × image generation) close the loop.

## Deliverables
- `docs-site/` build config + CI deploy job; information architecture that surfaces the
  design docs as first-class pages (not buried repo files); link checker in CI.
- `.github/workflows/release.yml`: tag-triggered build/test/publish flow with the
  reproducibility check (build twice, diff hashes) and a dry-run mode for verification.
- `docs/versioning.md`: the three-surface semver policy, support windows (e.g. snapshot
  N-1 loading per E6-T16), deprecation process.
- Compat matrix page generated from a checked-in TOML source of truth.
- First real release cut end-to-end: `v0.6.0-rc1` published to npm (or a scoped dry-run
  registry if publishing is deferred) + CDN + GitHub Release.

## Acceptance criteria
- [ ] Docs site deploys from CI; every design doc listed above is reachable within two
      clicks of the landing page; link checker passes with zero broken internal links.
- [ ] Tagging a release candidate runs the full pipeline green: wasm artifact built
      twice with identical sha256, npm tarball published with provenance, GitHub
      Release carries the checksum manifest.
- [ ] `npm install @wasm-vm/sdk@<rc>` in a clean project + the E6-T21 example A against
      the CDN release URL boots a machine (release artifacts actually work together).
- [ ] Pushing a tag without a matching CHANGELOG section fails the pipeline.
- [ ] Requesting a modified upload to an existing `/releases/vX.Y.Z/` path is impossible
      by construction (bucket policy or CI guard — demonstrated, not asserted).

## Adversarial verification
Attack reproducibility: run the release build on a different runner class (or locally in
the pinned container) and diff hashes against CI — a mismatch refutes; then intentionally
perturb the toolchain (unpinned rustc minor bump) and confirm the pipeline *fails* rather
than shipping silently different bytes. Attack immutability: attempt to re-tag and
re-release the same version and to overwrite a CDN release path with modified content —
success at either refutes. Attack the compat matrix: pick two cells claiming
compatibility (e.g. SDK 0.6 + snapshot v1) and actually run them; a false cell refutes
the matrix's source-of-truth claim. Attack the docs: follow the getting-started page on
a machine with no repo checkout, only released artifacts — any step that requires
unreleased files refutes. Verify provenance: `npm audit signatures` (or the registry's
attestation view) validates the published package's provenance chain.

## Verification log
(empty)
