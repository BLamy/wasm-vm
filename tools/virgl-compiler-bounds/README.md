`make verify-E6-T12g6b` is the single acceptance command for the checked compiler
resource envelope. It builds owned guard checks, ASan/UBSan, native and pinned
Emscripten 4.0.22 targets. The delivered Wasm memory/stack remain fixed. Compiler
stack tables measure owned optimized frames separately from native sanitizer
frames; neither substitutes for the actual public Wasm pair/recovery calls.

`cases.mjs` creates literal limit and one-past witnesses independently of the
compiler. `native.mjs` records all public results, each owned allocation failure,
recovery, private writer capacity probes and LLVM coverage. `wasm.mjs` checks
complete public results against native, wire text/token/terminal-padding bounds,
and fixed-memory failure/recovery. `retained.mjs` authenticates the prior sealed
native binary and preserves the complete original bodies, emitted GLSL and
metadata, with only the explicit capacity migration.

The physical browser test predicts raw words from independent dyadic input
vectors, sign-bit selection, literal immediate values and separately uploaded
constant values. It executes both predecessors and observes all vertex words
and framebuffer pixels. GLSL mutations target high-register addressing, the
deepest branch join and the visible long-chain counter. All must fail the
independent oracle. Actual reflection, source, readback, deletion and screenshots
are recorded. The unchanged original F6 and G6a GPU paths remain regression
checks. No guest graphics negotiation or performance claim is made here.

After freezing all sources, `cold.py --output <directory>` performs the same
acceptance once in a pristine clone with build-related environment scrubbed.
`seal.py --hot <hot> --cold <cold> --output <seal>` authenticates every receipt
member and writes a deterministic archive and digest index for a fresh critic.
Generated binaries are bound separately from source files at the frozen commit.
