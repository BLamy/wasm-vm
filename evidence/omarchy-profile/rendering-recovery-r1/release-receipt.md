# Rendering-recovery release receipt

This record concerns visible desktop pixels and host-side fitting only. Guest
interaction is still too slow; E5.5-T03a/T03d are not verified. Preparation and
publication are recorded separately below; production browser acceptance is in
`production/report.json`, not inferred from the uploader's success message.

## Source artifacts

The SDR R3 provenance and immutable chunk upload remain recorded in
`../sdr-build-r3/final-pair-receipt.md`. The current release uses these exact bytes:

- Kernel: `af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce`, 24,208,896 bytes.
- Base manifest: `5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44`, 1,097,812 bytes.
- RAM: `2231a21eb8ebc8d3965d1352a3523501faebc87bda31e2c8dc184320219235f5`, 205,050,833 bytes.
- Delta: `1f56d0bd44c945fab3ec1c201d04f39dd3f590320f54c8d2224446ebffb7e7da`, 1,209,196 bytes.

Old local RAM/delta and the old release manifest were copied recoverably to
`target/omarchy-release-before-sdr.ZaMMdV` before replacement. No R2 objects,
buckets, user files or other distributions were deleted.

## R2 RAM publication

Wrangler 4.130.0 returned `Upload complete.` for the following exact command:

```sh
npx --yes wrangler r2 object put wasm-vm/sha256/2231a21eb8ebc8d3965d1352a3523501faebc87bda31e2c8dc184320219235f5/releases/boot-snapshot/omarchy-ready.snap.gz --file target/omarchy-sdr-r3-snapshot/omarchy-ready.snap.gz --remote -y
```

At 2026-09-10T05:46:55.324Z, a fresh unauthenticated GET from
`https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev/sha256/2231a21eb8ebc8d3965d1352a3523501faebc87bda31e2c8dc184320219235f5/releases/boot-snapshot/omarchy-ready.snap.gz`
returned HTTP 200, exactly 205,050,833 streamed bytes and the SHA-256 above.
That request sent no Origin header and its absent CORS header is not a CORS
verdict; the actual browser release capture must prove cross-origin access.

At 2026-09-10T05:49:44Z, an Origin-bearing HEAD for
`https://wasm-vm.pages.dev` returned HTTP 200, `Content-Length: 205050833`,
`Access-Control-Allow-Origin: *`, and `Vary: Origin`. This verifies the public
object's CORS policy without substituting for the actual browser capture.

The generator now uses the release's base manifest, not a stale R2 candidate
directory. Local artifact validation and both generator tests passed after the
paired replacement. The failed mixed-region runtime change was removed and its
tests/diff/screenshots were archived at planning commit `ddfd00d7`.

## Cloudflare Pages production publication

From frozen head `e05d12abe3dd7210082a2825f1ef1a679ff5bb5c`,
`bash tools/deploy-cloudflare.sh` exited 0. `deploy.log` records exact local
artifact validation, full-byte public R2 checks for all referenced large
artifacts, and the production upload: 18 files uploaded, 279 reused.

- Existing Pages project: `wasm-vm`, production branch `main`.
- Deployment URL: `https://9c404b04.wasm-vm.pages.dev`.
- Production app: `https://wasm-vm.pages.dev/app?guest=omarchy&desktop=1#ide`.
- Omarchy kernel/RAM and the other distributions' large objects were already
  exact and reused. The small R3 Omarchy delta shipped in Pages staging.
- No bucket was created or removed; no R2 object was deleted; no PR was merged.

The staged manifests rewrite relative large-artifact URLs to their exact
content-addressed R2 objects. Source manifests and the committed dist retain
their reproducible source-form URLs; the production report records the actual
rewritten descriptor and hashes. The runtime and SW bytes are unchanged from
the clean-clone proof at `e05d12ab` (see `frozen-head.md`).
