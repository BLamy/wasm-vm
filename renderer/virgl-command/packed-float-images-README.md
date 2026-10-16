# Original R11G11B10 image storage

`createStandardPackedFloatColorResourceStore` and
`createStandardPackedFloatColorTransferBackend` select original VirGL format124.
The other factories preserve their earlier admission rules. The new decoder and
render consumer are separate work.

One original pixel is four bytes: unsigned 11-bit red, 11-bit green and 10-bit
blue floating fields. Native storage is `R11F_G11F_B10F`; uploads carry the original
packed words as `UNSIGNED_INT_10F_11F_11F_REV`. Logical and native allocation
charges are both four bytes per pixel across every retained mip. Native reads
use RGBA/FLOAT, charging sixteen bytes per pixel for scratch and staged PBOs.
The actual native floats are repacked in that same scratch reservation; there
is no persistent CPU image or extra GPU shadow.

For finite values, the storage proof predicts channels directly from the
original bit fields. ES permits denormal flushing. Nonfinite uploads get safety
and original/native custody records without portable NaN payload assertions.
The public inverse uses nearest-even finite quantization, saturates finite
positive overflow, clamps negative values to zero, preserves positive infinity,
and canonicalizes NaNs. This contract does not qualify arbitrary native render
rounding.

`make verify-E6-T11d27` records complete original full/truncated NPOT mips,
nonzero boxes and untouched neighbors, native private range copies, synchronous
and staged reads, odd strides/SG backing, delayed generation reuse, GPU-only
mutation, cancellation/disposal and native failures. All three schedule seeds
retain physical fences, full native words, public backing/padding and nested V8
coverage. Actual lane and copy-level sabotage must fail the same original-input
inverse after a consumed native fence. Independent Python reconstructs every
finite pixel and public packed inverse from the records. One pristine scrubbed
clone and sealed hot/cold archive go to a fresh critic.

Only this selected storage/transfer boundary is qualified here. Original
sampler/surface consumption, RGB9E5, guest API/capset advertisement, production
GPU workers/scanout and production graphics remain gated.
