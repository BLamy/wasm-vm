# Original floating image consumer

`decodeStandardFloatImageSubmission` and
`createVirglStandardFloatImageAsyncRenderer` select original F16/F32 R, RG,
RGB and RGBA 2D image sampling and framebuffer outputs. Their profiles are
`virgl-standard-float-image-commands-v1` and
`virgl-standard-float-image-async-jobs-v1`.

Use the D25 floating resource store and transfer backend. The consumer requires
actual `EXT_color_buffer_float`, `EXT_float_blend` and
`OES_texture_float_linear` support before allocating native consumer objects.
The existing fixed-memory original texture shader compiler supplies shader
bodies; there is no shader interpreter or CPU image storage mirror.

Views keep the exact resource generation and selected mip range. Original
TEX/TXL/TXF/TXD/TXB/TXQ operations and swizzles use retained native planes and
native samplers; queries report local dimensions and accessible level count.
Surface writes use original selected mip levels. Missing color components retain
zero and implicit alpha retains one, including RGB storage expanded to native
RGBA. Floating clears use `clearBufferfv`. Clears, masks and blending preserve
finite negative and greater-than-one values.

Historical factories and decoder selections keep their earlier admission. No
production capset, integer/packed/depth/array/MRT extension, worker deployment or
actual guest acceleration is established by this isolated selection.

`make verify-E6-T11d26` records whole original TGSI programs and packets through
the real C/Wasm bridge and headed Metal WebGL2. The independent Python inverse
reconstructs full native and public planes from original inputs, mip ranges,
filters and output state. Half-output fixtures use exactly representable values;
32-bit output fixtures preserve values that would expose accidental half
storage. The output budget is `2e-6 * max(1, abs(expected))`. Wrong native
precision, filtering and alpha writes must finish a physical fence and fail this
unchanged inverse. Original input bytes, complete V8 regions, physical native
objects, consumed fences, padding, hot/cold source closures and final seals remain
available to a fresh adversarial verifier.
