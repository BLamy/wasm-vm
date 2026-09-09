# Level-4 capstone measurement contract (E4-T28a)

E4-T28a defines the identity boundary for the six Level-4 capstone slices. It does not measure a
workload or claim a speedup. `tools/capstone_e4.sh` validates the committed denominator contract,
the append-only ledger chain, the served and deployable boot manifests, and the browser isolation
headers before a child records a result.

## Reproduce the boundary

Run these commands from a fresh checkout. The capstone runner scrubs `RUSTFLAGS`,
`RUSTDOCFLAGS`, `RUST_LOG`, every `CARGO_*` and `WASM_VM_*` setting, and the common compiler,
package, and browser cache variables before validation.

```sh
make web-dist
bash tools/capstone_e4.sh --self-test
bash tools/capstone_e4.sh --prepare --output evidence/e4-t28a/capstone-prepare.json
```

`--self-test` emits a schema-valid JSON envelope on stdout and must reject temporary fixtures for
an uncommitted candidate, a missing baseline row, a changed baseline score or commit, a changed
baseline build flag, a warmed profile, a bad manifest digest, and changed artifact bytes. The
`--prepare` mode is the strict measurement boundary: it rejects any uncommitted path and emits the
same envelope with `candidate.working_tree = "clean"`.

The command never captures a machine name, absolute checkout path, environment value, credential,
or benchmark cache path. Its only local exception is that `--self-test` may run beside known
deploy-local residue from a previous Pages assembly; the strict `--prepare` gate rejects that
residue too. A clean clone has no such exception to exercise.

## Frozen inputs and controls

`bench/capstone-baselines.json` pins the first four `level3-interpreter` ledger rows by benchmark,
ledger index, complete row digest, exact emulator commit, score, and complete config block. The
ledger is still append-only: later benchmark rows are allowed only when the existing hash chain
remains intact. A child must copy the `baseline.rows[*]` references into its result; it must not
select the latest row, recompute a denominator from a guessed value, or silently replace a binary.

The browser control arms the shipped JIT policy:

```text
?jit=1&jitThreshold=512&jitResidency=repack-off&jalr=1&region=1
```

The matched interpreter control is `?jit=0`. Both controls require a cross-origin-isolated,
whole-machine Worker with the committed COOP/COEP headers:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

Every sample uses a new Playwright browser context, clears origin data (cookies, storage,
IndexedDB, OPFS, and Cache Storage), creates a new machine/Worker, and performs no warmup. Child
results record every sample and the median; they never report the best run. WebKit and
independent-machine results are outside this directed proof and must not be presented as claims.

## Child commands

Each child owns the workload-specific evidence and runs its exact acceptance command after the
boundary has passed:

```sh
# E4-T28b
PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8133 PLAYWRIGHT_REUSE_SERVER=1 \
  npx playwright test tests/e4-t28-node-interactive.spec.js --project=chromium

# E4-T28c
PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8133 PLAYWRIGHT_REUSE_SERVER=1 \
  npx playwright test tests/e4-t28-coremark.spec.js --project=chromium

# E4-T28d
PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8133 PLAYWRIGHT_REUSE_SERVER=1 \
  npx playwright test tests/e4-t28-cold-boot.spec.js --project=chromium

# E4-T28e
PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8133 PLAYWRIGHT_REUSE_SERVER=1 \
  npx playwright test tests/e4-t28-gcc-interactive.spec.js --project=chromium

# E4-T28f, after all child evidence is verified
bash tools/capstone_e4.sh --final
```

The final command is owned by E4-T28f; this slice only supplies the identity/preparation helper.
The browser commands are intentionally shown with the Chromium project only. A child result must
include its exact source commit, build flags, runtime/guest digest, browser headers, and served /
`web/dist` artifact identities alongside its workload measurements.

## Result envelope

The helper emits `e4-level4-capstone-result-v1` with these required top-level fields:

```text
schema_version, schema, mode, candidate, build, baseline, controls,
fresh_profile, headers, artifacts
```

`candidate.commit` is a full 40-character commit. `build.flags` includes the release wasm/native
commands and the pinned RV64GC guest flags. `baseline` contains the content hash of the contract,
the current ledger content hash, and all four exact row references. `controls` contains both JIT and
interpreter arms. `fresh_profile` makes persistence and warmup explicit. `headers` records the
committed header-file digest and required values. `artifacts.served` and `artifacts.deploy` record
the manifest content digest and every artifact URL, declared SHA-256, size, and local-byte/remote
verification state.

This envelope is an input identity record, not a performance result. T28b–T28e append their own
guest timings, checksums, ratios, and adversarial observations; T28f is the only slice that may
combine them into a Level-4 capstone sign-off.
