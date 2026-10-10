# Standard shader bindings

`createVirglStandardAsyncRenderer` is an explicit host-selected consumer of
`createVirglStandardShaderBridge`. It shares owned resources, generation-keyed
caches and queued GPU jobs with the existing renderer. Neither guest packets,
provenance labels nor caller options can change a factory's facet.

`decodeStandardSubmission` admits VS/FS slot-zero banks of at most 2,048 raw
words. It owns the original byte snapshot and never interprets raw constants as
finite floats. Standard draws upload every active reflected word through
`uniform4uiv`, zeroing absent words on short, empty or unbound banks. The old
decoder retains its finite predicate and existing stage limits.

The standard consumer copies descriptor-only metadata before freezing it. It
checks physical IO 0..31, GENERIC 0..15, attributes 0..15, the two VS built-in
IDs, raw constant arrays up to 512 vectors, and 16 checked 2D samplers in each
stage. It derives the interstage interface from declarations and checks the
pair compiler's complete owned response. Flat varyings retain `uvec4` words;
smooth varyings and arithmetic use native highp shader semantics. There is no
exact numerical certificate or GPU loop termination guarantee.

Both-stage texture view variants participate in keys and byte accounting.
Reflection may remove unused raw uniforms or native samplers. Logical sampler
bindings and framebuffer feedback checks still apply. Native built-in IDs may
appear as active attributes: only checked integer system values with location
`-1` bypass buffer binding. The declared 656-byte coordinate system block must
match native reflection. Execution remains single-target COLOR0; MRT and color
broadcast fail explicitly.

After linking, the standard facet accounts for every active native uniform.
Default-block entries must match checked raw constants, stage samplers or the
renderer's inserted blend uniform. System-block entries must belong to the
already validated native block. Coherent stage/pair metadata cannot omit an
active binding; legitimately eliminated native declarations remain admissible.

Floating vertex inputs include [native compact formats](compact-vertex-README.md)
with actual byte-width bounds and retained stride-zero scalar reads. Arrays
continue to use original GPU buffers and native conversion. The later [scalar formats](scalar-vertex-README.md) add
normalized32 and scaled integer storage with native floating inputs.

`make verify-E6-T11d5` records literal wire/metadata predictions, hardware queued
draws, actual uniforms/reflection/buffer bytes, later-task zero-timeout fences,
owned input/output exchanges and independent full-pixel predictions. It covers
short banks, A/B/A restoration, cache pressure/relinking, retained selectors,
both-stage slot15 images and view variants, native coordinates/discard/IDs,
complete captured 92cb/c580 sources with authenticated original banks, structured
errors, cancellation and cleanup. A served upload mutation must fail the
short-bank pixel oracle. A separate served mutation disables native binding
accounting and must fail the coherent omission oracle after a real native draw.
The offline audit reconstructs shader/constant/view
state from literal command bytes and checks the saved physical pixels.

This factory is an isolated production prerequisite. It does not negotiate
guest capabilities or enter the demo's production device path. Full API,
actual guest Mesa initialization, scanout and performance need their own proof.

[Pure integer inputs](integer-vertex-README.md) use host-derived typed compiler
variants and native integer arrays/generic words in the standard async factory.
