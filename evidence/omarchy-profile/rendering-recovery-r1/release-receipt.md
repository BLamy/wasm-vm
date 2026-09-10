# Rendering-recovery release preparation

This record concerns visible desktop pixels and host-side fitting only. Guest
interaction is still too slow; E5.5-T03a/T03d are not verified. No production
Pages deployment is claimed by this preparation receipt.

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
