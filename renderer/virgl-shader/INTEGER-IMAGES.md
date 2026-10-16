The explicit `createVirglStandardIntegerImageShaderBridge` facet accepts homogeneous
FLOAT, SINT and UINT 2D sampler-view declarations. One through four original return
fields may spell the same type. Bounded SVIEW ranges are supported; sampler registers
keep individual declarations, matching the pinned converter's original mask export.
Existing standard, uniform and FLOAT texture factories keep their original grammar
and complete responses.

`translateImages` takes own stage, text, signedColorMask and unsignedColorMask data
fields. `translatePairImages` composes those host color-format masks with the five
existing vertex/uniform selectors. Color masks are disjoint four-bit sets of emitted
COLOR semantic locations, including COLOR0 broadcast. A vertex stage cannot select
color formats. The host supplies these masks from attachment formats; guest text
cannot supply keys or select the facet.

Integer samplers produce native integer vectors, which enter raw uvec4 storage
through bit-preserving constructors. Signed color outputs use ivec4, unsigned use
uvec4, and FLOAT outputs retain uintBitsToFloat. Broadcast converts the original raw
COLOR0 register separately for each attachment type. TGSI SAT retains the original
float clamp of destination words; it does not impose a numeric integer clamp.

This is isolated compiler qualification. It adds no integer command consumer,
resource authority, production capset, guest rendering, deployed demo capability
or throughput claim. Fixed16MiB memory,262144-byte stack and all existing text,
token, IO, slot and constant limits remain in force.
