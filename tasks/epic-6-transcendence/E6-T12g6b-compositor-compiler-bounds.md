---
id: E6-T12g6b
epic: 6
title: Bound compiler arenas for the larger captured compositor bodies
priority: 525.02701056
status: in-progress
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

Bound source text at49,152 bytes, 768 numbered instructions including END, TEMP0..511, IMM0..31 and
16 conditional levels. Keep IN/OUT/SAMP/SVIEW0..7 and CONST0..45 unchanged;
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

