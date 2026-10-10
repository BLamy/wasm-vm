# Scalar floating vertex fetch

The selected standard async renderer also admits original normalized32
R/RG/RGB/RGBA formats (UNORM 32–35, SNORM 40–43) and scaled integer storage
(USCALED32 36–39, SSCALED32 44–47, USCALED16 52–55, SSCALED16 60–63,
USCALED8 69–72, SSCALED8 82–85). These feed native floating shader inputs.
Scaled values become their binary32 integer value; normalized32 uses the full
original signed or unsigned range and clamps the signed minimum to -1.

Arrays use original GPU buffers and native `vertexAttribPointer` conversion.
The shared immutable descriptor controls type, normalization, alignment and
actual element bytes. Effective offset sums, legal overlapping strides, actual
indices and instance divisors retain the existing bounds and work ceilings.
Stride-zero inputs retain only their declared GPU bytes; after asynchronous
collection, signed/unsigned 8/16/32-bit scalars populate generic floating values.
Original shaders execute on the GPU, and missing lanes remain `(0,0,0,1)`.

`make verify-E6-T11d13` records 396 original scalar wire cases, 80 historical
wire cases, pinned native/sanitized enums and 391 headed hardware frames. An
independent byte/shader oracle reconstructs integer-to-binary32 rounding using
BigInt magnitude and ties-to-even, separate from runtime Float32 assignment.
Word-output shaders exercise signed minima/maxima, unsigned maxima and the
2^24 rounding boundary, as well as defaults and native normalization endpoints. Retained normalized32
generic words additionally test full-range interior rounding.
General native floating arithmetic retains its existing bounded pixel authority.

The proof also records original full GPU storage, physical pointers and generic
words, exact source/staging/work ends, shared/overlapping buffers, restart and
instanced draws, delayed revisions/cancellation/name reuse/disposal and A/B/A
restoration. Served signedness and scaled-value faults must finish actual draws
and fences before failing original pixels. The affected compact proof is rerun;
its old exclusions are explicitly updated for now-admitted scalar formats while
its prior recordings remain sealed historical evidence. Unchanged compiler,
allocator and point/list/restart evidence is carried incrementally.

Pure integer shader inputs, packed/swizzled formats, complete API qualification,
production negotiation, guest Mesa rendering, scanout and throughput remain
separate boundaries. See [compact floating formats](compact-vertex-README.md)
for the earlier half/normalized8/16 and float32 boundary.
