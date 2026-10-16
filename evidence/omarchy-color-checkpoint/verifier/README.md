Independent E5.5-T05c1 verifier record. Start with VERDICT.md and PREDICTIONS.md.

recordings.json authenticates recordings.tar.xz. The archive contains records.json
and content-addressed payload/*.bin: map each original path through records.json,
check its byte count/SHA256, then reconstruct in a separate directory. Source
bodies and data are retained as evidence; do not execute them automatically.

The archive preserves all original literal-pattern and selected-limit sabotage
hardware recordings, full logical/native/checkpoint buffers, sources, coverage,
commands, screenshots, and independently expanded run/audit records. Repeated
byte-identical payloads are stored once only after hashing the actual originals.
The readable predictions, verdict, audits and diagnostic scripts are also copied
alongside the archive for inspection. Diagnostic scripts originally resolve from
target/evidence/critic-omarchy-color-checkpoint in the named source checkout; the
archive supplies their complete original provenance.

Worker originals are separately authenticated in ../worker/frozen.json and
../worker/pristine.json. Historical C evidence and negative observations retain
their original scope. This verifier archive contains no new factory pair or
production deployment.
