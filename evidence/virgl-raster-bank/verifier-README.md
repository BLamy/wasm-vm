# E6-T12f4b fresh verifier evidence

VERDICT: verified. The worker correction at `10cac3c8` limits pre-link approval
to draw-triggered linking and the guarded effects to those consuming bank words.
The correction satisfies the sole demand from the historical needs-evidence
verdict. All physical observations, source faults, caps, ownership predictions
and hunk coverage remain HELD at unchanged source and evidence digests.

`verifier-incremental-verdict.json` records the final verdict.
`verifier-incremental-manifest.json` binds the separately preserved predictions,
audit script, full incremental audit and verdict. The original archive, manifest
and `verifier-verdict.json` preserve the historical overclaim finding unchanged.

`verifier.tar.gz` preserves every independent record and script, including the
complete fresh-seed hardware capture, all three actual source-fault reruns,
two actual explicit-link scope probes, full LLVM/V8 counters, archive audits,
original-source bindings and successful/sabotaged independent regression runs.
`verifier-manifest.json` binds every original member and the complete archive.
No worker/cold record or shared build output was changed. The historical verdict
retains exact raw line/digest citations and all prior outcomes; the incremental
verdict records the correction's satisfaction and carries every HELD outcome.

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
without pixel change. This was reproduced twice on actual hardware and agrees
with the corrected claim. Recheck the sole correction using:

```sh
python3 evidence/virgl-raster-bank/verifier-incremental-audit.py
```
