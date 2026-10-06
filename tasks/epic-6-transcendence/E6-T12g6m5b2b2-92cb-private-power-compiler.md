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

### 2026-10-06 — worker — final WebGL state check after preparation; resubmitted

Source head `bb6d781d13196dbff50d06312695582edb6c9937` passed
`make verify-E6-T12g6m5b2b2` and
`python3 tools/virgl-92cb-power-domain/private_cold.py
target/evidence/virgl-92cb-private-power/cold-draw-boundary` from a pristine,
scrubbed exact-head clone. `python3
tools/virgl-92cb-power-domain/private_seal.py
target/evidence/virgl-92cb-private-power
target/evidence/virgl-92cb-private-power/cold-draw-boundary
evidence/virgl-92cb-private-power/worker-draw-boundary` sealed 120 hot/cold
records. Archive `evidence/virgl-92cb-private-power/worker-draw-boundary/recording.tar.gz`
has SHA-256 `e67a41d43101d2aec07dc8e0d8817ab0eb7d57e5f6609daa40f43a650e8edb33`.
Both receipts hash 53 files, including all 19 browser mutation outcomes, the
complete float readbacks, reflection and coverage; the cold report records
empty checkout status before and after and exit 0.

The buffer read, clear, renderer/precision inspection, VAO and framebuffer
checks now precede the final readback of every bound vertex and fragment
uniform. No preparatory WebGL operation remains between that readback and
`drawArrays`. Faults changing bank 1's exponent immediately after the buffer
read and immediately after clear both fail at this final check before draw.
The fresh verifier's exact `addInitScript` second-`getBufferSubData` sabotage
was also replayed in the worker loop: its WebGL readback observed the changed
3.0 exponent, acceptance failed with `bound physical fsconst0 words still
equal the certified bank`, and only draw 1 executed. The independent pixel
oracle still reports 1,612,644 covered pixels and active branches 16/0/16,
with unchanged maximum relative power error 1.1921e-7. Prior HELD source,
numeric and full-original gate results retain their original digests. This
private prefix remains outside production DRAW and makes no MIPS claim.

### 2026-10-06 — fresh verifier — VERDICT: refuted

- **PREDICTION draw-time bank ownership — FAILED.** After the physical-state recheck, bank 1 must still have `fsconst0[6].x == 0x40000000` at its `drawArrays`, or the draw must be rejected. In two independent Playwright runs against source head `e69506b2cace03ce6eae2a5a19af58183d1b13f4`, an `addInitScript` wrapper delegated the **second** `WebGL2RenderingContext.getBufferSubData`, then replaced that bound uniform's first word with `0x40400000` using the original `uniform4uiv`. The wrapper read back `1077936128` immediately. A `drawArrays` wrapper observed three draws, with fragment exponents `[1073741824, 1077936128, 1073741824]` and each draw `(mode, first, count) == (5, 0, 4)`; nevertheless `runAcceptance()` returned `status: passed`, branches `[16, 0, 16]`. The repair checks uniforms at `renderer/virgl-shader/tests/original-92cb-private-power.mjs:171-172`, then calls `getBufferSubData` at line 227 and `drawArrays` at line 231. Reproduce by installing those wrappers with `page.addInitScript` before importing `runAcceptance()`, changing only the second buffer read. Bind the actual draw state to the certificate after the final mutable call, or make this late mutation fail before draw 2; re-record exact-head proof. The bank-1 pixel oracle cannot detect the substitution because that bank has zero active POW pixels (`hot/browser/physical-audit.json` in the sealed repair archive).
- **PREDICTION original fourth-upload sabotage — HELD after repair.** The prior attack, changing word 24 of the fourth `uniform4uiv` upload to `0x40400000`, now fails with `bound physical fsconst0 words still equal the certified bank`; the injected GPU readback is `1077936128`, and only draw 1 executes. An independent unused-word change at `fsconst0[36].w` also fails at the same check before draw 2. A changed VAO divisor and an RGBA16F attachment with complete framebuffer and no WebGL error each fail at their respective physical checks before draw 2. The sealed hot and cold `fault-post-bound-{exponent,vertex,attribute,color}/report.json` records likewise fail at their named boundaries.
- **PREDICTION evidence custody and numeric output — HELD.** SHA-256 `0c665d3e49bf5815587ac555761e1ca72a16d7449007725e659344c07a65226f` matches the 112-member `worker-repair/recording.tar.gz`; every member matches `records.json`. Both receipts match all 49 archived files, 18 exact-head `git show` sources, and five generated binaries. The cold report records a scrubbed pristine `e69506b2` checkout, exit 0, and empty status before and after. Each successful bank's reflected 16 vertex and 148 fragment words equals `hot/geometry.bin`; its full 12,582,912-byte readback matches the recorded SHA-256. The three readback digests, generated Wasm binaries, core bridge/index source digests, and native/Wasm output are unchanged from the prior HELD verification, so its independent full-pixel oracle and ordinary/full-original rejection carry forward. Covered/active counts remain `[96100,786432,730112]` / `[16,0,16]` with maximum relative power error `1.1920895e-7`.
- **COVERAGE and SUITE.** Precise browser coverage in `hot/browser/browser-coverage.json` records six `boundWords` calls and 123 per-register reads, plus three executions of the VAO and attachment checks and result serialization. Four new hot and cold fault reports reach their rejection guards; the shell loop and receipt assertions cover those outcomes. The late mutation is a semantic refutation, so no suite artifact is promoted until it is repaired.

Commands: independent SHA-256/tar/receipt audit; independent geometry/uniform/readback digest audit; V8 browser-coverage audit; independent Playwright `addInitScript` attacks on fourth uniform upload, unused uniform word, VAO divisor, RGBA16F attachment, and the late second `getBufferSubData` mutation (late attack repeated twice). Source head `e69506b2cace03ce6eae2a5a19af58183d1b13f4`; submitted evidence head `c70c28f249f6db2848545db241d96f62ddd56b9e`.

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
