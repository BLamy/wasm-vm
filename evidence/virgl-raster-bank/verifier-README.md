# E6-T12f4b fresh verifier evidence

VERDICT: needs-evidence. The unqualified worker claim of bank approval before
program linking is contradicted. The guarded bank-consuming output boundary,
all physical observations, source faults, caps and ownership predictions hold.
The only demand is the explicit scoped worker correction recorded in the verdict.

`verifier.tar.gz` preserves every independent record and script, including the
complete fresh-seed hardware capture, all three actual source-fault reruns,
two actual explicit-link scope probes, full LLVM/V8 counters, archive audits,
original-source bindings and successful/sabotaged independent regression runs.
`verifier-manifest.json` binds every original member and the complete archive.
No worker/cold record or shared build output was changed. `verifier-verdict.json`
retains exact raw line/digest citations and all carried HELD outcomes.

Extract into `target/evidence/virgl-raster-bank-verifier` to preserve relative
paths. The direct audit and replays require the original worker/cold recordings
bound by `manifest.json`; their complete archives remain in this directory.
The cold source-bound replay uses its named pristine source root in the cold
report. The standalone promoted regression is run after the recorded Wasm build:

```sh
node renderer/virgl-command/tests/raster-bank-verifier-regressions.mjs
python3 target/evidence/virgl-raster-bank-verifier/direct-audit.py
```

The scope probe at report line14747/GL event212 creates and links Program22
while copied C0.w is1. Restoration skips that bank and the later draw rejects
without pixel change. This was reproduced twice on actual hardware. It does not
show unsafe GPU transport; it identifies the exact overclaim to correct.
