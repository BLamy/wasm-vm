# Standard pure integer vertex inputs

The standard async renderer admits the original R/RG/RGB/RGBA 8/16/32 UINT
and SINT formats177..200. Arrays retain original GPU bytes and use
`vertexAttribIPointer`. Stride-zero inputs collect only the bounded declared
bytes through retained asynchronous reads, sign/zero-expand the scalar width,
and use native integer generic setters. Missing components are (0,0,0,1).

Owned bound elements determine disjoint signed/unsigned masks. The actual pinned
C compiler receives those masks through a separate typed pair entry point,
restricts them to declared attributes, and emits matching `ivec4`/`uvec4`
declarations and raw register words. Reflection and retained draw validation
check the type identity; both translation and program caches include it. The
existing stage/pair entry points and floating lookup retain their zero-mask
behavior. Guest packets cannot choose compiler keys or supply masks.

`make verify-E6-T11d14` records the literal ABI, native/sanitized/Wasm compiler
agreement, allocation faults/recovery, strict API custody, and headed M4 GPU
draws. Original packets/uploads, full GPU storage, pointer/generic/reflection
state, compiled source, full pixels, LLVM and V8 coverage are authenticated.
Native signedness, generic-word and supplied ESSL faults must complete native
draws/fences and fail exact original pixels. The ESSL fault changes the supplied
shader after translation; it does not change the C compiler. The final cold clone
and sealed evidence are submitted to a separate critic.

This is one graphics prerequisite. Packed/swizzled inputs, texture/storage/API
coverage, truthful production caps and actual guest graphics remain gated.
