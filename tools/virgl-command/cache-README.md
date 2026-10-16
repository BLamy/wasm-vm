# Renderer cache evidence

Run `make verify-E6-T12i` from a frozen source head. The gate rebuilds the pinned
shader Wasm and reruns affected H/G5/format/view/flat/job paths, including the
promoted H complete-RGB-fetch and independently scheduled job regression.
Hardware Chrome uses the actual M4 Max GPU; software renderer flags and browser
errors fail. Cache/source mutations affect only owned served copies.

The normal and all-hashes-collide runs each record all 10,000 ordered 16x16 native
RGBA frames to `toggles.rgba`. The receipt checks every byte against independent
literal off/on blend predictions, rather than trusting browser assertions or an
inverse resource conversion. It also authenticates native draw observations,
pressure/accounting, context and selector generation isolation, actual ESSL
captures, truncation counters, final GPU fence retirement, screenshots and V8
source coverage. Removing blend state or shader text from a key must fail the
precisely named physical pixel oracle. An intentional hash collision must pass.

`python3 tools/virgl-command/cache-cold.py --output DIR` runs the same acceptance
once in a pristine exact-head clone, with Rust/Cargo/compiler/Node/npm/renderer
environment overrides scrubbed and independent setup. Then
`python3 tools/virgl-command/cache-seal.py HOT COLD evidence/virgl-render-cache/worker`
seals all source-bound hot/cold records and generated shader binaries for a fresh
adversarial verifier. Source/runtime changes require a new frozen head and its
selected gates; evidence-only changes rerun the affected harness.

Authority is isolated bounded renderer reuse. This is not a live guest frame,
capset qualification, production cache hit-rate, FPS or MIPS proof. Cache lookup
denominators are explicitly defined in
[cache-README.md](../../renderer/virgl-command/cache-README.md).
