---
id: E6-T11d12
epic: 6
title: Execute compact floating vertex fetches from original GPU storage
priority: 525.0270390003
status: verified
depends_on: [E6-T11d11]
estimate: S
risk: high
capstone: false
---

## Boundary

One compact floating vertex-fetch boundary in the selected standard async renderer:
original R/RG/RGB/RGBA16_FLOAT, R/RG/RGB/RGBA8_UNORM/SNORM and
R/RG/RGB/RGBA16_UNORM/SNORM. Use one immutable pinned format descriptor for
component count, byte width, scalar alignment, native type and normalization.
Keep original buffers and native floating shader inputs. Ordinary array fetches
must execute native vertexAttribPointer conversion with exact source offsets,
strides and divisors; no CPU vertex conversion or shader evaluation. Preserve
float32 and legacy admission.

Validate effective buffer+element offsets and strides by the actual scalar size,
not an assumed float32 alignment. Bound every actual source fetch with the compact
byte width. Preserve the existing work and ownership ceilings. Stride-zero data
uses the existing retained asynchronous GPU read tickets; read only the declared
source bytes, unpack only scalar format values and native missing lanes, then bind
native generic floats. Release complete retained batches on every failure, source
revision, cancellation, name reuse and disposal. New format/type/normalized state
must restore across A/B/A with the original VAO state cache.

Pure integer, scaled, normalized32, packed/swizzled vertex formats, compiler
semantics and production caps remain separate. Original shader bodies execute
on the GPU; undefined native NaN payload domains gain no portable certificate.
This prerequisite does not activate complete API support or guest graphics.

## Deterministic acceptance

`make verify-E6-T11d12` runs narrow source syntax/format checks, native and
ASan/UBSan pinned-header format/ABI checks, literal original packet acceptance and
actual headed hardware draws through the unchanged fixed-memory compiler. Record
all newly admitted format/component combinations, source/type/normalization,
original full GPU buffers, native missing lanes, finite half values (normal,
subnormal, signed zero and max finite), normalized endpoints/interiors and special
half category handling without certifying undefined NaN payload bits.

Use independent literal format/upload decoding and original shader operations to
predict full framebuffer pixels and every actual pointer/fetch/divisor/range. The
oracle must not import the runtime descriptor or scalar unpacker. Cover array and
indexed/instanced/restart paths; byte and half alignment including individually
unaligned offset splits with aligned sums; non-four-byte and overlapping strides;
stride-zero constants, exact ends and one-byte-short storage, staging/work ceilings;
pending source revision/name reuse/cancellation/disposal and delayed-fence schedules;
poisoned native type, normalization, pointer, divisor and generic A/B/A restoration.

Two actual served native/scalar-fetch regressions must complete a GPU draw/fence
and fail the independent original pixel oracle. Record V8 coverage and served
source/blob custody. Carry unchanged compiler/allocator and earlier HELD seals;
run the affected point/list/default-restart paths once. Record one final pristine
exact-head default command with scrubbed environment, then seal for a fresh critic.

## Adversarial verification

Predict byte widths, native pointer types, normalized values, missing lanes,
source IDs, last fetched byte and pixels before inspecting the recording. Audit
all changed runtime hunks and retained scalar source bytes. Independently seed one
mixed-format/shared-buffer and stride-zero fetch pattern with a delayed schedule;
probe signed minima, half exponent boundaries, offset sums, one-byte-short bounds
and stale/reused source ownership. Sabotage the promoted oracle via real GPU
execution. Authenticate source/record/actual Wasm identities and pristine clone;
carry unchanged HELD proofs rather than restarting unrelated compiler arithmetic.

## Verification log

### 2026-10-10 — worker — activated compact floating fetch boundary

Dependency E6-T11d11 is independently verified at
`1fbdfa7e53ebe6e8ed4a80935687d8b71a797f42`; index ownership was explicitly
released. Its runtime/compiler and HELD seals are retained. The production
readiness record `evidence/virgl-production-readiness/standard-compact-vertex-gap.json`
authenticates 353 source/generated identities and 20 original compact format
packets rejected at that exact head. This ordered high-risk S boundary implements
only compact floating vertex fetch; it grants no positive production capability.
The user's continuing production graphics request keeps this chain ahead of
unrelated queue work.

### 2026-10-10 — worker — narrow self-validation before freeze

The original 301-case wire matrix and native pinned-header enum program passed.
Headed M4 Metal self-validation passed 225 full-frame draws, 60160 independently
derived pixels, 5 private native index buffers and 192 NaN-category pixels.
All twenty compact combinations execute as native arrays and retained generic
attributes under three schedules; four old float32 combinations remain covered.
Both actual served conversion faults completed native draws/fences and failed
the original pixel oracle. This is self-validation, not submitted final evidence.

The first hardware probe exposed a remaining historical source-offset alignment
predicate in object creation; the selected standard path now defers it to the
effective offset check, preserving the legacy predicate. Later inner-loop failures
were fixture errors: stale host-method names, illegal cross-class GL poison buffer
reuse, and a B-context upload still reading A's backing. The corrected fixture uses
real store transfer/revision operations, separate valid poison buffer classes and
complete original shared-buffer replacements. No failed self run is evidence.
Final submission now runs the affected gates once at a frozen head, followed by
a pristine exact-head default acceptance and a fresh critic. Compiler/vendor,
guest and production paths remain unchanged.

### 2026-10-10 — worker — submitted original compact fetch evidence

Implementation/harness freeze: `ac77cdd095de121d71628308d920bfdcdbc454c3`.
The recorded hot command `VIRGL_STANDARD_COMPACT_EVIDENCE_DIR=target/evidence/
virgl-standard-compact-final make verify-E6-T11d12` passed with exit0; no harness
correction or physical carry was needed. One pristine clone runs the default
complete `make verify-E6-T11d12` at that exact head with scrubbed environment,
exit0 and empty checkout status before/after. Command: `python3 tools/virgl-command/
standard-compact-cold.py --output target/evidence/virgl-standard-compact-final-cold`.
Cold report SHA256 `b3f88cd087837eb6db5fc2391c40f6ea2172499d21c57bd81b854d5b12fcbeca`.

Each hot/cold run records 301 original wire cases; independent pinned native and
ASan/UBSan enum checks; original fixed16MiB compiler identities matching the D11
critic seal; 225 actual headed M4 Metal compact frames; 60160 independently
derived full pixels; 5 private original-index buffers and 192 NaN-category pixels.
All twenty compact combinations and four retained float32 combinations execute
as native arrays and retained stride-zero generic values under three schedules.
Ordinary arrays retain original full GPU storage and execute native pointer
conversion. Supplied generic words, actual compact source read widths, missing
lanes, finite half endpoints/subnormals/signed zero, normalized signed minima and
original shader bodies are physically exercised. Native NaN payload bits receive
no portable certificate. Nine bounds/staging rejections occur before drawing, six
source-revision/cancel/reuse suspensions drain or preserve original generations,
and disposal plus A/B/A poisoned native state restore release bounded ownership.
Both actual served normalization/scalar-unpack faults complete native draws and
final fences then fail original full pixels. Retained point128/list304/default-
restart189 hardware frames and their five actual faults pass independent saved
pixel audits. Their historical seals and compiler/allocator evidence are unchanged
from dependency1fbdfa7e; no unrelated C arithmetic gauntlet was restarted.

Seal command: `python3 tools/virgl-command/standard-compact-seal.py
target/evidence/virgl-standard-compact-final
target/evidence/virgl-standard-compact-final-cold
evidence/virgl-standard-compact/worker`. The committed worker seal has16252
records; archive SHA256
`fcf9e7c4490eda1974668d22a8d1f1f2d28fbea28a8d157b31675d56fba860c4`;
index SHA256 `0b90efc9b0106526f4e54294377d4e01c7a1e464ee1daa4c24038385d8f2f480`.
Hot receipt SHA256 `0f23206cee8f3c4ebfb150b027ee4f6845acf6dda2399d8c04f10b4051cc8002`;
cold receipt SHA256 `f359b05663644cc0d92415c33410dd9e5163b4d51c6148ce5dd5b5dcd2ce64db`.
Source, generated compiler, served-source, V8 coverage, full pixel/buffer blobs,
original packet histories, GPU state and screenshots are sealed. This is isolated
standard compact floating fetch authority only. Complete API qualification, typed
production capsets, actual guest offload, deployment and performance remain gated.
Only a fresh critic may set verified.

### 2026-10-10 — fresh verifier — VERDICT: verified

VERDICT: verified

Predictions were written to `evidence/virgl-standard-compact/verifier/predictions.json`
before inspecting the worker recording. The critic implemented no runtime code.
The original runtime/harness freeze remains
`ac77cdd095de121d71628308d920bfdcdbc454c3`; only promoted tests and proof metadata
follow it. Promoted critic harness freeze:
`4fd889f27c477978b59f81e9cecb4bb7916e9c45`.

- P1 custody/pristine/compiler — HELD. Independently authenticated all 16252
  original archive records, each hot/cold run's 507 source and 8122 file identities,
  actual served/source/coverage bytes, and original fixed16 MiB generated Wasm
  against D11 critic pins. The exact-head pristine default make returned exit0,
  with scrubbed environment and empty checkout before/after; the clone remains
  at the claimed freeze and clean. 136 unchanged historical evidence files and
  compiler/allocator HELD proofs carry forward. Citation:
  `verifier/authentication.json`; worker archive SHA256
  `fcf9e7c4490eda1974668d22a8d1f1f2d28fbea28a8d157b31675d56fba860c4`.
- P2 original admission/ABI — HELD. Decoded the 301 hot/cold literal packets
  independently of renderer descriptors and checked native plus ASan/UBSan pinned
  enum results. 297 independent browser packets additionally execute standard,
  legacy, overflow and unsupported-format branches under exact-source V8
  coverage. Float32/legacy admission remains bounded. Citations:
  original `hot/wire/report.json`, `hot/abi/compact-{native,sanitize}.json` in the
  worker archive; `verifier/fresh-audit.json` and `coverage-audit.json`.
- P3 original arrays/pointers/bounds — HELD. Rebuilt full GPU sources from each
  original packet and owned upload exchange, then independently derived native
  types, normalized flags, components, offsets, strides, divisors, actual index
  extrema and required ends. Every actual native pointer uses its original source
  generation. Shared SNORM at original `hot/hardware/report.json:162727` fetches
  resource 3 at offset 213, stride 3, through requiredEnd 251; native source/pixel
  identities are in `verifier/citations.json`. Pixels SHA256
  `aeacb5e0bcf97e6af65b18da519988b8dc9eaaaa69badb8430230b2c7805ee2e`.
  Nine rejections per original run are independently predicted before drawing,
  including actual short ends, scalar misalignment and aggregate staging 7>6.
- P4 original scalar/TGSI pixels — HELD. A separate literal scalar decoder and
  interpreter of the original TGSI operations, importing no renderer descriptor,
  scalar unpacker or worker model, verified 450 original hot/cold frames and 120320
  full pixels. Ten private original restart buffers match the literal indices.
  Signed minimum at `hot/hardware/report.json:71664` produces generic word
  `0xbf800000` and native missing lanes `(0,0,1)`; pixels SHA256
  `d5af5258e13488f04e0155be6e97d36b39a46a4105d2374ed44a69690a28cc7c`.
  The half exponent transition at line193500 preserves `0x03ff/0x0400` and
  negative counterparts; pixels SHA256
  `28f67ea1e299227ba8a2986df2cdd5c6950e245d50bee59c122abc5b57e97d1d`.
  Signed zero, subnormals, max finite, infinities and 384 NaN-category pixels held.
  No native NaN payload certificate is issued. Citation: `verifier/physical-audit.json`.
- P5 retained source/ownership — HELD. Every constant source copy/read uses the
  declared compact width and original bytes. Revision/cancel failures retire the
  full batch before any draw; public name reuse preserves the originally uploaded
  generation. Disposal releases read/staging ownership. Actual later-turn fence
  polls are bounded and every sync retires. A/B/A restores poisoned type,
  normalization, pointer, divisor and generic state. Original restored A at
  `hot/hardware/report.json:248523` has pixels SHA256
  `9b6eb10cf9f7254d19c07e14ebdc2682490af62f58eddbac00daa5dd9a243fbb`.
- P6 original two GPU fault witnesses — HELD. Both original native-normalization
  and constant-unpack served faults finish native draw/fence work, retain the
  original full GPU buffers, and contradict independently derived original pixels.
  Normalize fault pixel(10,3): predicted `[174,175,175,97]`, observed all255;
  pixels SHA256 `020794cc70dac71e5d589a8294fae365d9a9322d6930dbbc5d885a3b06cac92e`.
  Unpack fault pixel(1,2): predicted `[159,191,223,255]`, observed all255;
  pixels SHA256 `0e48da2a94ba03bc5eca17e7f2e5c8aae637ec5606795e54cffc2d7ac88abc89`.
  Exact original record lines, source mutations and blob custody are in
  `verifier/citations.json` and `physical-audit.json`.
- P7 changed-hunk coverage/regression — HELD. All 61 added runtime lines are
  executed under authenticated detailed V8 coverage or individually structural
  waivers. The only unexecuted executable subexpressions are the unchanged
  legacy-only predicates at `state.mjs:368` and `state.mjs:1159`, separately waived
  because their added standard bypasses execute and their legacy bodies are the
  predecessor text. Original point 128/list 304/default-restart 189 and five faults
  per run retained their independent saved pixel verdicts; both hot/cold were
  rechecked with unchanged predecessor oracles. Compiler arithmetic is unchanged
  and was not restarted. Citation: `verifier/coverage-audit.json`.
- P8 independent attack/promoted-oracle sabotage — HELD. Seed `0x6b82d1f3`
  recorded 44 new native frames/31744 pixels across all 20 compact combinations,
  shared float/compact storage, delayed stride-zero reads, signed minima, half
  exponent transitions, effective offset sums, short bounds and source lifetime
  probes. Independent A/B/A and shared-generation reuse held. Both actual served
  faults against the promoted interpreter completed draws/fences and failed
  pixel(1,2): expected `[136,160,224,255]`, observed all255. Citation:
  `verifier/fresh-audit.json`, sealed `final-gpu/report.json` and
  `final-sabotage-{native,constant}/report.json`.

Commands: `python3 evidence/virgl-standard-compact/verifier/authenticate.py`;
`node evidence/virgl-standard-compact/verifier/audit.mjs`;
`node tools/verify-virgl-standard-compact.mjs --output
evidence/virgl-standard-compact/verifier/final-gpu --adversarial true`;
the same hardware runner with `--smoke true --mutation native-normalize` and
`constant-unpack` (both expected exit1 only after original pixels contradict);
`node evidence/virgl-standard-compact/verifier/fresh-audit.mjs`;
`python3 evidence/virgl-standard-compact/verifier/coverage.py`;
the unchanged `standard-{point,assembly,restart}-pixels.mjs` on each sealed
hot/cold retained directory; relevant Node syntax, Python compile and diff checks.

SUITE: promoted deterministic seeded browser test
`renderer/virgl-command/tests/standard-compact-vertex-fetch-adversarial.mjs` and
independent original-operation oracle
`tools/virgl-command/standard-compact-adversarial-oracle.mjs`.
Critic seal: `evidence/virgl-standard-compact/verifier/{manifest.json,records.json,
recording.tar.gz}`, 296 records, archive SHA256
`905bbffa7111083b74923a6d2d7df455aa9dc3a85487abf8d4df286b8c85a3f9`, index SHA256
`ae175766fbbe6075521bfb86e8f0e39134f2297325d8a43466485c0e802068db`.
The recorded authority is only isolated standard compact floating fetch.
Complete API, production capsets, actual guest graphics, deployment, throughput
and native NaN payload portability remain separate gates.
