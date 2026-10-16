# Fresh verifier reproduction

Run from the repository root on the recorded macOS environment, with the frozen implementation sources unchanged:

```sh
python3 evidence/virgl-component-floats/verifier/build-independent.py
python3 evidence/virgl-component-floats/verifier/audit.py
python3 evidence/virgl-component-floats/verifier/generate-gpu.py
node evidence/virgl-component-floats/verifier/gpu-audit.mjs
python3 evidence/virgl-component-floats/verifier/check-gpu-rationals.py
python3 evidence/virgl-component-floats/verifier/generate-gpu.py audit-sabotage.dylib sabotage-inputs.json
node evidence/virgl-component-floats/verifier/gpu-audit.mjs sabotage-inputs.json sabotage-results.json
```

The final command must exit unsuccessfully on the first MAX numeric-negation mismatch. It is a deliberate altered compiler, with the independent TGSI corpus and rational expectations held unchanged. All compiler writes remain inside this verifier directory. Compiled `.dylib`/`.dSYM` and generated parent/sabotage source directories are local build artifacts; the script reconstructs them from the pinned Git parent and bound current source.

`review-worker.py` rechecks the complete frozen worker receipt and all nested evidence without rewriting it. `check-gpu-rationals.py` independently decodes GPU words and raw carriers using Python fractions; it does not import worker oracle code. Seed `851ac309` controls the 360 independent arithmetic vectors.

The final evidence replay commands were:

```sh
python3 evidence/virgl-component-floats/verifier/review-worker.py
python3 evidence/virgl-component-floats/verifier/review-worker.py /var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-component-floats-cold-udhbtrt_/wasm-vm evidence/virgl-component-floats/cold-clone/acceptance cold-review.json
python3 evidence/virgl-component-floats/verifier/check-cold.py
```

The cold replay uses the surviving clone's native binary and source tree; the records copied into the repository are byte-identical to its acceptance output. `check-cold.py` also rehashes all 179 copied records and confirms the surviving checkout is still clean at the frozen head. Compiler binaries include local debug paths and are bound by their individual hashes; only the Wasm byte identity is shared between warm and cold builds.
