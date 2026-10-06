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
