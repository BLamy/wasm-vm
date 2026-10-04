# E6-T12f6 unchanged original shader corpus evidence

The integration harness is frozen at
`b961c772d0c79141c0c7050f9deb0c1cb94905f4`. Production compiler and renderer
semantics remain those of the independently verified parent
`a80ba9e929698c6d582589856822c18aad8c513c`. The final pristine-clone canonical
acceptance is also the worker happy recording.

`manifest.json` binds every recording file, receipt, native/Wasm replay artifact,
clean-clone report and hardware screenshot. Extract the complete recordings:

```sh
mkdir -p /tmp/original-corpus-worker /tmp/original-corpus-cold
tar -xzf evidence/virgl-original-corpus/worker.tar.gz -C /tmp/original-corpus-worker
tar -xzf evidence/virgl-original-corpus/cold.tar.gz -C /tmp/original-corpus-cold
```

The worker archive contains the acceptance. The cold archive contains the same
acceptance under `acceptance/`, plus the complete clone report/log. Separate JSON
inventories give every member's size and SHA-256. Packaging streamed every
archive member back, compared it with its original, and rechecked the original
inventories. Native/Wasm replay artifacts match the recorded binary digests.
Actual compiler-fault sources/builds, complete API transcripts, LLVM/V8 counters,
all observed bytes, uniform readbacks, hardware identities and screenshots are
preserved. No recording member was filtered out.

For strict receipt replay, use the preserved exact clone in `cold-report.json`
with its recorded `target/evidence/virgl-original-corpus-cold` evidence directory:

```sh
python3 tools/virgl-original-corpus/receipt.py target/evidence/virgl-original-corpus-cold
```

The recording binds all 19 original SHA-256 bodies and complete metadata. Native
and Wasm call the single and pair APIs on the original bytes; the 8-by-11 matrix
admits 57 compatible requests and rejects 31 incompatible requests. Physical
WebGL2 compiles and links all 57 admitted pairs. Each of three input schedules
observes 1,536 defined original vertex words and 155,648 actual fragment pixels.
Every original stage is observed. Independently authored equations predict
vertex outputs, and a literal TGSI interpreter predicts the four gradients.
Only defined lanes count. Zero/copy samples have zero numerical ULP distance;
the two lighting bodies have an eight-ULP budget for the stated samples.
RGBA8 pixels have explicit zero/one-byte budgets. These are bounded observations,
not a global numerical guarantee for arbitrary workload inputs.

Native records 2,046 calls, 361 hostile/mutated inputs, 1,578 valid recoveries
and eight repeated original/pair rounds. Wasm records 2,198 complete calls,
including original/pair parity and retained output ownership with the same
16 MiB backing buffer. The consumer validates 19 original contracts, 67
forgeries, 75 bank cases and 19 owned snapshots without invoking getters.
Finite-bank, signed count/address, radial and raster-definedness obligations
remain explicit. Pairing preserves those contracts and follows the original
fragment interpolation declaration.

Four named historical authored grammar fixtures are now valid under the
separately verified mask/PRECISE boundaries. Their hashes and full metadata are
explicitly migrated; each is observed in 32 physical identity-position draws.
The 512 migration words per schedule are separate from the 19 original bodies.
The captured textured scene keeps all 112 fixture cases and 1,792 mixed
recoveries, rejecting 108 fixtures and admitting only those four migrations.
The retained equality leaf's eight migrated bodies are authored fixtures,
separate from this captured original corpus.

One actual isolated `raw_bits.c` fault reverses the MAX_PRECISE selection and
recompiles the Wasm compiler. The unchanged original lighting body contradicts
the independent prediction at transform-feedback lane 4. Generic browser or
compiler failures do not satisfy this fault check. Nine retained physical GPU
leaves and promoted arithmetic/raster regressions also pass.

The first pristine run at `f19544c6` passed runtime checks but its receipt reader
indexed the absent optional `generic` field of a position-only shader. The
one-line reader repair uses the existing optional-field representation and
changes no compiler, renderer or oracle semantics. The final clean recording
above proves the repair. The initial log/report are preserved in `diagnostics/`;
ephemeral in-memory reader checks are not submitted as exact-source acceptance.

The full admission and output limits are in `tools/virgl-original-corpus/README.md`.
This integration does not enable production guest GPU negotiation, establish
complete compositor suitability, measure desktop MIPS/FPS or deploy the demo.
