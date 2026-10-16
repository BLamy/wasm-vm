# E6-T12e3b independent verifier evidence

The runtime stayed frozen at `81cd3a4c403176be4b0191fa00ed37f4fd1e1e35`.
The worker claim is `68186f6edf63a6f3c0e2160892a2bc5b868ab8f8`.
`predictions.md` was written before reading the implementation or worker evidence.
`findings.md` records the independent verdict and its scope.

## Promoted deterministic attacks

From the repository root, with the ordinary shader Wasm build and Playwright
dependencies available, repeat these committed verifier-owned tests:

```sh
node evidence/virgl-constants/verifier/decoder-attacks.mjs
node evidence/virgl-constants/verifier/run-attacks.mjs normal
node evidence/virgl-constants/verifier/run-attacks.mjs alias-sabotage
```

The decoder runner checks 1,046 literal finite/non-finite, size, stage/slot,
truncation and snapshot cases from four fixed independent seeds. The hardware
runner checks asymmetric VS/FS constants across context and subcontext owners,
short replacement and recovery, ID reuse, and two detached-input async schedules.
It also retains exact stage component neighbors: high arrays reject 183 and
accept 184 components; ordered arrays reject 187 and accept 188, independently in
VS and FS. Additional trusted-boundary fault checks cover invalid compiler
metadata after VS UBO allocation and invalid reported limits in both stages.

These are real hardware tests using headed Chrome and the production renderer
module. Their fixture/resource/packet scaffolding comes from the audited worker
suite, exposed by appending exports only in the local test server. They never
call that suite's acceptance or expected-output functions. New banks, geometry,
RGBA8 oracles and ownership assertions are verifier-owned. Both oracle geometry
and color are fixed before the runs. Neither generated GLSL nor renderer output
computes the expectation.

The alias control changes only served renderer upload code: FS constant 45 takes
the words from constant 5. It must still compile, link and draw, then fail the
independent expected pixel. A control caught by that oracle exits successfully as
a sensitivity test. The original runtime file is never edited; both original and
served source hashes are recorded. Normal and control runs must emit no browser
errors and release all native objects.

## Frozen-record audits

These commands audit the submitted immutable evidence rather than redoing the
entire acceptance gate:

```sh
python3 evidence/virgl-constants/verifier/coverage-audit.py
python3 evidence/virgl-constants/verifier/binding-audit.py
python3 evidence/virgl-constants/verifier/binding-audit.py evidence/virgl-constants/cold-clone/acceptance evidence/virgl-constants/verifier/binding-cold-acceptance-audit.json
python3 evidence/virgl-constants/verifier/binding-cold-claim-audit.py
python3 evidence/virgl-constants/verifier/final-audit.py
```

The binding helper independently interprets the original TGSI and raw submitted
constants, rasterizes the original indexed geometry, and compares every byte of
all 44 worker and cold framebuffers. It does not invoke the compiler, decoder or
root receipt as its oracle. Full native/Wasm translations, exact served sources,
raw packet framing, pristine clone, environment scrubbing and claim digests are
also checked. The helper audits are specific to the recorded frozen commit.

No guest acceleration, production activation, desktop MIPS or FPS gain is claimed
by any of these isolated transport/reflection proofs.
