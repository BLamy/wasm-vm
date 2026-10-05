# Fragment discard and surviving predecessors

E6-T12g6l admits fragment-only TGSI `KILL` and `KILL_IF` in the private
compiler. The latter inspects every post-swizzle source lane with absolute
applied before negation. Ordered binary32 `< 0` is false for both zeros and
all NaNs; negative finite values, subnormals and negative infinity discard.
No destination, numeric range or initialization fact follows from a discard.
Only an exact checked negative word removes a conditional survivor edge.
Surviving branches retain their own output, temporary, address and bank proofs.
Both unconditional and statically guaranteed conditional discard edges are
exercised with surviving copied-bank output certificates;
dead text still passes the existing parser and initialization restrictions.

The raw predicate uses integer encodings. ESSL 3.00 allows subnormal flushing
and leaves the float result of an infinity/NaN `uintBitsToFloat` unspecified
([primary specification, sections 4.5.1 and 8.3](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf)).
For this reason the unmodified pinned Mesa shader is a normative hardware
comparison only for finite normal/zero probes. Special-value differences are
recorded explicitly, with full raw readbacks; the owned shader must match the
literal ordered predicate for every input. Spatial comparison masks are ANDed
with the literal float-one word, as in the original c580 program.

The strict v39 wrapper retains its complete v1..v38 base obligations. Checked
pairs bind the discard policy and terminal status into the interface key. A
driver-eliminated color output is accepted only for a checked always-discard
program. Its draw temporarily selects `NONE`; CLEAR and ordinary restoration
keep COLOR0. No caller-supplied metadata can authorize a different pair source.
Existing non-finite SET_CONSTANT_BUFFER wire rejection remains in force.

`make verify-E6-T12g6l` is the affected high-risk submission: strict C warnings,
native ASan/UBSan plus LLVM coverage, complete native/Wasm single/pair parity,
literal pinned TGSI token fields, 8,349 authenticated predecessor results,
17,550 promoted compiler guards, strict inert metadata and copied-bank attacks,
and headed hardware browser runs at three seeds/command schedules. An
independent Python interpreter predicts all clear/written RGBA8 cells from the
literal source and clip-space mesh before GPU observation. Direct draws and
real indexed synchronous/asynchronous consumers execute branches, source words,
modifiers, aliases, native-state poisoning/restoration, selector attacks and
wire ownership, with zero final object/resource budgets. Four actual emitted
source faults (inhibit, invert, x-only and unconditional omission) must fail
the fixed pixel predictions. Receipt generation authenticates full sources,
profiles, tables, screenshots, browser coverage and raw captures at one head.

Run `cold.py --output DIR` once at the final frozen head, then `seal.py --hot
DIR --cold DIR --output evidence/virgl-fragment-discard/worker`. The cold clone
uses a scrubbed environment. A fresh adversarial verifier must challenge the
seal and diff before the task becomes verified. Historical coordinate seals
stay immutable; only their obsolete unsupported discard guard spellings now
use unsupported PRECISE forms. Two sealed historical discard rejections are
explicitly logged as the new admissions; every other result remains identical.

This is a compiler boundary. Full unchanged compositor programs, live device
negotiation, public imports, deployment, FPS and MIPS remain later work.
