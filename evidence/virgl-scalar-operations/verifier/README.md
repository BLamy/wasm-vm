# E6-T12g6f fresh critic evidence

`VERDICT: verified`. Scope: finite TRUNC/SSG in the private compiler/consumer,
above independently verified G6e58601f91. Runtime/harness freeze is
ad0bf0267ce7a53e2e5ab6a2f6a5b2ee0a2383f4. Predictions precede worker recording
inspection in predictions.json. No implementation, branch or commit was changed.

Authenticate the worker archive with `python3 evidence/virgl-scalar-operations/verifier/authenticate.py`.
It extracts the sealed hot/cold evidence under `unpacked/` and authenticates all81
members,223hot/218cold source rows and both actual sanitizer binaries/profiles.
This retains the existing pristine exact-source cold proof and previous HELD
seals; no duplicate cold clone or unrelated full gauntlet was run.

`python3 evidence/virgl-scalar-operations/verifier/replay_sources.py` independently
interprets the recorded TGSI, predicts source results, then reads raw feedback
and RGBA8 bytes for all6frozen runs. Numerical equations use Python binary32
unpack/pack, math.trunc, copysign and comparisons, never emitted GLSL.
`node evidence/virgl-scalar-operations/verifier/parity.mjs` binds all1598public
results,1562actual primary witnesses and740unique physical programs to exact
native/Wasm results, paired GLSL and physical shaderSource.

The fourth headed Apple M4 Max capture uses seed2718281828:
`node tools/virgl-scalar-operations/browser.mjs --output evidence/virgl-scalar-operations/verifier/gpu-2718281828 --seed 2718281828`.
Its broad inventory includes the untracked earlier1425case critic guard; that
file was never served/imported. gpu-critic-guard-snapshot.mjs preserves the exact
inventoried SHA. The final two-case addition is proven separately in the full
1427native/Wasm report. All actual served runtime/probe/consumer bytes are frozen.
Reopen its independent pixel proof with
`python3 evidence/virgl-scalar-operations/verifier/replay_sources.py evidence/virgl-scalar-operations/verifier/gpu-2718281828/report.json`.

The promoted permanent artifact is
renderer/virgl-shader/tests/scalar-operation-regressions.mjs. Run it with
`node renderer/virgl-shader/tests/scalar-operation-regressions.mjs --native renderer/virgl-shader/build/native/virgl-shader --output target/evidence/virgl-scalar-operations-promoted-guards.json`.
Optional --root selects the Wasm module root; --native-only isolates a native
fault. The report schema is virgl-scalar-operation-critic-guards-v1, with integer
cases, complete native/Wasm arrays, testSha256 and nativeBinary.sha256.
Every known scalar result bit is probed through deterministic private0/1 output
admission; masks, killed/saved versions, negation, typed recovery and joins have
independent predetermined provenance outcomes. The isolated sabotage changes
only the C TRUNC less-than-one return to positivezero, and fails at negativezero
bit31. It never changes the worktree implementation. The archive preserves the
actual mutated native binary plus the mutation and source-copy digests.

Run consumer_attacks.mjs under NODE_V8_COVERAGE to reproduce2008metadata,
872word/prefix and26snapshot attacks. coverage_audit.py re-exports LLVM from both
actual sealed sanitizer binaries/profiles and audits all23hunks/103added runtime
lines plus V8 counts. The3function signatures bind to the following recorded
body-entry lines. Static declarations/strings have explicit waivers; emitted
helper data is independently exercised on physical hardware. No dead or
needs-evidence runtime hunk remains. The two-operation metadata path is also
proven by independent-regressions.json native/wasm[1425..1426].

sensitivity.py authenticates all4physical source faults and the promoted
real-source sabotage. carry_forward.py checks previous guard sources/results,
25literal originals/23admissions and unchanged renderer dependency boundaries.
final_checks.py binds the final promoted source, fourth-seed inventory, syntax
and zero owned process/object/budget cleanup. The two initial critic expectation
corrections are preserved explicitly; neither was a product contradiction.

manifest.json,records.json andrecording.tar.gz seal actual verifier artifacts.
Worker archives/binaries and prior HELD seals remain immutable dependencies,
with their exact digests retained in authentication.json and manifest.json.
Production caps/imports, complete compositors, guest boot and MIPS/FPS remain gated.
