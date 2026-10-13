---
id: E6-T11d65
epic: 6
title: Compile original stream-output layouts into typed native capture varyings
priority: 525.027039000402
status: in-progress
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
