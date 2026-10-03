---
id: E6-T12e4c2
epic: 6
title: Preserve ordinary numeric shader chains with bounded float shadows
priority: 525.026990432
status: verified
depends_on: [E6-T12e4c1]
estimate: S
risk: high
capstone: false
---

## Boundary

Admit existing ADD/MUL/MAD and fragment 2D FLOAT TEX in owned raw-lane programs
with explicit per-lane ordinary float provenance and bounded float shadows.
Snapshot numeric RHS values and their captured raw representations before writes.
Numeric consumers and final float outputs use an authorized original float input
or computed/sample shadow directly. Integer consumers retain raw word semantics;
integer writes invalidate float authority. MOV and UCMP must preserve the correct
views under partial/swizzled aliases. Broader float-origin joins belong only to
the new mixed profile; earlier profiles retain exact outputs and rejections.

Raw numeric inputs need a stated, enforced domain proof at each use, including
dynamic values. Arbitrary raw CONST/TEMP words are not ordinary float authority.
Do not assume standalone shader calls inherit the guest constant decoder's
finite-value check, which also admits subnormals. Keep unknown raw numeric
constants rejected unless this task explicitly adds and proves an enforceable
runtime-domain boundary; otherwise record that limitation before Mesa activation.

Genuine floating computations retain the documented ordinary float contract:
no raw NaN-payload, signed-zero, subnormal or PRECISE preservation promise after
numeric computation. Do not replace undefined numeric behavior with an invented
exact result. Sample TEX once per instruction and publish truthful owned sampler
metadata. Preserve existing float interfaces, raw output safety and finite memory,
text, instruction, register and generated-output bounds. No new numeric opcode,
conversion opcode, modifier, control flow or PRECISE support.

## Deterministic acceptance

`make verify-E6-T12e4c2` records native sanitizer/Wasm parity and actual hardware
numeric and raw consumers. Prove real TEX-to-MUL-to-ADD/MAD-to-output chains with
safe inputs, the same captured lane consumed as integer and float, MOV/UCMP
shadow propagation, invalidation, partial writes, aliases, dynamic operands,
sampler validation and mixed-backend interfaces. Exact small dyadic values and
texture endpoints provide independent finite oracles; non-exact MAD tests use
only justified permitted outcomes. Keep raw comparison tests exact across all
encodings. Preserve unaffected prior gates and all 19 original outcomes. Record
source coverage, fixed-memory failure/recovery, exact-head and pristine-clone
evidence. Production stays off.

## Adversarial verification

Attack stale shadows, lost all-ones masks, aliasing across source and destination,
selected/unselected arm initialization, differing float origins, one authorized
arm mixed with unknown raw data, unsafe dynamic raw inputs, output safety and
sampler metadata. Corrupt shadow propagation or numeric interpretation and
require a real independent hardware mismatch. Audit captured instruction-time
facts rather than trusting final register state. Every changed executable path
needs evidence; arbitrary raw constant admission and PRECISE are not inferred.

## Preparation notes

The seven remaining unsupported original bodies all use direct numeric CONST
operands (8,3,12,7,15,11,10 uses in the current corpus inventory). This task keeps
unknown raw numeric constants rejected. Before Mesa activation, a separate
bounded boundary must either bind compiler-declared constant-domain requirements
to synchronous/asynchronous draw-time validation or prove a sound full-domain
numeric lowering. The current finite guest decoder does not confer standalone
shader authority and admits subnormals. This task makes no compatibility claim
for those remaining originals.

Ordinary MAD tests must permit the GLSL ES3.00 range/precision rules, including
higher internal precision. Use exact dyadic chains for the primary arithmetic
proof. An isolated non-exact witness may use a derived rational error enclosure,
not only the two results from fused/separate round-to-nearest binary32.

## Verification log

### 2026-10-03 — worker — implemented ordinary numeric shadows

Frozen implementation/proof head: `1ce9b75b182b5411aee9922f329dc898e2a28b4e`.
The v4 compiler snapshots ordinary ADD/MUL/MAD/TEX values and their captured u32
representations before aliased/partial publication. MOV/UCMP preserve authorized
views, integer writes invalidate authority, unknown raw numeric inputs reject,
and used sampler metadata matches one logical emitted sample per TEX. This is
an isolated compiler proof: guest constant transport and production negotiation
remain unchanged, all 19 original bodies retain their 12 accepted/7 rejected
outcomes, and no Mesa or desktop-performance claim is made.

Commands on the frozen head:

```sh
VIRGL_NUMERIC_FLOATS_EVIDENCE_DIR=evidence/virgl-numeric-floats/worker make verify-E6-T12e4c2
python3 tools/virgl-numeric-floats/cold.py --output evidence/virgl-numeric-floats/cold-clone
```

The recorded sanitizer run checks 1,509 cases and 125 pairs in 219,699 calls,
including 5,626 truncations, 324 hostile cases and 4,096 mutations across four
fixed seeds, followed by 115,550 standalone and 92,440 mixed-pair exact recovery
conversions. Native/Wasm full result parity and the complete unchanged ordered,
integer, raw, bank, constant and renderer regression checks pass. Existing fixed
IR/output/Wasm bounds remain; allocation-pressure runs reach structured failures
and restore exact output and capacity. The LLVM record includes both changed C
sources; interpretation of hunk/branch sufficiency belongs to the fresh verifier.

Actual ANGLE/Metal GPU recordings independently reconstruct 352 complete words
through vertex feedback and fragment bitplanes. Forty-eight draws consume both
raw and numeric forms; four texture frames check 4,096 pixels, 26 interface draws
check 25,792 non-edge pixels, and actual UBO writes exercise both orientation
signs. Exact rational dyadics and texture endpoints are the numeric oracles;
no non-exact MAD or exceptional-payload promise is inferred. Stale shadow,
incorrect numeric decode and exchanged sampler source mutations each compile,
link and cause an independently predicted actual GPU mismatch. Every run releases
all GL objects and records zero console/page/request errors. The worker inspected
`worker/hardware/browser.png`; the whole independent browser/native receipt also
revalidates retained recorded data instead of trusting printed pass status.

Worker evidence under `evidence/virgl-numeric-floats/worker/` (SHA-256):

- `receipt.json`: `612453552ec1c95798dcbc4e179a82725d44e577ad2054d752cdf59de8fa0a3b`.
- `native/native-report.json`: `86e1e501016a4b1ad59f4b99ee9587cf57d9f170347b7d0719d412102fcac4e7`.
- `hardware/report.json`: `6030241cb71e6abd68886f93a10b0fbb6036e2dc2664ea12460d9f123e5eb946`.
- `sabotage-stale-shadow/report.json`: `10a55bace05fd41cf7b6ea13ad4792419fb7d22f5117101de3fe552a08377fe9`.
- `sabotage-numeric-decode/report.json`: `18b5a06d84c7ba8bf79fb153570fff16bc218fd9b3772d1f8cf078ca60e16c0d`.
- `sabotage-sampler-index/report.json`: `fa4076859980e1fd00dc6522ff6b259f7218c3a7fa72671555450ed619a3db91`.
- `hardware/browser.png`: `083d7e8502d859b2cfa12aa2fad7aa2fa00dc90744751648e47c2636a65cb319`.

The receipt binds 236 source files and 142 recorded artifacts. Native sanitizer
binary SHA-256 is `4bc86b7e8e68f818ed51e04847cce9d449841ec73011957d8c016bc9ccdf8ae7`;
Wasm SHA-256 is `eefc0899be746bdbb246285e9c8bfe8c802d29e0480bf052be9790c78631c02d`.

The final pristine-clone acceptance passed on the same frozen head with a clean
checkout before and after. Build/runtime overrides were scrubbed by the recorded
cold harness. All 151 copied files and 142 receipt records were rehashed. The
retained clone is
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-numeric-floats-cold-nv_gxqs6/wasm-vm`.
Cold evidence under `evidence/virgl-numeric-floats/cold-clone/` (SHA-256):

- `report.json`: `2bbdfa7bdbc25ed352ec6e60d91618351f16bb73ceb2c614703fe2290367cd78`.
- `acceptance/receipt.json`: `a9659c5279ddb8c8d75372acff27e51bdd77540570a96047086fdf3ab5fd86fa`.
- `acceptance/native/native-report.json`: `4724df18e9fbfbc04b52d79efa9bf3a67c8d400bcc6d81eb1913d7d2a3ce2804`.
- `acceptance/hardware/report.json`: `e99a4d9d32a718c487a4d3c658811b63bc19ec08fe9799ce92d087e15f7efc0b`.
- `cold.log`: `c032cd95632b5af5cdfb9fd348cf6127ac8b708754d69192b7d28f3f5a04a35d`.

The cold Wasm digest equals the worker digest above. The path-dependent debug
sanitizer binary has its own recorded SHA-256:
`5db4f1763bed04759b1b2c17a11be65ea439e5eac6babbbcc0c7caa306c24368`.
Browser-impacting demo gates do not apply to this isolated compiler fixture path:
production negotiation remains off and the deployable demo sources are unchanged.
This worker submission does not set `verified`; the fresh critic owns that verdict.


### 2026-10-03 — verifier — VERDICT: verified

Fresh verifier predictions preceded evidence inspection. All 18 held against
frozen head `1ce9b75b182b5411aee9922f329dc898e2a28b4e` and worker submission
`752b4f677b7c3266080d5924cca780d9bde81468`; no runtime/harness fix was made.
Full verdict: `evidence/virgl-numeric-floats/verifier/VERIFICATION.md`, SHA-256
`0fc328a6fb05b390321470e422499d5048ae0353c86f3945a72744846769f383`.
Verifier manifest: `evidence/virgl-numeric-floats/verifier/manifest.json`, SHA-256
`172b96116ece1f9b8a3784da86da5be139afec423cd17d8b34a2d0f78f31d5a6`.

- HELD — Independent sanitized native/Wasm matrix: 2,024 programs, 4,048 exact
  recoveries and 1,178 parent full-result comparisons, including all 19 originals.
  Future authority, unknown raw domains, selected/unselected arms, partial
  invalidation and sampler attacks have precise transcript citations in
  `verifier/native-citations.json`.
- HELD — Five-seed independent state attack: 74,110 admitted instructions,
  18,050 rejection-without-mutation checks, 23,715,200 concrete fact checks,
  889,320 instruction-time mode checks and 3,051,568 origin/shadow checks.
- HELD — Independent hardware probes reconstruct 512 numeric/raw words through
  aliased dyadic arithmetic and two texture samplers. A separate rational TGSI
  interpreter reproduces 9,152 worker output-word assertions, all 4,096 texture
  pixels and all 25,792 nonedge interface pixels. Four source-bound semantic
  controls fail on actual GPU observations; the novel shadow-copy fault changes
  numeric x from `0x3f400000` to `0x3e400000`.
- HELD — All 155 changed executable C lines and both outcomes of all 111 changed
  conditional regions are recorded. Headers/config/comments have narrow direct
  inspection/compilation waivers; there is no new runtime proof gap.
- HELD — 40,028 independent binding assertions verify worker/cold sources,
  native streams, complete prior results, 9,522 nested source bindings, all 151
  copied cold files and all twelve worker-claim evidence digests. The retained
  exact-head clone is clean and its Wasm equals the worker module. Both hardware
  screenshots were inspected. Production remains off; unknown raw numeric
  constants, the seven rejected originals, PRECISE and Mesa remain gated.

Commands: verifier `native_audit.py`, `run_knowledge.py`, clean and sabotaged
`run_browser.mjs`, `coverage_audit.py`, `worker_semantics.py`,
`controls_audit.py`, and `binding-audit.py --frozen 1ce9b75b182b5411aee9922f329dc898e2a28b4e`.
SUITE: preserve the worker acceptance plus independent state, TGSI, GPU/control
and binding audit sources/records. Rebuildable native executables/debug bundles
are not promoted. No remaining finding or evidence demand within this boundary.
