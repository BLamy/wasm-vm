---
id: E6-T12f2
epic: 6
title: Prove selected-away interpolation lanes without inventing values
priority: 525.0269912
status: verified
depends_on: [E6-T12f1]
estimate: S
risk: high
capstone: false
---

## Boundary

Implement one bounded observational-definedness family for the captured outer
ELSE/interpolation/final-UCMP forms in 5a243fc7 and a6143f11. On the relevant
predecessor the interpolation operand is unwritten, but the final selector
provably discards its entire result. Preserve predicate/lane versions and
control predecessor identity. Guard or sink the arithmetic so emitted ESSL does
not read the unwritten value on that path. Do not union initialization masks,
zero-initialize missing data, or assume zero times an undefined value is zero.

This does not resolve the separate radial TEMP2.x alternate-root gap. A missing
selected arm or a changed selector must still reject. Preserve runtime/IR/flow
caps and original body identities; PRECISE remains independently gated.

## Deterministic acceptance

`make verify-E6-T12f2` proves independently authored instances of both captured
selection forms with exact words/pixels and checked predecessor traces. Exercise
both defined and discarded predecessors, all destination lanes, aliases and
nested control. Record native/Wasm parity, complete retained outcomes, actual
hardware through the shared renderer and final pristine-clone evidence.

## Adversarial verification

Reverse the final selection, overwrite an aliased selector, change zero to
nonzero, remove one selected lane and insert a NaN intermediate. Sabotage the
demand/certificate check and require an independent poison witness to fail.
Changed arithmetic must execute or have an explicit unreachable-path proof;
no shader-hash allowlist or manufactured initialization is permitted.

## Verification log

### 2026-10-03 — worker — activation

Dependency E6-T12f1 is verified at
`2a0d0359de37452d5a78bb9ab6fbf8583c69cb7c`. Implement the one captured
join/weight/interpolation/selection family with an owned bounded certificate,
guarded interpolation publication and lazy final selection. Initialization
masks stay intersected; unrelated missing reads, the radial gap and PRECISE
remain rejected. Preserve all full F1 recorded stage/pair/original outcomes.
Submit sanitizer/counter, fixed-memory Wasm, independent hardware word/pixel,
actual certificate/emitter fault and pristine-clone evidence for a fresh critic.

The compiler remains isolated from the demo's guest negotiation, so this slice
does not deploy or claim guest execution, all19 closure or desktop 300 MIPS.


### 2026-10-03 — worker — implemented, fresh verifier required

Runtime commit `e332abb975d6a4b7793717b680e65fd630fd87eb`; final proof source
head `5a34d6e5aeba3e52365484700aa921a24cb2d3f6`. The intervening commit adds
only a missing JSON import to the retained hardware receipt validator. Native
and Wasm source/counter/parity checks were carried forward by their complete
unchanged source digests; affected browser/fault recordings were refreshed at
that exact final head. The final pristine clone ran the whole acceptance there.

Commands: `EMCC=/tmp/wasm-vm-emsdk/wasm-vm-emcc
VIRGL_SELECTED_LANES_EVIDENCE_DIR=target/evidence/selected-lanes-worker make
verify-E6-T12f2`; after the receipt-only import repair, rerun
`tools/virgl-selected-lanes/browser.mjs`, the unchanged F1 hardware wrapper,
`faults.py`, both actual-fault browser modes, `receipt.py`,
`receipt_attacks.py`, and final `receipt.py`. Full command transcripts are in
the worker archive's `acceptance.log`. Final confirming command:
`python3 tools/virgl-selected-lanes/cold.py --output
target/evidence/selected-lanes-cold-final` (scrubbed `make verify-E6-T12f2`,
exit0, clean before/after, unchanged exact head).

Evidence: `evidence/virgl-selected-lanes/manifest.json`, SHA-256
`142e1ea6caa60ae7f9e6f322c656dc57ce2c9074b14636ed658fa85d19ff7b85`.
Lossless `worker.tar.gz` SHA
`c6d03d170a783b339c407759d0b7552231f632987605e5a703b670ce422ef30b` and
`cold.tar.gz` SHA
`2e68bfcdc53dff0fe12ac9768e25b66bd6949279e5fbe57559e9457ed09dc3ec`
preserve every original logical record, including the full186MB GPU JSON;
README gives extraction commands. Worker receipt SHA
`07bdb94f284666735cb6c466da00e4ae54deb87fd514d40a33a321e7c3238edd`;
cold receipt SHA
`2b58dceebd023bb123835feb2b3c8b13d0ce898c6be7350e95324a4057309db2`.
Original sanitizer binaries are included with their actual report digests and
LLVM coverage mappings. Screenshot: `evidence/virgl-selected-lanes/browser.png`.

Claim: a compact owned certificate proves one graph's initialized true
predecessor and signed-zero discarded predecessor; initialization intersections
and logical destination kills remain strict. Guarded interpolation and exact
lazy final selection preserve both-stage words across all destination masks,
safe aliases, swizzles, nested paths, finite payload/width contracts and a
selected-away NaN intermediate. Unsafe selected lanes, modified predicates,
nonzero/NaN zero arms, fallback clobbers, unconditional result reads and second
graphs reject. Native ASan/UBSan records4300 stages/378 pairs,802797 calls,
62 allocation failures,4096 mutations,324 hostile cases and3954 truncations;
all4152 retained stages,298 pairs and19 originals are full-result exact. Wasm
records19246 calls, fixed16MiB memory,32/30-profile recovery,30 real pressure
attempts and recovered allocation capacity. Shared actual Metal/WebGL2 renders
1216 exact words/1245184 pixels and196608 demand-observer pixels in88 fully
released rigs; retained F1 records640 words and8 unchanged migrated bodies.
Real emitter and width-certificate faults fail independent demand/poison
witnesses in both stages. All21 promoted recorded-data forgeries reject. Each
submission binds202 sources and48 records. Both worker and final cold receipts
pass. IR26464/profile7616/flow52644 remain below32768/8192/53248 caps.

The original capture outcome remains12/19. PRECISE and the separate radial
TEMP2.x gap remain gated; no guest execution, production negotiation, deployment
or300MIPS is claimed. This is a worker submission, not a verified verdict.

### 2026-10-03 — fresh adversarial verifier

VERDICT: verified

This session did not implement F2. It read the task and the diff from verified
parent `2a0d0359de37452d5a78bb9ab6fbf8583c69cb7c` through worker submission
`355050b5` before opening evidence. Runtime source remains
`e332abb975d6a4b7793717b680e65fd630fd87eb`; the recorded proof source is
`5a34d6e5aeba3e52365484700aa921a24cb2d3f6`. Predictions were written before
inspection in `target/evidence/selected-lanes-verifier-20261003/predictions.txt`.
All paths below are relative to that fresh ignored verifier directory unless
they start with `evidence/`, `renderer/` or `tools/`.

- P1 identity and completeness — HELD. Predicted exact archive/native hashes,
  every logical receipt byte, unchanged final source, and clean cold checkout.
  Independently checked the manifest SHA `142e1ea6…ff7b85`, both archive hashes,
  both original sanitizer binaries, all48 worker records and all50 cold
  acceptance files. Extracted receipts equal the direct committed receipts byte
  for byte. Valid AppleDouble metadata was separated from logical recordings;
  no logical data was removed. `archive-audit.json` records every check. Explicit
  `receipt.verify(worker, proof_head)` reproduced the entire original receipt;
  the same audit from the recorded cold source root reproduced the cold receipt.
  The cold report records exit0, clean before/after, unchanged detached exact
  head, and scrubbed environment; its existing clone still matches that head.
  Citation: `worker-receipt-audit.log`, `cold-receipt-audit.log`, and
  `cold/report.json`. No new full gate or cold clone was necessary.
- P2 predecessor, definition and physical observations — HELD. Predicted plain
  true words `[3e800000,3f000000,3e800000,3f000000]`; discarded words are four
  `3e800000`, with undefined deferred payload versions and zero LRP demands.
  Observed exactly those states at `worker/gpu/report.json`
  `/acceptance/rigs/0/draws/0` and `/acceptance/rigs/0/draws/1`. FormB outer-false
  produces four `3f400000` at `/acceptance/rigs/66/draws/3`; nested false and
  swizzled words match the independent dyadic predictions at rigs55/draw2 and
  31/draw0. Reconstructed words directly from physical RGBA bit planes, then
  checked every pixel and literal definition-version/predecessor trace through
  the complete receipt audit. Both-stage masked lanes, safe aliases and all
  nested vectors hold. Citation: `physical-prediction-checks.json`; original GPU
  report SHA `1e936265ede855548c7bba12fc7a3657310d1c16d46ac71d58c31f4963879c79`.
- P3 guard and actual shared consumer — HELD. Predicted signed-zero missing
  paths skip interpolation and both publications, and final selection reads
  fallback lazily. Old destination, negative-zero and discarded-NaN cases hold
  at rigs51/draw1, 68/draw1 and58/draw1 respectively; the last records a NaN DIV,
  undefined payload versions, zero demands and four exact fallback words.
  Every normal single/pair result equals native source/metadata exactly; actual
  `shaderSource` bytes equal those results, with only the separately reconstructed
  observer/poison projections in diagnostic rigs. All uploaded184-word banks,
  physical uniform readbacks, immutable vertex/index buffers, real indexed
  draws, framebuffer bytes, object deletions and zero final budgets were
  checked. Observed1216 words,1245184 pixels,196608 observer pixels and88 released
  rigs on Chrome154.0.8037.93 / ANGLE Metal Apple M4 Max. Screenshot inspected:
  `evidence/virgl-selected-lanes/browser.png`.
- P4 strict rejection, ownership and bounds — HELD. Every task attack rejects
  both forms/stages: reversed/changed selector, aliased selector/weight clobber,
  nonzero/NaN zero arm, missing selected lane/predecessor, fallback clobber,
  unconditional old-result read, second graph and PRECISE. Complete retained
  F1 stage4152/pair298/original19 results remain exact; F1's untouched consumer
  boundary and640 hardware words/eight migrated bodies are carried forward.
  Native observes802797 calls,62 injected allocation failures and full recovery;
  Wasm observes19246 calls, stable16MiB memory, owned responses and30 real
  pressure attempts with recovered capacity. Measured IR26464, profile7616 and
  flow52644 remain within32768/8192/53248 caps. Citation: checked native
  transcript/report, `worker/wasm/calls.jsonl`, both reproduced receipts and
  `worker/retained-equality/report.json`. Original capture status remains12/19.
- P5 actual sabotage and poison falsification — HELD. Predicted guard removal
  executes a discarded interpolation and zero expected demand pixels become
  255; observed both stages at `worker/fault-guard-open/report.json`
  `/acceptance/rigs/0/draws/1/failure` and rig1's same point, SHA
  `86eb2cf364de0fcc29cfd1282342c736125814d8bb8633e650816fe0394a98a6`.
  Width-check removal admits a missing nonzero-width predecessor; distinct
  diagnostic poisons produce four0 words versus four`3f800000` words at
  `worker/fault-width-proof/report.json` rigs0/1 and2/3 draw0, SHA
  `06665333dd7b2e11f6b5ab0bd2ce00068a8a9c48a7509d9491c8000439fb8ce1`.
  Checked sealed mutated C bytes, actual native/pair/Wasm artifacts and parity
  before those hardware witnesses. Independently rebuilt the real width fault
  in `sabotage-source/`; the new test exits1 on the nonzero-missing-width
  prediction, while four fresh both-form/both-stage cases change rejection to
  unsafe success. Citation: `independent-sabotage.json`, `promoted-sabotage.log`.
- P6 diff execution and sufficiency — HELD. Independently remerged each original
  raw profile and used the supplied original sanitizer binary to reproduce
  every recorded LLVM segment, branch and function counter exactly, including
  the cold clone's actual source filenames. All changed executable C lines
  have hits: demand_graph102154, demand_join512497, demand_retry103215,
  checked_source80392212. Ten defensive statement points (18 LLVM regions)
  initially had zero worker hits: bridge.c:222,396,414,425,426,427,438,441,642,657
  (222 is the NULL ternary; the other points include the combined guard return).
  The independent source-identical compiler attack recording now hits every
  such region, including width/condition/payload/fallback version clobbers,
  no-ELSE admission and unrelated missing reads after a fully defined graph.
  Citation: `llvm-audit.json`, `worker-changed-line-counters.json`,
  `supplemental-return-coverage.json`, `attack-coverage.json` and its line-count
  rendering. No changed executable implementation statement remains unproved.
  **Waived:** raw_bits.h layout/flag declarations and static assertions are
  types/configuration, directly measured by the sanitizer layout and Wasm cap
  observations. The native acceptance test's unused smoke/logging/fatal-assert
  paths at selected_lanes.c:267-268,284,36 are test diagnostics; smoke cannot
  satisfy the receipt's closed full-run grammar. All acceptance harness paths
  have original LLVM counters, and the separate new pair driver has independent
  counters plus11 complete/malformed protocol runs in
  `pair-harness-coverage.json` / `pair-harness-observations.json`. No dead product
  hunk was found, and no shader hash participates in compiler admission.
- P7 bounded novel attack and proof-consumer attacks — HELD. Predicted safe
  alpha/lane-renamed graphs with independently chosen dyadic bounds, swizzles,
  nested branches and payload aliases compile; changed lane versions reject.
  Observed220 native/Wasm-exact checks:56 accepted,164 rejected. The matrix
  checks every15 mask spelling with the unchanged parser's seven supported
  forms accepted and eight unsupported forms rejected; it does not invent new
  mask syntax. Added inner-predecessor missing-lane, width/condition producer
  clobber, aliased selector, fallback version and legacy-without-IR attacks.
  Independently reran all21 typed recorded-data forgeries; all reject with the
  same concrete reasons. Citation: `independent-attacks.json` SHA
  `dfd4ae05b3fda6b1f73d88010bb780bc98bc1226a252722b6a96f57c7bf2cce1`,
  `independent-wasm.json` and `fresh-forgeries.json`.

SUITE: promote `tools/virgl-contract/test_selected_lane_versions.py`. It authors
the220 bounded cases without consuming recorded compiler results, asserts the
actual public bridge outcome, and was rerun successfully after promotion; its
isolated compiler sabotage recheck fails as predicted. Run with
`python3 tools/virgl-contract/test_selected_lane_versions.py --binary
renderer/virgl-shader/build/native/virgl-shader --output
target/evidence/selected-lanes-fresh-versions.json`; optional `--profile-dir`
records actual native counters. Existing literal hardware, full-result parity,
fixed-memory/ownership and typed receipt tests are retained. No runtime change,
new metadata authority, demo deployment, guest negotiation, all19 closure or
300MIPS result is part of this verdict.

Commands: explicit-head worker/cold `receipt.verify` calls; independent
`llvm-profdata merge` and `llvm-cov export/show` using original artifacts;
source-identical instrumented native/pair builds in the isolated verifier copy;
the promoted220-case command; actual Wasm bridge parity for those220 requests;
isolated width-certificate sabotage; full21 recorded-data forgeries. Source and
record digests are sealed in `verifier-inventory.json`. Status gates:
`python3 tools/check_task_policy.py`, `python3 tools/build_queue.py`.
