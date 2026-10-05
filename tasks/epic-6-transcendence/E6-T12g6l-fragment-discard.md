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


### 2026-10-04 — fresh critic — VERDICT: needs-evidence

VERDICT: needs-evidence. The product claim was not contradicted. The sole gap is
an unreachable added runtime guard that the repository charter requires deleting.
Frozen source `4a1e9a36e33e072a58fd60815b1e6ae8c93460ab`, worker submission
`509b6d3462b06f55e51426d81160a9626628bd88`, base
`cca9a570fe061107ff05e3697b99cfc3566fabe5`. Predictions were written before evidence
inspection (SHA256 `a7a7d66014c7e5396b7dc15581b1945fc610b1dd9bffb4ccf7ecbac4bda87d59`); all five oriented runtime source
digests remained unchanged through the worker's harness repair. The critic made
no implementation edits.

- P1 ordered words — HELD. Both original hot/cold recordings independently match
  literal IEEE decoding and TGSI control execution for 324,480 cells each, including
  all four lanes, modifiers, signed zeros, subnormals, infinities and NaNs. Every
  owned cell is exact. Point: sealed `critic/recording-audit.json#/0/directPixels`
  and `#/1/consumerPixels`, `critic/independent-pixel-predictions.json`.
- P2/P3 versions, masks and surviving authority — HELD. 444 fresh native/Wasm
  singles/pairs with seed `1831565813` exercise aliases, saved/overwritten words,
  initialization masks, dead text, killed-only numeric/address facts and the novel
  killed `-1` versus surviving `-0` join. Missing survivor initialization rejects;
  the surviving version remains `-0`. Point: `critic/independent/report.json#/cases`
  and `critic/novel-gpu/report.json#/acceptance/captures/0`.
- P4 conservative termination/raster banks — HELD. Original profiles execute
  `raw_discard_guaranteed` 14,108 times and `raster_graph` eight times, covering both
  unconditional and statically terminating conditional bank edges. Unknown sign
  knowledge stays nonterminal; negative-zero/NaN survivors keep output obligations.
  Point: `critic/original-profile-audit.json#/0/functions`,
  `critic/recording-audit.json#/0/browserMarkers`.
- P5 policy/domain ownership — HELD. 1,011 original and ten fresh inert metadata
  attacks reject with zero getter invocations; six copied banks and four complete
  compound predecessor metadata restores retain their numerical restrictions.
  Point: worker `hot/consumer.json#/combined`, critic
  `independent/report.json#/forgeries`. Existing own-descriptor behavior is preserved;
  no new requirement about harmless record prototypes is introduced.
- P6 bounds/stage/dead paths — HELD. Wrong-stage discard, malformed operands,
  source masks, depth 17, instruction 769 and mismatched label targets reject;
  depth 16 and instruction 768 accept. Dead text remains initialized/checked.
  Matching leading-zero labels preserve the inherited instruction-label parser.
  Point: `critic/independent/report.json#/cases`,
  `critic/recording-audit.json#/0/markers`.
- P7 physical reflection, selectors and consumers — HELD. Original captures and
  24 fresh headed Metal cases expose actual compile/link/reflection and 864 new
  literal pixels. Missing output/`NONE` is terminal-only; CLEAR and subsequent
  surviving raster-bank draws restore COLOR0. Synchronous/asynchronous consumers
  own poisoned inputs, reject ten scoped faults per path and end with zero budgets
  and live objects. Point: worker `hot/gpu-2654435769/report.json#/acceptance/consumers`,
  `critic/novel-gpu/report.json#/acceptance`.
- P8 fault/test sensitivity — HELD. The original four physically compiled source
  faults each contradict 42 covered cells, first at `(2,1)`. An actual isolated
  C zero-predicate mutation fails native case 442; removing the native C admission
  assertions still fails the independent terminal-liveness oracle. Removing that
  independent assertion still fails its separate checked pair-key oracle. Both
  sabotage binaries and all supplementary profiles are preserved. Point:
  `critic/recording-audit.json#/0/faults`, `critic/sabotage.json#/records`.
- P9 coverage — NEEDS EVIDENCE; dead code. Predicted every changed executable
  path would execute in a valid public run or be deleted. Observed zero hits at
  `renderer/virgl-shader/bridge.c:1045-1046` in both original hot/cold LLVM profiles.
  The entire added guard at `:1043-1047` is unreachable: `register_name` permits
  ranges only for TEMP/CONST (`:151-154`), and `declaration` permits fragment OUT
  only as COLOR at index zero (`:330-342`); its loop at `:363` is the only writer
  of OUT declaration bits. Discard is fragment-only (`:819`). Therefore no admitted
  request can satisfy `declared[OUT][i>0]`. Demand: delete the unreachable guard,
  retain the parser's existing output-domain rejection, carry unchanged HELD results
  forward and submit source-bound proof of the deletion. Point:
  `critic/parser-reachability.json`, `critic/coverage-audit.json`; coverage digest
  `eae1bc82e481ad3f40e971c9ba7abef76cd721685dee41300ffd02678da23564`. Original hot profraw
  `1b41db286acc2ec0e961f3f8e37d9102da20f6422effded3084700fe70ae9bf5`, cold profraw
  `94dcb454a56a92aec6408951ae9dc72f08836dd5bbc74787384337d5ebe9e273`, merged profdata
  `d5993ff58cad388fd2bfa42db9dfb4cc364809a66835c850c16f3421b5883b9b`.

All 150 worker members, 431 hot/411 cold source bindings, both receipts and original
sanitizer binaries/profiles authenticate. Re-merging and exporting each original
profile with its preserved original binary reproduces the recorded coverage exactly;
both original sanitizer fixtures replay byte-for-byte with zero diagnostics.
The changed-line audit records 120 executing lines, twenty individually justified
nonbehavior waivers and only the two dead statements plus their closing guard line.
The new raw-opcode labels are exhaustive enum cases without an executable body:
`raw_record` already handles control opcodes before the per-destination switch.
Types, static assertions, signatures and documentation have individual waivers.
No other runtime behavior is waived. The 532-member predecessor critic seal
also authenticates; 8,347 complete legacy results carry unchanged, excluding the two
explicit new discard admissions. The original `c580` and `92cb` bodies remain gated.
The authenticated pristine proof holds for the frozen source; it is not relabeled
for a future head. Point: `critic/authentication.json`, `critic/carry-forward.json`.

The 6,336 Mesa primary special-value cells per original run are explicitly qualified,
as allowed by [ESSL3.00 sections 4.5.1/8.3](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf);
finite-normal/zero primary cells and all outside pixels remain exact. The critic
checked literal source/geometry, not an inverse, emitted-GLSL or captured-pixel oracle.
No production negotiation, public import, guest execution, deployment, FPS or MIPS
claim is added.

Commands: independent original `xcrun llvm-profdata merge` and `llvm-cov export`;
`python3 /tmp/e6-t12g6l-critic/audit-recordings.py`;
`python3 /tmp/e6-t12g6l-critic/coverage-audit.py`;
`node /tmp/e6-t12g6l-critic/independent-guards.mjs`;
`node /tmp/e6-t12g6l-critic/independent-gpu.mjs`;
isolated `build.sh discard-sanitize` and the three recorded sabotage gate runs.
Scripts, inputs, results, native replays, original/supplementary profiles, actual
sabotage binaries, pre-observation predictions, novel GPU raw cells and screenshot
are preserved in `evidence/virgl-fragment-discard/verifier/`.
69 critic archive members authenticate. Manifest SHA256
`21ce3644f99d69b8c4c7bc2518e395baebc45adc129699c508e7842d12d8c6cd`;
archive SHA256 `65a9e6775bf946e20fda667e6e83daa04aefdd0c0e19549860b32f4a4603bc60`;
index SHA256 `9cbc5263cc7fa006fe303deb4e952494311d6048eae45bd0fc682d3d94f941d9`;
verdict SHA256 `a83cb7e2f428d1fff53d6682c319742a41f4bad112283bbd8d9fc6bf9b926983`.

SUITE: defer promotion until the sole coverage gap is cleared. The independently
verified oracle/guards and physical/version fixtures are retained as bounded
promotion candidates. Status is `evidence-needed`; no dependent may activate.

### 2026-10-04 — worker — removing the sole dead guard

The fresh critic returned custody at `23717bf47d75a64ba2db39f41fb8089c5eafa6ff`.
Root independently authenticated all 69 critic members, its predictions/verdict,
the immutable worker manifest, unchanged runtime and all 4,202 historical untracked
paths (`/tmp/wasm-vm-discard-root-critic-authentication.json`). P1–P8, N1 and
the scoped predecessor checks are HELD; no semantic contradiction was found.

Remove exactly the unreachable five-line fragment extra-output guard at frozen
`bridge.c:1043-1047`. The existing declaration parser already excludes every
fragment OUT above zero. No syntax, initialization, stage or numerical rule is
widened. Keep both original seals immutable, record corrected-source hot/cold
receipts separately, and return to the critic for incremental coverage review.

### 2026-10-04 — worker — revised proof submitted

Frozen corrected head: `e7137ce55e714c4a5759175529a82cc056a6d097`.
Its runtime diff from the initial frozen head is exactly five deleted lines in
`bridge.c`; all other runtime and harness bytes are unchanged. The unreachable
extra-output guard is removed. Existing fragment declaration rejection, surviving
initialization, numerical ownership and reflection restrictions remain intact.
P1–P8, N1 and scoped predecessor HELD results carry forward unchanged.

```sh
VIRGL_DISCARD_EVIDENCE_DIR=target/evidence/virgl-fragment-discard-revised make verify-E6-T12g6l
python3 tools/virgl-fragment-discard/cold.py --output target/evidence/virgl-fragment-discard-cold-revised
python3 tools/virgl-fragment-discard/seal.py --hot target/evidence/virgl-fragment-discard-revised --cold target/evidence/virgl-fragment-discard-cold-revised --output evidence/virgl-fragment-discard/worker/revision-2
```

Both corrected-source runs passed: 2,007 native/Wasm singles and pairs, 1,975
pinned primary comparisons, 1,011 inert metadata attacks, six banks, four compound
obligations, 8,349 predecessor cases with the two explicit extensions, promoted
guards and 324,480 physical cells per run. The three schedules and four actual
source-fault recordings pass their independent literal oracle/sensitivity gates.
The same 6,336 primary special-value cells remain explicitly qualified; owned
emission stays exact for every word class. Console/page/request errors, leaked GPU
objects and budgets are zero. The new pristine clone records the corrected
detached head and empty tracked status before/after. This is new proof, not an
old receipt relabeled for the deletion. No production or performance claim changes.

The separate revised seal contains 148 authenticated members, including both
original corrected sanitizer binaries/profiles. Initial worker and critic seals
remain byte-identical. Root authenticated every revised member, receipt, pristine
report and source binding with `/tmp/authenticate-discard-worker-revision-2.py`;
result `/tmp/wasm-vm-discard-root-worker-revision-2-authentication.json`.
Evidence: `evidence/virgl-fragment-discard/worker/revision-2/`.

SHA-256:
- manifest: `a7e58892ccf37211ac6c2b14b02a5fee08850aec4e560c929fa10bdcd0233439`
- archive: `50136a98be6a8e559f69a783eb96bae859ff5afb60765c07da77177d5e49107e`
- index: `02958d5e896190be2704d42a8f58cc7fc00e5dfc5bd2e5259b97d1822bb70883`
- hot receipt: `c3538b29013db7b55289b585c85c134da8f450799a0714bcdf1bdcc40956272c`
- cold report: `26d27585df1c594e7b0eae6448c64367bc5adbfd6ffca288998b57c57013f976`
- cold receipt: `609ef3929ade036a98aef94485ef760172cf3c2994692a27ecc0b0471cf2b07c`

Status: implemented pending the critic's incremental P9/source-custody verdict.
PR #456 remains draft, open and unmerged.
