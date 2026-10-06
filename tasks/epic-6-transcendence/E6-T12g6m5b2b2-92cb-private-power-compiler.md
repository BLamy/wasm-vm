---
id: E6-T12g6m5b2b2
epic: 6
title: Bind first original 92cb powers to a private draw-time certificate
priority: 525.027010582222
status: implemented
depends_on: [E6-T12g6m5b2b1]
estimate: S
risk: high
capstone: false
---

## Boundary

Consume the verified numeric domain only for exact original fragment pc221/222 under complete 7bf4/92cb source, paired bank, quad, viewport and sample-state identity. The private compiler may issue a conditional certificate only when all preconditions hold, and the physical draw must recheck them immediately before using the generated shader. Keep other original operations gated; do not grant general `POW` or production renderer admission.

## Deterministic acceptance

`make verify-E6-T12g6m5b2b2` records native/Wasm identity and a physical WebGL2 execution of the exact original pc0..222 path under draw-time enforced geometry. A handwritten oracle checks first-power results for all three banks with varied boundaries; source, bank, geometry, viewport, sample count, exponent, negative and nonfinite mutations reject at the right boundary. Inspect generated shader reflection and pixels. Existing corpus, ordinary/default rejection and full-original gating remain unchanged. Record exact-head pristine-clone evidence and submit to a fresh critic.

## Adversarial verification

Attack certificate ownership and mutation between compile and draw, source/bank substitution, viewport and sample-state drift, negative/NaN/overflow inputs, exponent source, branch reachability and hidden full-original admission. Reject proof that does not execute the physical draw with the certified inputs.

## Verification log

### 2026-10-06 — worker — repaired draw-state ownership; resubmitted

Source head `e69506b2cace03ce6eae2a5a19af58183d1b13f4` passed
`make verify-E6-T12g6m5b2b2` and
`python3 tools/virgl-92cb-power-domain/private_cold.py
target/evidence/virgl-92cb-private-power/cold-repair` at the same exact head
in a pristine clone with scrubbed build environment. The hot and cold
`receipt.json` files independently identify and hash the recorded source,
generated native/Wasm binaries, browser report, full float readbacks,
coverage and 17 fault outcomes. `python3
tools/virgl-92cb-power-domain/private_seal.py
target/evidence/virgl-92cb-private-power
target/evidence/virgl-92cb-private-power/cold-repair
evidence/virgl-92cb-private-power/worker-repair` sealed 112 records in
`evidence/virgl-92cb-private-power/worker-repair/recording.tar.gz`, SHA-256
`0c665d3e49bf5815587ac555761e1ca72a16d7449007725e659344c07a65226f`.

The repaired browser run reflects every one of the 4 vertex and 37 fragment
`uvec4` constants from the bound WebGL program, compares their exact raw words
with the authenticated bank immediately before each draw, and records the
actual VAO input bindings and RGBA32F attachment component type/channel bits.
An explicit bank-1 exponent substitution to 3.0, where no power branch is
active and the pixel oracle cannot expose the substitution, now rejects at
the bound-uniform check before `drawArrays`. Vertex-bank, attribute-stride,
and RGBA8-attachment substitutions likewise reject before draw. The
independent full-readback oracle still checked 1,612,644 covered pixels with
active branch counts 16/0/16 and maximum relative power error
1.1921e-7; native and Wasm outputs remain byte-identical. The previous
verifier's unchanged source-custody, ordinary-gate and numeric-output results
remain HELD at their cited digest; this submission specifically repairs the
failed draw-state custody boundary. No production DRAW or guest MIPS gain is
claimed by this private compiler step.

### 2026-10-05 — fresh verifier

VERDICT: refuted

- PREDICTION draw-time bank ownership — FAILED. The physical draw should reject if the GPU's bound `fsconst0[6].x` differs from the authenticated bank's `0x40000000` exponent. In an independent Playwright run, an `addInitScript` wrapper changed the fourth `WebGL2RenderingContext.uniform4uiv` upload (bank 1 fragment bank, word 24) to `0x40400000`. A `drawArrays` wrapper then read `getUniform(CURRENT_PROGRAM, getUniformLocation(program, 'fsconst0[6]'))[0] == 1077936128` at draw 2, with `mode=5`, `first=0`, `count=4`, viewport `[0,0,1024,768]` and samples `0`; `runAcceptance()` nevertheless returned `status: passed` and branch counts `[16,0,16]`. Repeating the attack gave the same result. The certified word is read from the pinned geometry by `renderer/virgl-shader/bridge.c:2131-2135`; the physical upload occurs at `renderer/virgl-shader/tests/original-92cb-private-power.mjs:111-112`, but the checks at lines 134-170 compare the JS bank to the source binary and never read the actual GPU uniform before line 172 draws. The sealed `hot/browser/report.json:4214-4216` confirms bank 1 has zero active branches, so its pixel oracle cannot expose this exponent substitution. Recheck the bound GPU constants at the draw boundary and make this mutation fail *before* `drawArrays`; then re-record exact-head evidence.
- PREDICTION source custody, ordinary gate and numeric output — HELD for unchanged code. The sealed archive SHA-256 `d7aecf8578374d1f98a56ebcebc2a70eba4d94e134a2292190fadc5a45b2a0df` has 96 members that match `records.json`; both receipts match all 41 files, 18 `git show d78af4ea` sources and five generated binaries, and the browser-served Wasm matches those binaries. Independent full readback of `hot/browser/report.json` reproduced covered counts `[96100,786432,730112]`, active counts `[16,0,16]`, maximum input gap `7.7330545e-6`, and maximum relative power error `1.1920895e-7`; raw readback SHA-256 values are `2d9579eb8e0b4e2951bc304f2fff279f1cff1e6cc10442ada712eeaa3a5c3c3e`, `cfadd44a103cbd6d5726fa07b27d7aad2f67ed3930ff96901c486a5beaf7e723`, and `672ab3006241d7ae5f7474c2324e402bf0ce7c4a2ddde73d77b472f79d0669c7`. A separate Wasm bridge probe rejected changed source, bank selector, quad, exponent, negative/NaN/infinite/overflow coefficient, viewport and sample state as `invalid-input`; ordinary and exact full-original pairs remained `unsupported-feature` for all banks. The sealed cold report records a pristine `d78af4ea` checkout and exit code 0. These held results may carry forward if their code boundary and evidence digest stay unchanged.
- COVERAGE and SUITE: Native coverage reaches the private bridge success path, the two POW exceptions and the rejection guards (`hot/native-coverage.json`); browser coverage and fault reports reach the new draw path and named fault checks. The intercepted uniform upload is a successful-run sabotage of the new test: actual certified draw state was wrong while the test passed. Defer suite promotion and any remaining hunk classification until the semantic boundary is repaired.

Commands: independent archive/receipt SHA-256 audit; independent full WebGL2 readback oracle; Node/Wasm mutation probes; Playwright physical uniform substitution with `page.addInitScript` and `getUniform` inside the second `drawArrays`. Worker source head `d78af4ea7ff322700ee5df5bb25ddda6928dfa62`; submitted task head `15befd53a439587621765d136f151ef71215f88e`.

### 2026-10-05 — worker — implemented; conditional private pc221/222 prefix

Source head `d78af4ea7ff322700ee5df5bb25ddda6928dfa62` passed
`make verify-E6-T12g6m5b2b2` in the hot checkout and again through
`python3 tools/virgl-92cb-power-domain/private_cold.py
target/evidence/virgl-92cb-private-power/cold-final` from a pristine scrubbed
clone. `python3 tools/virgl-92cb-power-domain/private_seal.py
target/evidence/virgl-92cb-private-power
target/evidence/virgl-92cb-private-power/cold-final
evidence/virgl-92cb-private-power/worker` sealed 96 hot/cold records;
`evidence/virgl-92cb-private-power/worker/recording.tar.gz` SHA-256 is
`d7aecf8578374d1f98a56ebcebc2a70eba4d94e134a2292190fadc5a45b2a0df`.
The archive includes both exact-head receipts, full physical readbacks,
reflection, browser screenshot/coverage, native coverage, source and generated
binary hashes, thirteen browser fault records, the three-bank geometry and
raster capture, and the cold-clone cleanliness report. Native and Wasm emitted
byte-identical per-bank JSON fingerprints `2e2749582cb2a15d`,
`b5a330c55bb92715`, `7b2e9c293e2f403d`; the native test also observed
unchanged rejection of the complete ordinary and exact original pair.

The generated GLSL compiled and linked on the captured Apple M4 Max WebGL2
renderer. The browser checked 1,612,644 original covered centers, with active
branch counts 16/0/16. An independent rational-center audit of all float
readbacks found active first-power bases at least 0.5 on the observed draw,
maximum active interpolant gap 7.7331e-6, and maximum relative power error
1.1921e-7. Source, bank, quad, exponent, negative/nonfinite, zero-crossing,
viewport, sample, post-compile ownership, renderer and precision checks bound
the private certificate immediately before the draw. Other original operations
remain outside this pc0..222 observer; no production renderer DRAW, portable
numeric domain, or guest MIPS improvement is claimed. `make ci` was attempted
at the same runtime source head and stopped in pre-existing workspace Clippy
errors in `wvseccomp`, `jit-runtime`, `cli`, and `core` (log at
`target/evidence/virgl-92cb-private-power/ci.log`); the task-specific
native/Wasm/browser/cold-clone gate passed.

### 2026-10-05 — worker — activation

The physical 92cb first-power domain (E6-T12g6m5b2b1) is independently verified at `8c855549`. This task will bind the exact original source and draw state to a private compiler certificate for pc221/222, while retaining ordinary and full-original rejection outside that narrow boundary.
