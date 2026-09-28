# Frozen rendering recovery candidate

Runtime/source implementation: `7c6fc874560e807d312b7d3657aadeec42356f05`.
Final recording-only correction: `e05d12abe3dd7210082a2825f1ef1a679ff5bb5c`.
No runtime, distribution bytes, or built files changed between these heads.

The final proof runs in `/private/tmp/wasm-vm-omarchy-render.D9yPVR/repo`.
It was cloned with `--no-hardlinks --single-branch`, then fast-forwarded to the
final recording correction before running any acceptance commands. `git status
--porcelain` was empty before the run and after the snapshot download; only
ignored dependencies and the manifest-verified downloaded RAM were materialized.
No files were copied from the dirty working tree into this clone.

Command (output: `cold-clone.log`, captures/report: `cold-clone/`):

```sh
env -i PATH="$PATH" TMPDIR=/private/tmp npm_config_cache=/private/tmp/wasm-vm-omarchy-render.D9yPVR/npm-cache make verify-E5.5-T03c OMARCHY_RENDER_EVIDENCE_DIR=/Users/blamy/Documents/Codex/wasm-vm/evidence/omarchy-profile/rendering-recovery-r1/cold-clone
```

No inherited `RUSTFLAGS`, `RUST_LOG`, `CARGO_*`, image overrides, credentials, or
diagnostic selectors are present in that environment. The target installs pinned
web dependencies, downloads/checks the declared R2 RAM, runs 41 focused tests,
then loads the committed `web/dist` and tracked release inputs using its own
loopback server. The base disk manifest/chunks use the normal immutable R2 URLs.

Frozen WASM: `c48e9c2d9ec550c7daf4875716fef1dc729072fdfc91b805394d379bee4b9305`.
Frozen SW: `d16015b8f4466a91a3c0e66dac0fe7fbfb08abf497920482c1fa741f578b32ad`;
executing build token `347161e9e2b8`.
The report distinguishes captured responses, actual-worker successful resource
timings plus fail-closed restore, and independent full-byte provenance fetches.
Inspector body omissions and contradictory abort observations remain recorded;
they are not reported as absent network events or fabricated worker-body hashes.
