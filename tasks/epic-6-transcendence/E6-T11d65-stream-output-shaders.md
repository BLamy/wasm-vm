---
id: E6-T11d65
epic: 6
title: Compile original stream-output layouts into typed native capture varyings
priority: 525.027039000402
status: implemented
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
