---
id: E6-T11d1
epic: 6
title: Execute the GLES2 ordinary vertex constant-bank floor
priority: 525.027035
status: verified
depends_on: [E6-T12i]
estimate: S
risk: high
capstone: false
---

## Boundary

Before any positive guest API capset, extend the ordinary straight-line finite
vertex compiler and actual state reflection/upload path to 128 guest-addressable
slot-zero vec4 constants. Retain the existing raw/certificate 46-register boundary
and fragment boundary; wide constants do not gain integer, indirect, private
exact-bank or raw numeric authority. Preserve the upstream final-CONST0 extra
inaccessible element, host limits, complete active-word validation, owned banks,
per-owner caching and fixed Wasm memory/stack/output bounds. This is an isolated
capacity prerequisite, not a claim that every GLES2 feature or production guest
renderer is qualified.

## Deterministic acceptance

`make verify-E6-T11d1` compiles highest-register MOV/ADD/MUL/MAD paths in native,
sanitized and Wasm builds and executes actual original VirGL packets through
physical WebGL2. Read slot127 and multiple high slots, reflect complete active
prefixes, change all consumed high values between draws and require independent
literal pixels without stale cache/uniform state. Test the final-CONST0 suffix,
standalone and paired translation, context A/B/A and real asynchronous retirement.
Reject slot128/ranges crossing it, fragment/private/raw high-slot attempts,
malformed/short/nonfinite banks and reduced host limits before an actual draw.
Retain affected compiler/native/state/cache regressions and final pristine clone;
seal exact-head source, outputs, raw pixels, coverage and screenshots for a fresh
critic. Production caps remain disabled and demo imports are unchanged.

## Adversarial verification

Attack holes, reordered declarations, duplicate last CONST0, aliased masks,
inactive uniform suffixes, short banks differing at the highest active slot,
source modifiers crossing into raw paths, metadata forgery, context reuse,
cache pressure and caller mutation during asynchronous work. Check fixed native/
Wasm input/token/output/stack limits and the untouched private numeric boundary.
Invent one bounded physical attack and sabotage the high-index upload or capacity
check so the pixel/boundary oracle fails. Carry unchanged proof leaves forward.

## Verification log

### 2026-10-09 — worker — activated

Continue the explicitly requested production graphics chain from the verified
E6-T12i boundary (`fcb908e756a5e2fe7eb6f29864e23b0e46652b37`). The negative
ordinary-Wasm readiness recording in
`evidence/virgl-production-readiness/constant-floor.json` demonstrates the
128-vector vertex-bank gap. This slice changes ordinary finite vertex capacity
and its actual reflection/upload only. Private raw/certificate and fragment
limits stay at 46 guest registers; no guest capset or production authority is
enabled by this slice.


### 2026-10-09 — worker — implemented; fresh critic required

Frozen runtime/harness source `92c98c7361cad2518200bfa99765ed5895ef4f95`,
from activation `2173be34` above readiness parent `cbb640fc387b69441c0b3978bea6f687d9ebcc45`.
Submission commands at that frozen source:

```sh
make verify-E6-T11d1
python3 tools/virgl-command/vertex-constant-cold.py --output target/evidence/virgl-vertex-constant-cold
python3 tools/virgl-command/vertex-constant-seal.py target/evidence/virgl-vertex-constant target/evidence/virgl-vertex-constant-cold evidence/virgl-vertex-constant/worker
```

Both the recorded hot gate (`target/evidence/virgl-vertex-constant`) and the
scrubbed, pristine final clone (`target/evidence/virgl-vertex-constant-cold`)
passed. Clone path:
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-virgl-vertex-constant-cold-z4k4aggo/wasm-vm`.
The seal binds 254 files and 393 exact-head source files per receipt. Committed
`evidence/virgl-vertex-constant/worker/recording.tar.gz` SHA256
`0438914308a3ccd17516af6a696ad65cfe9afbb5af589afd882ee7cc919c2d3c`;
`records.json` SHA256
`90489cd5702fa32ccc6bfc5ac97cd1d67febb731a6be8b410f5ffa82b5da6f34`.
Hot receipt SHA256
`c7a845562b622013c70d1a36df9ba8043ba57f5c5a4ed761346005a59be6a474`;
cold receipt SHA256
`d1b0c930b114076b9b1269403b9d68ec340c1e3f8ad892751044cf2c076e33b1`;
cold report SHA256
`ad06e3d093d014d0aadae3bb0a54cb426af435234dd092c1416bd5434ce01ea4`.

Claim: ordinary finite vertex slot127 MOV/ADD/MUL/MAD and complete pairs execute
through the actual delivered Wasm and physical headed WebGL2. The versioned v6
metadata alone authorizes wider vertex uploads. Fifteen ordered raw16x16 RGBA8
frames per hot/cold run have independently checked literal pixels and exact raw
512-word input banks; context A/B/A, bank changes, real cache eviction, owned
asynchronous inputs and actual fences are exercised. The upstream CONST0 suffix
remains inaccessible, host limits remain enforced, and malformed, short,
nonfinite, fragment/raw/private high-slot inputs and forged metadata reject
before a native draw. Delays0/1/3 all retire actual GPU fences. Upload truncation
to46 vectors fails the MOV literal pixel oracle at its first high draw. No
production caps, live guest, FPS, MIPS or API conformance are claimed.

The memory-exhaustion witness exposed unchecked allocations in the pinned TGSI
sanity checker. The unchanged pinned checker/hash sources now execute in one
256KiB scratch transaction: initial malloc failure or scratch exhaustion returns
a complete typed error, and the real16MiB Wasm module recovers exactly. A64-byte
sanitized scratch build exercises cancellation. Native arena coverage, Wasm
stack-usage files and full native/Wasm responses are archived. Parser/raw/IR
ceilings and the private46-register/184-component boundary remain unchanged.

Affected checks include29 native/sanitized/Wasm cases,603 retained compiler
cases,23 pairs,752 allocation faults,402 dynamic join/canonical cases,25 literal
original bodies, all current I/H/G5 physical resource/state/format/transfer/job
regressions, both10,000-draw I cache runs and the three independently seeded
promoted cache schedules. The older compiler-bound harness's four layout numbers
were stale after the already-verified exact-bank pointers; its measurement now
matches the unchanged parent raw header. The old promoted join witnesses used a
provably true immediate, whose unreachable ELSE was later admitted by verified
v41; the new adapter retains their two-live-predecessor oracle with an unknown
one-bit input and preserves each text/line/index boundary. These are explicit
harness updates, not new runtime branch admissions. Demo imports remain absent
for this isolated prerequisite; production bring-up resumes only after fresh
verification.


### 2026-10-09 — fresh adversarial verifier

VERDICT: verified

- P1 custody — HELD. Independently authenticated all 254 worker archive members,
  both 393-source exact-head receipts and their generated binaries against frozen
  source `92c98c7361cad2518200bfa99765ed5895ef4f95`. The pristine clone's before/after
  status is empty and its scrubbed command exited zero. Citations:
  `evidence/virgl-vertex-constant/verifier/authentication.json:/receipts` and
  the worker archive/index digests in the submission above.
- P2 ordinary/private boundary — HELD. All 29 complete native, ASan/UBSan and
  delivered-Wasm responses agree. Highest MOV/ADD/MUL/MAD and pairs use ordinary
  v6; high128, fragment46/127, holes, duplicate/overlapping/aliased declarations,
  raw and private high tuples reject without GLSL or partial pair payloads.
  Citations: sealed `hot/native/sanitize.jsonl`, lines1–29, and
  `recording-audit.json:/reports`. Seven additional complete native/Wasm high
  absolute/negative/raw/dead-branch witnesses and four forged authority contracts
  reject in `boundary-attacks.json:/records` and `/forged`.
- P3 physical words/pixels/owners — HELD. An independent rational-arithmetic,
  binary32-packing and RGBA8 oracle checked every byte in all 30 sealed hot/cold
  raw16x16 frames, original512-word VirGL packets and complete responses. Context
  A/B/A, actual cache pressure and all delays0/1/3 fence predicates hold; every
  recorded browser error collection is empty. Citations:
  `recording-audit.json:/reports/0/frames` and `/reports/1/frames`;
  sealed `hot/hardware/report.json:/browserResult/result/jobs` and cold equivalent.
- P4 reflection/upload — HELD. Declared/retained129 is capped at128 guest vectors;
  host511, malformed/short/nonfinite banks and metadata forgeries perform zero
  native draws. A fresh swizzle/partial-write probe independently exercises
  nonadjacent slots61/93, an unused declared127, finalCONST0, six exact physical
  frames across two owners and recovery. ANGLE actually retains129; the whole128
  guest prefix is required even when only94 vectors are referenced. Citations:
  `physical-final/report.json:/result/frames`, `/result/assertions`;
  `recording-audit.json:/reports`; `state.mjs:459–482` in the frozen diff.
- P5 scratch cancellation/recovery — HELD. The actual16MiB module returns a
  complete typed TGSI allocation error under genuine heap exhaustion and recovers
  identical output. The recorded64-byte sanitized transaction exercises longjmp.
  A fresh sanitized test injects12 initial arena failures, recovers identical
  single/paired output12 times and executes three out-of-transaction hash schedules.
  Nine actual-Wasm exhaustion schedules with varied allocation sizes/free orders
  also recover exactly. Citations: `scratch-boundaries.json`,
  `critic-scratch-coverage.json` for `checked_tgsi_sanity.c:19,22–25,32,48`,
  `wasm-pressure.json:/pressure`, and sealed `hot/native/report.json:/memory`.
- P6 sufficiency/bounds — HELD. Audited all881 changed lines in27 files against
  original sanitized binaries/profiles, retained compiler coverage and actual
  served browser ranges. Every behavioral hunk executes; declarative includes,
  signatures, preprocessor bindings, documentation and recording/receipt harness
  branches have per-line waivers in `coverage-audit.json` (no gaps). The pinned
  checker/hash bodies are unchanged and their allocation calls hit the guard.
  Text49152, tokens8192, GLSL262144, stack262144, raw46/exact184 and parser/IR arenas
  stay bounded. Three fresh seeded maximum768-instruction,512-TEMP,128-CONST
  programs have identical native/sanitized/Wasm responses; exact text limit passes
  and one byte beyond rejects. Citations: `wasm-pressure.json:/records`,
  `/limits` in `final-audit.json`, sealed stack-usage files and the unchanged
  `raw_bits.h` digest in `carry-forward.json`.
- P7 retained proof/harness — HELD. Independently authenticated the previous
  55-record I critic seal and carried forward12 unchanged resource/cache/raw
  boundaries, current I/H/G5 recordings, both10,000-draw cache runs and three
  promoted chaos schedules. The four layout numbers match the already-landed
  exact-bank pointer types; this diff changes no raw/profile structure. Audited
  all402 join adaptations: AND of unknown IN with literal1 preserves two live
  predecessors across384 witnesses, and missing-arm lanes still reject. Text,
  line and canonical index boundaries are preserved. Citations:
  `carry-forward.json`, `join-audit.json` and sealed compiler bound reports.
- P8 critic prediction correction — Initial driver-prefix inference FAILED,
  without a product refutation: a highest referenced slot93 did not imply native
  active94 on ANGLE. Its actual129 reflection made the short94 bank correctly
  reject before draw. Preserved the exact initial probe source, report and digest
  in `initial-reflection-test.mjs`, `physical-reflection/report.json` and
  `prediction-correction.json`; wrote the corrected prediction before rerunning
  with the complete128 guest prefix. The corrected pixel/boundary prediction HELD.
- P9 sabotage — HELD. Independently truncating the actual upload to93 vectors
  produces `[64,0,191,0]` instead of literal `[159,8,255,72]` on the first partial
  high-slot draw. It fails the physical pixel oracle with empty browser/import
  error collections. Citation: `sabotage-physical/report.json:/result/failure`,
  its exact served mutation binding and reported raw pixel values; original upload46 sabotage
  also fails the worker MOV oracle. No implementation correction was made.
- SUITE: promoted `renderer/virgl-command/tests/vertex-constant-boundaries.mjs`
  for physical partial-write/swizzle, retained suffix, ownership and invalid-bank
  recovery, and `renderer/virgl-shader/native_tests/tgsi_scratch_boundaries.c`
  for initial allocation cancellation, outside-hash fallback and exact recovery.
  Repro commands are the sealed `physical.mjs`, `build-scratch.sh` and
  `wasm-pressure.mjs`; archive records include their complete sources and outputs.

All verifier evidence is sealed in
`evidence/virgl-vertex-constant/verifier/recording.tar.gz` (54 records), SHA256
`36d18cbf16f9736618c4a435f494961f3476f92a52edd442ee9425b54bda4850`;
index SHA256 `3e7f1f18f18b94f1067da6dc736860b3762d535d86d3743e1cd9b1ae7a084326`.
`final-audit.json` SHA256
`9ba3ab5f12a59783d1bcd6ea4043708ed653af38a5bd4f4895e342d9985f682f`;
coverage audit SHA256
`353afbc116f3c6d16a033e0d06a12f62c5e96cd957ee101763d001fef736c15e`.
Only the isolated ordinary vertex128 capacity is verified. Raw/private/fragment46
remain bounded; production capsets, live guest acceleration, FPS/MIPS and general
API conformance remain outside this verdict. No deployment or merge was performed.
