# Existing Pages release staging plan (not implemented or deployed)

Prepared during the E5.5-T03a cold browser run. T04b remains pending T04a;
this document does not establish acceptance or authorize a merge.

## Exact candidate assets

- Unbooted image `target/omarchy-profile-r2.ext4`: 4,294,967,296 bytes,
  SHA-256 `47584cba39876ee958ea8fa39d3432488277d230abb2997b5999e54b8defe13e`.
- Split directory `target/omarchy-profile-chunks-r2-256k`: manifest SHA-256
  `ec1bc2601b104cfb6d6875c091377ccfd0654d5b6aab71c6a08ae37263f1c391`,
  16,384 logical chunks, 10,535 unique `chunks/<sha256>.bin` files.
- Kernel `releases/kernel/6.6.63/Image`: 24,208,896 bytes, SHA-256
  `af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce`.

The existing image verifier checks every chunk against the full image and
rejects symlink/path escapes. Reuse it before staging. Do not publish booted
test disks or any original/private VM disk. No full ext4 object is needed.

## Intended immutable URL layout

Put both image manifest and chunk files under
`releases/omarchy/<manifest-sha256>/`; put the kernel under
`releases/kernel/sha256/<kernel-sha256>/Image`. Keep the accepted manifest
bytes unchanged. The demo release configuration pins the manifest hash and
kernel hash and must match these URLs exactly. Every URL remains same-origin.
The existing service worker excludes `/releases/` from app-shell caching.

## Staging contract

1. Build the accepted app locally, preserving unrelated dirty dist files.
2. Create a fresh scratch directory, never deploy directly from mutable
   `web/dist`. Copy only the intended application files, rejecting symlinks,
   unexpected artifact manifests, snapshots, old guest images and credentials.
   Keep capability-suite ELFs, wasm bindings/snippets and xterm assets.
3. Copy the exact kernel, manifest and referenced unique chunks; verify the
   staged copies, not just the source files. Check size/hash/URL bindings before
   any external write. Record sorted path/size/SHA-256 inventory and digest.
4. Enforce <=20,000 files and <=26,214,400 bytes per file for the entire staged
   release. Installed Wrangler 4.129.0 independently enforces these constraints.
   Its uploader batches at 40 MiB; the unchanged 256 KiB layout fits without
   inventing compressed-chunk semantics or requiring HTTP range requests.
5. Deploy this directory to existing project `wasm-vm`, branch `main`, with the
   configured Cloudflare OAuth session. No new hosting project, R2 credentials,
   account setting, paid service or GitHub Actions is required by this path.
6. Record deployment identity and verify the public app in a fresh Chromium
   context. Upload success alone does not prove desktop/input readiness.

## Replacement scope

`tools/deploy-cloudflare.sh` currently rewrites three legacy manifests and
requires R2 upload credentials for missing large assets. Replace that production
flow with the explicit Omarchy release staging contract. Do not leave the old
boot selection as a fallback. Retain unrelated generic validation tooling only
where it still has an actual consumer; do not mutate unrelated dirty manifests.

Before a manual web-dist build, copy the user's two dirty dist manifests into a
fresh scratch backup. Restore those files after the build and exclude them from
staging the source commit. Use `SKIP_WEB_BUILD=1` only after a successful recorded
manual build, because the hook otherwise stages all of web/dist including user
changes. Deployment staging must independently ignore those legacy manifests.

## Bounded tests to implement in T04b

Reject: missing or altered kernel/chunk/manifest, an unreferenced payload,
symlink traversal, an oversized file, too many files, old writable snapshots,
and release config/hash disagreement. A valid fixture must reproduce exactly
the expected staged inventory without modifying any source. Run the final
large-image integrity check once on the accepted frozen release.
