---
id: E6-T11d12
epic: 6
title: Execute compact floating vertex fetches from original GPU storage
priority: 525.0270390003
status: in-progress
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
