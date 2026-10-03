---
id: E6-T12e8
epic: 6
title: Admit proven-bounded TGSI indirect constant access
priority: 525.0269908
status: implemented
depends_on: [E6-T12e7]
estimate: S
risk: high
capstone: false
---

## Boundary

Admit the inventoried ADDR[0].x, UARL and CONST[ADDR[0].x] forms. Preserve exact
TGSI unsigned address interpretation and constant-bank identity. Every admitted
address must have a proved bound, either established statically or validated
against the immutable uniform data used by the same draw. A static token count
does not establish an address bound. Do not clamp, wrap, substitute zero, or
silently drop an out-of-profile access. Reject unsupported address forms before
GPU dispatch. Keep loops and PRECISE rejected.

Bind the complete proved dynamic address set and its finite numeric domain to
the same immutable draw snapshot. Address validity is independent of numerical
validity. Missing guest words, zero defaults, index clamping, or checking only
one observed index cannot establish this proof.

## Deterministic acceptance

`make verify-E6-T12e8` records native/Wasm parity and hardware pixel/bit oracles
selecting distinct first, interior and last constant entries. Include negative
admission cases and, if draw-time constraints are used, evidence that validation
and dispatch bind the same uniform bytes/generation across updates. Preserve
12/19 original outcomes; all PRECISE originals remain rejected. Record exact-head
and final pristine-clone proof.

## Adversarial verification

Attack an unwritten ADDR lane, first/last/one-past indices, UINT32 boundary values,
undeclared ranges, wrong constant buffers and mutable-uniform TOCTOU. Any invalid
access must fail before dispatch, with no partly changed draw state. Sabotage the
address bound or uniform-generation check and require rejection/oracle failure.

## Execution notes

Start from independently verified dependency
`d3a57934cab34e62a274996c0a5559ed8db52645`. This S/high boundary combines the
compiler's complete address-set proof with the shared renderer's immutable bank
obligation: neither half alone authorizes a safe indirect read.

Admit one scalar ADDR[0].x and raw integer UARL. Use existing known-zero/known-one
facts to establish a complete conservative set at each indirect source use;
require the unsigned maximum below 46, nonconflicting facts, every possible index
declared, and every consumed component available. Carry address initialization
and facts through both structured predecessors. Unknown or stale bounds remain
rejections; no predicate correlation, generic runtime expression evaluator,
loops or PRECISE is added. The address profile requires an actual indirect read;
bare unused address-register forms may remain outside this bounded profile.

Closed profiles raw-bits-v10/v11 require exactly one `constantAccesses` record of
kind `constant-bank-static-indirect-v1`, with stage, slot0, bank name, declared
count and sorted unique union of all possible indices. Version11 also requires
the existing finite-binary32 constant-domain record; version10 forbids that
numeric contract. Older profiles forbid the new access record. Preserve old
successful compiler results and explicitly inventory any newly admitted negative
fixture or changed unknown-profile diagnostic in successor proof adapters.

For either new profile, require the complete `min(count,46)` vec4 bank prefix
before draw allocation or dispatch, own its immutable words, and ensure reflected
uploads cover every proved index. Version11 validates that same full prefix as
finite. The existing array-identity draw-plan check binds validation to uploaded
bytes; replacing the bank between draws must invalidate any prior approval.
Missing words, index clamping and default zero values cannot satisfy this proof.
A declared extent47 does not authorize guest index46.

Keep instruction/source/output bounds, <=32KiB IR, <=8KiB profile, <=53,248-byte
flow arena, and fixed16MiB Wasm memory/256KiB stack. Any minimal scalar address
state growth must be measured explicitly rather than claiming old layout parity.
Use independent first/interior/last word and pixel oracles, actual compiled source
faults, repeated async schedules, recorded native/Wasm recovery, final exact-source
pristine clone and a fresh adversarial verifier. Production negotiation stays off.

The captured loop bodies remain original-byte rejections. Read-only analysis of
their signed-ISGE count/unsigned address recurrence suggests raw CONST9.x in1..18
as a sufficient later loop domain; that is planning context, not E8 admission or
proof. Primary UARL semantics are described by Mesa's TGSI specification:
<https://docs.mesa3d.org/gallium/tgsi.html#opcode-UARL>.

## Verification log

### 2026-10-03 — worker — implemented

Frozen implementation and harness: `b4ee940d78f651553c2b900be95f8b083085cdf9`,
from verified predecessor `d3a57934cab34e62a274996c0a5559ed8db52645`.
All runtime and acceptance sources were committed before recording. No guest GPU
negotiation, original shader body, loop or PRECISE admission changed.

Commands:

- `python3 tools/check_task_policy.py`; `git diff --check`.
- `VIRGL_INDIRECT_CONSTANTS_EVIDENCE_DIR=evidence/virgl-indirect-constants/worker EMCC=/tmp/wasm-vm-emsdk/wasm-vm-emcc make verify-E6-T12e8`.
- `python3 tools/virgl-indirect-constants/cold.py --output evidence/virgl-indirect-constants/cold-clone`.

The selected high-risk C/JS gauntlet records source guard, strict owned C build,
ASan/UBSan native execution, actual fixed-memory Wasm, typed consumer/profile
checks, hardware sync/async draws, real isolated compiler source faults and the
unchanged earlier shader/renderer oracles through explicit successor adapters.
No historical complete gate is synthesized or relabeled. This isolated renderer
is not imported by the demo; the production negotiation boundary stays disabled.
No Rust or demo deployment source changed, so unrelated workspace/build/deploy
walls are outside this claim.

Native evidence records 603,728 calls: 3,814 single stages and 252 pairs, including
all 3,466/236 preceding complete results unchanged and all 19 original captured
bodies at their original hashes (12 accepted, seven PRECISE rejections). It also
records 4,579 truncations over ten named new/boundary inputs, 324 hostile cases,
4,096 mutations across four seeds, 26 actual allocation failures and complete
24-stage/22-pair recovery anchors. This successor deliberately scopes truncation
to the changed address/parser boundary; it does not claim to repeat the entire
historical character-truncation workload. Measured IR/profile/flow sizes are
26,256/7,616/52,612 bytes, below 32,768/8,192/53,248 caps. All new executable C lines
ran except the exhaustive UARL switch arm already bypassed by its earlier return.

Actual Wasm evidence records 21,165 calls, all 3,814/252 full native results,
8,856 stage and 8,118 pair recoveries, 64 maximum-text/instruction stresses and
33 real allocation-pressure attempts. Memory stayed at 16 MiB with stable buffer
identity and the 256 KiB configured stack. Consumer proof independently checks
206 metadata cases, 290 bank cases and three ownership sequences with no getter
execution; the retained 50 profile cases inventory only four newly recognized
v10 missing-access diagnostics.

Actual Apple M4 Max Metal GPU evidence records 31 positive draws, 1,216 words and
126,976 pixels with zero mismatches. Two async schedules account for 60 completion
fences and 90 withheld polls; ten short/current-bank failures precede any draw
work. The separate negative-only decoder bypass rejects six invalid draws and
proves five clean recovery draws. Literal first/interior/last addresses, raw
swizzles, reassignment, structured joins and finite numeric use all execute.
The real compiled in-bounds XOR-index fault produces 48 wrong addressed words
while orientation remains intact. The separate removed-bound compiler fault
wrongly admits both unknown-AND46 witnesses under native/Wasm; those invalid
shaders are never GPU-dispatched. Earlier shader, compiler-domain, command,
resource, state, draw, async and constant consumer leaves all pass their original
independent oracles. Browser console/page/request error lists are empty.

Before freezing, the fresh reviewer found proof-only numeric-type aliases in
consumer coverage and native maximum counters. The receipt guards now distinguish
JSON integers, booleans and floats; independent clean/corrupt controls reject
those alterations. No runtime semantic repair was needed.

The final pristine clone began and ended clean, removed inherited build/Node/
Python/compiler overrides, ran the complete acceptance once at the frozen head,
and passed. It is preserved at:
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-indirect-constants-cold-bzr7uqca/wasm-vm`.
Its 152 recorded acceptance files bind 379 source identities and 150 receipt
records. The worker and cold recordings both correspond to this exact source.

Evidence and SHA-256:

- `evidence/virgl-indirect-constants/worker/receipt.json`: `1228079b139a3c0d8c1aff48acfdfbbf20bb0e3e1c1fb8885807a6dd3d8b0219`.
- `evidence/virgl-indirect-constants/cold-clone/report.json`: `1d0cb600febe8f18aab8410ea2ceeb5e341b1ca0fb46dc33aae741ba9b8f19d3`.
- `evidence/virgl-indirect-constants/cold-clone/acceptance/receipt.json`: `b8aba573e74f650d1737c4fabc15ffa10922615348bc451c95be71b2bfd96946`.
- `evidence/virgl-indirect-constants/cold-clone/acceptance/native/native-report.json`: `427b1669b9bcd43f5eb948df33d1302209c6bb9add5109515d444d20ef9e8f3c`.
- `evidence/virgl-indirect-constants/cold-clone/acceptance/wasm/report.json`: `00da84221caa63f7ce0cc9b9238f2988b4636c386672f2a00c9fe18fb3b81ca9`.
- Hardware screenshot: `evidence/virgl-indirect-constants/cold-clone/acceptance/hardware/browser.png`, SHA-256 `12b3e2c1c0425e83dac5fc46f2e25ca5bb48192fbfdf58f05f2328a7f78ab5db`.

Claim: the bounded indirect profile proves every possible consumed constant index
and binds the complete current immutable bank to the same draw, without address
clamping, missing-word zeros or numeric authority borrowed from another bank.
Original outcomes and prior successful complete results remain exact. This is an
isolated compiler/shared-renderer result, not live Mesa, guest desktop graphics,
300-MIPS throughput or an FPS improvement. Fresh adversarial verdict pending.

