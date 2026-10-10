# Compact floating vertex fetch

The selected standard async renderer admits original VirGL R/RG/RGB/RGBA16_FLOAT
(91–94), 8_UNORM (64–67), 8_SNORM (74–77), 16_UNORM (48–51) and 16_SNORM
(56–59), alongside existing float32 formats (28–31). One immutable descriptor
pins component count, scalar alignment, element bytes, native type and
normalization. The historical factory retains its original float32 admission.

Arrays bind original GPU buffers through `vertexAttribPointer`. Native hardware
performs format conversion and missing-lane expansion. Bounds use actual compact
byte widths and actual indices/divisors. Effective buffer plus element offsets
and strides must align to the scalar width; the separate offset fields need not
be individually aligned. WebGL's 255-byte stride limit remains in force.

Stride-zero inputs retain the existing asynchronous GPU read batches, sized to
the declared compact bytes. Only collected scalar values are unpacked into native
generic binary32 attributes. Half normals, subnormals, signed zero and infinities
are preserved. Signed normalization clamps the minimum to -1; unsigned values map
to [0,1]. Original float32 word custody and (0,0,0,1) missing lanes remain intact.
NaNs are category-only evidence; their native payload bits have no portable
certificate. Original shader bodies always execute on the GPU.

`make verify-E6-T11d12` records 301 literal wire cases, pinned native/sanitized enum
checks, the actual unchanged fixed-memory compiler and 225 headed hardware
frames. Its independent oracle reconstructs original wire/uploads, all source
lanes, native pointer types, exact generic words, full GPU storage and 60,160
pixels. Delayed schedules, shared/overlapping compact buffers, source revisions,
name reuse, cancellation, disposal and A/B/A state restoration are covered.
Actual served normalization and scalar-unpack faults must complete draw/fence
work and fail original physical pixels. Point/list/default-restart bindings and
unchanged compiler/allocator seals are retained.

Normalized32, scaled, packed/swizzled and pure integer vertex formats remain
separate boundaries. This isolated factory has no production-demo import or
positive capset, complete API, actual guest offload, deployment or throughput
authority. Format conversion follows the [GLES3 vertex attribute rules](https://registry.khronos.org/OpenGL/specs/es/3.0/es_spec_3.0.pdf)
and [WebGL2 restrictions](https://registry.khronos.org/webgl/specs/latest/2.0/).
