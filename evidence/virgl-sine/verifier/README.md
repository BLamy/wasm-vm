Fresh independent critic verdict: **verified** for E6-T12g6j1, private bounded
scalar SIN only. P1–P10 were written before evidence inspection; every prediction
is HELD. This session did not implement the runtime and changed no runtime code.

Worker submission c6e56fa8; frozen runtime ad31839ebc55e5f853c9d9853a44c9922767e7da;
worker evidence head d44d2683941ab4cb32df53d4dcb84f045046caf9. Independent guards and
acceptance wiring are frozen at f6facf82163965c5018abc054f50247f9f0928e2. Authenticate
manifest.json, records.json and every ACTUAL archive member before reading claims.
The critic seal has 115 original members; it references the independently
authenticated 135-member worker archive by immutable digest rather than duplicating
its 1.1 GB of original outputs. Unpacked and unchanged sabotage scratch sources
are deliberately omitted; actual sabotage binaries and changed C sources are sealed.

Commands recorded here:
- python3 evidence/virgl-sine/verifier/authenticate.py
- python3 evidence/virgl-sine/verifier/replay.py
- python3 evidence/virgl-sine/verifier/source_audit.py
- node renderer/virgl-shader/tests/sine-regressions.mjs --native evidence/virgl-sine/verifier/unpacked/generated/native/virgl-shader --output evidence/virgl-sine/verifier/independent-regressions-final.json
- python3 evidence/virgl-sine/verifier/guard_recording.py
- NODE_V8_COVERAGE=evidence/virgl-sine/verifier/node-consumer-coverage node tools/virgl-sine/consumer.mjs evidence/virgl-sine/verifier/unpacked/hot/native/report.json evidence/virgl-sine/verifier/consumer-attacks.json
- NODE_V8_COVERAGE=evidence/virgl-sine/verifier/node-consumer-coverage node evidence/virgl-sine/verifier/consumer_attacks.mjs
- python3 evidence/virgl-sine/verifier/carry_forward.py
- python3 evidence/virgl-sine/verifier/coverage_audit.py
- python3 evidence/virgl-sine/verifier/fourth.py
- python3 evidence/virgl-sine/verifier/sabotage.py
- python3 evidence/virgl-sine/verifier/sensitivity.py
- python3 evidence/virgl-sine/verifier/final_audits.py

Both ACTUAL archived ASan/UBSan binaries reproduce the original 1,006-case log
exactly and have empty diagnostics. ORIGINAL profraw exports match, without
rebuilding substitute binaries. Fifty changed C/mjs runtime lines have actual
source-bound C/V8 or Node coverage; twelve signatures/comments/declarations have
individual sound waivers. A further independently predicted 520-case recording on
the original sanitizer binary exercises all ten wrapper-selector arms.

The separate source oracle derives operands/versions/conditions/masks from original
TGSI and uploaded words. Real sine uses an independently enclosed Machin pi,
rational quadrant reduction and reduced sin/cos Taylor tails. Expected values
never come from emitted GLSL, observations or the worker's cached oracle. All six
worker hardware recordings hold. The frozen fourth seed 1834637033 runs actual
headed ANGLE Metal Apple M4 Max, 8,160 full feedback words and 20,352 whole RGBA8
pixels, including 80 fresh actual pinned parser/converter witnesses. Original
vendor GLSL is preserved and its componentwise equations verified; TGSI scalar
replication, canonical broadcasts and both literal original statements stay
separate and explicit. Maximum conservative absolute error is about
6.859461500265203e-8 on each backend against measured budget 2^-20. ESSL 3.00
section 4.5.1 supplies no sine precision guarantee.

Authenticated unchanged SAT/EX capture/fault proofs and FRC guards carry HELD.
Complete 5,861 predecessor responses and obligations hold. Only the two declared
old bounded plain-SIN negatives extend admission; original sealed rejections
remain intact and SIN_PRECISE stays unsupported. The 974 consumer contracts,
580 original plus 274 independent metadata/ownership/bank attacks, zero getters,
physical A→B→A/restore, atomic poison rejection and zero lifetime budgets hold.

Three scratch-only C sabotages (removed domain, component broadcast, invented
result facts) fail meaningful promoted guards. All six actual archived physical
function/argument/broadcast faults fail the independent source oracle. A rehashed
capture with a poisoned cached oracle also fails original-source expectations.
The novel lane-locality attack checks usable old/repaired lanes against newly
computed or poisoned sibling versions.

Qualifications remain visible: the worker's first collector failed after a clean
successful acceptance; corrected final pristine clone and original failure/receipt
remain sealed. The critic's first fourth GPU run passed, but its capture audit
rejected two untracked new guard files; that capture/error is retained and the
final run at clean critic head passes. Initial mechanical verdict/seal-script
repairs and the seed-label correction are recorded. No runtime refutation or proof
gap survives. Only test/harness changes followed the original final pristine
clone, so unchanged runtime gates were carried under incremental verification.

Production caps/negotiation/live imports/guest offload/FPS/MIPS and original full
computed-domain bodies remain outside this proof. No rr, ssh dev, deployment,
merge, push or new pull request was used. The promoted guards and source oracle
are wired into make verify-E6-T12g6j1. See verdict.json for every digest-bound
prediction, point and observation.
