# Original packed vertex fetch

The standard async factory admits pinned original VirGL R10G10B10A2_UNORM,
USCALED, SSCALED and SNORM enums 8/123/172/173. These are four channels in one
four-byte little-endian element, with widths 10/10/10/2 and shifts 0/10/20/30.
Four-byte effective offset/stride alignment and the actual four-byte end apply.

Unsigned arrays use the original GPU buffer with unsigned REV fetch, size 4,
and the corresponding normalization flag. Signed arrays fetch the same original
four bytes as unsigned unnormalized REV fields. The actual C vertex emitter
sign-extends each field on the GPU; SNORM divides by 511/1 and clamps minima.
This avoids the signed packed alpha mismatch observed in the hardware run and
preserves the original [GLES signed field contract](https://registry.khronos.org/OpenGL/specs/es/3.0/es_spec_3.0.pdf), section 2.9.2.

`translatePairVertexFormats` accepts only own primitive texts and four compatible
16-bit host masks. Packed normalized inputs are a subset of signed packed inputs,
disjoint from integer inputs, and name declared vertex attributes. They remain
native vec4 inputs. The masks derive from original format and nonzero bound
stride, and participate in retained plan, translation and native program identity.
Old stage/pair/typed entry points select no packed conversion. Production source
contains no post-translation packed shader rewrite.

A zero wire stride is a constant attribute. The retained async read batch obtains
exactly four original GPU bytes, and one bounded expansion supplies
`vertexAttrib4fv`. Signed fields use their own width, including two-bit alpha;
SNORM clamps the most negative value to -1. Supplied generic words are binary32
values and bypass the array helper. Ordinary arrays have no CPU per-vertex
conversion, expanded vertex buffer or shader evaluation.

`floatingVertexFormat` and historical factories remain unchanged. The standard
lookup owns a separate immutable packed table. BGR/swizzled, pure integer packed
inputs and packed texture storage remain separate boundaries.

`make verify-E6-T11d15` binds original header pins, native/sanitized and fixed-memory
Wasm compiler calls, original wire/extents, source/served/compiler/blob identities,
full LLVM/V8 coverage and actual headed hardware draws. Independent literal
uploads/TGSI reconstruct whole original GPU storage, exact pointers/generic words
and complete pixels. It exercises array/constant transitions, normalization and
cache eviction, high attribute15, shared/overlapping storage, mixed read batches,
delayed schedules, index/divisor/budget ends, lifetimes and native state restoration.
Three runtime/GPU faults finish actual draws/fences before failing original pixels.
All genuine packed and retained typed allocation sites fail and recover. The full
standard compiler gate, exact-head pristine clone and fresh critic remain required.

These checks prove an isolated fetch prerequisite. Production API/caps, actual
guest execution and live deployment are proven by the later bring-up task.
