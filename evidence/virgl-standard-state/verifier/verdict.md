VERDICT: refuted

- F1 — FAILED: predicted that a coherent compiler response omitting an active
  native raw uniform would fail before draw. Removed only the fragment
  `metadata.uniforms` from both real stage and pair results, preserving their
  GLSL. Two fresh hardware runs instead return `{ok:true,gpuComplete:true}` and
  execute `drawArrays(5,0,4)` at turn 16. Active `fsconst0` has size 3, but all
  twelve native words are zero despite the literal full bank; pixel 0 is
  `[0,0,0,0]`, predicted `[91,117,153,140]`. Cite `findings.jsonl:1`,
  `metadata-omission-recheck/report.json`, SHA256
  `6ad6e395c8de953ebca9ce351b32b8d7f4ace556603c141e8e3acb97a32abbdc`,
  point `browserResult.result.cases[0]`, including `nativeDraws[0]`,
  `native.uniforms`, and `output`. Frozen source: `constant-domain.mjs:857` and
  `state.mjs:517`. Demand complete accounting of every active native
  default-block raw uniform against owned stage metadata before any draw.
- F2 — FAILED: predicted that a coherent compiler response omitting active
  native samplers would fail before draw. Removed only fragment
  `metadata.samplers` in both real stage and pair results, preserving their
  GLSL. Both runs again complete one hardware draw at turn 16. Native `fssamp2`
  and `fssamp15` both read unit 0 rather than 2 and 15; pixel 0 is
  `[77,81,80,232]`, predicted `[91,117,153,140]`. Cite `findings.jsonl:2`, the
  same recheck report digest, point `browserResult.result.cases[1]`, including
  `nativeDraws[0]` and the saved native sampler/pixel state. Frozen source:
  `constant-domain.mjs:864` and `state.mjs:542`. Demand complete accounting of
  every active native default-block sampler against owned stage metadata before
  any draw. Legitimately optimized-out declarations must remain admissible.

All conclusions refer to runtime/acceptance head
`365b3cf3d076637c347c7e9802420f847d09fbed`, task diff base `11558494`, worker
claim `e5d4dba7b9cd5e8f8085f191d74f5e4a817abddd`. Read AGENTS.md, the entire
task and all task diff before evidence. Predictions were written in
`predictions.json`, then the specific omission predictions in
`metadata-probe-predictions.json`, before inspecting their program state.

HELD results are preserved in `prediction-results.json`; only P3 fails:

- P1 authentication — independently checked all 228 original sealed members,
  4,648 source/coverage custody checks, 220 receipt file checks and four generated
  binary checks. Worker archive SHA256
  `553a510d719a5a4dd2617ec3ae1d126ee3a77ed4cbec5d113fb254b33c69d3d0`, index
  `efc78b0e268437e163c675bf1c601e3ee41f1c5272de39b2240b9c6921501ff4`.
  `authentication.json` records independent results and the pristine scrubbed
  exact-head clone. No second clone is required by these semantic findings.
- P2/P4/P5/P6/P7/P8 — independent parsing of original packet bytes authenticates
  original complete 92cb/c580 shader bodies and banks at their capture offsets.
  Native raw uploads/read words, active array sizes including 512, suffix zeroing,
  literal vertex buffer/fetch bytes, texture units/views, 656-byte system block,
  raw flat and native fragment semantics hold. Audited all 55 hot and 55 cold
  frames, 4,742,336 full pixels in total; the stable hot/cold pixel digests agree,
  including nine original-source frames each. Original-source maximum pixel error
  is zero within the stated budgets. `recording-audit.json` gives recorded
  packet/source/pixel points; the independent offline pixel auditor also passes
  each hot/cold recording and catches the worker upload sabotage.
- P9 — 73 actual completed fences per recording with later-task increasing
  turns, zero-timeout polls and PBO reads after readiness. Twelve failing jobs
  draw nothing; drawn cancellation drains without output. Retained identity,
  A/B/A restoration, cache pressure/relink, foreign/consumed requests, ownership
  and zero final budgets hold. See the original records and independent audit.
- P10 coverage — all 45 runtime hunks / 268 added lines accounted:
  constant-domain 149 executed, 4 partially executed with waivers, 27 structural;
  decoder 14 executed, 4 structural; state 62 executed, 3 partially executed
  with waivers, 5 structural. `coverage-audit.json` retains immutable source
  digests, exact V8 offsets, innermost branch counts and recording citations.
  Seven narrow partial-line waivers: unexpected non-DomainFault rethrows at
  constant-domain 916/927/940/945; preserved legacy VS-v6 size arm at state516;
  preserved old-facet VS view-null arm at state545; preserved old-facet
  all-constant pruning arm at state547. Reasons are recorded individually. No
  unclassified runtime hunk or additional sufficiency gap remains. Types,
  comments, README and Makefile are declarative; the recording/acceptance tools
  execute in the authenticated hot/cold evidence. Nine affected old gates and
  promoted old boundaries pass at this head.
- P11 — the bounded independently chosen shader uses four distinct 2x2 RGBA
  images, VS samplers 3/15 and FS samplers 2/15, nonidentity and all-constant views,
  GENERIC14 flat raw words and GENERIC15 smooth values at physical28/29/31.
  Seeds `0x38f27cd1` and `0xba29ad44` run 22 queued hardware frames under delays
  3/7, step budgets 3/4 and varied task waits. Full/short/empty banks, contexts,
  shader/view name reuse, cache eviction and optimized native reads agree with
  independent CPU equations over every 8x8 pixel (budget 1). Twenty-five fresh
  metadata attacks and two native admission attacks hold before draw. The final
  byte quota includes input TGSI and fails at opcode31, proving variant admission.
  An initial prediction demanding all unused native reads disappear was too
  strong; its recorded observation and correction before the final run are in
  `prediction-correction.json`. Driver retention is allowed by this task.
- P12 — sabotaged the new oracle once by remapping only the actual served VS
  blue view lane to red. The compiled shader reaches its real draw/fence, then
  fails specifically `critic-full-955415761 independent pixel oracle`: predicted
  `[91,117,153,140]`, observed `[82,117,144,140]`, error9. Native word uploads
  remain valid; no unrelated admission error stands in for the pixel failure.
  `sabotage-audit.json` records exact source custody and report digest.

Carry unchanged E6-T11d4 compiler/device/transport proof at
`9323b44519710dfb2c8a324fe115872b79d274f0`, and the byte-identical old
numerical/metadata prefix SHA256
`bfd25f78876cb1b60c7d04de81245c5d9e3938fb4d34f6b0e723961d896afdd2`.
Rebuilt 16MiB Wasm SHA256
`40772f2a609b803a11f97a3cdd35087810964c2dd35662e0bb143e7144f97287` matches
both recordings. Do not re-litigate unchanged HELD boundaries during repair;
recheck the changed native-admission boundary and the affected proof instead.

The critic seal `manifest.json` / `records.json` / `recording.tar.gz` contains 52
records, including raw reports, screenshots, coverage, predictions, reproduction
scripts, audits and frozen runtime/test sources. Archive SHA256
`6f05eeafad2f2dcdc225957b6ee95889855c1abc3538b480ad3f9a1222257c9b`, index
`09f798b43f4b9e960c97879b682ac0110089cb9f124b42108d79edd4093cbd7e`.
The expanded worker archive is excluded. To inspect packed recorded points,
extract this archive in a scratch directory; the names in findings are members
relative to its root. Original worker points remain in its authenticated seal.

Commands run from the managed worktree:

```sh
python3 evidence/virgl-standard-state/verifier/authenticate.py
python3 evidence/virgl-standard-state/verifier/recording_audit.py
node tools/virgl-command/standard-state-pixels.mjs evidence/virgl-standard-state/verifier/unpacked/hot
node tools/virgl-command/standard-state-pixels.mjs evidence/virgl-standard-state/verifier/unpacked/cold
node tools/verify-virgl-standard-state-adversarial.mjs --output evidence/virgl-standard-state/verifier/independent-final
node tools/verify-virgl-standard-state-adversarial.mjs --output evidence/virgl-standard-state/verifier/sabotage --mutation vs-blue
node evidence/virgl-standard-state/verifier/metadata_probe.mjs --output evidence/virgl-standard-state/verifier/metadata-omission-recheck
python3 evidence/virgl-standard-state/verifier/coverage_audit.py
python3 evidence/virgl-standard-state/verifier/seal.py --verify
```

The sabotage and omission commands correctly exit 1. The coverage script emits
raw counts; this adjudicated `coverage-audit.json` adds the explicit waivers.
The independent shader/texture oracle and omission repro are committed as critic
regression candidates/evidence tooling. Terminal SUITE promotion waits until
F1/F2 clear. No runtime repair was made. Return this task to `in-progress` for
worker repair and affected re-recording; keep the isolated single COLOR0 scope.
