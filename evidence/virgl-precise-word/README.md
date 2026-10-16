# E6-T12f4 instruction-local PRECISE word evidence

The frozen source under proof is `09afcaa29bda5206b98fb14e019f41395d669fec`.
`manifest.json` binds the lossless recordings, complete receipts, native LLVM
binaries, pinned token-audit binaries, generated Wasm modules and GPU screenshot.

Extract each recording into a separate fresh directory:

```sh
mkdir -p /tmp/precise-worker-evidence /tmp/precise-cold-evidence /tmp/precise-refuted-evidence
tar -xzf evidence/virgl-precise-word/worker.tar.gz -C /tmp/precise-worker-evidence
tar -xzf evidence/virgl-precise-word/cold.tar.gz -C /tmp/precise-cold-evidence
tar -xzf evidence/virgl-precise-word/refuted-b8743ae4.tar.gz -C /tmp/precise-refuted-evidence
```

The worker recording contains every native/Wasm result and recovery, the full
ASan/UBSan transcript, LLVM counters and stack reports, actual pinned token flags,
the independent rational word reference, closed precision/domain metadata attacks,
all hardware pixels and bank/buffer words, source inventories, three actual compiler
fault source trees and compiled Wasm modules, and retained equality/selected/radial
browser recordings. Cold evidence includes the scrubbed clone report, complete
canonical acceptance log and the same full recording set under `acceptance/`.
Every archived file was streamed back and compared with its original size and SHA-256.

Both canonical runs prove 1,404,199 native calls, 24,556 fixed-memory Wasm calls,
830 hardware draws, 3,320 exact words and 3,399,680 checked pixels. The native run
executes 229 real allocation failures, including 20 upstream malloc/realloc sites;
all 58 single and 56 paired profile anchors recover after each. The fixed Wasm heap
remains 16 MiB with the same backing buffer. Three real compiler-source faults
(MAX source order, signed-zero equality and unordered inequality) contradict the
independent hardware oracle. The final pristine clone passes the canonical command
directly, with an unchanged clean checkout before and after.

The initial source at `b8743ae4` passed native checks but published incomplete
ordinary GLSL during fixed Wasm heap pressure. Its complete failed recording is
retained separately: `wasm/calls.jsonl` line24440/index24439 contains four `(null)`
operands in the successful mixed-pair result. That archive retains the original
transcripts, results and coverage; its original executables were subsequently rebuilt.
The owned allocation/strbuf wrapper at the frozen repaired source preserves all
pinned vendor hashes and rejects incomplete results before publication. The full
selected risk-tier submission was repeated after this runtime repair.

This evidence covers instruction-local FSEQ_PRECISE, FSNE_PRECISE, MAX_PRECISE and
MOV_PRECISE. Exact MAX selects its second operand on equal or unordered comparisons,
including the selected zero sign and NaN payload inside private shader words. The
modifier remains attached to each instruction, with a mandatory closed operation
contract and every existing bank/control obligation. Numeric and raster authority
remain separate. Arbitrary words enter through finite carriers and are observed as
ordinary zero/one bit projections, avoiding an unsupported NaN/subnormal raster claim.

All 19 captured bodies and their hashes remain unchanged; 12 are currently accepted.
Other shader boundaries still require ordered destination masks, owned-bank output
authority and PRECISE ADD/MUL arithmetic. This isolated compiler/shared-renderer
submission does not enable guest GPU negotiation or establish desktop 300 MIPS.
