---
id: E6-T11d65
epic: 6
title: Compile original stream-output layouts into typed native capture varyings
priority: 525.027039000402
status: verified
depends_on: [E6-T11d64, E6-T11d61, E6-T11d46]
estimate: S
risk: high
capstone: false
---

## Boundary

One explicitly selected standard compiler facet for original VirGL vertex
stream-output layout words. Check the original output count, four dword strides
and two words per output in typed C before upstream parsing/emission. Preserve
register, component range, buffer, destination offset and stream identity. Support
four buffers, stream0 and up to64 captured components per buffer; reject malformed,
undeclared, overlapping or out-of-stride output ranges before generating source.

Emit uint/uvecN native capture varyings from original output-register words before
host position adjustment. A host-selected buffer variant retains the original
complete layout and produces its checked interleaved native varying list and packed
stride. Initialize captured output registers for WebGL's unwritten-output rule.
Keep all historical compiler facets and response bytes intact. No resource,
decoder, capset or production execution authority follows from this compiler alone;
the ordered original-target/capture consumer is the next graphics boundary.

## Deterministic acceptance

`make verify-E6-T11d65`

Record one bounded compiler matrix through native C, ASan/UBSan and actual
fixed-memory Wasm. Independently compare complete GLSL/metadata/error responses,
original tokens and original layout words. Exercise every component range, first/
last output register and buffer, stride/destination bounds,128-output and64-
component boundaries, stage rejection, malformed headers, allocation failures and
recovery. Carry unchanged predecessor proof and compare historical responses.

On actual headed hardware WebGL2, link the typed checked varying list and compare
every captured original word across three deterministic data schedules, including
signed zeros, integer masks and NaN encodings, POSITION before Y adjustment,
partial/aliased writes and unwritten captured lanes. Cover all four buffers and
the64-component boundary. A deliberately incorrect native varying selection must
fail the unchanged complete-word oracle after actual capture/readback. Audit the
finest new executable regions and changed native branches, fixed memory and stack
bounds. Run affected gates, one final scrubbed cold clone and reopened portable
recording for a fresh verifier. Surface/deploy the partial compiler evidence in
appropriately scoped demo text.

## Adversarial verification

Predict each original output word and native varying type/order from original
layout and TGSI before opening the recording. Test independent component,
register and buffer combinations and one bounded alias/partial-write regression.
Check64 versus65 components, buffer3 versus4, register31 versus32, original stride
and destination arithmetic, missing/extra layout words, reserved stream bits,
reflection/data-field custody and allocation recovery. Compare old entry responses,
not only success flags. All generated strings/layouts must come from the selected
C/Wasm facet; no JS source rewrite or alternate compiler fallback. Audit full
captured output and the native varyings physically used, and require the promoted
regression to detect an incorrect native selection after GPU work.

## Verification log

### 2026-10-13 — worker — implemented, recorded compiler boundary

Frozen source/proof head `31bf0781db74fea94f51c9d6fa3217d16227bc99`; runtime
implementation `cefb45fd` is unchanged by the two proof-only portability repairs.
Command `python3 tools/virgl-stream-output-shaders/cold.py
target/evidence/stream-output-shaders-cold-03` runs `make verify-E6-T11d65`
in a pristine committed sparse checkout with scrubbed compiler/environment overrides.
All42 affected commands passed and the checkout remained clean. The recording
compares400 original-layout native/ASan/UBSan/actual fixed-memory Wasm responses,
all20927 historical response bytes against freshly built original D64 source,
181 real allocation failures/recoveries, and247 finest V8 plus357 changed native
executable regions with no unexecuted regions. The generated module remains16MiB;
measured selected stage/pair frame sums141296/197824 are below the256KiB stack.

Three actual headed hardware WebGL2 schedules54831/90107/171281 each capture160
original component/register/buffer layouts. Full-word/guard audit reopens all
recorded bodies, native varying types/order, fenced native calls and raw NaN,
signed-zero, mask, partial/alias/unwritten and pre-position-adjustment words.
The valid reversed native varying selection fails the unchanged full-word oracle
only after actual native capture, completed fence and readback. No renderer
consumer, capset, production Linux execution, worker/scanout or MIPS claim follows.

Portable worker `evidence/virgl-stream-output-shaders/worker` includes the final
cold run, complete earlier successful/failed diagnostics, both failed cold proof
preparations and complete original protocol/primary-source planning. Every member
and backward link was reopened through the actual gzip trailer.
ManifestSHA256 `cd82a9b788f33e1261f62694c40f0d22d4eedbe591a8f53a7204dbdd43440b1d`; index `fbe6f40c7fa30e96fd22d7e957bc1dc870ae7c682a3d1ff06befb9fcd02cd653`;
archive `08ded61150b358dfe04839c5931ca754b9681c9a6c04d009e30e3690e85eb98d`; 2438members/24367262compressedbytes.

The partial marker is deployed at `6b288a8e-3da0-4c81-8970-2674e22fa678`
(https://6b288a8e.wasm-vm.pages.dev) and canonical <https://wasm-vm.pages.dev>. Actual Wrangler receipts,
full staging/source bodies and canonical browser bodies are sealed in
`evidence/virgl-stream-output-shaders/deployment`, manifestSHA256
`94011feafe8720006fea2c4eab4e529c5d7b826d76cb590c86034001a673d8a0`. The default suite is127passed/0failed,
with zero unexpected errors, proof exports absent and production acceleration
explicitly disabled. The independently verified marketing/docs site is byte-identical
except roadmap/cache-version bytes. This is a worker claim awaiting the fresh critic.

### 2026-10-13 — independent verifier

VERDICT: verified

Fresh critic of submission `0c167360a8d01a1e51b7be1309d6caf70fbff611`, frozen
source `31bf0781db74fea94f51c9d6fa3217d16227bc99`, against verified D64
`6f43010dfa7b3e08bfe62f62543b7ee0468e1a21`. Predictions P1–P8 and the legal
TEMP-alias N1 / same-type native-selection S1 were declared before opening D65
evidence (`verifier/predictions.json`). No implementation code was changed.

- P1/P2 — HELD. Predicted admission, original-index varying types/order, complete
  layout and packed strides from the original words. Independently decoded all 400
  native ABI requests and 9,234 original TGSI token words; complete native,
  ASan/UBSan and selected fixed-memory Wasm responses agree. Count/component,
  declaration, stream, stage, range and overlap refusals match the independent
  oracle (`verifier/interrogation.json`, `citations.jsonl` compiler entries).
- P3/P4 — HELD. Predicted raw original output-register words and selected-C-only
  source/metadata. Interrogated 480 hardware captures over all three schedules,
  all 43,952 capture/guard bytes and 29,198 native calls, including every shader
  string, typed varying selection, completed fence and readback. NaNs, signed
  zeros, integer masks, partial/aliased/unwritten lanes and POSITION before
  adjustment agree. The original physical control fails only after GPU readback
  (`citations.jsonl` hardware/physical entries).
- P5/P6 — HELD. Predicted copied own-data layout custody and clean allocation
  recovery, with unchanged historical response bytes. All 181 actual allocation
  faults recover; 123 reflection cases satisfy refusal/custody checks. All 20,927
  complete historical responses are byte-identical, including error responses.
  D64 HELD results are carried only across identical code, dependency and seal
  digests (`authentication.json`, `interrogation.json`).
- P7 — HELD. Predicted finest executable-region coverage and bounded memory.
  Independently recomputed 247 JS regions, 357 native regions and 71 justified
  static waivers; no region remains unproven (`coverage.json`). Two original
  native predicate outcomes lacked evidence: declared-component mismatch at
  `standard_stream_output.c:39` and reversed-disjoint interval comparison at
  line 46. A three-case ASan/UBSan supplement from the frozen Git source supplies
  actual LLVM true/false counts 1/3 and 0/1 respectively. Selected Wasm returns
  byte-identical complete C response strings (`native-components/report.json`,
  `wasm-report.json`, raw profiles/coverage/source archive and binary). Wasm
  initial/maximum memory is 16,777,216 bytes; measured selected stage/pair frame
  sums 141,296/197,824 remain below 262,144 bytes, with the unchanged nested compiler
  boundary carried from D64. The critic's two signature-waiver checker
  diagnostics are preserved; their correction changed no runtime or oracle.
- N1/S1 — HELD. Predicted legal TEMP snapshot alias
  `MOV TEMP[0].yz, TEMP[0].wxyz` yields `[Ax,Ax,Ay,0]` when captured as OUT31.
  Twelve fresh headed Metal WebGL2 captures cover four buffers and three
  independent raw-data schedules, interleaved original indices and destination
  gaps. Caller layout mutation and later compiler calls preserve saved complete
  metadata/GLSL; JS arena ownership returns to zero. Physically swapping two
  valid uint varying selections in buffer 3 links and completes real capture,
  fence and readback before the unchanged whole-word oracle fails (expected
  exit 1). All 1,056 additional capture/guard bytes and native post-call readback
  bytes were independently checked (`finish.json`, `novel-citations.jsonl`,
  `alias-clean/report.json`, `alias-reversed/report.json`).
- P8 — HELD. Fully reopened 2,438 worker and 858 deployment members/backward links
  through gzip EOF. All 42 frozen-head cold commands pass with scrubbed environment
  and clean checkout before/after. Authenticated source bodies equal the submitted
  diff. Independently bound 639 staged files and 192 served bodies to frozen or
  unchanged authenticated predecessor bytes. Actual Wrangler receipts identify
  `6b288a8e-3da0-4c81-8970-2674e22fa678`; canonical suite is 127 passed/0 failed,
  zero unexpected browser errors, partial compiler marker and absent proof exports.
  Default Wasm remains SHA256
  `d45b575207e0035b5c518698e7b6793b2bf12da635531723fad70813a5956c36`
  (`authentication.json`, `finish.json`, deployment seal).
- SUITE: promote `tools/virgl-stream-output-shaders/alias-browser.mjs` as the
  deterministic alias/layout custody regression and physical native-selection
  control; retain the three component fixtures and complete critic recording.
  There is no remaining correctness or evidence gap. This verdict grants only
  isolated original-layout compiler authority; the renderer consumer and
  production graphics remain later task boundaries.

Verifier evidence is `evidence/virgl-stream-output-shaders/verifier`.
Full state-point citations SHA256
`d2a37b8f197bf94b8c4fd8d44702a7ce1fb00cbb6c85ef44fdbc645ad7eb48aa`;
novel citations `89619e8115ad5eb2950702810ea2efd726a2293d20fed1b4d2bc096390ae9766`.
The final critic seal reopens every member, digest and backward link to gzip EOF:
manifest `c82404435ddd31f8ac9878f08b3cbf5e00e874eee01617cb9440baf546b490e4`, index `f7c321115248ecc39e824f690c00f248016d739618517f4295c7c602b8e6b38f`,
archive `882edfef6fbb582d0a4309a9e267022273d85eba1c145fbb47260f6841e4dffc`; 64 members / 3656915 compressed bytes.
Worker/deployment seals retain the hashes in the worker entry unchanged.

Commands: `python3 evidence/virgl-stream-output-shaders/verifier/authenticate.py`;
`python3 evidence/virgl-stream-output-shaders/verifier/interrogate.py`;
`python3 evidence/virgl-stream-output-shaders/verifier/components.py`;
`node evidence/virgl-stream-output-shaders/verifier/component-wasm.mjs`;
`node tools/virgl-stream-output-shaders/alias-browser.mjs --output
evidence/virgl-stream-output-shaders/verifier/alias-clean --authority
target/evidence/d65-critic-opened-01/worker/cold/recording --seeds
1779033703,3144134277,1013904242` (exit 0); the same command with
`--output evidence/virgl-stream-output-shaders/verifier/alias-reversed --seeds
1779033703 --fault true` (expected exit 1 after native readback);
`python3 evidence/virgl-stream-output-shaders/verifier/coverage.py`;
`python3 evidence/virgl-stream-output-shaders/verifier/finish.py`;
`python3 evidence/virgl-stream-output-shaders/verifier/final_checks.py`
(syntax, task policy, queue, diff and unchanged-runtime checks);
`python3 evidence/virgl-stream-output-shaders/verifier/seal_final.py`.
All final narrow checks pass. No PR was merged.
