# E5.5-T03an — compiled FMADD.S evidence

Runtime and acceptance harness freeze: `618286f3b1431990bbeddb9ef40d894b67be0605`.
Published artifact-reference commit: `c531ceffb9b7adc8de9f5ebc927d00076a26f1dd`.
Release WASM: `0f9b1213fa160f31d4f35503f6b35b4caf7193668eac3c369ac4a75611b6fced`.

## Claims and limits

The optional FMADD.S helper performs one software fused operation with precise
rounding, NaN boxing, flags, register aliases and exits. The independent exact
oracle exposed 24 inherited backend flag mismatches; `backend-preflight.log`
preserves them. The correction changes flags at two boundary outputs, retaining
result bits. Other fused admission and F64 arithmetic remain unchanged.

Instruction correctness does not establish desktop responsiveness. The actual
physical-input outcome is recorded separately in `physical-input/`,
`physical-summary.json` and `visual-inspection.json`. A successful recording
requires independent nonce readback by Enter+120 seconds and personal inspection
of a fresh image showing the typed command and returned prompt.

## Reproducible records

- `derive-goldens.py`, `fmadd-goldens.json`: 56 exact rational triples, five modes.
- `bind-renderer-page.mjs`, `saved-fmadd-encodings.json`: pinned R3 address-space
  walk, actual page hash and 24 fully contained FMADD.S parcels in measured regions.
  The trailing partial parcel is excluded. `page-binding-initial.log` preserves
  the initial overly strict end-of-page assertion.
- `freeze.py`, `frozen.json`: submitted sources, recorder closure, carried AM
  evidence, exact AJ R2 pair and release artifacts, recorded before final gates.
- `record-submission.py`, `affected-commands.json`: every affected command passed.
  Detailed logs include native/private/shared generated-code cases, independent
  verifier literals and precise helper-count, memory-write and fault checks.
- `ci-commands.json`, `ci.log`, `ci-failures.json`: full local `make -k ci` ran and
  failed in the five explicitly cited pre-existing categories. This gate is not green.
- `browser/`: real built Chrome run, ELF, full state digests, actual memory growth,
  4,570 JIT retirements out of 5,000 and all 127 ISA tests passing with zero errors.
- `cloudflare-deploy.log`, `cloudflare-public.json`: tested deployment and twelve
  exact-byte comparisons across the deployment URL and canonical public origin.
- `run-cold.py`, `cold/`: one pristine clone, scrubbed Rust/Cargo settings,
  byte-identical release rebuild and the same deterministic acceptance command.
- `symbols.py` and `bind-names.mjs`: if the physical trial fails, bind its optional
  post-verdict CPU sample to names only after exact executable-section comparison.
- `seal.py`, `submission.json`, `sha256.txt`: final claim and immutable file index.

The fresh critic's independently written predictions, oracle, sabotage and
coverage audit are in the sibling `fmadd-single-verifier/` directory. Its final
verdict, not this worker's claim, determines the task status.
