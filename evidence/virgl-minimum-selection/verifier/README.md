# Fresh minimum-selection critic — E6-T12g6g1

VERDICT: verified. The worker and this critic are different sessions. The critic
read AGENTS.md, the full task and diff before recording predictions.json. No
implementation, harness, branch, commit or PR was edited. Only the task status/
verification log, this evidence and the independent promoted test were written.

Submission: 22be542aa68d1d502fd59d99bed0664bf4aeb8b5. Final recording harness:
2be8709b05a9f6bcaf9f2a543a62d9eda37656ed. Runtime freeze:
2412ecf2e4350cd21eadf10b3f022fdbd7e75e1d. Independently verified parent:
79cae493. Worker archive dependency SHA-256:
4cde54d259703ba0c62f7f70f88820fdb53faa06621f5b7b0d5f372066ebc394.

All 11 prior predictions held. Source-only TGSI interpretation reproduces all
333,504 words and 34,688 pixels from six frozen hot/cold recordings, plus 55,224
words and 5,440 pixels from new physical seed 19088743. Ordinary and primary
floating zero signs use their existing documented freedom. Owned precise zero
and unmodified masked-copy lanes stay exact. Primary MIN_PRECISE comparisons
are only for normal/zero operands; NaN/subnormal payloads use the owned raw path.
No emitted shader or compiler ordering key contributes to the math oracle.

Both actual ASan/UBSan binaries reproduce identical full native stdout and
coverage exports. Their 961 public cases and 913 primary witnesses each match
the sealed logs. Actual shaderSource events bind real, unchanged pinned Mesa
GLSL and the owned output. 601 physical source programs match native output.
32 runtime hunks / 69 added lines execute or have explicit structural waivers;
needsEvidence=[] and dead=[]. Independent metadata attacks bind exact V8 ranges.
Five old critic seals, 242 dependency files and 15 unchanged helper bodies
authenticate; current original/legacy/guard recordings preserve their results.

The promoted test is renderer/virgl-shader/tests/minimum-selection-regressions.mjs.
It has 4,524 mathematical selected-bit, lane, version, provenance and native/Wasm
cases. Its exact schema, source digest and native binary digest are in
final-checks.json and verdict.json. An isolated actual C selector-order mutation
fails precise-selected-1-0-none-bit-0: a=1, b=0 must select zero, whose bit 0
may rasterize; the faulty abstract selector chooses subnormal 1 and rejects it.
Both real emitted-helper faults likewise contradict captured physical lane 6.
2,606 independent metadata attacks, 738 bank/prefix checks and 24 immutable
snapshots pass with zero getter calls. All nine GPU runs close native objects
and state/resource budgets; their owned Chrome profiles have no live process.

The initial critic test incorrectly added _PRECISE suffixes to the old policy
inventory. Existing preciseWordContract uses the opcode names FSEQ/FSNE/MAX/MOV.
expectation-correction.json and the initial source/report preserve that correction.
It was a test expectation error, and did not contradict product behavior.

Reopen the worker archive with authenticate.py in a checkout of submission
22be542a. It authenticates all 82 members and extracts them to unpacked/. The
verifier seal omits that duplicate worker directory and unchanged scratch
sources, retaining their authenticated dependencies, the actual mutant binary
and source, and every independent report/script/capture/profile used here.
Native profile paths stay bound to each actual recorded sanitizer binary;
coverage_audit.py re-exports the worker maps and v8_audit.py finishes policy
coverage using the independent Node recording. source_semantics.py executes
the recorded TGSI directly; --fourth selects the new GPU recording.

Focused commands from the isolated worktree:

```sh
python3 evidence/virgl-minimum-selection/verifier/authenticate.py
python3 evidence/virgl-minimum-selection/verifier/coverage_audit.py
NODE_V8_COVERAGE=evidence/virgl-minimum-selection/verifier/node-consumer-coverage node evidence/virgl-minimum-selection/verifier/consumer_attacks.mjs
python3 evidence/virgl-minimum-selection/verifier/v8_audit.py
python3 evidence/virgl-minimum-selection/verifier/native_parity.py
python3 evidence/virgl-minimum-selection/verifier/source_semantics.py
python3 evidence/virgl-minimum-selection/verifier/source_semantics.py --fourth
node renderer/virgl-shader/tests/minimum-selection-regressions.mjs --native renderer/virgl-shader/build/native/virgl-shader --output evidence/virgl-minimum-selection/verifier/independent-regressions.json
node renderer/virgl-shader/tests/minimum-selection-regressions.mjs --native evidence/virgl-minimum-selection/verifier/sabotage/renderer/virgl-shader/build/native/virgl-shader --native-only --output evidence/virgl-minimum-selection/verifier/sabotage-regressions.json
python3 evidence/virgl-minimum-selection/verifier/carry_forward.py
python3 evidence/virgl-minimum-selection/verifier/final_audits.py
```

The sabotage command must fail. Fourth seed was recorded with the unchanged
headed physical browser wrapper before the promoted test was added, leaving
its served source inventory clean. The single existing pristine cold clone is
authenticated; no duplicate clone or unrelated gauntlet was run. The September
rr waiver applies. This verdict proves the isolated compiler/consumer boundary.
Production integration, complete compositor admission, guest boot and FPS/MIPS
remain gated by later tasks.
