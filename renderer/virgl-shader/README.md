# Bounded VirGL shader bridge

This isolated module reuses virglrenderer 1.3.0's TGSI text parser and GLSL
converter for the legacy finite-float profile, and owns a bounded IR/emitter for
the separate private raw-bit profile. It supplies a translation boundary to the proof-only browser
renderers. Production GPU negotiation remains disabled; this module does not
establish general Mesa or guest desktop compatibility.

## Build and reproduce

From the repository root:

```sh
bash renderer/virgl-shader/build.sh native
bash renderer/virgl-shader/build.sh sanitize
EMCC="$(bash tools/setup-virgl-emsdk.sh)" bash renderer/virgl-shader/build.sh wasm
make verify-E6-T10a
make verify-E6-T10d
make verify-E6-T12e1
make verify-E6-T12e2
make verify-E6-T12e3
make verify-E6-T12e4a
make verify-E6-T12e4b
make verify-E6-T12e4c1
make verify-E6-T12e4c2
make verify-E6-T12e6b
```

Native builds require Clang, a C11 standard library, and Python 3.9 or newer.
The sanitizer target runs AddressSanitizer and UndefinedBehaviorSanitizer with
immediate failure enabled, assertions enabled, all six literal shaders, explicit
hostile cases, every truncation of a valid input, and 4,096 deterministic
mutations followed by successful conversions. Native checks do not establish
WebGL compatibility; the headed hardware-browser gate compiles, links, binds,
draws, and checks exact interior pixels from the literal corpus in `tests/`.

The WebAssembly toolchain is Emscripten **4.0.22**, emsdk commit
`15915cad554b707837024dc2758b6a1c5b94b036`, release artifact
`bebaf7e50e31865b0724f17eaa52e161e2dfef5a`. `build.sh` checks the compiler version.
Use the setup script's returned wrapper so the compiler uses its bundled Python
rather than an incompatible system Python. The Wasm module has a fixed 16 MiB
memory and 256 KiB stack, with no memory growth or filesystem. Generated build
artifacts stay in ignored `build/`.

`verify-E6-T10d` additionally compiles and executes the two unchanged TGSI bodies
from the recorded guest textured scene. It checks three original indexed draws
against 768 literal interior pixels, compares native and Wasm translations, runs
the shared malformed-grammar cases under sanitizers and Wasm, and requires a
texture sabotage to fail its pixel oracle. `verify-E6-T12e1` additionally executes
four unchanged originals using declaration ranges and component writes: the two
texture/tint fragments `003270…` and `981906…`, affine vertex `403b05…`, and matrix
vertex `e9bc6d…`. `verify-E6-T12e2` additionally admits unchanged flat fragment
`67c701…` and pairs it with a translated vertex shader. Exactly twelve of the
nineteen original bodies translate; all seven PRECISE-bearing originals remain
rejected. These are
explicit workload bindings; they do not establish full workload compatibility.

The component sanitizer target is `build.sh component-sanitize`. Its runner is
`tools/virgl-components/native.py --binary
renderer/virgl-shader/build/component-sanitize/component-test --output DIR`.
The runner hashes the four original inputs and `tests/component-cases.json`,
records complete translations and boundary results, and runs every original byte
truncation plus 4,096 mutations with four-original recovery after each case.
Shared cases cover all 55 TEMP ranges, all 36 CONST ranges, and 64 combinations
of initialized, destination and selected source lanes. The historical 112-case
negative fixture retains its rejection contract: eleven newly valid inputs were
replaced with adjacent invalid range, unwritten-lane or incomplete-output inputs;
their admitted forms are tested positively in the component fixture. In v4, the
old CONSTANT rejection in each shared negative fixture is replaced with the
adjacent unsupported `CONSTANT, CENTROID` form. The valid flat forms are covered
by the pair fixture, preserving the historical negative-case counts.

The pair sanitizer target is `build.sh pair-sanitize`, followed by
`python3 tools/virgl-pairs/native.py --binary
renderer/virgl-shader/build/pair-sanitize/pair-test --output DIR/native`. It
hashes all nineteen originals and `tests/pair-cases.json`, checks complete
standalone/pair results and literal semantic expectations, then runs truncations,
invalid bytes and four deterministic mutation seeds. Four distinct pair outputs
and standalone smooth-VS/flat-FS outputs must recover exactly after every case.

The bank sanitizer target is `build.sh bank-sanitize`, followed by
`python3 tools/virgl-banks/native.py --binary
renderer/virgl-shader/build/bank-sanitize/bank-test --output DIR/native`.
It records all nineteen unchanged original results, every shared bank boundary,
and the exact four hardware pair inputs. Low/high single-stage and full-bank
pair translations recover after every rejection, truncation and mutation. The
shared cases actually write/read every new TEMP and read every new CONST index,
check independent small banks, and exercise 179/180 instructions plus unchanged
text and line bounds. Historical negative fixtures retain their counts: v5
replaces TEMP10/CONST8 neighbors with TEMP118/CONST46 neighbors; the newly valid
forms have positive bank cases. Seven PRECISE-bearing originals still reject;
some bodies now reach the integer-immediate or ADDR guard before their
decorated instruction. Well-formed UINT32 words excluded by the unchanged
float domain and recognized ADDR files return `unsupported-feature`; malformed
words, decimal overflow and unknown file spellings remain `parse-error`. All
seven original rejection codes remain `unsupported-feature`.

The larger profile tables add 6,804 bytes per stage (13,608 per pair) on the
fixed Wasm ABI; their bank checks precede every indexed access. Text, token,
line, GLSL, JSON, memory and stack capacities are unchanged. The sanitizer and
browser reports record observed generated/serialized maxima, without claiming
that the selected stress input mathematically maximizes every output.

Constant metadata stays faithful to upstream declaration order. Disjoint
`DCL CONST[45]` followed by `DCL CONST[0]` emits extent47 because upstream's
single-CONST0 path increments its count; the addressable bank still ends at45.
An unread declared tail can also exceed the active reflected prefix. Direct
WebGL callers must inspect the actual active uniform array before uploading.
The qualified Metal driver retains the full declared extent, including47 in
the reordered case. The hardware proof records required, declared, reflected
and uploaded counts separately, poisons the unaddressable host element46, and
checks that the shader still uses only guest CONST0..45. Neither a retained
suffix nor a link-time default value is evidence of a guest input.
E6-T12e3b separately owns command transport, host-limit checks and renderer
restoration for these extents; v5 frontend acceptance does not enable those
command paths or production GPU negotiation.

## JavaScript contract

```js
import { createVirglShaderBridge, LIMITS } from "./renderer/virgl-shader/index.mjs";
const bridge = await createVirglShaderBridge();
const result = bridge.translate({ stage: "vertex", text: tgsiText });
if (!result.ok) console.log(result.error.code, result.error.message);
else console.log(result.glsl, result.metadata);
```

Factory options are Emscripten loading options, such as `locateFile`; they are
trusted application configuration. Translation requests accept exactly `stage`
and `text`; unknown enumerable string request keys are rejected, including
shader-key overrides. The pair request described below rejects every unknown own
key, including symbols and non-enumerable keys.
`LIMITS.registerIndex` remains 7; `LIMITS.temporaryRegisterIndex` is 117 and
`LIMITS.constantRegisterIndex` is 45. These are shader frontend limits. The
command decoder and state renderer retain their separately gated constant limits.
Each factory call creates separate Wasm memory. Calls are synchronous and
serialized. Returned strings and objects own their data; the adapter frees its
input allocation in `finally` and does not return any view into Wasm memory.

Success is `{ok: true, glsl, metadata}`. Failure is
`{ok: false, error: {code, message}}`. Error codes are `invalid-input`,
`input-too-large`, `unsupported-stage`, `unsupported-feature`, `parse-error`,
`translation-error`, `incompatible-interface` (pair semantic/component mismatch),
and (JS input allocation only) `allocation-failed`.
Errors indicate rejection, not a fallback shader. Repeated rejected inputs do
not reset or poison the instance. Native users can call `bridge_translate` from
`bridge.h`; its static JSON result is borrowed until the next serialized call.
The native CLI reads stdin and accepts one argument, `vertex` or `fragment`.

The fixed upstream configuration is GLSL ES 3.00, GLES/core profile, integer
support, one draw buffer, fragment lower-left origin, and otherwise zero shader
key state. Pair translation additionally derives only the matching vertex
interpolation interface from checked fragment declarations. No caller-supplied
rasterizer, alpha-test, clipping, swizzle, stream-output or arbitrary shader key
is accepted.

### Pair translation

```js
const pair = bridge.translatePair({ vertexText, fragmentText });
// Success: {ok:true,vertex:{glsl,metadata},fragment:{glsl,metadata},interfaceKey}
```

Both fields must be own string-valued data properties; getters, missing fields,
unknown keys and failed reflection reject before Wasm allocation. Each text
keeps the single-stage bounds, for at most 32,768 input bytes per pair. No source
is rewritten. Both original texts are grammar-checked before conversion;
each declared fragment GENERIC input needs a matching, fully written vertex
output covering its declared components. Upstream first converts the fragment,
then its value-only interpolation export is checked against the bounded profile
before being used in an otherwise-zero vertex key. Each conversion owns and
frees its output strings and shader-info arrays independently. No upstream
ownership pointers escape or become persistent compiler state.

`interfaceKey` is `generic-interpolation-v1:` followed by entries sorted by
GENERIC semantic index, such as `g0/15/flat;g1/3/smooth`; an empty interface has
only the prefix. The decimal component mask and interpolation mode are both
included. The renderer must bind program reuse to this effective interface and
selector generations; a vertex shader compiled for a smooth consumer cannot
serve a flat consumer unchanged. `bridge_translate_pair` exposes the same native
operation in `bridge.h`. Pair failure returns only the ordinary structured error,
never a partial stage. The synchronous JS wrapper frees both input allocations
in `finally` and owns all returned JSON data.

## Supported profile and bounds

### Private raw lanes

`virgl-webgl2-raw-bits-v1` identifies fully validated programs containing AND,
OR, NOT, SHL or USHR, without any v2, v3 or v4 operation described below. A bounded lexical probe chooses which guard
to attempt; it does not admit an instruction or select returned semantics.
Programs without any admitted raw instruction tokens take the original v5 path, preserving
its full GLSL, metadata and error results, including its finite UINT32-immediate
policy. A raw-domain immediate alone does not opt a program into the new profile.
There is no caller backend flag, vendor patch or generated-source rewrite.

The v1 owned path permits MOV and the five bitwise operations. ADD, MUL, MAD and
TEX cannot be mixed into it; SAMP/SVIEW declarations also reject in this profile.
PRECISE, modifiers, control
flow, indirect addressing and ADDR remain unsupported. It retains the v5 bank,
line, text, instruction, component and initialization bounds. All decimal UINT32
words from 0 through 4294967295 are permitted in raw immediates; signs, exponent
notation, suffixes and overflow reject. FLT32 immediates keep their existing
finite parsing policy. TEMP lanes and immediate operands use highp unsigned
32-bit storage/expressions. SHL and USHR always mask each count with `31u`, as
specified by the captured Mesa TGSI revision. Every instruction first snapshots
all consumed RHS lanes into `raw_rhs`, then commits destination lanes. Sparse
unsupported masks remain rejected; prefix masks and individual lanes preserve
untouched components and ordered source swizzles.

The bit-preservation guarantee covers private lanes and these integer operations.
Attribute, GENERIC, POSITION and COLOR interfaces remain float interfaces. Each
lane tracks known-zero bits, known-one bits, and an optional original float-input
register/lane. MOV retains that origin; bitwise operations clear it. A surviving
float origin is emitted directly from the corresponding input at final output,
without claiming preservation of input NaN payloads. Other output lanes must
exclude all-one exponents, and must either contain a definitely set exponent bit
or have a definitely zero mantissa. This proves finite normal values or signed
zero and rejects possible NaNs, infinities and subnormals. Unknown raw CONST
words receive no float-origin authority. Dynamic shift proofs join all compatible
low-five-bit counts, at most 32 possibilities. Final output validation happens
after all source checks and writes; intermediate private values can use every bit.

Raw stages never invoke the upstream translator. The owned emitter constructs a
complete ESSL300 shader from typed operands and fixed templates. Checked
declarations supply the same metadata shape and names. Every GENERIC retains the
legacy vec4 link type even when its checked component mask is xy or xyz; masks
constrain initialized and consumed lanes, not the varying's GLSL width. Constant extent follows
the pinned `vrend_shader.c:1961–1965` rule, including the CONST45-before-CONST0
extent47 case; the addressable limit remains46. The exact 656-byte VirglBlock
and its winsys_adjust_y offset640 are retained. Raw fragment declarations form
the same bounded value-only interpolation interface checked for legacy stages;
mixed-backend pairs derive the same sorted key and only alter authorized vertex
qualifiers. Fragment standalone/pair results remain identical. The `float32-bits`
uniform transport encoding is unchanged: arbitrary host-u32 hardware probes are
direct compiler tests, not expanded guest constant-command admission.

Each owned stage allocates a fixed 26,232-byte IR and a 65,537-byte GLSL buffer,
including its terminator. A pair holds at most 183,538 bytes in these blocks.
Both are freed on every success or failure, including second-stage failure.
Native compile-time assertions cap the IR at32KiB, each profile at8KiB and the
two conversion records together at32KiB. The current profile is7,608 bytes;
the IR's 179 instruction entries are112 bytes each. The input guard uses one
16,385-byte temporary text buffer sequentially. Raw emission has bounded scalar
locals and no recursion or token workspace. Legacy conversion retains its
sequential 16,385-byte input and 8,192 four-byte token workspaces; the new raw
grammar cannot exceed that token capacity (at most179 three-operand statements,
8 immediates and256 bounded lines). The fixed16MiB Wasm memory,256KiB stack,
64KiB GLSL and existing JSON capacities stay unchanged. Native sanitizer stack
records describe that compiler build, not the Wasm stack layout.

`build.sh raw-bit-sanitize` builds the ASan/UBSan and LLVM-coverage harness;
`tools/virgl-raw-bits/native.py` records exact results for `raw-bit-cases.json`,
the hardware fixtures and all19 unchanged original bodies. The hardware gate
reconstructs u32 words from finite-normal vertex transform-feedback carriers
and exact0/255 fragment bit planes, with independent expected words and dynamic
uniforms. It also records real fixed-memory allocation failure and recovery.

### Wrapping arithmetic, masks and raw selection

`virgl-webgl2-raw-bits-v2` extends the owned profile with UADD, ISGE, USEQ, USNE
and UCMP. A stage reports v2 when one of these instructions validates and no v3 or v4
instruction occurs; old v1 and
legacy v5 programs retain their full GLSL/metadata/error results. A pair selects
the profile independently for each stage, with the same derived interface key.
Raw immediates alone still do not select an owned backend. Mixed floating-point
arithmetic, PRECISE, control flow and integer IO remain excluded.

UADD computes the low32 bits using unsigned addition. ISGE orders two's-complement
words by XORing each sign bit with `2147483648u` and comparing the unsigned results.
USEQ and USNE compare raw words. All three predicates produce exactly
`4294967295u` or `0u`. UCMP selects src1 when the corresponding src0 word is
nonzero, otherwise src2; every noncanonical true word is valid. Selected payloads
stay unsigned even when their bits encode NaNs, infinities or subnormals. No
float mix, numerical float conversion or signed overflowing C expression carries
these values. The private raw guarantee and existing float-output boundary remain
separate.

The safety proof computes exact UADD/comparison bits only when both inputs are
fully known. Otherwise those bits are unknown, and these operations always clear
float origin. Output encoders can re-establish safe bounds with AND/OR operations.
For UCMP, a known-zero condition copies src2's proof; any definitely set condition
bit selects src1's proof. An unknown condition intersects both arms' known-zero
and known-one bits and keeps float origin only when both name the same original
input register/lane. Dynamic selection between different unknown float origins
therefore does not authorize float output. Both arms must be declared and their
consumed lanes initialized even if a constant condition chooses only one arm.
The complete RHS snapshot precedes all writes, including three-source aliases.

Checked sources now retain only file, index and four swizzle selectors:24 bytes
each. Three fit the old two36-byte parser-register slots. The full parser still
checks range, mask and spelling before recording any source. Instructions remain
112 bytes, the IR remains26,232 bytes, and no allocation or capacity increases.
The existing opcode counter slot becomes a presence mask; no profile-version field
is added. Native/Wasm layout and allocation-pressure proof continue to bind these
sizes. Long three-source expressions can reach the unchanged64KiB GLSL bound;
they return `translation-error`, release both allocations and recover normally.
The179-instruction cap does not override the independent output-size cap.

`tests/integer-mask-cases.json` covers constant and dynamic proof paths, exact
comparison masks, selection/origin joins, aliasing, third-source initialization,
arity errors and capacity boundaries. One formerly rejected captured-fixture
UADD program becomes a positive: its final MOV overwrites the raw result with an
ordinary input origin. Its historical rejection slot now uses unsupported UMUL.
The two historical one-source UADD bank negatives likewise become UMUL slots;
their exact old malformed UADD texts are new explicit `parse-error` cases. The
old v1 UADD/ISGE/UCMP negative programs still reject because their final lanes are
unsafe float outputs. Historical counts and all19 original body results remain
unchanged. The hardware proof reconstructs every result bit using the v1 output
encodings and independent integer oracles, including dynamic operands in both
stages and mixed-profile pairs.

### Ordered binary32 masks

`virgl-webgl2-raw-bits-v3` adds FSLT and FSGE. Only a fully validated occurrence
of one of these opcodes selects v3 when no v4 numeric operation occurs; unaffected v1, v2 and v5 full results stay
unchanged. The comparison helper is emitted only in stages that use these opcodes. Both operands
remain unsigned words: no float bitcast or floating-point comparison implements
either instruction.

Magnitude bits greater than `0x7f800000` identify a NaN, including every signed
quiet or signalling payload; either NaN makes both predicates false. The two
signed zeros compare equal. For other values, complementing a negative word or
flipping a positive word's sign bit gives monotonically ordered unsigned keys.
This preserves subnormal, normal and infinity ordering, including reversed
negative magnitudes. FSLT tests less-than; FSGE tests greater-or-equal with its own
ordered guard. Results are exactly `0xffffffff` or zero, including when carried
through subsequent integer arithmetic or selection.

The compile-time proof evaluates the predicate only when both words are fully
known. Otherwise it retains unknown bits; neither case confers float-input
origin. The existing output guard therefore rejects an unencoded dynamic mask
or an all-ones result written directly to float output. A known false result can
be output as zero. Source initialization and instruction-wide RHS snapshots
remain unchanged for partial writes, swizzles and aliases. An IN source refers
only to the float encoding delivered by the existing input ABI; it does not
extend arbitrary raw NaN/subnormal payload transport across that ABI.

These operations add no IR field, allocation or capacity. Instructions remain
112 bytes and the IR remains26,232 bytes. Mixed ADD/MUL/MAD/TEX still reject in v3; ordinary numeric mixing uses the
separate v4 boundary below. PRECISE and control flow remain unsupported.

`tests/float-mask-cases.json` records constant-fold and dynamic cases, all ordered
domains, partial initialization, aliases, unsafe outputs and unchanged bounds.
Six newly supported historical FSLT/FSGE bodies are preserved exactly as positive
cases. Their former negative slots in the raw-bit and integer-mask fixtures use
adjacent unsupported FSEQ/FSNE names and opcodes; other fields and historical
counts are unchanged. The successor gate binds those exact migrations while
retaining all unaffected earlier full results and browser proofs. Native and
Wasm results are compared in full, and hardware vertex/fragment probes reconstruct
all32 result bits against an independent encoding-domain oracle. Production GPU
negotiation and guest constant-command admission remain unchanged.

### Ordinary numeric shadows

`virgl-webgl2-raw-bits-v4` admits ADD, MUL, MAD and fragment 2D FLOAT TEX in
owned raw programs. A bounded lexical scan recognizes the possibility of numeric
work throughout the stage so UCMP before the first arithmetic instruction can
join different ordinary float origins. Only a fully validated numeric instruction
and a successful complete output proof select v4. Numeric-only legacy programs
retain v5; comments, malformed tokens and sampler declarations alone cannot select
v4. Unaffected v1/v2/v3/v5 full translations and errors remain unchanged.

Each lane keeps its private uint word and separately tracks authority to read an
ordinary float. Authority is either an immutable original input register/lane or
a computed/copied float shadow. Numeric use may also decode raw words whose known
bits prove every possible value is finite normal or signed zero. Unknown CONST
words and arbitrary raw TEMP words have no numeric authority, even when one
particular host upload is finite. The guest constant decoder's finite check does
not confer standalone compiler authority and permits subnormals. Direct numeric
Mesa constants therefore need a later explicit runtime-domain boundary before
remaining original shaders or production Mesa can be claimed supported.

ADD/MUL/MAD read the pre-instruction authorized float sources into `float_rhs`,
then capture that same result with `floatBitsToUint` before publishing any raw or
float destination lane. TEX evaluates one `texture(fssampN, vec2(...))` expression
into `float_rhs` per validated instruction and shares that vec4 across all lanes
and both views. Only x/y coordinate selectors are consumed; their ordinary-input,
shadow or proved-raw domains are checked separately. Used samplers alone appear
in owned metadata and GLSL; unused declarations may remain inactive. The existing
fragment-only SAMP/SVIEW pairing, 2D FLOAT type, indices0–7 and explicit sampler
bindings remain required. Explicit TEX/MAD destination masks still reject.

MOV copies existing shadows before destination writes; original-input authority
may remain a direct input identity. Mixed UCMP snapshots both representations and
selects with the same raw `condition != 0u`. A dynamic selector grants float
authority only when both arms are authorized inputs/shadows or statically proved
safe raw values; the selected float becomes a new shadow. A known selector may
retain its selected authorized arm while the other arm has arbitrary raw data;
that unselected arm is never decoded as float. Both arms' consumed lanes must
still be initialized. Integer and comparison writes always clear float authority,
including UADD by zero. A later numeric use must establish a new raw-domain proof;
it must not read an old shadow left in the physical array. Partial writes and
swizzles preserve untouched lanes and snapshot every consumed lane before any
publication. Final output uses an authorized input/shadow directly; raw-only
output retains the preceding finite-normal-or-zero proof.

Computed floats obey the ordinary GLSL ES3.00 highp contract. This is no promise
of NaN payloads, computed zero signs, subnormal retention or PRECISE semantics.
The raw view preserves the bits actually captured from a computation, while
numeric consumers use its actual shadow without an undefined Inf/NaN decode.
Raw FSLT/FSGE still compare captured encodings with exact integer predicates.
The primary hardware arithmetic oracles use exact dyadic chains and texture
endpoints; any non-exact MAD witness requires a separately justified enclosure.

The checked destination is12 bytes, leaving room for three packed per-source
float-read mode words, a float publication mask, sampler index and mixed-mode
flag in each unchanged112-byte instruction. The facts remain12 bytes per lane
and the IR remains26,232 bytes. Checked modes record the source authority at the
instruction, never the final register facts. The shader adds118 TEMP vec4 shadows,
eight OUT vec4 shadows and one vec4 RHS:2,032 logical bytes per invocation, not a
claim about driver register allocation. All native/Wasm memory, stack, input,
instruction and output capacities remain unchanged. Long179-op full MAD programs
can return the existing structured GLSL-bound error; short179-op scalar programs
remain accepted. The successor gate covers deterministic native/Wasm parity,
actual hardware texture/arithmetic chains, mixed profiles, source-bound sabotage,
fixed-memory recovery and unchanged original outcomes. Production stays off.

### Componentwise ordinary arithmetic and numeric negation

`virgl-webgl2-raw-bits-v5` extends the owned numeric-shadow path with DIV,
MAX, FRC and LRP. Their checked per-lane expressions follow the pinned VirGL
emitter: `src0 / src1`, `max(src0, src1)`, `fract(src0)`, and
`mix(src2, src1, src0)`. LRP's first source is the weight; its second is the
weighted endpoint. FRC subtracts floor, so a negative fractional input such as
-1.25 produces .75. Each operation accepts the existing scalar, xy, xyz or full
destination masks, validates only consumed swizzled lanes, reads every source
before an aliased write, and publishes both representations through the existing
C2 snapshot machinery. Numeric-only shaders containing a new operation enter
the checked owned path even without an integer instruction.

One optional unary `-` is accepted before a numeric source register in ADD,
MUL, MAD, DIV, MAX, FRC, LRP and TEX coordinates. It negates the authorized float
expression after selecting its swizzled lane. A newly computed result always
has a float shadow; it cannot retain the original positive input's shortcut.
All source positions are independently flagged, including LRP's weight and
endpoints. This syntax does not extend MOV, UCMP, integer/bitwise operations,
raw FSLT/FSGE comparisons or sampler operands. Absolute-value bars, repeated
signs, unary plus, saturation, PRECISE and LEGACY_MATH_RULES remain unsupported.
The latter specifies an additional zero-times-infinity rule, including LRP's
implicit multiplication, which these ordinary expressions do not implement.

The numeric authority rule is unchanged: actual original IN values, existing
computed/sample shadows, or raw values conservatively proved finite normal or
signed zero. Ordinary inputs and shadows have no new magnitude, finite-value,
nonzero-divisor or weight-range admission restriction. LRP can extrapolate;
DIV does not clamp or replace its divisor. Unknown raw CONST/TEMP values remain
unauthorized numeric operands, including the captured `-CONST[4].xxxx` shape.
The pending constant-domain integration remains necessary before Mesa activation.
These are ordinary ESSL operations, not exact CPU executor or all-domain IEEE
emulation. NaN payload/propagation, computed signed zero, retained subnormals and
PRECISE behavior are not promised. Quantitative DIV witnesses use independently
derived rational enclosures for the GLSL ES3.00 highp accuracy guarantee in its
specified denominator domain; those test-oracle limits do not restrict shader
admission. Exact dyadic MAX/FRC/LRP/negation witnesses and partial/alias/sample
chains supplement the DIV proof.

The primary equations are Mesa26.2.2's TGSI documentation (MAX, LRP, FRC and
DIV), and the lowering is pinned `vendor/src/vrend/vrend_shader.c` at lines5580,
5595,5702 and5752. Source negation is assembled there at4708. GLSL ES3.00
revision6, sections4.5.1,5.11 and8.3 define the ordinary precision and builtin
limits. The CPU executor's rearranged LRP or `fmaxf` implementation does not
establish a stronger GLSL guarantee.

Three source-negation bits occupy existing instruction flags; one spare feature
bit records validated negation for profile selection. The checked instruction
remains112 bytes and IR26,232 bytes, with unchanged logical shadow storage and
native/Wasm capacities. Unmodified v1/v2/v3/v4 and legacy straight-line-v5
programs retain exact full outputs. `tests/component-float-migrations.json`
binds the six former C2 MAX, DIV and negated ADD rejections to their original
bodies, newly accepted shared cases, and adjacent retained-negative replacements.
Malformed two-source FRC and every original captured full result remain unchanged.
The new deterministic gate combines sanitizer/Wasm parity, actual GPU results,
independent numerical oracles, source-bound sabotage, fixed-memory recovery,
retained regressions and a pristine clone. Production remains disabled.

### Dot products and scalar reciprocals

`virgl-webgl2-raw-bits-v6` adds DP3, RCP and RSQ to the owned ordinary
numeric path. DP3 consumes xyz after each source swizzle; RCP and RSQ consume
only post-swizzle x. The source mask is independent of the destination mask:
a DP3 writing x still needs xyz, while a reciprocal writing w needs only x.
One shared `raw_consumed_mask` rule drives both parser initialization checks
and numeric-authority checks. Unconsumed selectors may refer to uninitialized
TEMP lanes or unauthorized raw values without being read or decoded.

The emitter evaluates one `dot(vec3(...), vec3(...))`, `1.0 / (source)` or
`inversesqrt(source)` expression, broadcasts its scalar result into `float_rhs`,
and captures that vec4 before publishing either destination representation.
Only the validated destination mask is written. Aliases observe all consumed
pre-write values; other destination lanes retain their old values and authority.
Typed numeric negation applies after swizzling to each consumed source lane.
No per-destination reevaluation or fourth dot-product lane is introduced.

This scalar replication contract follows Mesa26.2.2 TGSI documentation at
RCP103, RSQ112 and DP3176, `tgsi_info_opcodes.h` entries4/5/10, the contemporary
`tgsi_util.c` source-use cases94–108/133–135, and `tgsi_exec.c`'s scalar helper
2869–2888 and DP3 implementation3025–3052. It also matches the pinned vendor's
REPL opcode metadata. The older pinned `vrend_shader.c`:5675 RCP expression and
`tgsi_util.c`:185 channel-wise classification do not implement nonbroadcast RCP
replication. The owned path follows the contemporary TGSI contract instead of
that shortcut. Both captured RCP instructions already write x from xxxx; the
broader scalar contract is covered by adjacent nonbroadcast y/w/full-mask tests.
The complete capture inventory is four DP3, two RCP and four RSQ instructions
in four PRECISE-bearing originals, whose full translations remain unchanged.

Numeric authority remains original IN, computed/sample shadows, or raw values
proved finite normal or signed zero. There is no additional value-range,
finite-value or positivity admission guard. Unknown raw numeric CONST/TEMP
remains unsupported, and no absolute value, clamp, zero-divisor replacement or
PRECISE semantics is added. Ordinary RSQ results for nonpositive operands are
undefined; exceptional observations do not assert payloads, computed zero signs
or retained subnormals. Approximate RCP/RSQ results use the ordinary ESSL highp
contract. Independent reciprocal witnesses use the specified positive-divisor
2.5-ULP allowance; reciprocal-square-root witnesses use integer-derived rational
root brackets and the specified2-ULP allowance. Those oracle ranges constrain
the numerical proof rather than shader admission. Exact dyadic DP3 controls
separate xyz consumption from poisoned w and exercise replication. No host
float division or Math.sqrt defines the expected quantitative result.

Opcode-mask bit21 remains the v5 negation marker; v6 opcodes use bits22–24.
Instructions remain112 bytes, the IR26,232 bytes, and all input/instruction,
output, shadow-storage and16MiB Wasm-memory bounds stay fixed. The two formerly
unsupported, valid DP3 bodies are preserved as new positives with exact
source-bound migrations in `tests/dot-reciprocal-migrations.json`. Their old
negative slots use adjacent unsupported absolute syntax. The four old RCP/RSQ
two-source bodies remain malformed with their complete previous errors.

The successor gate retains every earlier full result except those two explicit
admissions. A versioned proof adapter runs the unchanged E5 native harness with
the two bound adjacent-negative inputs and its original12/10 recovery anchors;
all earlier GPU oracles and the full C2 gate remain unchanged. New v6 evidence
adds native/Wasm parity, consumed-lane and scalar-broadcast checks, independent
hardware oracles, sabotage, memory/recovery coverage and a pristine clone.
Numeric CONST integration and PRECISE support remain later boundaries before
original closure or actual Mesa acceleration. Production stays disabled.

### Legacy finite-float profile

`virgl-webgl2-straight-line-v5` deliberately accepts a strict subset of TGSI text:

- `VERT` and `FRAG`; unique `DCL` registers with canonical decimal indices
  of at most three digits. TEMP indices are 0–117 and CONST indices are 0–45;
  IN, OUT, IMM, SAMP, SVIEW and GENERIC semantic indices remain independently
  bounded at 0–7. TEMP and CONST declarations may use non-overlapping inclusive
  ranges within their respective banks. Other ranges, signs, nondecimal
  spellings and leading zeroes remain rejected. Declarations and immediates
  precede instructions; declarations may follow immediates.
- Vertex input attributes, mandatory vertex `OUT[0], POSITION`, and generic
  vertex outputs. Fragment inputs are `GENERIC[n], PERSPECTIVE` or `GENERIC[n], CONSTANT`; fragment
  output is `OUT[0], COLOR`. Generic semantics within a stage are unique.
  Generic vertex outputs and fragment inputs may declare `.xy` or
  `.xyz`; all other declarations remain full-width.
- Full `vec4` `MOV`, `ADD`, `MUL`, `MAD`; `TEMP`, `CONST`, and sequential
  `IMM[n] FLT32 {x, y, z, w}`. Temporary reads require every effectively consumed
  lane to have been written by an earlier instruction. Finite
  immediate floats must parse without range errors and have magnitude at most
  1,000,000. `UINT32` immediates accept four checked decimal words interpreted as
  float bits by upstream. Their float values must satisfy the same finite/range
  bound, and nonzero subnormals are rejected. Integer instructions remain unsupported.
- `MOV`, `ADD` and `MUL` may write TEMP or OUT with `.x`, `.y`, `.z`, `.w`,
  `.xy` or `.xyz`. Masked MAD and TEX remain unsupported, as do other explicit
  masks (including `.xyzw`, duplicate and unordered masks). Implicit full-vector
  forms remain accepted. POSITION and COLOR must be fully written before `END`;
  generic outputs must have every declared component written.
- Sources may use exactly four `xyzw` selectors, including repetitions. For
  componentwise operations, each destination lane selects its corresponding
  source selector; 2D TEX consumes coordinate lanes x and y before applying its
  source swizzle. Only those selected source lanes must be declared and, for
  TEMP, previously initialized. For example, an xy write from `.yzww` consumes
  y/z, while a 2D sample from `.xxxx` consumes only x. Unconsumed selectors must
  still be syntactically valid but need not refer to initialized lanes. All
  source checks finish before the destination's written mask is updated.
- Fragment `TEX dst, coordinates, SAMP[n], 2D`, with matching declared
  `SVIEW[n], 2D, FLOAT`. Sampling, wrapping, filtering and blending are caller
  GL state, separate from translation.
- Optional bounded sequential instruction labels. ASCII spaces, tabs, CR and
  newline; no embedded NUL or other control/non-ASCII bytes.
- Exactly one optional fragment `PROPERTY FS_COLOR0_WRITES_ALL_CBUFS 1` before
  instructions. The fixed one-target configuration makes this COLOR0 only.

Unsupported TGSI includes ranges outside TEMP/CONST, indirect addressing, other declaration
or write masks, short/long swizzles, source modifiers, all other properties
(including unknown properties upstream would otherwise ignore), PRECISE,
control flow, other opcodes, integer/double operations, other texture types,
extra shader stages, MRT, UBOs, SSBOs, images and atomics.
This is not a general Mesa desktop-shader frontend. Widening this profile
requires new safety checks and independent browser execution evidence.

Input is capped at 16,384 bytes, 256 nonempty lines, 512 bytes per nonempty line,
179 non-END instructions, 118 TEMP registers, 46 CONST registers and eight
registers in each other file. The original corpus maximum is 178 non-END
instructions (179 including END); the admission limit is static, not a future
loop execution bound. Tokens have a fixed 8,192
word allocation, GLSL is capped at 65,536 bytes, and JSON storage is fixed at
147,456 bytes per standalone result and 295,936 bytes per pair result. Pair
conversion reuses the text/token stack workspaces sequentially. The fixed
16 MiB Wasm memory and 256 KiB stack are unchanged. Output bounds are checked
before returning success. The small
guard checks syntax, numeric bounds and dataflow before upstream sees input;
upstream still performs the actual TGSI parsing and GLSL generation. No upstream
assertion is disabled. Upstream diagnostics cause translation failure.

## Binding metadata

Every success has `profile`, `stage`, and the following arrays, including empty
arrays where applicable:

| Field | Meaning |
| --- | --- |
| `inputs`, `outputs` | `{index,name,type,semantic,semanticIndex,componentMask}`; outputs additionally include `writtenMask`. GENERIC inputs/outputs also have `interpolation:"smooth"|"flat"`; standalone VS outputs are smooth, while pair VS outputs reflect the matched FS modes (unmatched outputs stay smooth). Attributes, POSITION and COLOR have no interpolation field. Masks are numeric bitsets (`xy=3`, `xyz=7`, `xyzw=15`). Type remains `vec4`, matching upstream declarations, even for partial generic components. A linker must check component coverage rather than infer it from type. VS attribute names are `in_n`, linked generic names are `vso_gn`, position is `gl_Position`, and fragment color is `fsout_c0`. |
| `attributes` | Vertex input records; bind or reflect each attribute name. Fragment list is empty. |
| `uniforms` | `{name,type:"uvec4[]",count,encoding:"float32-bits"}`. Base name is `vsconst0` or `fsconst0`; query `name + "[0]"`. Upload float bit patterns with `uniform4uiv`, not numeric integer conversion or `uniform4fv`. `count` is the upstream declared extent and includes gaps; it is not the active reflected size. |
| `samplers` | `{index,name,type:"sampler2D"}`; name is `fssampn`. Caller binds each texture unit and sets the sampler uniform. |
| `uniformBlocks` | Vertex `VirglBlock`, 656 bytes under std140. Its required member is `winsys_adjust_y`, float at byte offset 640, default 1. Fragment list is empty. |

The upstream vertex shader multiplies `gl_Position.y` by `winsys_adjust_y`.
Initialize the whole block to zero, then set that member to 1 (or deliberately
choose -1 for an explicit coordinate flip). Reflect block size/member offsets
and validate the metadata before binding. The remaining upstream block fields
are clip planes (bytes 0–127), stipple data (128–639), alpha reference (644),
clip-enable (648), and draw-id base (652); the supported fixed key does not use
them. The browser harness checks the actual block reflection and GLSL types.
Declared bindings may be optimized away by GL when unused, so production callers
must use program reflection for active locations.

## Upstream provenance and regeneration

Source: <https://gitlab.freedesktop.org/virgl/virglrenderer>, tag
`virglrenderer-1.3.0`, commit `ca50e008863837e094747a69974dde3ae148aeaa`.
`vendor/` contains byte-identical upstream files, the shader dependency closure
for the native/Wasm builds, and generation inputs. MIT notices are retained in
each file and `vendor/COPYING`. `UPSTREAM.json` records the complete source and
generated SHA-256 inventory. Every build verifies it via `verify_sources.py`.
The full renderer, EGL, DRM, epoxy, Vulkan and GPU command handling are absent.
The only platform hooks supplied by `bridge.c` are deterministic disabled debug
options and bounded diagnostics; no upstream source is patched.

Ordinary builds require no Python package downloads. To check generation in a
temporary environment:

```sh
python3 -m venv /tmp/virgl-shader-regenerate
/tmp/virgl-shader-regenerate/bin/pip install PyYAML==6.0.2
/tmp/virgl-shader-regenerate/bin/python renderer/virgl-shader/regenerate.py --check
```

`regenerate.py` runs the pinned unmodified `u_format_table.py` and
`u_format_parse.py` over `u_format.yaml`, using `--enums` for `u_format_gen.h`
and the default output for `u_format_table.c`. It substitutes 1/3/0 into the
upstream `virgl-version.h.meson` template. Remove `--check` only when deliberately
regenerating, then review changes and update the recorded hashes. To verify
upstream identity independently, obtain the pinned git revision and compare
each `vendor/<path>` with `git show <revision>:<path>`.


### Conditional finite constants in the owned compiler

`virgl-webgl2-raw-bits-v7` permits numeric consumption of raw constant-derived
finite values under one compiler-derived stage-local `constantDomains` record.
The shared renderer must enforce that record against the complete current
active uploaded prefix before drawing. It includes zeros and subnormal inputs;
raw transport remains bit-exact, while ordinary arithmetic keeps its documented
precision and subnormal-flush latitude. This is not a promise of exact computed
zero signs, NaN payloads or PRECISE behavior.

The compiler first tries the existing unconditional validator. Only its typed
missing-numeric-authority failure permits a fresh full conditional attempt, and
that attempt must actually consume CONST-dependent numeric data. Existing
successful full results are unchanged. A conditional stage within a pair carries
the same bank requirement as its standalone translation; an unconditional
companion acquires no additional contract. Failed retries preserve the original
public rejection and publish no partial response.

Exact MOV/swizzles and supported UCMP provenance can carry numeric access
without ordinary-output authority. Conditional-only arms remain unsuitable for
raw float output until actual numeric arithmetic computes an ordinary value.
Unknown raw data or integer writes cannot borrow a stale numeric shadow. The
fact, instruction, IR and Wasm allocation bounds are unchanged. TEX remains
fragment-only; PRECISE, indirect addressing and structured control flow remain
outside this profile.

`make verify-E6-T12e6b` records native sanitizer/recovery and full-result
compatibility checks, real compiler-to-shared-renderer GPU draws, raw constant
bitplanes, independent numeric bounds, targeted compiler faults and named
predecessor regressions. Positive GPU tests inject neither GLSL nor metadata.
The separate retained consumer regression is explicitly a trusted-host metadata
harness and makes no additional compiler claim. Production guest negotiation
remains disabled.

### Structured unsigned shader conditionals

E6-T12e7 adds the bounded UIF/ELSE/ENDIF family to the owned backend. UIF tests
only the unsigned post-swizzle x word against zero; it does not use floating-point
truthiness or require a canonical all-ones boolean. Optional target labels must
identify the actual matching ELSE/ENDIF, every delimiter must balance before END,
and nesting is limited to eight. IF, arbitrary jumps, loops and indirect operands
remain unsupported.

Validation saves entry state per nesting level, swaps it with the completed true
predecessor at ELSE, then intersects initialized lanes at ENDIF. Without ELSE the
other predecessor is the entry state. A lane written on one path cannot become
initialized on another. The validator conservatively considers both syntactic
paths and does not infer predicate correlations. Each structured write with
numeric authority stores its actual value in a physical float shadow, allowing
joins to preserve distinct input origins and computed values correctly. Ordinary
output permission must hold on both paths; finite-bank dependence is retained
from either path. No missing lane is filled with zero.

The closed compiler profiles are raw-bits-v8 for unconditional structured code
and raw-bits-v9 for structured code with the existing finite-bank obligation.
The consumer requires the complete contract for both v7 and v9 and rejects a
contract on v8. Its finite-word predicate, immutable bank ownership and draw-time
checks are unchanged. The temporary control-flow arena is heap allocated, capped
at 53,248 bytes and freed within each validation attempt, preserving the existing
instruction/IR/profile layouts and fixed Wasm memory and stack limits.

The captured shaders include one-sided lane definitions that a conservative join
cannot accept. They remain original-hash PRECISE rejections here; later full-corpus
work must prove path-sensitive definedness or observational irrelevance before
admitting them. This slice uses independently authored nested shaders, literal
per-lane colors and raw-word atlases on actual hardware, plus separately compiled
branch-polarity and initialization-union faults. Production guest negotiation
remains disabled pending the remaining shader and live Mesa milestones.

The deterministic acceptance command is `make verify-E6-T12e7`. Its final record
includes native/Wasm complete results, allocation and retry recovery, actual
compiler-derived metadata consumed by the shared renderer, a pristine clone and
independent adversarial verification. Existing shader inputs and full results are
preserved; positive tests do not inject metadata or modify captured source text.

### Bounded indirect constant addressing

E6-T12e8 adds scalar ADDR[0].x, raw integer UARL and
CONST[ADDR[0].x]. The address copies the first post-swizzle unsigned word.
At each indirect use, known-zero and known-one facts must establish a complete
conservative set contained in 0..45. Every candidate index and consumed component
must be declared. Address initialization and facts join both syntactic branch
predecessors; a no-ELSE branch includes entry state. Unknown values, stale facts,
other address forms and out-of-range candidates reject before translation.

Profiles raw-bits-v10 and v11 require one compiler-derived
constant-bank-static-indirect-v1 record identifying the stage, slot zero, bank,
declared extent and sorted union of possible indices. v11 additionally requires
the existing finite constant domain; v10 is raw transport. Older profiles reject
the new record. Before draw allocation, linking or dispatch, the renderer owns
the complete min(count,46) vec4 prefix and checks v11 finiteness over that same
prefix, including unselected entries. Reflection must cover every possible index.
The existing immutable bank identity check still binds draw validation to upload
across updates and asynchronous yields. Short banks and restoration zeros cannot
supply missing authority; non-draw restore skips incomplete new-profile uploads.

The additional scalar state measures 26,256 bytes for raw IR, 7,616 for profile
state and 52,612 for the flow arena, below their existing caps. The 179-instruction,
16 MiB Wasm memory and 256 KiB stack bounds remain. The acceptance command is
`make verify-E6-T12e8`: complete native/Wasm results and recovery, independent
first/interior/last word and pixel oracles through decoded commands, immutable-bank
attacks, and actual source-built bound-removal and low-bit-index faults. The latter
stays in range on hardware; invalid-address fault witnesses are compiler-only.

All 3,466 prior shader results and 236 pairs remain unchanged. Original captured
admission stays 12/19 with every PRECISE shader rejected. This completes the
bounded address slice; loops, PRECISE/corpus closure and live Mesa integration
remain separate prerequisites. Production guest graphics stays disabled.

### Certified counted-table loops

E6-T12e9 supports one structural family matching the captured table search, with
checked TEMP/IMM renaming and consumed lanes. The initial raw values are j=1,
a=11 and b=16. Each header reads table[a] before testing an OR of a numeric
comparison and signed j>=CONST9.x. The guarded BRK is the only exit. The checked
recurrence preserves a=j+10 and b=16*j; a matching post-loop j!=n guard protects
the three tail address chains. Other induction graphs and unproved forms reject.

Under signed_i32(raw CONST9.x)<=18, a nonpositive count exits at the first header;
a positive count exits by j=n. The true tail has j<=17. The complete header set
is 11..28 and tail sets are 10..26, 29..45 and 28..44. Count 19 can exit early at j=18 and
read CONST[46] in the tail. The compiler emits the checked original loop and BRK,
with no artificial iteration cutoff. See the [Mesa TGSI control-flow specification](https://docs.mesa3d.org/gallium/tgsi.html#opcode-BGNLOOP).

A shared syntax pass cannot authorize emission. A structural certificate and
ordinary checked validation over universal header facts establish the proof;
first-iteration facts cannot narrow the certified set. BRK terminates its path,
joins include only live predecessors, and ENDLOOP restores the checked exit
state. One snapshot per level preserves combined depth 8 without adding a second
full state array. Explicit uint64 opcode shifts avoid an opcode 32 shift overflow.
Actual layout and allocation sizes are recorded against the existing caps.

The closed raw-bits-v12 profile requires the existing finite and indirect access
contracts plus one constant-bank-counted-table-i32-v1 constraint identifying the
same stage, slot zero, bank name and declared extent 46 or 47, register 9/component 0,
and signed maximum 18. Its finite policy is explicit; raw FSLT does not itself
imply numeric-bank consumption. The consumer reads raw word 36 from the same
owned complete finite prefix it uploads, before preparing the draw. It preserves
bank identity checks across replacement and async yields. A failed count cannot
borrow a prior draw's approval or restoration zeros.

`make verify-E6-T12e9` records the bound derivation, independently authored loops,
exact first/interior/final words and pixels, maximum safe tail addresses, signed
count boundary attacks, actual source faults, native/Wasm parity and recovery,
and final pristine-clone evidence for a fresh reviewer. Invalid or potentially
unbounded mutants are compiler-only; the GPU fault preserves the forced terminal
break while changing the observable early-break choice.

Original shader bodies remain untouched at 12/19 accepted. PRECISE and the second
capture's separate conservative TEMP2.x initialization gap remain later work.
Production guest GPU negotiation and performance claims remain gated.

## Raw float equality — E6-T12f1

Undecorated FSEQ/FSNE compare integer binary32 encodings. Both zero signs are
identical for equality; any NaN is unordered, including a self-comparison of
an identical signaling payload. Results are exactly zero or all-ones. The
compiler folds only fully known words and consumes current raw snapshots of
computed numeric results. Source initialization, existing destination-mask
syntax, PRECISE/modifier rejection and ordinary output authority are preserved.

The closed unconditional profile13 follows loop12, indirect10/11, structured8/9
and finite-bank7 in obligation precedence. The consumer forbids every domain,
access and count field on13 and rejects unknown14. Comparison alone adds no
numeric bank dependency.

`make verify-E6-T12f1` preserves 4,004 complete E9 stage results, all264 pairs and
all19 original outcomes. The eight former negative comparison bodies in the
immutable integer/float fixture sets have an explicit hash/result migration
manifest and are separately rendered on the GPU. Successor leaf recorders keep
the old GPU probes/oracles byte-exact; no historical full gate is claimed.
Their historical heap partition assumptions are replaced by the current Wasm
pressure recording, which preserves fixed16MiB memory and available4KiB chunk
capacity through allocation failure and recovery. Coalescing may increase the
available chunk count; every observed before/after count remains in evidence.

The native input table grows to8192 only in the test driver; runtime storage and
179-instruction/16KiB/64KiB output caps stay unchanged. Original captures remain
12/19 while PRECISE and the separate radial definedness gap remain gated.
This compiler proof does not enable guest GPU negotiation or establish300MIPS.


### Selected-away interpolation (E6-T12f2)

One bounded, alpha-renamable outer ELSE / weight / LRP / FSNE / final UCMP
family may preserve a payload defined only on the true predecessor. The false
predecessor must prove width is exactly either signed zero. Ordered positive
finite bounds force the weight's true arm to literal zero there; FSNE and final
UCMP must use the same unmodified weight and interpolation lane versions. A
second candidate graph, changed selector, nonzero missing width, missing selected
lane, fallback clobber or any later unconditional read of the conditional result
still rejects. This is a graph proof, not a shader-body allowlist.

Initialization masks remain intersected. A 112-byte demand certificate holds
true-predecessor payload and result facts separately from unconditional lane
facts. Only the two exact checked operand use sites may borrow those facts.
Guarded LRP kills the old logical destination definition, including when it had
a value before the branch. Emitted arithmetic and both raw/float publications
execute only when the weight's magnitude is nonzero; final UCMP reads only its
selected arm. No missing value is filled with zero, and zero multiplication of
an undefined payload grants no authority. Partial writes retain untouched lanes;
full RHS snapshots preserve permitted aliases. LRP may alias its payload, and
final UCMP may alias its result or selector; overlapping fallback publication
that would destroy the false arm rejects.

Existing structured profiles8/9 and finite-bank obligations are unchanged. IR
storage measures26464 bytes, profile7616 and flow52644, below existing caps32768,
8192 and53248. The deterministic `make verify-E6-T12f2` records both captured
forms, all output masks, aliases, nested predecessors and NaN intermediates,
full retained native/Wasm outcomes, shared-renderer physical bit-plane words,
independent definition-version traces and demand observers. Real isolated
compiler faults remove the guard or width proof: the demand counter catches the
former and two distinct diagnostic poisons change observable words for the
latter. The poisons demonstrate invalid admission; they do not assign a guest
meaning to an unwritten value. Exact-head cold evidence and a fresh critic are
required before the task can become verified.

Original captures stay12/19 because PRECISE is independently rejected. The
second capture's radial TEMP2.x gap remains outside this family. Guest GPU
negotiation and the desktop300MIPS target remain unproven.

## Restricted radial coefficient admission — E6-T12f3

The two captured radial structures have a real definedness gap: the small-coefficient
linear predecessor does not write TEMP2.x, and its later alternate-root use can
change transparency. Coefficient 2^-20, q=(4,0), B=4 and C=16 gives primary root 2;
missing-word zero produces an out-of-range alternate root, while word0x407ffffe
produces visible root0.5. No missing TEMP is assigned zero.

A bounded typed certificate recognizes the adjacent MAX(c,-c), FSLT against
word0x3727c5ac, and UIF consuming that exact scalar lane version, with a real
matching ELSE/ENDIF. Both MAX inputs must be CONST4.x, only the second is negated.
Only under the explicit admission absBits(CONST4.x)>=0x3727c5ac may the validator
exclude the linear predecessor from the live join. Other missing lanes, clobbered
versions, altered thresholds and a second candidate graph reject. Ordinary
validated success keeps its prior profile.

Closed profiles14/15/16 respectively combine radial admission with finite-bank
structured, static-indirect, and counted-table obligations. Each requires exactly
one constant-bank-radial-coefficient-f32-v1 record, naming the same stage, slot,
bank and extent, register4/component0 and minimumMagnitude925353388. Older
profiles forbid that field. The consumer owns one complete finite declared prefix
and checks the coefficient and any raw signed loop count on those same words
before link, allocation, index readback or draw dispatch. Replacement, async
yields and restoration preserve the checked bank and shader generation.

`make verify-E6-T12f3` records the independent rational domain proof and missing-value
counterexample, native/Wasm full-result parity, immutable-bank failures, admitted
hardware colors, retained selected-lane hardware words and a source-built domain
sabotage caught before GPU execution. The measured raw IR is26480bytes, profile
7616bytes and flow arena52644bytes; instruction179, memory16MiB and stack256KiB
caps remain.

The two full-body fixtures are explicitly authored structural ports: PRECISE
suffixes are removed and alpha uses a numeric ADD-zero output projection. Both
changes are inventoried; original bodies remain untouched and gated. This domain
proves restricted admitted paths, not arbitrary finite radial input, captured
workload banks, current guest GPU support or a300MIPS desktop.

## Instruction-local PRECISE word operations — E6-T12f4

FSEQ_PRECISE, FSNE_PRECISE, MAX_PRECISE and MOV_PRECISE retain the pinned
TGSI instruction bit in the owned IR. Their copy, comparison and selection
operate on unsigned binary32 words. MAX uses the TGSI strict ordered
`source0 > source1` decision: equal or unordered inputs select source1,
including its zero sign or NaN payload. FSEQ treats opposite zero signs as
equal; FSNE returns true on unordered comparisons. Aliased operands are
snapshotted before destination writes. Typed MAX negation flips the sign bit.
Numeric and raster authority still follow the selected sources.

The stable Mesa 24.2.8 TGSI source snapshot and an actual pinned virglrenderer
1.3.0 token-parser recording bind this interpretation. Upstream destination
qualifiers depend on `has_gpu_shader5`; this ESSL300 subset does not rely on a
GLSL `precise` qualifier. The retained bit is instruction-local. This boundary
makes no exact backward RSQ/DP3 arithmetic claim; ADD_PRECISE and MUL_PRECISE
remain gated by their separate task.

Closed raw profiles17..26 respectively describe ordinary, finite-bank,
structured, structured-finite, indirect, indirect-finite, counted-table,
radial, radial-indirect and radial-counted-table combinations. Each requires
`preciseWordContract` with kind `tgsi-precise-word-local-v1`, the actual stage,
and a nonempty sorted unique subset of FSEQ/FSNE/MAX/MOV. The existing finite,
address, signed count and radial contracts remain mandatory in their matching
families. Older families forbid the new record. The consumer owns and freezes
it without relaxing the existing draw-time bank checks. Instruction/IR layouts,
179-instruction, 16 MiB memory and 256 KiB stack caps are unchanged.

`make verify-E6-T12f4` records 84 new literal cases, 82 pairs, all 4,344 historical
case inputs and 429 historical pairs, with an explicit inventory of 20 newly
accepted cases, two still-rejected cases whose error becomes parse-error, and
two newly accepted radial pairs. All other complete results stay unchanged.
The GPU observer reconstructs arbitrary source words from finite 16-bit
carriers inside the shader and projects each result bit to ordinary zero/one
raster values. It therefore checks NaN payloads and subnormals internally
without promising their preservation at floating raster boundaries. Fifty
kernels exercise 3,320 words through actual decoded shared-renderer draws.
Actual compiler-source faults for MAX source order, zero equality and FSNE
unordered behavior must fail the independent rational word oracle.

Mixed pairs also retain the ordinary translator's allocation boundary. An owned
wrapper compiles the unchanged pinned source through checked malloc/realloc and
safe string-buffer initialization. Each upstream conversion resets and checks
the failure latch before a successful result can be published. Failed operand
buffers stay empty and cannot expose uninitialized fields or NULL printf sources.
The recording forces all five actual allocation sites in each of four ordinary
and mixed witnesses, then recovers every profile. The identical fixed-heap Wasm
schedule must fail cleanly and later return the complete healthy paired result.

The original capture bodies and hashes remain unchanged; they compile
14/19 after the ordered destination-mask extension below. Owned-bank raster
authority and exact arithmetic work have separate tasks. This isolated boundary keeps production
guest GPU negotiation disabled and makes no desktop300MIPS claim.


Ordered destination subsets
---------------------------

Checked writes accept each nonempty, strictly ordered unique subset of `xyzw`,
including `.yz` and explicit `.xyzw`. Source selectors retain their four-lane
grammar. Declarations retain their existing prefix component masks. Writes must
still stay inside the declared component authority, and explicit MAD/TEX masks
remain gated. The existing complete right-hand-side snapshots preserve aliased
sources and unselected raw and numeric lanes.

`make verify-E6-T12f4a` binds the complete previous workload, explicitly records
24 historical admissions and 30 errors that now reach the uninitialized-source
check, and preserves every unrelated result. It exercises all15 masks with
raw words, ordinary numeric shadows, aliases, swizzles and output neighbors in
both stages. Independent literal TGSI predictions are compared with actual
shared-renderer GPU pixels. Four separately compiled source faults widen yz,
pack source lanes, overwrite neighbors or publish an aliased source early; each
must fail the physical oracle.

Untouched lighting captures `12f6d594` and `d4f702f7` now compile and link with
their existing finite-bank contracts. The hardware witness uses a negative
unit normal so their instruction-local MAX selects exact +0 while `.yz` copies
distinct selector/texcoord words. This does not claim exact native RSQ/DP3
intermediates, bank-derived raster alpha authority, guest GPU negotiation or
300MIPS desktop throughput.

Guarded bank copies to raster outputs — E6-T12f4b
------------------------------------------------

Raw profile27 adds a mandatory use-site component certificate for bank words
copied to ordinary floating outputs. Its `rasterBaseProfile` retains every
existing finite, indirect, signed-count, radial and instruction-local PRECISE
obligation. The closed `constantRasterDomains` record names one bank and sorted
register/component masks. It permits finite normals and both zero signs for
those copied components. Subnormals remain valid private bank/count data but
cannot become ordinary copied raster values. Computed integer values do not
inherit this authority.

The bounded backwards analysis follows checked control-flow predecessors,
masked writes, pre-write aliases, copy/selection payloads and certified table
indices. Existing numerical producers retain their previous authority. The
recognized radial branch is pruned only under its mandatory coefficient domain.
An integer table count cannot be used as copied floating output data. The
16,516-byte iterative analysis arena has a 32 KiB cap; its small final certificate
reuses TEMP facts only after semantic validation completes. The 26,480-byte IR,
7,616-byte profile, 52,644-byte flow arena and 112-byte instruction stay unchanged.

The shared renderer approves one owned immutable complete finite bank prefix
before linking, uploads and draws. Combined predicates and copied components
refer to that same snapshot. Restoration skips invalid current banks; async
work retains and checks shader, program, context and bank identities. Replacing
a bank requires fresh approval. No missing word is synthesized.

`make verify-E6-T12f4b` records the complete predecessor workload and an explicit
ledger of24 newly admitted singles,3 pairs and4 untouched original gradients.
All other complete results stay unchanged. Literal copy, branch, alias and
selection fixtures cover both stages, domain boundaries and the compiler caps.
Actual GPU captures compare flat copied words and ordinary RGBA8 pixels against
independent predictions. Replacement, restoration and varied async schedules
must reject unsafe banks before effects. Three actual source faults omit a
component, remove the consumer predicate or decode an unapproved bank word;
independent domain or pixel oracles must refute them. Unsafe subnormal raster
paths are stopped before invoking the native GPU method.

The original bodies now compile18/19. ADD_PRECISE and MUL_PRECISE remain gated.
This is guarded admission, without claiming real captured radial banks,
production guest GPU negotiation or300MIPS desktop throughput.

Explicit integer binary32 PRECISE arithmetic — E6-T12f5
-----------------------------------------------------

`ADD_PRECISE` and `MUL_PRECISE` execute on the GPU through bounded ESSL300
highp integer helpers. Each instruction returns one raw binary32 word, rounded
once to nearest with ties to even. Gradual underflow preserves subnormals;
ADD cancellation returns positive zero, ADD of two negative zeros returns
negative zero, and MUL uses the XOR of operand signs. NaN inputs and invalid
operations (opposite infinities in ADD, zero times infinity in MUL) return the
canonical quiet NaN `0x7fc00000`. Source absolute value clears the sign bit
before source negation toggles it. `LEGACY_MATH_RULES` remains unsupported.

The [TGSI specification](https://docs.mesa3d.org/gallium/tgsi.html) prohibits
result-changing transformations of PRECISE instructions, including contraction.
It does not select a rounding mode. This bridge explicitly chooses nearest-even,
also the default reference mode documented by
[SoftFloat](https://www.jhauser.us/arithmetic/SoftFloat-3/doc/SoftFloat.html).
Two separately rounded instructions are therefore observably distinct from a
fused multiply-add. For `0x3f800001 * 0x3f7ffffe + 0xbf800000`, this policy returns
zero; rounding the exact combined rational once returns `0xa8800000`.
There is no native floating multiply/add inside these helpers and no reliance
on bitcasts, helper calls or driver options as contraction barriers.

[ESSL300](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf)
specifies 32-bit highp integers. ADD aligns significands with guard/round/sticky
bits, then performs at most26 normalization steps. MUL normalizes each nonzero
subnormal in at most23 steps and forms a48-bit product from16-bit limbs in two
32-bit words. The lower limb product fits in32 bits; the middle accumulation
is at most33488384 and the upper word at most65535. Product reduction shifts
by20 or21, retaining three rounding bits and the discarded-bit sticky flag.
Exponent underflow can request a shift up to172, but the jam helper handles
zero,1–31 and32-or-more as separate guarded paths. Every executed shift count
is less than32; no64-bit GLSL type, extension, CPU shader evaluator or unbounded
normalization loop is used. The three helper strings together remain below8KiB
and the existing64KiB output,179-instruction,118-temporary,46-constant and fixed
16MiB Wasm/256KiB stack limits are unchanged.

Outer profile `virgl-webgl2-raw-bits-v28` adds a closed
`preciseArithmeticContract` with the operation set and fixed rounding/NaN/
underflow policy. `arithmeticBaseProfile` retains one existing raw profile
v1–v27; v28 cannot recursively wrap itself. A v27 base still retains its own
raster base. The renderer validates every simultaneous finite-bank, indirect,
count, radial, raster and word-PRECISE obligation before using its bank.
Contracts are copied into frozen owned records without invoking caller getters.

Exact private arithmetic accepts all binary32 input words and keeps results
raw through masks, aliases, swizzles, selects and exact comparisons. Existing
ordinary numerical access and floating output authority remain separate: both
arithmetic operands must already possess numerical authority before their
result receives it. Integer manufacture alone cannot obtain ordinary raster
output authority. Arithmetic outputs may still undergo ordinary interpolation,
RGBA8 conversion or host GPU treatment of subnormals; the exact-word promise
applies to internal integer consumers. The bit-plane GPU proof observes internal
words using known zero/one floating carriers, in both stages.

`make verify-E6-T12f5` records the complete source-bound predecessor corpus and
an explicit admission ledger for10 singles,4 pairs and the last unchanged
original. All19 originals translate; this isolated slice executes original
`3f78a90d` with its original multiply-by-zero and ADD instructions intact.
The full19-body hardware integration remains E6-T12f6. A rational oracle uses
BigInt values and binary search between adjacent representable numbers; it does
not copy the GPU alignment/product algorithm or consult emitted GLSL. The
hardware proof checks386 four-lane vectors per full kernel, all exponent-gap
classes, all23 subnormal leading-bit positions, modifiers, masks, aliases,
conditional paths and contraction-sensitive chains. A separate recorded GPU
counter run exercises all39 helper markers in both stages. It changes only
explicit marker/observer instrumentation and never substitutes for the unchanged
compiler-source word proof. Six isolated source faults remove sticky bits,
change halfway rounding, lose a limb carry, break normalization, lose a zero
sign or truncate intermediate rounding; each must produce an independent
physical word mismatch. Three input seeds, the retained hardware leaves, native
ASan/UBSan/counters, actual fixed-heap Wasm pressure, and a final scrubbed clone
complete the scoped evidence. Guest3D negotiation remains disabled and no desktop
MIPS or compositor responsiveness result is claimed here.
