---
id: E6-T12g6l
epic: 6
title: Admit fragment discard with sound branch liveness
priority: 525.027010581
status: implemented
depends_on: [E6-T12g6k]
estimate: S
risk: high
capstone: false
---

## Boundary

Add fragment-only KILL/KILL_IF preserving ordered numeric comparison and each source lane/modifier. A discarded predecessor cannot grant initialization or numeric authority to a surviving predecessor. Vertex stage remains rejected; inherited structured depth/targets stay bounded.

Production GPU negotiation, live demo imports and caps remain disabled. No FPS
or MIPS claim follows from this isolated compiler boundary.

## Deterministic acceptance

`make verify-E6-T12g6l`: Literal clear-versus-written actual framebuffer cells for unconditional/conditional kills, both branch outcomes, zero signs and source vectors; source modifiers and aliases. Attack missing output initialization at survivor joins, dead paths, stage misuse, depth/label bounds and inhibited/inverted discard faults. Native sanitizer/wasm and physical GPU recordings required.

Use the narrow affected compiler/consumer gates, record final exact-source native,
wasm and physical hardware proof, numerical source-fault sensitivity, varied
seeds and one pristine clone. Preserve unchanged HELD results. Submit to a fresh
independent critic before any dependent activates.

## Adversarial verification

Predict each stated semantic/domain result before inspecting. Attack signedness,
source and destination versions, liveness, domain ownership/metadata, masks,
boundaries and actual hardware reflection. Run every scoped acceptance angle,
one bounded novel attack and test sabotage; no mock/inverse/self-derived pixel
oracle. Each finding names a report/trace point and digest. Unexecuted runtime
hunks need evidence or deletion; unsupported original paths stay gated.

## Verification log

### 2026-10-04 — worker — started

Continuing the user's guest-graphics-offload request with the next eligible graphics
boundary. The prerequisite E6-T12g6k is independently verified at
`cca9a570fe061107ff05e3697b99cfc3566fabe5`; its 532-member critic seal was
independently authenticated before this task started. Unrelated desktop publication
in the global queue is outside this graphics continuation.

Risk: high (compiler semantics and asynchronous GPU consumer). Scope the gauntlet
to the affected C/JS compiler, strict owned policies, native sanitizer, Wasm parity,
retained original bodies and promoted guards, literal source-level discard/geometry
predictions, actual headed Metal captures, varied seeds/schedules, source-fault
sensitivity, a final scrubbed pristine clone and a fresh adversarial critic. No
runtime evidence from the coordinate leaf is relabeled as discard proof.

The source-word predicate must preserve ordered binary32 comparison: both zeros
and all NaNs are nonnegative for KILL_IF; negative finite values and negative
infinity discard. Static termination is conservative and adds no initialization,
output, numeric or address authority. All existing parser, flow and bank bounds
remain in force, including dead text. Terminal all-discard programs omit output
reads; any reflection exception requires their checked terminal policy.

### 2026-10-04 — worker — implemented; independent review pending

Frozen recording head: `4a1e9a36e33e072a58fd60815b1e6ae8c93460ab`, based on
`cca9a570fe061107ff05e3697b99cfc3566fabe5`. Runtime implementation is
`02e1181718e7ba5108239efdcc61965b23174020`; the later commits add conditional
discard/raster-bank fixtures and freeze all three generated reference tables before
browser collection. The five runtime files are unchanged after `02e11817`.

Exact final commands:

```sh
VIRGL_DISCARD_EVIDENCE_DIR=target/evidence/virgl-fragment-discard-final make verify-E6-T12g6l
python3 tools/virgl-fragment-discard/cold.py --output target/evidence/virgl-fragment-discard-cold-final
python3 tools/virgl-fragment-discard/seal.py --hot target/evidence/virgl-fragment-discard-final --cold target/evidence/virgl-fragment-discard-cold-final --output evidence/virgl-fragment-discard/worker
```

Both hot and scrubbed pristine-clone acceptance passed at the frozen head. The
cold report records empty tracked status before/after and the exact detached
clone head. The gate records strict C/JS syntax, ASan/UBSan and LLVM profiles,
2,007 complete native/Wasm single and paired results, 1,975 pinned Mesa token/source
comparisons, 1,011 inert metadata attacks, six inherited owned banks and four
compound predecessor obligations. The authenticated predecessor replay preserves
8,347 results byte-for-byte; its two archived unsupported KILL/KILL_IF cases are
explicit new admissions. Promoted predecessor guards pass. Literal original
bodies remain 23/25 admitted: the larger `c580` and `92cb` originals stay gated.

The recording demonstrates fragment-only ordered any-negative comparison over
all four post-swizzle/modifier raw words, including both zeros, subnormals,
infinities and NaNs; copied/aliased and overwritten versions; conservative static
termination; surviving branch initialization/domain joins; guarded raster-bank
joins with both KILL and statically terminating KILL_IF; and retained parser,
instruction, nesting and label limits. Checked v39 policies recursively preserve
every predecessor obligation. No discarded predecessor creates numeric, address
or initialization authority for a survivor. A missing fragment output location
and draw-buffer NONE are accepted only for a checked all-discard program, with
framebuffer readback and state restoration exercised.

Headed Chrome on this machine's Metal GPU checks 324,480 physical framebuffer
cells per acceptance: 201,600 direct cells and 122,880 indexed consumer cells,
across seeds `2654435769`, `608135816`, `2242054355` and command budgets `1,3,3`.
Each seed includes 640 direct probes and twenty indexed captures in each of the
synchronous/asynchronous paths, with ten atomic rejection checks per path. Owned
emission is checked exactly for every raw-word class. The 6,336 Mesa primary
special-value cells are explicitly qualified because ESSL bitcasts/denormals do
not give a portable NaN/infinity/subnormal oracle; finite-normal/zero Mesa cells
remain exact, every raw capture is retained, and qualified cells still obey the
clear/written and viewport constraints. Predictions come from literal TGSI,
source geometry and uniform words, not emitted GLSL or observed pixels. Four
actual emitted-source faults (`inhibit`, `invert`, `x-only`, `unconditional`)
contradict those predictions at recorded coordinates. Browser console, page and
request errors are zero; final tracked GPU objects and budgets are zero.

An earlier hot run at `e07aed8a` passed product checks but its collector rejected
a generated-reference source digest: a later seed's file was regenerated after
an earlier capture had bound it. Commit `4a1e9a36` fixes only reference generation
order. The failed log is retained as `hot/diagnostics/e07aed8a-source-binding-failure.log`
in the seal, is not final proof, and the complete final hot/cold runs were recorded
again after that repair. No recording or profile was relabeled.

Evidence: `evidence/virgl-fragment-discard/worker/{manifest.json,records.json,recording.tar.gz}`.
The index authenticates all 150 members, including hot/cold acceptance reports,
actual sanitizer binaries and profiles, literal reference tables, raw GPU captures,
screenshots, browser/V8 coverage and diagnostic history. Root separately checked
every archive member, both receipts, the pristine report and all source bindings
with `/tmp/authenticate-discard-worker-seal.py`; its result is
`/tmp/wasm-vm-discard-root-worker-authentication.json`.

SHA-256:
- manifest: `daf510538b80e3da376a7d003457657f6266ce07a6b23fcac638733efbbcd31a`
- archive: `dcd4019e8fc1b9a03bdd6e7471b758ae47a61a1d1a38ee3e8409e8fd826ea0bf`
- index: `a7614d8db95e013dd72d431788cf82e6626d6465024bac1eae08018148475730`
- hot receipt: `d1a11337fe5906d28329fdbf4b28b7211a2cfa249d1739a0bfd3143c80a46fd9`
- cold report: `4c2b9fb2c06a19733124ae3a75714d18bc3f285f231bc1f3a2ecbd54d1d389de`
- cold receipt: `91850912b62da1f23f90630ca219265433c6b1b19b25f4c633d99b469501973d`

The fresh critic has prepared predictions before opening evidence. Status is
implemented pending its adversarial review. This is a private compiler/consumer
boundary; production GPU negotiation, guest execution and public imports/caps
remain disabled. This run supports no deployment, FPS or MIPS claim.
