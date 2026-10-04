---
id: E6-T12g4
epic: 6
title: Execute required sampler-view swizzles addressing and filtering
priority: 525.0270104
status: verified
depends_on: [E6-T12g3]
estimate: S
risk: high
capstone: false
---

## Boundary

Implement immutable per-view sampling semantics for the measured required
formats: swizzles including zero/one, format/alpha/origin specialization, mip/
layer/cube addressing and filtering where required. Validate view/storage role
compatibility and include all shader-visible dependencies in the program key.
Never advertise unproven targets or level/layer/face semantics. Any requirement
outside the measured bounded shader/storage family gets its own S dependency.

## Deterministic acceptance

`make verify-E6-T12g4` runs original required surface/view/sampler packets
and independent WebGL2 swizzle/alpha/filter and each admitted mip/layer/cube-face
oracle. Test every advertised role, view aliasing and A/B/A restoration, with
bounded variant allocation and exact GL calls. Explicitly record unrequired
unsupported target/level families and reject their requests. Require a swizzle
or admitted cube-face source fault to fail, retained color/depth/tiny-scene
checks and final clean clone.

## Adversarial verification

Attack nonidentity swizzle, zero/one lanes, mip/layer/face bounds, cube
orientation, incompatible reinterpretation, filtering/LOD and poisoned host
state. Collide shader keys while changing view semantics and require distinct
correct physical results; unsupported requests cannot become no-ops.

## Verification log

### 2026-10-04 — worker — execution boundary

The user's graphics-offload continuation selects this next eligible dependency
at verified G3 `96d6b83fcde1765fc5e931a95808629f78d37b60`.
G1's unchanged client sampler requirement is kmscube format67/target2,
level/layer0, identity swizzle and clamp-edge linear non-mip filtering
(resource5@125; VIEW at176/byte4400; SAMPLER at176/byte4444). The original
gears client creates no sampler views. Preserve unsupported mip/layer/cube,
depth-view and vertex-texture families explicitly; do not invent captured
requirements or advertise those families.

Extend exact-matching existing color views2/67/233 with bounded immutable
selectors0–5, including ZERO/ONE, as the task's synthetic specialization
proof. Native storage and alpha are the independently verified G2 boundary.
Specialize the checked compiler's existing fragment 2D TEX output in a private
per-program GLSL variant; do not mutate shared textures or add view images.
Canonical program keys include every specialization dependency, preserve
fixed legacy identity semantics, and reuse the original A program on A/B/A.
Own and charge fragment variants alongside existing flat vertex variants;
prove allocation/compile/link/reflection/quota rollback and deletion.

Use unchanged original packets plus separate synthetic hardware sampling,
swizzle/alpha, nearest/linear/clamp-edge, alias/role, A/B/A and poisoned-state
oracles. A swizzle source fault must fail independent pixels. Retain affected
color/depth/state/draw/async/tiny checks, then freeze the exact source, record
final hardware/pristine-clone proof and submit to a fresh critic. This remains
an isolated renderer boundary; production negotiation stays disabled.

### 2026-10-04 — worker — frozen proof plan

The isolated runtime adds no production import or guest capability negotiation.
The submission target rebuilds the unchanged pinned Wasm compiler and records
all affected decoder/resource/state/draw/async/color/depth gates. New hardware
proof exercises26 view patterns per color format, all selectors in each lane,
native nearest/linear/clamp-edge pixels, exact role guards, retained/reused
aliases, slot0/7 keys, combined flat+view variants,12 native failure boundaries,
exact/one-byte-short shader quotas, six trusted-host compiler-output guards and
delayed asynchronous A/B/A draws at schedules0/1/3. A served GLSL swizzle source
fault must fail a physical GPU pixel, before inverse guest-byte conversion.

The historical `tools/verify-virgl-pairs.mjs` wrapper stopped at its old compiler
corpus premise: it still predicts12/19 standalone admissions although subsequent
verified compiler work expanded that family (precheck report at
`target/evidence/virgl-view-precheck/pairs/report.json`, unchanged shader
`12f6d594…`, expected false/observed true). This is outside G4's JS runtime
boundary. The new hardware suite invokes the unchanged exported
`runRendererPairs` directly with its authenticated original/fixture inputs,
retaining its physical smooth/flat/mixed, lifecycle,12 fault and two quota tests.
No admission expectations or implementation tests are weakened or rewritten.
The final exact-source acceptance and pristine clone, followed by a fresh critic,
are authoritative; these prechecks are only iteration.

### 2026-10-04 — worker — implemented submission

Frozen runtime/harness head: `7b4fbb11b3d386319b7050d7fc1e0442494d4f68`.
Base: verified G3 `96d6b83fcde1765fc5e931a95808629f78d37b60`.
Commands, both exit0:

```
VIRGL_VIEW_EVIDENCE_DIR=target/evidence/virgl-texture-views-worker-final make verify-E6-T12g4
python3 tools/virgl-command/views-cold.py --output target/evidence/virgl-texture-views-worker-cold
```

Evidence of record: `evidence/virgl-texture-views/worker/manifest.json`,
`records.json` and `recording.tar.gz` (63 members; archiveSHA256
`de6d0334fed7059bb9af7dfaa5bd52ed2531089091ef1ce74e65970bb0789830`,
indexSHA256 `5df25538360b1290ceec6cb23213b4c139635a8bdb0ca146317b9207ca0d58e0`).
Hot receiptSHA256 `0e05457e623069ada8754571f567d1dc625189fa7440a2e1ee1dab7f76070849`;
cold reportSHA256 `ed88346b27cf7b1f9312e8a5f675ff7a8d2322bf03b44f9d21fc596dd790de0a`;
cold receiptSHA256 `33530f41598a57c020cefe28988fdac00af6104e07388bfec1a20bbb5ff570d6`.
The hot/cold source and input tables are identical; the scrubbed exact-source
clone is pristine before and after acceptance. Browser is Chrome154.0.8037.93,
ANGLE Metal/Apple M4 Max, hardware enabled, with zero console/page/request errors.

The recording demonstrates294 identical Node/browser guard assertions and4870
hardware assertions, including the unchanged original kmscube VIEW/SAMPLER,
26 independent physical patterns on each format2/67/233, native alpha, no extra
view images (resident GPU4188 bytes in each tiny format rig), retained/reused
aliases and exact A/B/A program reuse. Independent nearest center is
[92,64,148,17], linear center[68,91,104,82], and combined flat/swizzled provoking
pixels are[36,200,8,255]/[148,64,92,255], with both generated stages charged.
Slot0/7 selection and delayed actual-fence jobs at0/1/3 produce correct pixels.
Six incompatible role/storage attacks retain no charge; all-constant sampler
elimination preserves logical view/state/feedback requirements. Exact shader
quota succeeds and one byte short rejects before allocation. Twelve native
allocation/compile/link/reflection/error failures roll back every new name and
charge, including an already-created flat vertex variant when FS compilation
fails. Six explicitly trusted-host output injections exercise lookup/main/
length/sampler metadata guards. The unchanged retained flat renderer suite
passes44 physical draws,12 failures and two quotas. A served lane-swap source
fault fails at physicalRGBA67 pixel8,8: expected[172,84,40,12], actual[40,84,172,12].
All affected old color/depth/state/draw/async/resource/decoder gates also pass.

`hot/changed-line-coverage.json` records positive V8 counters for62 added runtime
lines, bound to each clean recording/source digest. This worker map is a claim;
the fresh critic must independently decide statement coverage and waivers.
Original full-client draw closure remains G6; depth raster execution remains H.
No live guest offload, capability negotiation or MIPS improvement is claimed.

### 2026-10-04 — fresh verifier — VERDICT: verified

VERDICT: verified

Read the entire task and base-to-frozen runtime/harness diff before evidence,
then saved falsifiable predictions before observations in
`target/evidence/virgl-texture-views-verifier/predictions.md`. Reviewed source
`7b4fbb11b3d386319b7050d7fc1e0442494d4f68` against verified G3
`96d6b83fcde1765fc5e931a95808629f78d37b60`; `970ab070` is the sealed submission.
No semantic refutation or sufficiency gap survived. Detailed per-prediction
state, source/record citations, coverage classifications and suite decision are
in `target/evidence/virgl-texture-views-verifier/verdict.md`, SHA256
`ba5a6b4845111e757f13dc64d7ccddf8cb47056d15980ba6948784fa37751e7a`.

Here `H` is verifier-extracted `recording/hot/hardware/report.json`, SHA256
`fee9a6e152ae86de131c00b1f6f5cf46cb6aac44923a183817e1209aace10d40`;
`N` is `novel-clean/report.json`, SHA256
`6c64eb942da5efb9cb3f07811273d9525b48ba67cbf2a6ef81012522f7f78bd0`;
both are under `target/evidence/virgl-texture-views-verifier/`.

- **P1 — HELD.** Independently authenticated all63 regular archive members,
  113 frozen source/input bindings, generated compiler, served modules, V8
  counters, fixtures and screenshots across18 hot/cold reports. Archive SHA256
  remains `de6d0334fed7059bb9af7dfaa5bd52ed2531089091ef1ce74e65970bb0789830`.
  Hot/cold source/input tables match; cold report:4–19 proves exact head,
  exit0 and pristine before/after with scrubbed configuration. Its SHA256 is
  `ed88346b27cf7b1f9312e8a5f675ff7a8d2322bf03b44f9d21fc596dd790de0a`.
  Independently decoded original VIEW `[0x60601,5,5,0x02000043,0,0,0x688]`
  at event176/byte4400; packet SHA256
  `f9cdf2022c82808a28b62d1a98f1711947f4edb920740dca387aaaaf9aabe36c`.
  Original SAMPLER byte4444 SHA256
  `321dcf863e76de17bf6d2019346c25b7b434715951cddea95da9bdb0164c345d`.
- **P2/P3/P6 — HELD.** H records294 identical native/browser admission guards,
  six incompatible role/storage attacks and26 patterns on each native format.
  H:95461 proves no new view image; H:100541 records packed alpha1;
  `/result/filtering` proves independent nearest/linear/clamp and combined
  flat+view colors. H:105999 onward preserves logical view/state/feedback
  checks after native sampler elimination; all six explicitly trusted-host
  output injections reject before partial charge. N independently repeats
  composed filter/swizzle pixels and unsupported/mismatched requests.
- **P4/P5 — HELD.** H:95555 and `/result/multiple` prove exact A/B/A and slot7
  program reuse; only generated format/view dependencies alter keys. H:107639
  charges bytes before compilation; H:108825 rejects one byte short;
  all12 fault paths roll back native names/charges, including flat vertex
  allocation followed by fragment failure at H:117389. N:7710 observes15
  distinct mixed-format/view programs under one selector; N:1722 and8172 prove
  filter changes and different images reuse appropriate code. N:8624 preserves
  the old view lease through name reuse; N:9706 onward checks deletion and
  actual `gl.isProgram === false` for all15 old variants after final selector
  release. N:9958 observes final shaderBytes0 and all native names collected.
- **P7 — HELD.** H `/result/jobs` records actual-fence delays0/1/3, nonblocking
  polling, zero outstanding syncs and correct A/B/A pixels/native program
  identities. Changed sampling validation at state.mjs:522 executes with
  positive precise counters before physical issue. Trusted API job ownership
  prevents state mutation while a plan is pending.
- **P8 — HELD.** Independent zero-context Git diff/UTF-16/tightest V8 range
  map, excluding the worker map and mutant counters:62 added runtime lines,
  53 wholly executed,2 executed with narrow defensive-branch waivers,7 comment/
  structural waivers; no dead or unproved behavior. Only state.mjs:421 `: null`
  and:422 `?? false` tokens lack hits; they require vertex samplers, rejected
  by unchanged checked TEX parser bridge.c:874. Admitted fragment paths execute.
  `coverage-audit.json` SHA256
  `5c11102cf91c47a48ecea6211e0830d776c4276be87a9edfcd8ca8fcce12744a`.
  Declarative docs/metadata are waived; recorded transcripts exercise new
  make/fixtures/hardware/receipt/cold glue; generic environment-failure and
  argument checks add no guest behavior claim.
- **P9 — HELD, carried forward.** G1/G2/G3 and unchanged shader/compiler/
  storage dependency boundaries retain their prior verdicts. All seven affected
  regression gates pass hot/cold. Direct unchanged `runRendererPairs` with
  authenticated supplied inputs retains44 physical draws, lifecycle,12 faults
  and two quota cases in H `/result/flat`. The skipped stale standalone12/19
  compiler-corpus premise is outside the changed renderer boundary; no affected
  renderer assertion was removed or weakened. No portability finding requires
  repeating the exact-source pristine clone.
- **P10 — HELD.** Independent bounded hardware attack passes39 draws/1688
  assertions on Chrome154.0.8037.93 / ANGLE Metal Apple M4 Max with fresh
  seeds2485694867/2803642213/1833140897. It interleaves all formats under one
  selector, computes bilinear/native-lane pixels independently, combines
  ZERO/ONE and filters, changes/reuses view and shader names, checks actual
  program collection and all final budgets. Zero GL/console/page/request errors.
- **P11 — HELD.** Independent served helper ONE→0 source sabotage fails at
  raw physical RGBA pixel8,8 lane2: expected255, observed0, before inverse
  conversion. `sabotage-one-zero/report.json:1958`, SHA256
  `dc7801e9a5c449274bf2fa37afafd4b2c07a5ed9b5f68976333781693930a53b`.
  Original runtime SHA256
  `bf56e153037793201d1588c1e58571c2980b24b0f8e6cb94f16315582ff26d7e`;
  served mutant `850428f5f6eced44dbffa7a7ea76a52b7fe16d039f99aff337dc8af8962c4be8`.
  Both fault and clean control bind served source/counters/screenshots and
  leave no native name/charge leak. Sealed worker lane-swap fault also rejects.

Commands: `python3 target/evidence/virgl-texture-views-verifier/authenticate.py`;
`python3 target/evidence/virgl-texture-views-verifier/audit-recording.py`;
`node target/evidence/virgl-texture-views-verifier/run-novel.mjs`;
`node target/evidence/virgl-texture-views-verifier/run-novel.mjs one-zero`.
Prediction results SHA256
`3a271bf9a55f5d2963cc987aa99d3f2aeb18158e03235e99731f29c8e94b54d8`.

SUITE: retain the committed `texture-views.mjs` native/GPU/ownership checks,
physical source-fault gate and `make verify-E6-T12g4`; preserve novel seeds,
independent driver/pixels/sabotage as verifier replay evidence. No runtime or
new tracked harness edit was needed. The final clone was preserved; no unrelated
Rust/shader/guest gauntlet, deployment, rr or `ssh dev` was run. This is the
isolated view boundary; original full-client shaders remain G6 and depth raster
execution H, with no production negotiation/offload/throughput inference.
Queue regeneration, evidence preservation and commit belong to the parent.

### 2026-10-04 — worker — preserve independent verdict

Preserved the fresh critic's20 nonduplicate artifacts in
`evidence/virgl-texture-views/verifier/verifier-recording.tar.gz`, SHA256
`5f2642a4f78ce6821d36efcc7a55d2f31c7b6ccd1b0a2abcb3bd4086c3fde6f3`,
with `verifier-manifest.json` and `verifier-records.json` (index SHA256
`a36f83f4b28b8fceb1af613e735ecbfe3fc00144dd39e3ba7505fc6a059007ef`).
The critic binds the frozen7b4fbb11 source and the original worker archive;
extracted worker duplicates are excluded from the new archive. The independent
verdict and all11 held predictions are unchanged.
