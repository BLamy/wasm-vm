# Original R11G11B10 image consumer

{% hint style="info" %}
Technical reference. Read the stated acceptance boundary and source context before treating a described milestone as current verification.
{% endhint %}

`decodeStandardPackedFloatImageSubmission` and
`createVirglStandardPackedFloatImageAsyncRenderer` select original VirGL format124
2D sampler views and framebuffer surfaces. The independently verified packed owner
keeps public little-endian R11G11B10 words and actual native R11F_G11F_B10F storage.
Historical decoder and renderer factories keep their prior admissions.

`make verify-E6-T11d28` records complete original packets, original TGSI programs,
source words, native retained mip planes, source/target generations, original public
transfers, generated bridge hashes and consumed physical completion fences. An
independent Python inverse reads the original programs and words to reconstruct
both shader stages, local queries, nearest/linear/mip filters and swizzles. Native
output tests cover negative-to-zero conversion, implicit alpha1, clear, color masks
and addition using exactly representable values. The original [.1,.1,.1,1] clear
predeclares [.099609375,.099609375,.099609375,1], shared by the specification's allowed
nearest and toward-zero conversions. No arbitrary packed rounding claim is made.
Wrong native filtering and a physically substituted RGBA32F output must complete
actual fences and fail that unchanged original inverse.

Three deterministic schedules exercise two retained contexts, unequal old/new ID
reuse, terminal cleanup, cancellation/disposal and GPU-only source refresh with
unchanged backing. Complete nested V8 records remain the coverage authority;
added-line samples are navigation aids. The submission also authenticates carried
verified packed storage and floating consumer evidence, and runs one pristine
scrubbed frozen-head clone before a separate adversarial verifier.

This isolated profile does not advertise a production guest capability or execute
Mesa/compositor work. RGB9E5, packed vertex inputs, integer/depth/array/MRT features,
complete guest API/capsets and production GPU workers remain separate boundaries.

## Related field guide

{% content-ref url="./docs.html?page=graphics" %}
Guest graphics: the admitted boundary
{% endcontent-ref %}
