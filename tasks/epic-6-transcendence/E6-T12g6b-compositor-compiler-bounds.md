---
id: E6-T12g6b
epic: 6
title: Bound compiler arenas for the larger captured compositor bodies
priority: 525.02701056
status: implemented
depends_on: [E6-T12g6a]
estimate: S
risk: high
capstone: false
---

## Boundary

Raise one consistent checked shader resource envelope, without new opcode or
raster semantics. Literal G1 bodies 92cb866a/c5806d5f require 39,261/14,786
source bytes, 716/295 instruction lines, TEMP indices438/218, IMM index28,
and nested conditional depths14/3. Existing defaults (16KiB,179 instructions,
TEMP117,IMM7,depth8) cannot represent those original bodies.

Bound source text at49,152 bytes, 768 non-END instructions, TEMP0..511, IMM0..31 and
16 conditional levels. Keep IN/OUT/SAMP/SVIEW0..7 and CONST0..45 unchanged;
Bound nonblank lines at1,536 and keep the512-byte individual-line ceiling.
do not conflate the immediate bank with interface register capacity. Keep the existing8,192-token ceiling (both literal bodies need at most2,663
encoded tokens). Expose the separate immediate and conditional-depth limits.
Set a measured bounded GLSL/JSON output envelope adequate for the worst emitted
admitted witness (at most262,144 GLSL bytes) and keep truncation fail-closed.
Extend shared declaration/fact/flow/certificate arenas and JS/native/wasm/wire
limits together; document exact worst allocation sizes and integer/index widths, flow/raster heap and conversion-pair stack bounds.
The existing wasm memory16MiB/stack256KiB stay fixed unless measured bounds
prove a required change; never hide an abort or allocation failure by growing
unbounded memory.

The larger originals still reject for unsupported grammar/domain semantics.
Admission and original execution require separately verified later boundaries.
Update limit-dependent historical rejection fixtures deliberately; retain their
prior archived evidence and all unchanged numerical bodies/metadata. Do not
change production negotiation, output semantics, live imports or caps.

## Deterministic acceptance

`make verify-E6-T12g6b` builds guard checks, sanitizer native cases and wasm,
then verifies exact-limit/one-past text, instruction, TEMP, IMM and flow-depth
witnesses through both checked compiler and wire decoder. On actual WebGL2,
execute positive witnesses that simultaneously use highest temporary/immediate
indices, long bounded straight-line code and depth16 with independent raw
word/pixel oracles. Exercise true/false predecessors, target bounds and terminal
padding. Preserve late-register initialization, file-specific interface bounds,
indirect candidate and demand/radial/loop certificate constraints, malformed
labels/indices/branches and text/token/GLSL/JSON truncation errors.

Bind every extended arena/allocation/loop to deterministic coverage, inject
allocation failure before each new sized arena and physical source faults for
high-register addressing and flow joins. Record measured source/token/output,
allocation/stack sizes and actual GPU reflection/disposal, zero errors, varied
seeds, old body/profile regressions and the four G6a originals. Run the risk-tier
submission once at frozen head and one pristine clone; submit to a fresh critic.

## Adversarial verification

Predict exact ceilings and worst byte counts before inspecting. Attack highest
indices, one-past and wrong files, wrapped/canonical spellings, branch labels,
initialization at every join, flow-depth overflow, old indirect candidate sets,
short allocations and output serialization envelopes. A bigger configured
constant alone is insufficient: new addressed rows and deepest flow frames
must execute. Neither original unsupported body may be replaced or advertised.

## Verification log

### 2026-10-04 — worker — activated compiler resource envelope

The human graphics continuation authorizes this ordered compiler boundary after
G6a was independently verified at `60aebb0e1a4639ff4d9468067879e9789e6a5a23`. Fourteen S-sized
compiler/execution tasks now make the two larger complete original programs
explicit dependencies of parent G6. This task changes only consistent checked
capacity and owned allocation/output bounds. Missing shader operations remain
rejected; negotiation, caps, live imports and deployment stay gated.

The resource limits are combined admission ceilings, not a promise that every
maximum-length opcode combination fits the GLSL output ceiling. Oversize emitted
source or JSON must reject without partial publication. Preserve byte-identical
old emitted shader bodies when their existing register extent suffices, and
retain literal historical fixture inputs when an old boundary moves.

### 2026-10-04 — worker — bounded compiler envelope implemented

Frozen runtime/harness source: `07f47569525dfa898dadd6f95dfa0a7a4a8718e4`;
verified parent: `60aebb0e1a4639ff4d9468067879e9789e6a5a23`. Exact commands:

```sh
make verify-E6-T12g6b
python3 tools/virgl-compiler-bounds/cold.py --output target/evidence/virgl-compiler-bounds-cold
python3 tools/virgl-compiler-bounds/seal.py --hot target/evidence/virgl-compiler-bounds --cold target/evidence/virgl-compiler-bounds-cold --output evidence/virgl-compiler-bounds/worker
```

The scoped high-risk submission rebuilt owned strict-warning guard checks,
ASan/UBSan/LLVM native coverage, the native converter, pinned Emscripten4.0.22
Wasm and native/optimized-Wasm stack tables. Native and public Wasm agree on603
literal cases and23 pairs;752 owned allocation failures reject and recover.
Three schedules each exercise highest TEMP511/IMM31,768 non-END operations,
depth16 in both validation and raster graphs, both branch predecessors and
highest CONST45. Wire text/token and terminal-padding checks remain bounded.
The delivered module remains16MiB with256KiB stack; actual exhaustion rejects
and recovers. Native measured IR/flow/raster allocations are111744/433092/207884
bytes; pair conversion records total67168 bytes. Worst six-byte escaped GLSL
strings take1572866 bytes singly and3145732 bytes as a pair, inside1589248/3179520
static JSON capacities. All owned optimized Wasm stack frames sum235392 bytes;
this conservative nonrecursive-owned-code table excludes upstream/libc frames.
The actual fixed-stack public Wasm pair, stress and recovery calls all passed.

Physical headful Chrome used Apple M4 Max through ANGLE Metal, with10368 exact
transform-feedback words and82944 independently predicted framebuffer pixels
across three seeds. Actual object deletion and zero WebGL/console/page/request
errors are recorded. Three emitted numerical faults failed at precise points:
`fault-high-register/report.json`, high-vertex/bounded-1/lane4, expected1025507328,
observed1032847360; `fault-branch-join/report.json`, deep-vertex/bounded-0/lane4,
expected1062600704, observed1041235968; `fault-counter/report.json`,
combined-vertex/bounded-0/lane4, the same expected/observed words. Their mutated
source and physical bytes are captured. No simulated GPU is accepted.

All25 complete literal original bodies retain23 admissions; their emitted GLSL
and metadata are byte-identical to the authenticated prior compiler. The39261-byte
92cb866a original now fits the input envelope and rejects unsupported grammar;
c5806d5f also remains rejected. The literal historical TEMP0..118 declaration
is the sole new admission among112 retained grammar fixtures, explicitly
recorded without replacing its input. F6 native2046calls/public Wasm2198calls,
88 original pair decisions and57 physical compatible programs passed; hardware
checked1536 words/155648 pixels. G6a's four newly supported originals passed
864 words/9216 pixels, including the fresh critic's exact-alpha guard. Existing
consumer-domain and instruction-capacity regressions passed.

The same acceptance passed once at the frozen source in a pristine clone with
build-related environment scrubbed and an empty checkout status before/after.
Both receipts bind1514 source/generated entries; LLVM/V8 coverage and physical
screenshots are sealed. Historical leaf runtime, deployment, guest negotiation,
live imports and capability claims remain outside this isolated change. No
performance or original larger-compositor execution claim is made.

Worker evidence: `evidence/virgl-compiler-bounds/worker/{manifest.json,records.json,recording.tar.gz}`
contains104 members; archive SHA256`2e9a57b80f05914377f852f17c3aaf597112f269d2ea67244b1a510944601756`,
index SHA256`77214cdb6c845547d9985015bee862323a06cc8f401380d64340b9c21c06fcf7`.
Hot receipt`06095e23f4688683932916a4968717ce391175faa8d233628b19fc32067a5c9e`;
cold report`ab084416411bab8c517943d55d52aa901333e59a2ad659ad581276cc16cdffb9`;
cold receipt`9880378ec6192667f9377e43643bcf174b52a2fbe32fd41c00695e3e298b8a9a`.
The worker submits the diff and recordings to a fresh critic; this is an
implementation claim awaiting independent verification.
