---
id: E6-T11d69a
epic: 6
title: Provide original boolean GPU query lifetimes and guest results
priority: 525.027037
status: verified
depends_on: [E6-T11d68]
estimate: S
risk: high
capstone: false
---

## Boundary

Production original query object9/types1 and11 and commands19/20/21 provide
actual ANY_SAMPLES_PASSED and CONSERVATIVE results. Retain original custom
result resources and publish the pinned16-byte state/result-size/u64-result
layout only from real available native results. Preserve unavailable versus
false, original ignored wait/offset fields, virtual context/subcontext ownership,
resource generations, bounded polling and cleanup. Counter, timestamp, pipeline,
conditional-render and QBO types/commands remain refused. Private profiles stay
closed. Advertised boolean support must match actual GLES behavior.

## Deterministic acceptance

`make verify-E6-T11d69a` records qualified original Wasm/MMIO resource creation,
query create/begin/end/get and guest-memory result readback on hardware WebGL2.
Both boolean targets must produce independently predicted true and false results,
including depth-rejected and empty runs. Original no-wait polling exposes pending
state without publishing a fabricated false/DONE result. Check result_size4,
u64 high-half0, all16bytes, extents and poisoned padding. Interleave active queries
in virtual contexts/subcontexts; resource detach/unref/reuse, destroy, reset and
actual context loss must not mutate a different owner. Exercise invalid states,
unsupported types, exact framing, object budgets and fenced cleanup. Record all
changed paths, affected high-risk native/wasm/browser gates and one final clean
clone. The full actual GLES query probe is completed by69b;69a cannot claim TF.

## Adversarial verification

Fresh verifier predicts original ABI and actual query outcomes before reading
physical traces. Choose one novel depth/pending/interleaving schedule, prove
false differs from unavailable, and sabotage availability or result publication
to demand an oracle failure. Inspect original custom-buffer accounting and
all new positive capability fields. Every changed runtime hunk executes or has
a specific waiver.

## Evidence carried

The independent actual-GLES3 negative and pinned original ABI are preserved in
E6-T11d69 and the committed original-negative seal. Public renderer remains
virgl; no llvmpipe, invented packets, fabricated availability or CPU count may
justify a positive result. Parent default Omarchy remains a separate acceptance.

## Verification log

### 2026-10-14 — worker — native query boundary and self-validation

Pinned VirGL1.3.0 source create_query11659 uses original custom host-memory
resources and ignores offset; begin/end/get11791–11873 queue real native query
results and ignore the wait hint. Query state16bytes is state@0, result_size@4,
u64 result@8; only physical availability permits DONE1 with size4. Original
custom bind is131072 (VIRGL_BIND_CUSTOM), distinct from modern PIPE_BIND_CUSTOM.
The WebGL2 specification getQueryParameter table returns GLuint for QUERY_RESULT
and GLboolean for AVAILABLE; the first qualification self-run incorrectly expected
a JS boolean result, and is retained as a harness negative. Corrected calls accept
actual counters0/1. [WebGL2 query specification](https://registry.khronos.org/webgl/specs/latest/2.0/#QUERY_RESULT)
provides the asynchronous event-loop contract.

Self-validation passes six hardware rows across targets1/11 and schedules0/1/2:
visible quad, strict depth NEVER, native conservative outcome, empty true-ready0
versus actual-but-withheld availability, original offsetu32MAX ignored, sixteen
state bytes/high-half0/poisoned padding, virtual context/subcontext interleaving,
invalid states/types/private admission, resource span/role/detach/reuse and reset.
An additional actual WEBGL_lose_context pending-query run passes uncertain GPU
completion/no fabricated guest result and zero owners. These are worker checks;
the frozen full submission and independent evidence review remain outstanding.

### 2026-10-14 — worker — fresh native-result refutation repaired

Fresh original-MMIO verifier reproduced a real query getter fault observer:
the actual empty result0 was observed, then invalid2 deliberately delivered.
GET correctly rejected it, but available/result fields had already mutated;
a later FROM_HOST read skipped validation and published DONE/true. Source9ef83920,
queries.mjs53–57; independent novel02 run0002 and independent schedule271828
both reproduce the issue. The repair commits availability and result together
only after both actual native getter values validate. Rejected values remain
pending and are re-read on retry. Healthy interleaving, actual4096/4097 native
budget/refusal/cleanup and actual guest GLES six-case pixel results are held.
Runtime changed, so the selected full risk-tier gates are re-earned on the
new frozen head; final cold proof has not run yet.

### 2026-10-14 — worker — actual GLES and promoted repair proof

Actual ordinary image12/default Wasm capture production-omarchy-gpu-boolean01
runs the independent compiled RISC-V probe (ELFec3f014b6dac36f4d5838b6163da92110b37e059e783dc7f0092fff46570cc0b,
20,544bytes) through the original public serial controller. Its guest sha256sum
matches; renderer is virgl/OpenGL ES3.0 Mesa26.2.2. Allsix visible/depth-rejected/
empty cases return available correct actual native results and16/16 literal
pixels, probeexit0. Optional SamplesPassed and TimeElapsed return INVALID_ENUM.
Original control commands, guest response and GPU packets remain recorded.
This boolean/API claim is held independently; full desktop input remains parent.

Promoted fresh original-MMIO proof passes five rows after the transactional
repair: healthy interleaving, actual4096 native parts/4097 no-effect refusal
and complete retirement, repeatedly invalid result, invalid availability and
native getter GL-error. Faults remain active for two refused original polls
without result publication; after removal, a new validated native0 publishes
exact DONE1/size4/false0/high0. All native owners/syncs and browser errors are0.
The failed old runtime and independently repeated failure remain preserved.

### 2026-10-14 — worker — final exact-head submission

Runtime head `7eef61fe41d050f3f128f6dff4c88a52c4a0b1cc`. Commands:
`python3 tools/virgl-production/verify-boolean-queries.py --output
target/evidence/production-boolean-queries-frozen02` and
`python3 tools/virgl-production/cold.py --task E6-T11d69a --output
target/evidence/production-boolean-queries-cold01`. Both pass all11 gates;
the cold proof uses an ordinary full-history clone without hardlinks and a
scrubbed proving environment, local `make web-dist` and full
`make verify-E6-T11d69a`, with no carry.390 native tests, typed ABI/original
transport, affected core/wasm clippy/build,7 worker physical cases,5 promoted
critic rows (~2million assertions), historical private replay and default
demo127passed/0failed/proof exports absent/zero errors all pass.

Reopened worker seal `evidence/virgl-production-boolean-queries/worker/exact-head-query-submission-and-cold.tar.gz`,
SHA256`28f17e3938b135f00207055d9922de053fc0997543558507e77b32925c03532d`, 1023 exact paired identities. It includes
both frozen runs, final clean clone outputs/captures (checkout excluded),
complete actual ordinary guest GPU recording, immutable intermediate default
dist and the independent C source/build/binary. Actual real-Mesa C/public
pixels used nominal runtime9ef83920 before the fault-only transactional repair;
its valid-host observations are independently held, while final exact-head
original hardware proofs exercise the repaired hunk and all three rejected
getter paths. The ordinary capture is a parent negative: early bar assertion,
then visible readable package bar/Foot, failed keyboard marker, and a later
confirmed fullscreen screensaver with baralpha0. Those failures remain intact;
this task claims boolean queries, safe native reads/publication and ownership
only. Fresh verdict/status is independent; TF and full desktop remain gated.


### 2026-10-14 — independent verifier

VERDICT: verified

- P1 rejected native values — initially FAILED at9ef83920. Predicted an invalid
  delivered result cannot later become a guest true result. Two original-MMIO
  recordings observed actual native empty0, delivered invalid2, rejected GET0x1201,
  then FROM_HOST `[DONE1,size4,true1,high0]` (novel02 run0002 SHA262e00cf…;
  independent schedule271828 rowd26a828c…). The transactional repair737c8245…
  is HELD: result2, nonboolean availability1 and an injected getter GL error each
  refuse two polls without result-buffer writes, then re-read actual0 and publish
  exact DONE/false. Original transport and physical getters remain in every run.
- P2 outcomes/isolation — HELD. Independent quarter-depth GREATER quad is true,
  LESS is false and all16 pixels remain literal yellow. Same handle300 in another
  context and subcontext independently returns empty false. Withheld actual native
  availability leaves WAIT2 and preserves poisoned size/result words
  `0x33557799/0x87654321/0x1234abcd`; all32 result bytes and64-byte guarded DMA
  extent match. Worker types1/11 across schedules0/1/2 cover repeated ready GET,
  invalid states, detached/reused owners, destruction, reset and physical loss.
- P3 native ceiling — HELD. Sixteen original256-draw jobs execute4096 actual
  drawArrays and retain4096 native query parts. Draw4097 returns0x1201 before query
  allocation or drawing; END/GET returns actual true and retires all4096 parts.
  Frozen hot and cold promoted budget rows each assert1,937,673 checks.
- P4 exact framing/private/optional gates — HELD. Independent original QUERY,
  BEGIN, END and GET each refuse both short and long payloads with0x1205 before
  native query/result writes; subsequent valid empty query returnsfalse. Private
  query admission remains closed; optional query types/index/wait values refuse.
  The supplemental framing row is promoted after the cold run as a tests-only
  addition. Its touched six-row matrix passes2,000,601 assertions without changing
  runtime or repeating unrelated gates.
- P5 actual Mesa API and capability11 — HELD within the public GLES-only profile.
  Independently built ELFec3f014b… authenticates in the ordinary production guest;
  receipt2e01265a… reports strict/conservative visible1, depth-rejected0 and empty0,
  each16/16 literal pixels, and SamplesPassed/TimeElapsed INVALID_ENUM. Original
  gpu.ndjson1121–1123 creates CUSTOM131072/format64/target0/width16 resource6/gen7,
  attaches real backing and context2/gen3. Streams1128/1139/1150/1161/1172/1183
  contain types1/11, BEGIN19/END20/GET21; transfers1131/1142/1153/1164/1175/1186
  read the original16-byte result. Pinned Mesa virgl_screen284,
  st_extensions1061, context.h539 and extensions_table277 distinguish GLES
  boolean exposure from desktop counters. Public desktop EGL contexts stay refused.
  Valid-host source/ABI results carry across the transactional fault-only repair;
  the repaired branch is independently re-executed, not inferred from that carry.
- P6 coverage — HELD. Recorded V8 coverage executes new native lifecycle,
  query ownership/lease/span validation, WAIT/DONE publication, retained-part
  cleanup, pending polling and renderer integration. Native390 tests exercise new
  custom byte accounting and its bounds. Original Mesa and typed capset/transport
  evidence exercise the positive field. Comments/docs/name tables and diagnostic
  tracking are waived as declarations/observers; unchanged raster implementations
  carry their prior indexed/MS/instancing/culling holds. No new runtime hunk is
  left supported only by a worker assertion.
- P7 oracle sabotage — HELD. Served-only aggregation changed to constanttrue;
  the unchanged empty-false oracle rejects native0→guesttrue immediately.
  Report2869c8ef… records original source737c8245… and sabotagedc2f65fd9…;
  tracked runtime remains untouched. The earlier wrong test expectations0x1205
  for budget/native-backend errors are retained and corrected to observed0x1201.
- P8 final custody/cold — HELD. Frozen runtime
  `7eef61fe41d050f3f128f6dff4c88a52c4a0b1cc`, worker submission854c4452.
  Reopened every1023 worker archive identities, SHA
  `28f17e3938b135f00207055d9922de053fc0997543558507e77b32925c03532d`.
  The ordinary full-history, no-hardlink clone rebuilds and runs all11 gates with
  no carry. All121 unique cold files (236 nested inventory entries) and12 physical row blobs/source pins
  authenticate;2,182,311 assertions, zero native owners/syncs/browser errors,
  private replay passes and the default suite127/0 has no proof exports.
- SUITE: permanent original-MMIO interleaving/depth/poison/budget/native-fault/
  framing regression matrix, independent guest C boolean probe and the existing
  `make verify-E6-T11d69a` target. Independent archive01 SHA
  `e31192b678d2503f58fe81029db15b3b16d999fa6d973f07674f192bdec6bdca`
  contains229 reopened identities; supplemental exact-framing archive02 and
  final custody/coverage audit are paired in
  `evidence/virgl-production-boolean-queries/verifier/`.

Commands: recorded `make verify-E6-T11d69a`; ordinary
`python3 tools/virgl-production/cold.py --task E6-T11d69a --output
 target/evidence/production-boolean-queries-cold01`; independent
`node tools/virgl-production/critic-fast-boots-boolean-queries-browser.mjs
 --output target/evidence/critic-production-boolean-queries-framing-promoted-01`
plus recorded independent schedules161803/271828/314159/223606, source and
archive custody checks. Native fault observers call the actual native API before
controlled delivery; no original device, MMIO, DMA, renderer or result transport
is replaced. This verdict covers boolean query ownership/results only. Logical
transform-feedback counts, complete public desktop interaction, recovery and
deployment remain separate pending acceptance; the readable bar/Foot evidence
does not establish the missing trusted keyboard marker.
