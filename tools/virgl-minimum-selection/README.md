# Minimum selection evidence — E6-T12g6g1

`make verify-E6-T12g6g1` records the scoped private compiler/consumer boundary.
Pinned TGSI `renderer/virgl-shader/tests/mesa-24.2.8-tgsi.rst:213` defines
component-wise minimum. The untouched pinned converter emits GLSL `min` at
`vendor/src/vrend/vrend_shader.c:5601`. Native witnesses preserve actual typed
MIN tokens and each instruction's PRECISE flag.

Ordinary MIN keeps the existing finite numeric authority and GLSL zero-sign
allowance. MIN_PRECISE uses the existing private MAX selection model in the
opposite strict direction: the first original word wins only when ordered
strictly smaller; ties, both signed zeros and unordered comparisons retain the
second original word. JS and Python binary32 decoding/comparison predict words
independently of the IR's unsigned ordering keys and emitted GLSL. Private
NaN payloads, subnormals and all remaining bits are never float-converted by
the selector. Numeric/output authority is still governed separately.

Native sanitizer recordings contain 961 predetermined public cases and 913
actual pinned parser/converter witnesses. Wasm singles/pairs must match every
native result. All 15 destination masks, both source negations, swizzles,
aliases, joins, saved/killed versions and malformed modifiers are exercised.
Three physical Apple GPU seeds capture all 32 result bits using finite carrier
words and bit-plane pixels. Ordinary primary comparisons are restricted to
normal/zero inputs and have their existing mathematical zero-sign allowance;
owned precise results have one exact encoding. Mesa GLSL is never rewritten.

Four real indexed-draw rigs execute F2I/I2F/TRUNC/MIN/MIN_PRECISE/SSG/F2I.
Source equations predict pixels from whether the original converted value is
negative. Both stages and sync/async consumers prove owned A/B/A bank changes,
reflection pruning, exact component/range obligations, restoration and held
index waits before upload/read/draw. All objects/resource budgets end at zero.
Whole preceding wrapper contracts and 84 original precision cases remain
intact; four formerly rejected ADD/MUL cases use the prior verified arithmetic
migration ledger, and two MOV-only upstream pass shaders explicitly transition
to the owned raw-v1 backend when a minimum marker is added.

The source-selection fault swaps the actual unsigned helper's operand order
and must contradict physical word predictions. LLVM counts bind actual native
binaries and profiles. `receipt.py` recomputes each captured word, plane and
indexed pixel from source inputs, validates the complete declared schedule,
old guards, hostile metadata and every source digest. Run `cold.py --output
<directory>` once at the final frozen head, then `seal.py --hot <directory>
--cold <directory> --output evidence/virgl-minimum-selection/worker`.
Production negotiation, guest execution and FPS/MIPS claims remain disabled.
