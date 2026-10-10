The host can explicitly create `createVirglStandardShaderBridge` from
`standard.mjs` for ordinary guest shaders. It exposes `translate({stage,text})`
and `translatePair({vertexText,fragmentText})` with owned primitive fields.
Its only Wasm exports are separate standard transactions; the existing bridge
entry points keep their exact admission and private certificate rules.

This is a bounded compiler for a closed TGSI subset, with ESSL 300 output.
It does not enable a virtio feature, capset or production renderer. Stage,
grammar, extents, source registers, output masks, properties, immediates,
structured flow and interfaces are checked before the pinned upstream text
parser. Explicit conditional labels must agree with the structured edges.
Zero loop labels retain the pinned dumper's unspecified-label convention.
Unknown or excessive inputs return an error with no partial stage or metadata.

Constant declarations may appear in any order. A standard-only stable token
permutation moves an isolated `CONST[0]` declaration before other constant
declarations because the pinned upstream converter otherwise increments an
already larger bank count. Every original token and instruction index remains
intact, and upstream metadata must still equal the independently checked maximum
extent. This does not admit duplicate declarations or direct reads of holes.

Uniforms, temporaries, immediate vectors, MOV/UCMP and flat varyings retain
32-bit words in `uvec4` storage. Storing integer masks in float temporaries
would allow a hardware compiler to canonicalize `0xffffffff` as a NaN, changing
later NOT/AND predicates. Floating operations decode their typed operands and
use ordinary native highp math. Scalar TGSI operations replicate the first
swizzled component, including masked destinations. Smooth varyings use floats.
Integer negate uses two's complement; absolute source modifiers require a
floating/untyped payload. Shift counts consume the low five bits.

The metadata states `native-gles3-highp-v1`, native undefined numerical domains,
word storage and scalar replication. `_PRECISE` does not grant an exact result:
ESSL 300 has no GPU-shader5 precise qualifier, as the metadata states. It
contains no constant-domain, exact-bank, old raw-word or private-source authority.
Uninitialized shader reads, invalid indirect addresses and exceptional floating
domains retain native shader behavior. A finite compilation depth/instruction
bound does not prove GPU loop termination.

The fixed module has 16 MiB of memory and a 256 KiB stack. Published limits are
49,152 text bytes, 8,192 tokens, 262,144 GLSL bytes, 768 instructions, 512 temps,
512 constant vectors, 32 immediates, 32 IO registers, 16 attributes/GENERICs/
samplers, four color outputs and 32 flow levels. Output expansion can hit its
bound before the instruction bound. Allocation failure rejects the transaction
and the same instance must recover after memory is released.

`make verify-E6-T11d4` records independent pinned TGSI metadata, native/sanitized/
Wasm agreement, real allocation and input-custody attacks, hardware compiles,
full original compositor draws, independent pixel bytes, an actual SIN-to-COS
mutation, coverage and affected exact-facet regressions. A fresh verifier judges
the frozen submission. Full GLES API/device integration is separate work.
