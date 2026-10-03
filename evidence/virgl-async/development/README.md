# Development diagnosis only

These are the exact local raw-WebGL snippets and outputs used to isolate a staging
usage-hint issue during E6-T11b1 implementation on 2026-10-03. They do not load
product modules and are not the final worker acceptance evidence. The snippets
retain the local Playwright import and output paths used during the run.

Commands were `node /tmp/virgl-eab-staging-repro.mjs` and
`node /tmp/virgl-eab-staging-repeated-repro.mjs`. Chrome 154.0.8037.93 reported
no immediate GL error, then deferred INVALID_OPERATION for element-buffer staging
allocated with STREAM_READ. DYNAMIC_COPY and DYNAMIC_DRAW returned the same literal
indices without errors. A reordered repeat reproduced the distinction in all
four STREAM_READ trials and both trials of each alternative. Ordinary data-buffer
staging passed every tested usage hint. This is an observed compatibility issue,
not a claim about all browsers or drivers.

The implementation chooses DYNAMIC_COPY for actual buffer-copy staging while
retaining the same element-buffer class, GPU copy, fence, and post-signal readback.
Texture PBO staging retains STREAM_READ. No GL error is suppressed. Final proof
uses the source-bound asynchronous acceptance gate and separate review.
