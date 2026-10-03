VERDICT: verified

Fresh independent verifier, no D implementation edits. Frozen source
`ab60a54e6b3c8bd1020065b7e78b847e3d91c65f`; diff from verified C head
`a768b341`. Predictions predate implementation/evidence and remain unchanged
(SHA256 `8280bfc67a7b32648586a8b1b710eff19d05e0ded58fa73c6227fea445121e89`).
This verdict covers isolated captured draw replay only. No live guest transport,
production capability advertisement, Mesa initialization or FPS claim follows.

- P1 HELD — `worker/hardware/report.json:540` records all eight original byte
  sequences, 210 packets and exactly three actual GPU draw calls. The independent
  replay repeats the complete original submissions and reproduces all three
  full-image hashes (`verifier/attacks.json:545`). The audit parses every original
  packet header independently of the runtime decoder and matches the recorded
  command/event/offset dump. State-only C still stops at DRAW and retains its
  result shape; same-source C acceptance passes in worker and cold runs.
- P2 HELD — original top-level context creation96 is applied once, excluding its
  nested call97. Resource creation, zero initial attachments, context membership
  and the 92 selected CPU input bytes follow recorded chronology. Explicit
  exclusions identify boot scanout and unrelated fence transport. Original
  public resource5 removal precedes submit249; the entire submit249 runs once.
  The remaining recorded public cleanup ends at context_destroy275. Independent
  replay also applies that ordered cleanup; final allocations and budgets zero.
- P3 HELD — primary readbacks use staging offsets64/4160/8256, driven by actual
  original COPY packets. Poisoning all 12,288 reference image bytes preserves
  all actual output hashes in worker, cold and independent replay. A separate
  legal relocation to offset16384 returns correct actual pixels and preserves
  one-byte guards on both sides. CPU texture bytes do not become saved images.
- P4 HELD — the literal workload oracle checks all 768 interior pixels at the
  original lower-left rectangles. Worker `hardware/report.json:2463` includes
  per-frame native calls, generations, bindings, readback hash and pixel checks;
  emitted original-shader GLSL/metadata appears at 6464. Independent replay uses
  its own literal colors and index arithmetic. Both screenshots were viewed:
  quadrant orientation and color/tint/alpha phases match the literal oracle.
- P5 HELD — actual GPU indices are scanned as little-endian u16 values; primary
  min/max 0/3 and index range 12 yield position requiredEnd 56 and UV requiredEnd 64.
  Unknown UINT_MAX hints do not allocate an enormous range. In 36 independent
  rounds, an actual GPU index is changed while CPU backing remains original;
  a forged maxIndex0 cannot hide the bad index. Each rejects out-of-bounds before
  any GL draw, then an original transfer repairs GPU storage and exact pixels
  recover. Conversely CPU-only0xffff poison leaves the already-valid GPU draw
  unchanged. Independent UV offsets12/16 reject while position still fits.
- P6 HELD — unsupported start, empty/nonindexed draw, zero stride and actual
  ushort0xffff reject, preserving clean GL error state. Existing decoder rejects
  unsupported primitive/instance/base-vertex/restart/indirect forms; unchanged
  decoder proof carries forward with its regression gate. Worker positive
  index-buffer offset6/count3 draws the second triangle with actual min1/max3
  and independent blue/yellow probes. Thus byte offset is neither ignored nor
  incorrectly combined with DRAW.start. Pinned semantics are in reference-notes.
- P7 HELD — original three frame dumps show actual private program/VAO/FBO,
  attribute/index resource identities, tint bits, viewport/masks and blend
  factors. Worker A/B1/A/B2/A checks actual pixels after hostile host state;
  independent same-context subcontext name reuse plus null program/VAO/FBO,
  disabled writes and zero-area scissor also recover correct pixels. Missing
  required stages/elements/buffers/sampler/constants/viewport and feedback reject
  before draw (`worker/hardware/report.json:6948`).
- P8 HELD — original public resource5 removal leaves retained texture storage
  alive until recorded object/framebuffer teardown. Independent public index4
  unref and numeric reuse do not retarget the already-bound index generation:
  it still renders correct pixels, and the old native buffer is deleted only
  on explicit index unbind. All independent rig disposals assert every state/
  resource budget and tracked native allocation is zero.
- P9 HELD — independent valid DRAW followed by invalid opcode in one submission
  issues no draw and reports an empty summary; a corrected submission renders
  the original phase. Worker rejects geometry/missing binding cases, checks no
  temporary-resource growth and recovers after each. A two-draw quota admits
  exactly two commands/summaries/native calls, rejects the third and resets at
  the next submission; worker additionally covers zero/default/index quotas.
- P10 HELD — eighteen independent mutations across three seeds cover vertex UV,
  actual uploaded index, a different texture channel, phase1 tint, phase2 blend
  factor and phase1 readback offset. Index corruption reaches structured bounds
  rejection; all other mutations reach the independent literal-pixel mismatch.
  Worker and cold recordings separately bind and detect all six wire corruptions.
- P11 HELD — novel GPU/CPU divergence, stale validation, per-attribute extent and
  recovery tests run against real WebGL buffers. They do not use a mocked resource
  readStorage implementation. Independent actual-index values range beyond3,
  and actual storage changes are read synchronously by the frozen runtime.
- P12 HELD — served-source sabotage skipping draw leaves blue CLEAR pixels where
  red is required (`attacks.json:579`). Masking actual scanned indices to two
  bits lets a corrupt index reach WebGL error1282 instead of structured pre-draw
  bounds rejection; the independent bounds oracle fails (`attacks.json:595`).
  Baseline browser errors are empty. The 852-check audit binds original/frozen/
  served inputs, generated Wasm, worker/cold records, independent sources and
  exact clean-clone HEAD/status. Both hardware captures were visually inspected.

Changed-hunk sufficiency:

| Added/changed runtime range | Evidence |
| --- | --- |
| state.mjs:1,7–8,47–77 factory split, profiles, readStorage requirement and limits | D success, invalid/missing capability and quota controls; C factory regression preserves old option/result contract. |
| state.mjs:279 sampler stage/index metadata | Actual program linking and reflected sampler validation before all primary and independent draws. |
| state.mjs:420–449 profile, budgets, complete bindings, feedback and attribute prerequisites | Valid full replay, missing/feedback/zero-stride controls and repeated independently seeded recovery. |
| state.mjs:450–474 exact index read, restart rejection and per-attribute bounds | Original/positive-offset GPU reads, first/last/restart index attacks, independent GPU/CPU divergence and UV-only overflow. |
| state.mjs:475–488 restore, actual GL draw and bounded result metadata | Three original phases, context restoration, quota prefixes and exact summary/native-call assertions. |
| state.mjs:534–536 state-only stop versus draw dispatch | Same-source C regression and direct independent legacy-factory check; D actual execution. |
| state.mjs:618–627 submission-local counters, success/failure summaries | Valid, malformed-tail, semantic failure and partially successful quota submissions, with next-submission recovery. |
| state.mjs:633 draw profile/limits introspection | Factory, quotas, state snapshots and cleanup observations. |

Precise V8 innermost-range counts from worker D, same-source C regression and
independent hardware recording cover every changed executable range in all 14
runtime diff hunks (105 added/changed lines). `audit.json` reports no uncovered
changed range; no D runtime waiver is needed. Unchanged C semantics retain their
previous independent verdict plus this final same-source regression. There is no
resource/decoder/compiler runtime change in D.

The new acceptance/fixture/receipt/cold/browser orchestration executes in the
worker and clean clone, including all six wire corruption modes. Original source
hash checks, independently parsed headers, actual GL call queries and literal
pixel assertions were reviewed. Host-only CLI misuse, timeout/filesystem/report
failure diagnostics are not guest draw behavior and are waived from runtime
range requirements. Documentation, task metadata and Makefile dispatch are
reviewed declarative/orchestration changes. No unexecuted draw semantics remain.

Mock/environment hunt: actual pinned Wasm translates the exact original TGSI;
real GL compiles/links, native buffers/textures back commands and COPY readPixels
populates original staging. Per-frame output hashes are observations; literal
workload colors decide correctness. Original output snapshots are explicitly
poisoned and irrelevant. The independent bounds attack modifies native GPU bytes
without modifying CPU backing, defeating an accidental CPU mirror oracle.
Hardware WebGL is enabled on Chrome154/ANGLE Metal/Apple M4 Max. Fresh dependency
installation and translator rebuild happen in a scrubbed exact-head clone;
independent Git inspection confirms it remains pristine.

SUITE: retain the original full-replay target, six wire corruption controls and
promoted independent runner. The verifier directory commits reproducible seeded
GPU-index/UV attacks, guarded readback, lifetime, invalid-tail, quotas, source
sabotages, screenshots and audit. No runtime repair is needed.

Commands:

- `node evidence/virgl-draw/verifier/run-attacks.mjs`
- `python3 evidence/virgl-draw/verifier/audit-evidence.py`

Final independent result: 28,760 assertions, 26,432 successful literal pixel
comparisons, 18 input mutations, 36 GPU-index/UV recovery rounds and two detected
runtime sabotages. The 26,432 count includes successful comparisons made before
expected input-mutation failures; it does not claim that corrupted images passed.

Digest anchors:

- Worker receipt: `09bd16273acbb6cb1efa8ab27c271b2b069f297afa3b00cc48eb60bd7771318e`
- Cold receipt: `f0a1e3ce227a4cb1702fa1e58c1d6123240f27104db31df7824e88f92128b5e1`
- attacks.json: `fe81359740246c8e221da67ff10bbd01160fab4633a5a77746c6996c53aef9e8`
- audit.json: `9289ad8df75f979f406c869ce20cf44149960e01fb54bad682308e3af05fee20`
- attack.png: `c7ad3865a71db8a6215f23d3afeb563fdb6ea2b013caa24dd439d46f78dfe8e9`
