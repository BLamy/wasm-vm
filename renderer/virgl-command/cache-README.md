# Bounded renderer reuse

The three renderer factories share context-owned translation, native program and
pure render-state caches. `cacheLimits` may only tighten `CACHE_LIMITS`; the
existing `limits.programs`, `shaderBytes` and `uniformBytes` also bound native
programs, variants and system buffers. None of these caches enables the guest
device or advertises capabilities. The host shader bridge remains fixed,
synchronous and non-reentrant for one renderer lifetime.

`cache.mjs` uses FNV32 buckets and a global LRU for each cache. A lookup must match
both the exact private subcontext owner and the entire canonical key string.
Unequal strings and equal strings from another owner cannot alias even when all
hashes collide. Generations increase monotonically within a renderer; public
context/resource/object numbers do not identify cached allocations.

Translation keys contain subcontext generation, stage and complete original TGSI
text. Pair keys contain both complete bodies and the derived semantic interface.
Only owned frozen bridge results are retained. The consuming link rechecks pair
output against its exact selectors and interface. Recreating an identical stage
can reuse its translation; the new selector still compiles and owns a separate
native shader. Contexts and subcontexts never borrow another owner's translation.

Program keys contain owner generation, both immutable selector generations,
the interface derived from that actual VS/FS pair, and every used view's slot,
name, format, target, level/layer, origin and swizzle. Selector generations bind
the exact owned TGSI, emitted ESSL and checked metadata, rather than a digest or
public handle. A fragment cannot reuse an interface checked against a different
vertex. Native program generations change after eviction/relinking. Variants
and every 656-byte system buffer are deleted on eviction; live selector/binding
references survive and recreate the program when next selected. Quota pressure
evicts least-recent programs before allocating replacement variants/buffers. A
single entry that cannot fit rejects without publishing a native program.

Render-state keys include the program's native generation/key, draw/restoration
phase, complete vertex elements and vertex/index buffer descriptors/generations,
color/depth metadata and resource generations, all view and sampler descriptors,
both raw constant banks, blend/raster/depth/stencil state, viewport including Y
sign, scissor, blend color and framebuffer defaults. These cache frozen state
plans only. Native attachments and storage leases resolve live; constants retain
their ordinary numeric checks and upload from the current owned bank. Every
supported GL binding and state is restored on every use. A hit does not authorize
skipping validation or inherit GL state from the host. Dynamic target formats,
vertex layouts and render state affect this state key; they do not alter ESSL
and therefore do not force a different shader program by themselves. Texture and
buffer *contents* are live storage, never cached output or authority to draw.
Unsupported inert reset packets remain declarative bookkeeping.

Residency charges are bounded owned payload estimates, not measurements of a JS
engine heap or opaque driver memory. UTF16 strings charge two bytes per code
unit. Translation charges are `1024 + 2*(key + JSON(result))`; program charges
are `1024 + 2*(key + JSON(reflection) + variant ESSL)`; state charges are
`512 + 2*(key + JSON(plan))`. Terms are string lengths. Fixed allowances cover
entry/index bookkeeping; entry counts also bound metadata/index cardinality.
Base selector text/ESSL and native variants retain the existing `shaderBytes`
profile charge; system buffers retain their actual `uniformBytes` charge.
Native program/shader/buffer counts bound allocations independently of payload
estimates. Driver/compiler overhead is not exposed as measured GPU bytes.
Oversized or zero-capacity translation/state entries bypass with a counter;
programs require admission. Failed native publication rolls back its variants,
program and system buffers. A successful checked translation may remain in its bounded CPU cache after a native compile/link failure. Deleting a selector's final reference removes its
programs; context/subcontext destruction removes every owned cache entry.
`resetCaches()` requires no active job, releases every cache and frame dump, and
preserves logical bindings for subsequent recreation. `dispose()` clears all
owners and dump payloads. Cache counters retain their lifetime history.

`inspect().caches.{translation,program,state}` exposes requests, hits, misses,
comparisons, hash collisions, insertions, capacity evictions, explicit removals,
bypasses and current entry/byte residency. A request is one cache lookup;
`requests = hits + misses`. Translation requests include valid stage creation and
checked pair requests on link misses. Program requests include explicit LINK,
binding/state restoration and draw planning; state requests include every full
restoration, including CLEAR/binding updates. These are not draw-only or
frame-only hit-rate denominators. `inspect().work` counts actual bridge
translation/pair invocations, native compile/link invocations, submission attempts,
successful decodes, completed/failed submissions, applied commands, returned GL
draw calls and successful draws. Decode errors, semantic prefix failures,
cancelled jobs and disposal of unfinished jobs remain visible. Live kmscube's
post-frame 10 hit-rate acceptance belongs to E6-T12k.

The trusted host can bracket a capture with `beginFrame(n)` / `endFrame(n)` using
strictly increasing safe integer labels. This labels a host frame; it does not
infer a guest frame from a submission or claim presentation. Start/end work/cache
counters, owned original raw submission hex, explicit success/failure outcomes,
actual linked TGSI/ESSL300, reflection, draw summaries, complete bindings, constant
uploads and program/state keys are recorded. The returned frozen dump is also
available from `frameDump()`. Native shaders/leases are not retained by a dump.
No active asynchronous job can be reset, destroyed or ended by those APIs.

Only one active/last dump is retained, capped by `debugBytes`. Captures reserve 8192
bytes for metadata and charge each record's serialized UTF16 payload plus 256.
Overflow sets `complete:false` and increments typed dropped-record counters;
actual draw/submission counters continue counting all work. Disabled capture
rejects explicitly. The final dump's serialized charge is checked and exposed in
`budgets.debugBytes`. A new capture/reset/dispose releases the previous payload;
caller-retained returned data is the caller's own lifetime.

`make verify-E6-T12i` checks every raw 16x16 frame of 10,000 blend toggles through
actual WebGL2 draws, retains the entire 10,240,000-byte physical RGBA recording,
forces eviction and bound-program recreation, checks changed sources/formats/
layouts, poisoning, stale contexts, name reuse, repeated destruction, typed
capture overflow and owned delayed jobs. It matches counters to independent
bridge/GL wrappers and frame ESSL to actual attached shader sources. A served
blend-key omission and stage-text omission must fail literal pixel predictions;
forcing every hash to zero must still pass all physical results. The final gate
includes affected predecessor proofs and a pristine exact-head clone. It does
not claim production guest rendering, FPS, MIPS or live cache hit rates.
