---
id: E6-T12f4a
epic: 6
title: Preserve ordered nonprefix destination masks in checked shader writes
priority: 525.02699141
status: implemented
depends_on: [E6-T12f4]
estimate: S
risk: high
capstone: false
---

## Boundary

Untouched lighting bodies 12f6d594 and d4f702f7 finish with
`MOV OUT[1].yz, IN[2].xxyx`. The parser admits xy/xyz and single-lane
destinations but rejects this ordered yz subset. Accept bounded ordered unique
destination subsets without changing source swizzles, declaration or output
authority. Snapshot consumed sources before aliased writes and preserve
untouched lanes. Keep declared component limits and reject duplicate/reversed
masks. This is separate from the PRECISE word-operation boundary.

## Deterministic acceptance

`make verify-E6-T12f4a` records every nonempty destination subset in both stages,
aliases/swizzles and untouched-lane witnesses, duplicate/reversed/undeclared
write failures, native sanitizer/Wasm parity and independent shared-renderer
GPU words. Record unchanged 12f6d594/d4f702f7 compile/link with capture hashes
and existing finite-bank contracts, caps and final pristine clone.

## Adversarial verification

Widen yz to xyz, map sources from mask position instead of destination lane,
overwrite a neighbor or publish an aliased destination early. Actual compiler
faults must fail the independent word oracle. Preserve the separate arithmetic
and ordinary output-authority boundaries.

## Verification log

### 2026-10-03 — worker — planning evidence

F4 read-only diagnostics isolate the existing rejection at original 12f6d594
instruction17 and d4f702f7 instruction27. Unmarked versions reject identically.
`register_name` permits xy/xyz or one component. This task precedes the
integration-only closure task; diagnostics are planning context, not evidence.

### 2026-10-03 — worker — activation

F4 is verified at `cd92690de01298315ca4b7f50bc10eb9c9405857`, with its
runtime frozen at `09afcaa29bda5206b98fb14e019f41395d669fec`. Extend only
the destination parser's ordered unique subsets, keeping declaration and
source grammar, texture/MAD restrictions and declared-component authority.
The existing checked facts and emitted right-hand sides already snapshot
sources before aliased writes; preserve those mechanisms and record all15
nonempty masks in both stages, swizzles, aliases and untouched neighbors.

Account explicitly for historical mask rejection migrations without rewriting
their inputs or fixtures. Preserve every unrelated complete F4 result, all
production caps and all original capture hashes. Record unchanged lighting
bodies with their finite-bank/precision contracts and actual native/Wasm and
shared-renderer compile/link paths. Independent bit/pixel predictions, actual
compiler-source fault witnesses, a final exact-source pristine clone and a
fresh verifier are required. This isolated compiler slice adds no guest
negotiation or desktop throughput claim.

### 2026-10-03 — worker — implemented with recorded exact-source proof

The frozen compiler and recording harness are `2815f3d23806aa5b7aaa6a12cef03d5ce54ade90`. Commands:

```sh
VIRGL_ORDERED_MASK_EVIDENCE_DIR=target/evidence/virgl-ordered-masks-worker-2815f3d2 make verify-E6-T12f4a
python3 tools/virgl-ordered-masks/cold.py --output target/evidence/virgl-ordered-masks-cold-2815f3d2
```

Both canonical commands pass directly. The worker and final scrubbed pristine
clone each record 1,429,106 ASan/UBSan native calls over all 19 original bodies,
4,643 single cases and 693 pairs. They exercise 720,360 single and 695,520 paired
recoveries, 3,128 truncations, 324 hostile cases, 4,096 mutations with four fixed
seeds and 229 real allocation failures, including 20 upstream malloc/realloc
sites. LLVM records bridge coverage 1,197/1,206 lines, raw coverage 492/500 and
the complete owned upstream wrapper, 44/44 lines. Native result maxima are
63,369/109,235 single/paired bytes.

Wasm records 51,287 calls with complete native result agreement, 64 maximum-size
stress calls and 31 actual fixed-heap pressure calls followed by healthy
recovery. Initial/final memory is 16 MiB and the backing buffer is identical.
The unchanged production bounds are IR 26,480/profile 7,616/instruction 112 bytes
and flow 52,644 below 53,248; stage GLSL maximum is 58,201 below 65,536 bytes.
The private test pair capacity accommodates 693 fixtures without changing a
production cap. The 179-instruction boundary passes and 180 rejects.

All 15 ordered nonempty masks run in both stages, with direct raw copies,
source aliases/swizzles, ordinary raw/numeric operations, numeric aliases and
masked OUT neighbors. Declaration/source grammar, declared components,
duplicate/reversed/empty/too-long masks and explicit MAD/TEX gates remain
bounded. An independent literal TGSI interpreter predicts 182 actual shared
renderer rigs and 542 hardware draws before readback: all 2,168 words and
2,220,032 pixels agree. Source words use finite 16-bit carriers and ordinary
0/1 bit projections. The unchanged original lighting bodies 12f6d594/d4f702f7
compile, link and render with their existing finite-bank/MAX_PRECISE contracts;
this records no exact backward RSQ/DP3 cone or exceptional raster transport.
Complete records contain actual shaderSource/compile/link, geometry/uniform
readbacks, all RGBA bytes, hardware identity, coverage, zero browser errors and
released object budgets. Four separately compiled actual C-source faults
(widen yz, pack source lanes, overwrite a neighbor, publish an alias early)
each fail independent physical pixel predictions.

The full F4 input inventory is preserved. Its explicit migration ledger records
24 historical mask admissions, 30 new uninitialized-source parse rejections
and the 2 unchanged original lighting admissions. Four historical MAD/TEX
negatives and every unrelated complete F4 result remain unchanged. All 19
original capture hashes/bodies are unchanged and 14/19 are now accepted.
Retained PRECISE/equality/selected-lane/radial hardware leaves, promoted F4
consumer/allocation checks and radial regressions also pass.

Lossless evidence is committed under `evidence/virgl-ordered-masks/`:

- `worker.tar.gz`: `bdf9499f20d74e44a1c3f57ff207f2f7e0e5e568e0e81172130809dd7961edad` (713 files).
- `cold.tar.gz`: `04f6aa5b8fbfa77f4a112f0ebb795abaae9e60ccfe8929e4b7fcadd6b9d33677` (715 files).
- `worker-receipt.json`: `5a3cefc2f55f703eab313fc3508b2f6b21e2645d9a95553d9e4a9f2618cc94ce`.
- `cold-receipt.json`: `cae07cf58c61518cb62a4c86682cf51cb059a4bfa19d8bbc446c18c0cf0a109e`.
- `cold-report.json`: `1740e1fb815546a63b22132a178b490d7411cbebde16fd49bb48c87bc627233d`.

The manifest binds both native LLVM binaries, generated Wasm/mjs artifacts and
the screenshot. Every recording file is archived; each member was streamed
back and checked against its original size and SHA-256, then originals were
checked again. The cold report identifies the exact detached clone, clean
status before/after, scrubbed environment names, full canonical log and every
acceptance-file digest. Evidence/status packaging changes no frozen runtime
or recording-harness source.

The production diff extends only the existing destination parser predicate;
checked source snapshots, component authority, arithmetic and consumer
contracts remain unchanged. This recording proves ordered destination writes
and their scoped native/Wasm/shared-renderer behavior. Owned-bank output and
precise ADD/MUL remain separate boundaries. Production guest GPU negotiation,
live deployment and desktop 300 MIPS are not claimed. A fresh verifier must
judge this diff and evidence before setting verified.
