---
id: E6-T12g6m5b2b2
epic: 6
title: Bind first original 92cb powers to a private draw-time certificate
priority: 525.027010582222
status: verified
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

### 2026-10-06 — fresh verifier

VERDICT: verified

- **PREDICTION isolated physical draw — HELD.** A page-realm `addInitScript` hook on `getUniform`, `uniform4uiv`, `drawArrays`, `OffscreenCanvas.getContext`, and `fetch` should see no calls from the physical run and should not change bank 1's certified exponent. An independent Chrome run observed zero calls to all five hooks, a real `DedicatedWorkerGlobalScope` at the exact worker URL, and a served worker SHA-256 of `2eec3a8c0aa66275f37b39bd93c0d9bbaaac228d8c12833950a1af852784b023`. A passive probe inside that worker observed three `(mode, first, count) = (5, 0, 4)` draws with live `fsconst0[6].x = 0x40000000` each time; the returned full-readback digests match `hot/browser/report.json` in the sealed archive. Calling `runPhysicalAcceptance()` directly in the page rejected with `isolated physical WebGL worker`. The worker entry and page dispatch are `renderer/virgl-shader/tests/original-92cb-private-power-worker.mjs:1-10` and `renderer/virgl-shader/tests/original-92cb-private-power.mjs:303-318,370-390`.
- **PREDICTION worker-local fault sensitivity — HELD.** For each of `post-buffer-exponent` and `post-clear-exponent`, an independent worker probe observed the live bank-1 exponent change from `0x40000000` to `0x40400000` after draw 1, then `bound physical fsconst0 words still equal the certified bank` before draw 2. The sealed hot and cold named fault reports agree; all 19 faults on each side have the stated rejection message. A separate sabotage probe suppressed the first worker `drawArrays` and the oracle rejected at `missing original pixel (356,228)`, so a report cannot pass merely by returning a success string. The relevant code is `original-92cb-private-power.mjs:183-195,237-243`.
- **PREDICTION evidence and unchanged compiler boundary — HELD.** The archive SHA-256 is `66fc1985148f66ce6cc8b7bea1c3a7f2a89ccd6a5727a28625f16364e7846d96`; its 120 members match `records.json` (SHA-256 `d9d7ba5e7f82c448b6a3d69d99a50d0d85bcfd609e727ea28a7822a065d3cbde`). Both receipts match all 53 archived files, 19 `git show de7d3f38` sources, and five generated binaries. The cold report records a scrubbed pristine `de7d3f38` clone, exit 0, and empty status before/after. Six full readbacks each decompress to 12,582,912 bytes and match their hashes. Core bridge/index/input source hashes, four generated Wasm artifacts, native/Wasm output, and all three readback digests are unchanged from the previous HELD proof. Thus the independent 1,612,644-pixel oracle and ordinary/full-original rejection carry forward at that unchanged boundary; branch counts remain `[16,0,16]` and maximum relative power error `1.1920895e-7`.
- **COVERAGE and SUITE.** The sealed page CDP coverage correctly records only page dispatch; worker execution is instead evidenced by the observed worker target, three live draws, complete pixels, and the success/error messages from the actual served worker. Success and catch paths of the new worker entry execute in the clean and fault recordings; both page dispatch branches, OffscreenCanvas creation, receipt checks, and the 19 fault outcomes are exercised. The other changed hunks are metadata and wording. Existing `make verify-E6-T12g6m5b2b2` and its named faults remain the permanent suite artifact; the ad hoc prototype-hook probes are browser/renderer-specific and add no cheap deterministic fixture. A privileged `worker.evaluate` hook can still change a uniform after the final reflected read, but it injects code into the trusted, hash-bound worker realm and is outside the page-realm interception boundary tested here.

Commands: independent SHA-256/tar/receipt/`git show` audit; native/Wasm and prior-digest comparison; independent Chrome/Playwright page-hook, direct-page, passive-worker, two fault, and no-draw sabotage probes; `node --check` on the worker module; `python3 tools/check_task_policy.py`. Source head `de7d3f38213c4fab541523619a918a68204151ee`; submitted evidence head `94dadd8cb96ee0a6446b8b64bf7e1a0974dc0166`.

### 2026-10-06 — worker — isolated physical certificate draw; resubmitted

Source head `de7d3f38213c4fab541523619a918a68204151ee` passed
`make verify-E6-T12g6m5b2b2` and
`python3 tools/virgl-92cb-power-domain/private_cold.py
target/evidence/virgl-92cb-private-power/cold-worker-isolation` from a
pristine, scrubbed clone at the same head. `python3
tools/virgl-92cb-power-domain/private_seal.py
target/evidence/virgl-92cb-private-power
target/evidence/virgl-92cb-private-power/cold-worker-isolation
evidence/virgl-92cb-private-power/worker-isolation` sealed 120 hot/cold
records. Archive `evidence/virgl-92cb-private-power/worker-isolation/recording.tar.gz`
has SHA-256 `66fc1985148f66ce6cc8b7bea1c3a7f2a89ccd6a5727a28625f16364e7846d96`.
Both receipts hash 53 acceptance files, 19 mutation outcomes, 19 source
paths including the served worker module, and five generated binaries. The
cold report records exit 0 and empty checkout status before and after.

The physical WebGL2 context now belongs to a dedicated worker-created
`OffscreenCanvas`. The worker itself fetches the complete pinned sources and
geometry, obtains the M4 Max context, certifies the program, rechecks all
physical draw state, and issues the draw; the page only requests the run and
receives a serialized result. This removes page-realm WebGL method wrappers
from the draw's execution realm. In worker-loop replay of the verifier's
page-level second-buffer-read hook, the page observed zero WebGL calls and
no mutation while the worker returned the normal three-bank result. Internal
worker faults after the buffer read and clear still change bank 1's actual
bound exponent and fail before draw. The independent full-readback oracle
again checked 1,612,644 covered pixels, 16/0/16 active branches and maximum
relative power error 1.1921e-7; browser errors are empty. Prior HELD source,
numeric and full-original gate results retain their cited digests. This
isolated proof does not grant production DRAW or claim a guest MIPS increase.

### 2026-10-06 — fresh verifier

VERDICT: refuted

- **PREDICTION final draw-state custody — FAILED.** Predicted that bank 1's physical `fsconst0[6].x` would remain the certified `0x40000000` at draw 2, or the altered draw would be rejected. In two independent Playwright runs at source head `bb6d781d13196dbff50d06312695582edb6c9937`, an `addInitScript` wrapper delegated the second program's 41st and final `getUniform` call, returned the authentic `fsconst0[36]` value `[9,0,0,0]`, then used the original `uniform4uiv` to change `fsconst0[6].x` from `1073741824` to `1077936128` (`0x40400000`). The wrapper's immediate WebGL readback saw `1077936128`. The `drawArrays` wrapper observed all three draws, with exponents `[1073741824,1077936128,1073741824]`, `(mode,first,count)=(5,0,4)`, viewport `[0,0,1024,768]`, and samples `0`; `runAcceptance()` still returned `status: passed`, branch counts `[16,0,16]`, and no page or request errors. The temporal opening is the final reflected read in `renderer/virgl-shader/tests/original-92cb-private-power.mjs:240` followed by the unchecked `drawArrays` at line 241. Bank 1 has zero active power branches in sealed `hot/browser/physical-audit.json`, so the pixel oracle cannot expose the changed exponent. Make a mutation made as the final uniform read returns fail before the second physical draw, then re-record exact-head proof.
- **PREDICTION previous timing escapes — HELD.** A fourth-`uniform4uiv` wrapper changed bank 1's fragment word 24 to `0x40400000`; an independent second-`getBufferSubData` wrapper delegated the read and then changed the same bound word. Each attack read back `1077936128`, failed with `bound physical fsconst0 words still equal the certified bank`, and observed only draw 1. The sealed hot and cold `fault-post-buffer-exponent/report.json` and `fault-post-clear-exponent/report.json` show the same guard at `original-92cb-private-power.mjs:240`. The clean control passed with three draws and original exponent `1073741824` on each.
- **PREDICTION evidence custody and prior numeric/source gates — HELD.** SHA-256 `e67a41d43101d2aec07dc8e0d8817ab0eb7d57e5f6609daa40f43a650e8edb33` matches the 120-member `worker-draw-boundary/recording.tar.gz`; every member matches `records.json` (index SHA-256 `5d0ba92c93f267be647a1a47ff6404492ac578ebdcf4be537f9cbb0f1b8bc90b`). Both receipts match 53 archived files, 18 `git show bb6d781d` sources, and five generated binaries. The cold report names a pristine scrubbed `bb6d781d` clone, empty status before and after, and exit 0. Bridge/index/geometry, native and Wasm outputs, generated Wasm, and all three float-readback digests are byte-identical to the previously HELD `worker-repair` evidence. Covered counts `[96100,786432,730112]`, active branches `[16,0,16]`, and maximum relative power error `1.1920895e-7` carry forward; ordinary and full-original rejection remains HELD at that unchanged code and evidence boundary.
- **COVERAGE and SUITE.** Sealed `hot/browser/browser-coverage.json` attributes three executions to the moved renderer, buffer, clear, VAO, framebuffer, and final draw-state checks (`original-92cb-private-power.mjs:171-241`), six `boundWords` calls and 123 register reads. The new fault bodies at lines 188-194 are reached by the hot/cold named fault reports; the shell fault loop and receipt mappings are exercised by those records. The other changed hunks are comments, fault-name data, and evidence metadata. No changed behavior lacks execution evidence. The successful final-read sabotage refutes the boundary, so defer suite promotion.

Commands: independent SHA-256/tar/receipt and `git show` custody audit; V8 coverage-to-source audit; independent physical Playwright `addInitScript` attacks on the fourth uniform upload and second buffer read, plus the final `getUniform` return mutation (repeated twice), with clean controls. Submitted task head `a9580dafd3f6a13cfe871417aaa9b3aab9435446`.

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
