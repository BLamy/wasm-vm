# E6-T12f3 restricted radial admission evidence

The final source under proof is `ee23e8d63ba27afec874ec7dc63c6c6be3c7ee7a`.
Runtime implementation froze at `5c71957192758f0c14302683c628cf47e215eb75`.
`manifest.json` binds all archives, receipts, native LLVM binaries and the hardware screenshot.

Extract the lossless recordings into separate fresh directories:

```sh
mkdir -p /tmp/radial-worker-evidence /tmp/radial-cold-evidence
tar -xzf evidence/virgl-radial-domain/worker.tar.gz -C /tmp/radial-worker-evidence
tar -xzf evidence/virgl-radial-domain/cold.tar.gz -C /tmp/radial-cold-evidence
```

Worker evidence retains every native/Wasm result and recovery, raw sanitizer transcript,
LLVM raw profiles/export, stack usage, twelve native/Wasm graph probes, independent
coefficient/counterexample interpretation, real removed-guard source sabotage, all hardware
pixels and bank/buffer words, V8 coverage, source inventories and rejected receipt forgeries.
Cold evidence includes the clean clone report, complete canonical acceptance log and the
entire same recording set under `acceptance/`. All original receipt-bound bytes survive.
The native binaries allow independent LLVM coverage export against the recorded profiles.

The original worker acceptance log records a receipt inventory duplicate after successful
runtime checks. Only the recording harness changed; `resubmission.log` records the focused
successful repair commands. Each ancestral recording is checked against both its recorded
Git source and the final identical source. The final pristine-clone `make verify-E6-T12f3`
passes directly with no adaptive repair, with a clean checkout before and after.

The two complete radial fixtures are labelled authored structural ports: PRECISE qualifiers
are removed and the alpha MOV is explicitly projected with ADD zero. This does not establish
untouched original radial compatibility. Original corpus admission remains 12/19, and the
owned coefficient contract excludes the undefined small-coefficient predecessor. These are
isolated compiler/shared-renderer tests; guest GPU negotiation and desktop 300 MIPS are not
claimed. Previously HELD behavior carries forward only across unchanged evidence boundaries.
