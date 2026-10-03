---
id: E6-T12f3
epic: 6
title: Establish an explicit admission contract for radial shader definedness
priority: 525.0269913
status: verified
depends_on: [E6-T12f2]
estimate: S
risk: high
capstone: false
---

## Boundary

The a6143f11/e911b393 radial forms leave TEMP2.x unwritten on the small-coefficient
linear branch; later alternate-root selection can make it observable. Treat it
as a separate semantic boundary. Start with the concrete finite counterexample:
q=(4,0), CONST5.xy=(0,0), CONST7.xy=(1,0), CONST6.x=CONST8.x=0,
CONST4.x=2^-20, raw CONST3.x=0 gives B=4,C=16,t=2. Different missing TEMP2 values
can select a visible root or transparent output. Never silently select zero.

Implement an explicit bounded certificate and immutable finite-bank admission
that excludes the undefined predecessor: absBits(CONST4.x)>=0x3727c5ac. Audit
the exact captured predicate graph and consumed lane versions before using that
fact in live-predecessor joins. Give this policy its own closed metadata kind;
preserve any simultaneous loop-count/indirect/finite contracts and validate all
obligations on the same owned bank generation before draw side effects.

This is a restricted admitted domain, not arbitrary-finite-bank radial support.
The existing capture creates these gradient shaders without binding them; it
cannot prove actual radial workloads satisfy the guard. Any workload support
claim needs a new untouched capture or named original execution with recorded
banks. If this specific policy cannot be proved, record the exact blocker.

## Deterministic acceptance

`make verify-E6-T12f3` records the counterexample, independent predicate/domain
proof, threshold neighbors and signs, both captured structural forms, exact
owned bank generations and before-draw failures. Exercise replacement, sync/
async interference and restoration; record native/Wasm parity and hardware
results only for admitted paths. Preserve caps and final pristine-clone proof.

## Adversarial verification

Attack coefficient zero, signed zero, subnormal values, threshold +/-1,
NaN/Inf, altered predicates/lane versions, stale approvals and dropped combined
contracts. A removed domain check must admit the counterexample and fail the
independent definedness oracle before unsafe GPU execution. Never infer workload
compatibility from shader creation or a compile-only result.

## Verification log

### 2026-10-03 — worker — activation

Dependency E6-T12f2 is verified at
`ab1f145616fc9dbf97e8113759622b6848cdfeee`. Begin with the task's finite
counterexample and independently prove the exact coefficient predicate. Bind
one bounded graph certificate to consumed lane versions and exclude only its
small-coefficient predecessor under a new explicit immutable-bank domain.
Keep simultaneous finite, indirect and loop-count contracts on the same owned
bank snapshot through synchronous draws, asynchronous jobs and restoration.
Submit native sanitizer/Wasm parity, before-effect domain failures, admitted
hardware paths, actual domain sabotage and final pristine-clone evidence with
`make verify-E6-T12f3` for a fresh adversarial verifier.

This is a restricted compiler/shared-renderer admission boundary. Original
PRECISE-bearing bodies remain independently gated; compiler fixtures cannot
establish radial workload compatibility. The isolated renderer is not wired
into the demo's guest negotiation, so this slice claims no deployment, guest
execution or desktop 300 MIPS.

### 2026-10-03 — worker — final restricted-domain submission

Runtime implementation: `5c71957192758f0c14302683c628cf47e215eb75`.
Final source under proof: `ee23e8d63ba27afec874ec7dc63c6c6be3c7ee7a`.
The frozen implementation adds one typed, bounded radial graph certificate and
closed profiles 14/15/16. It binds adjacent MAX/FSLT/UIF producers and the current
consumed TEMP lane, requires the complete matching ELSE/ENDIF, and excludes
only the certified small-coefficient predecessor under the mandatory owned
bank contract. It does not initialize the missing lane. Finite, static-indirect
and counted-loop obligations are checked on the same immutable captured bank
before draw effects, and independently on restoration.

Commands recorded:

```sh
VIRGL_RADIAL_DOMAIN_EVIDENCE_DIR=target/evidence/radial-domain-worker make verify-E6-T12f3
node tools/virgl-radial-domain/browser.mjs --output target/evidence/radial-domain-worker/gpu
python3 tools/virgl-radial-domain/probes.py --output target/evidence/radial-domain-worker/probes
python3 tools/virgl-radial-domain/receipt.py target/evidence/radial-domain-worker
python3 tools/virgl-radial-domain/receipt_attacks.py --evidence target/evidence/radial-domain-worker --output target/evidence/radial-domain-worker/negative-receipts.json
python3 tools/virgl-radial-domain/receipt.py target/evidence/radial-domain-worker
python3 tools/virgl-radial-domain/cold.py --output target/evidence/radial-domain-cold
```

The canonical command records the pinned-source/build checks, native ASan/UBSan
and LLVM coverage, fixed-memory Wasm full-result parity/recovery, twelve
supplemental native/Wasm graph probes, rational predicate/counterexample proof,
metadata/ownership/source-fault attacks, physical WebGL2 rendering, retained F2
hardware and independent oracle, and positive/negative receipt consumers.
The original worker run passed all runtime gates but failed sealing because the
browser source inventory duplicated an already discovered pinned fixture.
That original `acceptance.log` is preserved. Only the recording harness changed;
`resubmission.log` records the focused successful commands above. Every ancestral
recording checks each source against both its recorded Git head and the final
identical source. Unchanged native/Wasm/domain/retained evidence carries forward
under the incremental policy. The final pristine-clone canonical command passed
directly at the final proof head, without adaptive repair, with clean status
before and after and scrubbed build/runtime environment variables.

Recorded results:

- Native: 4,344 stages / 429 pairs / 19 untouched originals, 1,139,669 API
  calls, 577,182 standalone and 546,804 pair recoveries, 4,096 seeded mutations,
  324 hostile cases, 6,304 truncations and 121 actual allocation-fault attempts.
  Every retained F2 result remains byte-identical (4,300 stages / 378 pairs).
- Wasm: 12,298 calls with full native-result equality, 3,800 standalone and
  3,600 pair recoveries, 64 stress calls and 33 actual pressure attempts across
  three targets. Memory remains the same 16 MiB ArrayBuffer; the 256 KiB stack,
  179-instruction limit and existing result/arena caps remain unchanged.
- Domain: 240 independent rational checks, 164 rejected closed-metadata
  forgeries, twelve owned-caller mutations and three combined count-19
  failures. Removing the actual coefficient check admits the literal 2^-20
  counterexample and fails the independent oracle before any GPU draw. Missing
  TEMP2 word zero selects a transparent root; word 0x407ffffe selects a visible
  alternate root. The implementation never substitutes either value.
- Supplemental probes: four accepted / eight rejected nested/version/control
  forms with native ASan/UBSan and Wasm full-result parity, real LLVM raw
  profiles and a source-bound coverage export.
- Hardware: Chrome 154.0.8037.93, ANGLE Metal on Apple M4 Max; 21 rigs,
  138 admitted draws, 565,248 whole-frame pixels, 258 before-effect failures,
  six asynchronous schedules and zero console/page/request errors. Recorded
  bank words, shader/bank generations, VB/IB bytes, actual GPU poisoning during
  an asynchronous yield, replacement/restoration and final zero live objects
  are independently checked. All shader source bytes match recorded compiler
  output. Full pixels and V8 coverage survive in the lossless archives.
- Retained F2 hardware: 1,216 exact words, 1,245,184 pixels, 196,608 observed
  demand pixels and 88 rigs. Earlier F1 hardware predictions remain HELD only
  across unchanged source/evidence boundaries; no obsolete predecessor full
  gate is claimed. Twenty-one physical/typed receipt forgeries are rejected.

Evidence of record:

- Worker recording: `target/evidence/radial-domain-worker`, preserved as
  `evidence/virgl-radial-domain/worker.tar.gz` (49 files), SHA-256
  `7c6c072899bf3d242ab2e36c12893f009178654d9e5762455f3caecd77e37862`.
  Final worker receipt SHA-256
  `496522d2b5b73a17e81b37b4cb751094a171a5e300a7ed40b836fc9952cdee1f`
  binds 182 sources and 47 recorded artifacts.
- Pristine recording: `target/evidence/radial-domain-cold`, preserved as
  `evidence/virgl-radial-domain/cold.tar.gz` (50 files, including 48 acceptance
  artifacts), SHA-256
  `d8ced30900b9fd9ffce4f2866c41c37d333fc9a47be8c4dfde254d663af5c8cd`.
  Cold receipt SHA-256
  `cf79cc161526ebe8d288c962b255f3a57bc9703bd1cfd0f7d09d6a1d4e0cb773`;
  cold report SHA-256
  `47216de50dab608d003ff77508eee2dc9be7f8fcfb307f8cdafedbe145de2362`.
- `evidence/virgl-radial-domain/manifest.json`, SHA-256
  `c36806f2fbad051b6106d60f94db8e7fbf7f75dc75198493ec1a3ad9688f2cd0`,
  binds the lossless archives, both receipts, cold report, native LLVM binaries
  and screenshot. Every archive member was streamed and checked against the
  original byte count and SHA-256. README documents extraction and proof scope.

The recording demonstrates restricted definedness admission for the exact
certified graph, simultaneous obligations on one owned bank generation, and
safe rejection before effects. Both full-body fixtures are explicitly authored
structural ports: PRECISE qualifiers are removed and the alpha MOV is projected
with numeric ADD zero; the corresponding unprojected port remains rejected.
Untouched original corpus admission is still 12/19. This submission establishes
neither actual radial workload banks, untouched radial shader compatibility,
guest GPU negotiation, deployment nor desktop 300 MIPS. A fresh verifier must
falsify the claim and audit changed-hunk coverage before setting `verified`.

### 2026-10-03 — fresh verifier — VERDICT: verified

VERDICT: verified

Read the full task and diff from `ab1f145616fc9dbf97e8113759622b6848cdfeee`
through `ee23e8d63ba27afec874ec7dc63c6c6be3c7ee7a` before examining evidence.
Eight falsifiable predictions were recorded first in `predictions.json` inside
the verifier archive. Worker submission `48787ee5` changes evidence/status only;
the runtime remains the exact frozen implementation. No implementation code was
edited by this verifier.

- **P1 coefficient predicate/counterexample — HELD.** Predicted finite admission
  exactly when numeric abs(coefficient) reaches the captured threshold, for
  both signs, zeros, subnormals, adjacent words, NaN and Inf. Independent seed
  `0xe3d21a77` plus literal witnesses produced 4,138 matching actual bank checks.
  Recomputed q=(4,0), B=4,C=16 and coefficient 2^-20: primary root2;
  missing word0 selects transparent root4194304, word0x407ffffe selects visible
  root0.5. Points: `attacks.json#/classification`, lines42459-42480
  (`counterexample`), and worker `domain/report.json#/proof`.
- **P2 exact graph/current lane/live join — HELD.** Every altered predicate,
  threshold, constant/component, clobbered producer and unrelated missing lane
  rejects. The novel zero-selector enclosing branch cannot grant TEMP2 to an
  outside consumer; negated UIF and partial ELSE reject in both stages. A
  current magnitude/predicate destination alias succeeds with profile14.
  Eight new native/Wasm full-result comparisons and thirty retained negative
  graph checks held. Points: `attacks.json` lines40600/40924 (dead enclosure),
  lines40614/40938 (negated selector), and `promoted-regression.json#/normal/graphs`.
- **P3 closed combined policy/ownership — HELD.** Predicted dropped radial,
  finite, indirect or count contracts and every old-profile radial forgery to
  fail; 96 independent metadata attacks held, supplementing the worker's164.
  Twelve caller mutations leave the approved frozen coefficient unchanged;
  six independent count failures retain the simultaneous radial obligation.
  Points: `attacks.json#/metadata`, `/ownership`, `/combined`; worker
  `domain/report.json#/forgeries` and `/combined`.
- **P4 before-effects and generation identity — HELD.** Independently repeated
  all21 physical rigs with async seeds `0x177a50e1` and `0xf9b32c0d` (one and
  three commands per step). Observed138 admitted draws,565248 exact pixels,
  258 before-effect failures, six async schedules, complete safe replacement
  and restoration, real native poisoning during an index-wait yield, busy
  mutation rejection, exact uploaded banks and matching shader generations.
  No console/page/request errors or surviving native objects. Points:
  `independent-gpu/report.json#/acceptance/rigs`, `independent-gpu-audit.json`;
  its source inventory binds the actual served runtime and Wasm to the proof
  head. Only the copied verifier test's import URLs and prescribed seeds differ.
- **P5 parity/caps/coverage — HELD.** Reconstructed the full sealed native and
  Wasm receipts against raw transcripts/results,182 sources and47 artifacts.
  Native log line1 records rawIR26480/profile7616, line4919 arena52644,
  line4920 all1,139,669 calls; 4344 stages/429 pairs and all original results
  match. The actual retained native binary/profile independently reproduces
  the complete LLVM export. New graph/retry/metadata hunks execute in real
  LLVM and V8 counters. Worker browser line198's helper extent rejection was
  unexecuted; the final promoted regression independently executes it seven
  times in each of two recorded V8 runs. Fixed16MiB memory,256KiB stack,
  instruction179 and output caps survive. Points: `coverage-audit.json`,
  `archive-audit.json`, `receipt-reconstruction.json`; native log digest
  `b19f3e0f0a01b93e596bef5cded82fed0b4cdbd64bfdfbf328b613cc3284649c`.
- **P6 scope and unchanged predecessor — HELD.** Independently reconstructed
  both complete port bodies using exactly PRECISE suffix removal and numeric
  ADD-zero alpha projection; original capture digests and bytes match the
  dependency commit. Untouched originals remain12/19. Full retained F2
  results remain4300 stages/378 pairs byte-identical; unchanged HELD F2/F1
  predictions and retained hardware evidence carry forward without an
  obsolete full predecessor gate. Points: `fixture-provenance.json`, worker
  native `compatibility` and retained-selected receipt fields. No radial
  workload, original PRECISE, guest/deployment or300MIPS inference is made.
- **P7 actual source sabotage — HELD.** Independently removed exactly the
  actual consumer coefficient guard in an isolated copy. The normal helper
  rejects2^-20; the fault admits its same owned bank and the independent
  numeric predicate throws before any GPU call. The promoted regression
  also fails under this source fault with `AssertionError`; GPU calls0.
  Points: `attacks.json` line42481 (`sabotage`),
  `promoted-regression.json` line274 (`actualSourceGuardRemoval`).
- **P8 exact-head/cold provenance — HELD.** Independently hashed every worker
  and cold lossless archive member (49/50), inspected ancestral binding, and
  reconstructed the cold receipt from its own pristine clone. The canonical
  cold command passes at exact `ee23e8d6`, exit0, clean before/after; the
  clone remains clean on direct inspection. The harness clears RUST/CARGO_
  and build/runtime override variables before cloning; RUST_LOG was removed.
  Points: `cold-audit.json`, `archive-audit.json`, cold `report.json` and
  `acceptance/receipt.json`. No stale or unexercised runtime source remains.

**COVERAGE waivers.** Comments, whitespace, function declarations, typed
certificate fields/static layout assertions and documentation are declarative;
their matching runtime functions and measured layouts execute. The recognizer's
`end == ir->count` defensive arm is unreachable after successful balanced-control
syntax validation; missing ELSE and duplicate graphs are exercised. Optional
native `--smoke` output is not a submitted product claim. Fixture generation is
authoring support, and its resulting exact inputs all execute; both original-to-
port operations were independently reconstructed. Acceptance/build plumbing is
exercised in the canonical clean-clone log. All waivers and actual line/range
counters are retained in `coverage-audit.json`; none waive changed runtime
behavior named by the task.

**SUITE.** Promoted
`renderer/virgl-command/tests/radial-domain-regressions.mjs` preserves the novel
live-join attacks, current producer alias, independent numeric threshold oracle,
owned-word mutation, invalid extent/type errors and simultaneous count constraint.
Its actual-Wasm run has8 graph cases,38 coefficient cases and7 extent failures.
It is source-sabotage checked. No implementation edit or unrelated gate was needed.

Verifier commands:

```sh
node target/evidence/radial-domain-verifier-20261003-fresh/attacks.mjs
node target/evidence/radial-domain-verifier-20261003-fresh/browser-run.mjs
node renderer/virgl-command/tests/radial-domain-regressions.mjs
node --check renderer/virgl-command/tests/radial-domain-regressions.mjs
```

Additional recorded Python/Node interrogations reconstruct receipts at the frozen
head and inside the cold clone, audit per-line LLVM/V8 counters, reproduce the
native LLVM export from the sealed binary/profile, check archive members and
sabotage the promoted suite. Records are losslessly preserved in
`evidence/virgl-radial-domain/verifier.tar.gz` (44 files), SHA-256
`818289db824978ab6f607fbc7d18043f65c36c348913ca45d1c5932f58d8b4f0`.
`verifier.json` binds the archive and summaries, SHA-256
`a9e9f2cf38716b3e14b4605ac12f15dfb1f5faae63851d4ba63acb8e7e7cb6b3`;
`verifier-verdict.json` preserves all eight predictions and citations, SHA-256
`7eb73c0c398ebd3e852b97bcb38c3fa538b886968bdcd7b828f1c2e955ed64c9`.
Each archive member was independently compared to its original size and digest.
The worker receipt digest remains
`496522d2b5b73a17e81b37b4cb751094a171a5e300a7ed40b836fc9952cdee1f`;
the pristine receipt remains
`cf79cc161526ebe8d288c962b255f3a57bc9703bd1cfd0f7d09d6a1d4e0cb773`.
