# Original floating image storage

`createStandardFloatColorResourceStore` and
`createStandardFloatColorTransferBackend` explicitly select the eight original
F16/F32 R, RG, RGB and RGBA 2D formats. Historical factories keep their existing
admission. This is an isolated storage boundary; the production guest device and
draw consumer are not enabled by it.

The pinned Mesa format table and VirGL public enum header define original lane
order, missing components and scalar representation. Native storage uses R/RG/
RGBA16F or R/RG/RGBA32F. RGB expands backwards into RGBA in the same charged
scratch buffer, with alpha one. Native range copies use framebuffer blits, with
retained source generations and completion ownership. Refresh reads the actual
GPU image; it does not reconstruct an image from guest backing.

`EXT_color_buffer_float` is required before native allocations. Transfers read
actual RGBA/FLOAT planes, charging sixteen bytes per pixel for both scratch and
PBO storage. Binary16 output rounds nearest-even from native binary32 words;
binary32 output preserves the native words. Logical guest bytes, padded native
allocations, expanded uploads and private mip copies are charged separately.
The owner enforces its existing limits and native maximum texture dimension.

Ordinary finite values are predicted independently from original input words.
OpenGL ES permits denormal flushing and signed-zero changes. Nonfinite command
inputs have unspecified values: their recordings prove custody, bounded work
and cleanup without promising NaN payloads or source/readback equivalence.
No CPU image shadow, CPU shader or software GPU fallback exists here.

`make verify-E6-T11d25` records all formats, complete and truncated NPOT mips,
segmented padded backing, public synchronous and fenced transfers, private
ranges, native refresh, old generations, cancellation and disposal. Three varied
schedules exercise bounded native failures. Real wrong upload lanes, storage
precision and copy levels must complete physical fences and fail the unchanged
independent original-value oracle. A separate Python rounding oracle covers all
65,536 binary16 inputs and 190,474 binary32 midpoint/edge patterns.

The recordings retain complete original bytes, native planes, call/type and
allocation observations, full V8 regions and immutable served source hashes.
The final exact-head pristine clone and hot recording are sealed for a fresh
critic. Existing byte-color, uniform-buffer, async job and texture consumer
native gates check the shared resource code. The small HTTP closure changes add
the required module dependency to historical browser snapshots; their inverse
is authenticated with the runtime boundary.
