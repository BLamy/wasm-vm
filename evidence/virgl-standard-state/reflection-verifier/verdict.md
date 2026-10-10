VERDICT: verified

- R1 authentication — HELD. Independently authenticate all 332 repaired worker
  members, 4,754 source checks, 324 receipt files, four generated compiler
  artifacts and 126 served/coverage identities against runtime/acceptance head
  `adcbe81bcd091c3d411a8f96ac8746e1a17290fb`; worker claim
  `b1263f6e60d68239288309218b3e8cc4590363ad` changes documentary/seal bytes only.
  `authentication.json` retains exact digests and the already completed pristine
  scrubbed clone. Repaired worker archive SHA256
  `9c2a187e7f192c35bcc9c06eb32d1e7fc90e8e7ca938cb37c6a124eb3bdc467e`, index
  `be036ae9072dbfae6ea1225572ffbe62fa84a5df4ebe345eefe25a72d62fef11`.
- R2 carry-forward — HELD. The entire prior runtime equals this runtime after
  removing only the 14 new accounting lines. The original independent TGSI,
  four images, raw banks and CPU oracle section are unchanged. Authenticate the
  original critic's 52-member seal; carry its HELD compiler/device/transport,
  numerical prefix, original native/ownership/cache/schedule/pixel and 45-hunk
  coverage matrix with all seven explicit partial-line waivers. The unchanged
  compiler/device closure remains `9323b445`; legacy prefix SHA256
  `bfd25f78876cb1b60c7d04de81245c5d9e3938fb4d34f6b0e723961d896afdd2`.
- R3 F1 and R4 F2 — HELD. Re-run the ORIGINAL independently selected shaders,
  images and literal banks. Coherent stage/pair omission of active FS/VS raw
  uniforms and FS/VS samplers now fails `shader-reflection-error` at opcode31,
  byteOffset1912, with zero native draws. Actual recorded native entries at
  turn15 are respectively `fsconst0[0]` / `fssamp2` / `vsconst0[0]` / `vssamp3`;
  raw extents are three vectors, samplers scalar, default-block indices -1.
  Cite `promoted-final/normal/report.json`, points
  `browserResult.result.nativeBindings.cases[0..3]` and their actual
  `getActiveUniform` / `getActiveUniforms` events. The independent audit repeats
  the error/name/type/extent/default-block/draw assertions.
- R5 recorded native completeness — HELD. Inspect all 112 repaired hot/cold
  hardware frames: 672 active system-block entries, 182 raw entries, 16 sampler
  entries and two owned blend entries are completely accounted. All 110 old
  literal wire/source/native count/full-pixel digests match the prior HELD
  observations. Each added blend frame at index34 has native vec4 factor
  [0.25,0.5,0.75,1], and its literal Gallium packet/bank equation independently
  predicts [16,64,143,255] over every 16x16 pixel. `recording-audit.json` cites
  the worker report digests and frame/native points. Total authenticated images:
  4,742,848 pixels; no replacement of old evidence with silent new assumptions.
- R6 bounded novel attack — HELD. Inject one real active default-block highp
  float into coherent compiler GLSL, preserving the metadata. The native entry
  `wv_critic_unaccounted` is genuinely active (type5126, size1, default block -1)
  and rejects before any draw. Its unused declaration counterpart is genuinely
  eliminated by the native linker, executes one completed real draw, and agrees
  with the original CPU equation over all64 pixels [91,117,153,140]. Cite
  `promoted-final/normal/report.json`,
  `browserResult.result.nativeBindings.cases[4]` and `[5]`; actual submitted and
  native attached source text, calls, fences, active lists and full output bytes
  are saved. Two initial harness-only corrections are explicit in
  `harness-correction.json`; those preliminary failures are not product evidence.
- R7 old regressions / legitimate bindings — HELD. On the repaired source,
  the original two independent seeds/schedules execute all22 shader/image/view/
  raw-linkage/context/cache/handle/ownership frames within the original pixel
  budget. Native elimination, all-constant views and the validated system block
  remain admissible; the new physically read owned blend factor is admissible.
  The nine affected old gates plus promoted blend/float and pristine full worker
  acceptance retain their authenticated repaired-head records.
- R8 sabotage — HELD. Disable only the actual served standard accounting loop:
  one real F1 omission draw completes with twelve zero FS native words and all
  zero pixels, then the named rejection oracle fails (expected false, observed
  true). Cite `promoted-final/fault-native-binding/report.json`,
  `browserResult.bindingPartial.cases[0]`; actual native draw/readback fences
  and source mutation bytes are recorded. A single real VS-view corruption also
  draws/fences and fails `critic-full-955415761 independent pixel oracle`:
  expected [91,117,153,140], observed [82,117,144,140]. Cite
  `promoted-final/fault-pixel/report.json`, `browserResult.partial.lastFrame`
  and `browserResult.partial.runs[0].events`. The promoted auditor validates both
  named failures, their native calls/fences and exact original-to-served mutation.
- R9 coverage — HELD. The added runtime hunk at `state.mjs:597-610` contains
  11 executed lines plus two comments/one brace; no new runtime waiver. All60
  worker proof additions are accounted (52 executed, eight structural), with
  `nativeDraws.map` exercised by the actual served metadata sabotage. The promoted
  harness's 85 added lines are 68 executed, 15 structural and two narrowly waived
  diagnostic portions (trusted-native null formatting; failure-only eliminated
  pixel mismatch collection). Their exact V8 offsets, counts, SHA256 identities,
  citations and reasons are in `coverage-audit.json`. The original 45-hunk / seven
  partial-waiver matrix is carried intact; its source maps shift only original
  state lines >=597 by +14. Changed proof tools have an individual execution /
  declarative ledger. No additional sufficiency gap remains.

SUITE: promote `make verify-E6-T11d5-adversarial`, the original independent
shader/texture/bank/CPU equations and six native accounting regressions. Its final
recording passes 22 regression frames plus one native-elimination draw / 1,472
full pixels, 25 metadata attacks, two prior native admission attacks, five genuine
native accounting rejections and both actual source sabotages. No runtime code
was fixed by this verifier. Original frozen compiler outputs are hash-checked;
the helper records actual native source/reflection/calls/fences rather than
substituting proxy program outcomes.

Scope remains the isolated standard renderer factory, single COLOR0 and the
existing draw/2D storage profile. No full GLES/API, production capset, live guest
boot, scanout, MIPS or throughput claim follows. A further cold clone is not
required: the final repaired exact head already has its pristine scrubbed proof,
and this verifier changed only acceptance tooling, evidence and task metadata.

Exact verifier commands, from the managed worktree:

```sh
python3 evidence/virgl-standard-state/reflection-verifier/authenticate.py
python3 evidence/virgl-standard-state/reflection-verifier/recording_audit.py
VIRGL_STANDARD_STATE_ADVERSARIAL_EVIDENCE_DIR=evidence/virgl-standard-state/reflection-verifier/promoted-final make verify-E6-T11d5-adversarial
python3 evidence/virgl-standard-state/reflection-verifier/coverage_audit.py
python3 evidence/virgl-standard-state/reflection-verifier/adjudicate.py
python3 evidence/virgl-standard-state/reflection-verifier/seal.py --verify
python3 tools/check_task_policy.py
python3 tools/build_queue.py
```

The fresh critic seal `manifest.json` / `records.json` / `recording.tar.gz`
contains original reports, full pixel/native/source/fence observations, browser
captures, precise coverage, predictions, audits, explicit fixture corrections,
frozen sources and the exact promoted harness diff. Worker records remain in the
separately authenticated repaired-worker seal; those large archives are not
duplicated. Every assertion above is tied to immutable recorded points and
source/evidence digests. Set E6-T11d5 verified; its next ordered prerequisite may
then activate under the queue policy.
