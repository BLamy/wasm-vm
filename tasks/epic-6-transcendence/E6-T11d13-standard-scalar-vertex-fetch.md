---
id: E6-T11d13
epic: 6
title: Execute remaining scalar floating vertex formats from original GPU buffers
priority: 525.02703900031
status: verified
depends_on: [E6-T11d12]
estimate: S
risk: high
capstone: false
---

## Boundary

One scalar floating vertex-fetch boundary in the selected standard async renderer:
original R/RG/RGB/RGBA32_UNORM/SNORM and 8/16/32_USCALED/SSCALED. Extend the
immutable pinned format descriptor; ordinary arrays keep original GPU buffers,
native floating shader inputs, pointer conversion, exact type/normalization,
offsets/strides/divisors and bounded actual source fetches. No CPU vertex conversion
or shader evaluation. Stride-zero values retain the existing asynchronous GPU
read batch and unpack only the declared signed/unsigned scalar width into native
generic binary32 values. Scaled inputs convert their scalar values directly;
normalized32 clamps signed minima and uses its full original integer range.

Preserve existing float32/half/normalized8/16 fetch semantics, missing lanes,
work/byte ceilings, source revision/name reuse/cancellation/disposal and cached
A/B/A native state restoration. Pure integer and packed/swizzled formats, compiler
semantics and production caps remain separate. Update historical wire exclusions
whose format is deliberately admitted by this new boundary; preserve their original
sealed negative evidence as history. This prerequisite does not qualify complete
API support or activate production guest graphics.

## Deterministic acceptance

`make verify-E6-T11d13` checks original pinned native/sanitized enums, literal wire
admission/end bounds and headed hardware through the unchanged fixed-memory
compiler. Record every new family/component count for arrays and stride-zero
attributes under varied delayed schedules; native pointer type/normalization,
original full GPU storage, actual reads and exact supplied generic words. An
independent literal byte/original-shader oracle must not import the runtime format
descriptor or scalar converter.

Probe signed/unsigned widths, zero/min/max, values around binary32 rounding at
2^24, signed minima normalization, missing lanes, shared/mixed byte and 32-bit
buffers, individually unaligned offsets with aligned sums, non-four-byte and
legal overlapping strides, indices/restart/instances/divisors, exact ends and
one-byte-short buffers, staging/work limits and pending source lifetime attacks.
Actual served native type/normalization and generic scalar conversion faults must
complete real draws/fences and fail original full pixels. Preserve standard
native numerical authority without claiming a portable exact arithmetic certificate.

Carry unchanged compiler/allocator and earlier HELD evidence; run the affected
compact positive hardware and legacy float32 admission once. Record source/blob
custody and V8 coverage, one final pristine exact-head default acceptance with
scrubbed environment, then seal for a fresh critic. No unrelated compiler gauntlet
restart for the unchanged C/Wasm boundary.

## Adversarial verification

Predict integer source widths, signedness, normalization, native floating input
types, component defaults, generic binary32 words, actual last fetched bytes and
pixels before inspecting evidence. Authenticate original uploads/native storage,
source/Wasm identities and the clean clone. Independently seed one mixed-width
shared-buffer and stride-zero case with delayed read collection, then attack a
rounding boundary, a signed minimum and a stale/reused source. Cover every changed
runtime hunk and sabotage the promoted oracle through actual GPU execution. Carry
unchanged HELD results rather than re-litigating prior compiler arithmetic.

## Verification log

### 2026-10-10 — worker — activation

Predecessor E6-T11d12 is independently verified at
`b98847797f109b0a3af6171fd0a8c21983e1057b`; its fresh critic explicitly released
the clean index. The literal negative record
`evidence/virgl-production-readiness/standard-scalar-vertex-gap.json` binds all
32 original scalar packets and 356 source/generated identities at that verified
head. Each packet still fails standard and historical admission. The user's
explicit instruction to finish production guest graphics keeps this ordered
prerequisite ahead of unrelated general-queue work. One active S/high boundary;
no production caps or complete API claim is made by this activation.

### 2026-10-10 — worker — self-validation before freeze

The runtime diff is limited to original scalar descriptors in `decoder.mjs`
and the signed-width/normalized-versus-scaled stride-zero branch in `state.mjs`.
No compiler, allocator, interface, resource, guest or production source changed.
The first complete new hardware run passed 383 frames, 396 wire records and 80
historical wire records. Both actual served faults completed draw/fence work
and failed original pixels: signedness expected `[0,0,0,207]`, observed
`[0,0,0,79]`; scaled-generic rounding expected `[0,0,128,75]`, observed
`[0,0,0,75]`, both at pixel(1,2). Offline original byte/storage/word/pixel checks
passed. Pinned native and ASan/UBSan enum programs print the same literal list.

The affected compact225 and its two native faults still pass their independent
saved-pixel audit; the promoted critic44/297-wire run passes unchanged original
TGSI/pixel interpretation with the deliberately updated scalar exclusions.
Historical recordings remain byte-identical. Eight additional normalized32
retained-generic interior word checks bring the final matrix to 391 frames,
including full-original-range rounding. `target/evidence/virgl-scalar-self-*`
and `/tmp/wasmvm-scalar-*.log` are inner-loop output only, not the final proof.
The final default hot and scrubbed pristine-clone command will be recorded once
at the frozen implementation/harness head, then sealed for a fresh critic.

### 2026-10-10 — worker — implemented; frozen hot/cold submission

Runtime/harness freeze: `1b8e94b79de6ee79f72116246ce4042aa7bda815` (activation `dea9d95a`).
Exact final commands, each passing exit0 with no harness correction or runtime
change after freeze:

```sh
VIRGL_STANDARD_SCALAR_EVIDENCE_DIR=target/evidence/virgl-standard-scalar-final make verify-E6-T11d13
python3 tools/virgl-command/standard-scalar-cold.py --output target/evidence/virgl-standard-scalar-final-cold
python3 tools/virgl-command/standard-scalar-seal.py target/evidence/virgl-standard-scalar-final target/evidence/virgl-standard-scalar-final-cold evidence/virgl-standard-scalar/worker
```

Original 32-format pinned native and ASan/UBSan programs agree; 396 scalar wire
and 80 historical wire cases pass. Each physical recording has 391 new frames,
102912 independently derived full pixels, 391 native draws, five original private
index buffers, ten source/staging/work rejections, six delayed lifetime probes
and active-read disposal. All job-owned reads/staging/normalized storage return
to zero. Original full GPU bytes and pointer type/normalization, source generation,
effective alignment/end/divisors and native generic words are recorded. Independent
BigInt integer rounding checks signed/unsigned extrema and 2^24 ties; normalized32
retained generic words exercise its full original range. Array arithmetic retains
native authority, not a portable general word certificate.

Both actual served faults finish real native draws/fences and contradict original
pixels. The affected compact225/60160 pixels plus critic44/31744 pixels and their
updated 297 wire cases pass in both runs; both earlier compact faults still fail
after actual draws. The unchanged C/compiler/allocator and point/list/restart
boundary carries 154 authentic historical evidence files. Actual generated
16MiB Wasm hashes match the D12 critic pins; no compiler, guest or production
source changed.

Hot receipt SHA256 `33dbe88bfa942657c87255d8a65937fac6509e8bdf038919ffd21d7a476cbfc3`. Cold report SHA256
`6651b7e44098ae7d9f40a81fb789e5f19b63a29dd2e28c091e96f7a37926316e`; cold receipt SHA256
`c7b25cad9a3f308f66b9b58130d61db7db30dd7f893a5fe6005969c5f1d89dfb`. The scrubbed pristine clone identifies the same exact
freeze, exits0 and has empty status before/after. The committed worker seal
`evidence/virgl-standard-scalar/worker/{manifest.json,records.json,recording.tar.gz}`
contains 9578 records; archive SHA256 `99c79728c82a3c7ddef092b1faa10420192df535be67da662e1724b3aab596d2`,
23655986 bytes; record index SHA256 `8f1c71adc3cce4358b72b8fa80c2bcf4c8e90d8c02c30cfde28c2967869c1097`.
Original local paths and `/tmp/wasmvm-standard-scalar-{final,cold,seal}.log`
remain available; the committed archive is the handoff. Fresh adversarial
verification is pending. This implements only scalar floating fetch: complete
API/profile/caps, production guest offload, deployment and throughput are unclaimed.

### 2026-10-10 — fresh verifier — VERDICT: verified

VERDICT: verified

The fresh critic wrote P1–P11 in
`evidence/virgl-standard-scalar/verifier/predictions.json` before opening the
worker recording. Runtime/harness freeze remains
`1b8e94b79de6ee79f72116246ce4042aa7bda815`; worker submission is
`2879d9a49c5b9b4f351993f0cf75342c7743d41b`. Promoted independent test/oracle
freeze is `f8770251a815c9c9d7dbca58e671a0ec61262c94`. No implementation code
was edited by the critic.

- P1 custody and P10 pristine/compiler — HELD. Independently authenticated every
  one of the 9578 archive records, all raw/gzip blobs and served/V8 identities,
  each receipt's 531 tracked sources and two actual generated compiler files,
  and all 154 unchanged predecessor evidence files. The recorded scrubbed default
  acceptance exits 0 at the exact freeze; its still-present clone is pristine.
  Actual fixed 16 MiB generated hashes match the D12 critic pins. Compiler/allocator,
  C/vendor, guest, web and production sources are unchanged. Citation:
  `verifier/authentication.json`; worker archive SHA256
  `99c79728c82a3c7ddef092b1faa10420192df535be67da662e1724b3aab596d2`.
- P2 literal ABI/admission — HELD. Native and ASan/UBSan pinned programs emit
  the independently enumerated 32 formats. Independently reconstructed 396 scalar
  packets and 80 historical packets per run preserve byte-end overflow and legacy
  gates. The affected 297 compact critic packets per run admit only deliberately
  widened original scalar enums. The sealed historical negative evidence stays
  byte-identical. Citations: `verifier/physical-audit.json`, original
  `hot/abi/scalar-{native,sanitize}.json` and `hot/wire/report.json` in the worker seal.
- P3 native source/pointers — HELD. Reconstructed every complete original GPU
  buffer from literal upload packets and owned exchanges, checked original source
  generations, floating native reflection, pointer types/normalization, component
  counts, effective alignment/stride/divisors and actual index-derived ends.
  Shared signed32 overlap at original `hot/hardware/report.json:398065` uses
  resource 3, offset 216, stride 8 and requiredEnd 328; pixels SHA256
  `7ae7c17ba068572e60850a3bdcd53be0ac3e477d5a9fc788bd3c5c21f4c24ca0`.
- P4 exact generic words — HELD. A separate arithmetic byte decoder plus BigInt
  rational ties-to-even rounding imports no renderer descriptor/converter or
  worker model. Original `hot/hardware/report.json:224239` converts
  `[16777217,16777218,16777219,33554431]` to words
  `[0x4b800000,0x4b800001,0x4b800002,0x4c000000]`. Signed normalization minimum
  is `0xbf800000` at line312239. Full-range normalized32 interior words hold at
  lines316715/322310; missing components hold at line350849. Original retained
  reads contain exactly declared bytes. Citations and full report/pixel digests:
  `verifier/citations.json` and `physical-audit.json`.
- P5 original shader/pixel authority — HELD. The carried independent interpreter
  evaluates original TGSI instructions and constants from literal packets against
  original bytes, never generated ESSL. All 782 scalar frames / 205824 pixels and
  538 affected compact/critic frames / 183808 pixels hold across hot/cold; every native
  draw completes its final fence. General native array arithmetic retains bounded
  numerical pixel authority; no portable exact arithmetic certificate is added.
- P6 bounds/work and P7 lifetime/ownership — HELD. Each run's ten rejections
  independently fails original ends/alignment, required staging 22>21 or original
  work 6>5 before drawing. Twenty total baseline private index buffers match literal
  restart semantics and retire. Every scalar run releases job storage and owned
  fences. Six delayed probes per run reach their stated phases: revision/cancel
  drain with zero draws; name reuse preserves originally uploaded generations
  and pixels; active-read disposal releases the batch. A/B/A restores poisoned
  native state. Reuse at original line425796 has pixels SHA256
  `ea263e0b96d3e17cc0fcc2c3a34b4a0469780b02c854f71c17c417e8e893a350`;
  restored A at line430101 has SHA256
  `6c2187a5f30442e58aa9f5e1f881aa61d458712836ade087de4544038dfee05f`.
- P8 original GPU fault witnesses — HELD. Served signedness and scaled-generic
  faults complete actual draws/fences and fail original pixels in both recordings.
  `hot/fault-native-signedness/report.json:364`, pixel(1,2): predicted
  `[0,0,0,207]`, observed `[0,0,0,79]`. The scaled witness at
  `hot/fault-constant-scaled/report.json:364` predicts `[0,0,128,75]`, observes
  `[0,0,0,75]`. Four affected compact fault witnesses also hold. Exact mutation,
  report and blob digests are in `verifier/citations.json`.
- P9 changed-hunk coverage — HELD. All 13 added runtime lines and all affected
  historical expectation updates have authenticated detailed V8 hits; no new
  runtime executable segment is unexercised. All 34 worker diff hunks are classified.
  The only unhit executable segment on a changed helper line is the textually
  unchanged fixture-only unsupported-format throw, explicitly waived. Types,
  declarative metadata/docs and sealed records are individually classified;
  defensive harness failure guards add no product behavior. Citations:
  `verifier/coverage-audit.json` and `hunk-audit.json`.
- P11 independent bounded attack/sabotage — HELD. Seed `0xd35a7e19` generates
  original bytes independently of the worker fixture, and proves 92 fresh M4 Metal
  frames / 70656 pixels, 396 wire cases, mixed-width shared storage, delayed generic
  reads, fresh 2^24 ties, signed minima, non-four-byte/overlapping strides,
  restart/divisors, five short/alignment rejections, revision/cancel/reuse and
  disposal. Both served runtime sabotages complete native draw/fence work and
  fail the promoted original-TGSI oracle. Fresh scaled tie pixel(1,2): predicted
  `[4,0,128,75]`, observed `[4,0,0,75]`. Citations: `verifier/fresh-audit.json`,
  sealed `final-gpu/report.json` and `final-sabotage-{native,constant}/report.json`.

Commands: `python3 evidence/virgl-standard-scalar/verifier/authenticate.py`;
`node evidence/virgl-standard-scalar/verifier/audit.mjs`; scoped scalar/compact
`--node-only true` runs with `NODE_V8_COVERAGE`; final
`node tools/verify-virgl-standard-scalar.mjs --output
evidence/virgl-standard-scalar/verifier/final-gpu --adversarial true`;
the same promoted command with `--smoke true --mutation native-signedness` and
`constant-scaled` (both expected exit1 at original pixels); `audit.mjs --fresh`;
`fresh-authenticate.py`, `coverage.py`, `finish.py` and `seal.py`.

SUITE: promoted the independent scalar byte/rational/TGSI oracle and seeded headed
hardware test, using the existing `--adversarial` runner. The final critic seal
contains 543 records, archive SHA256
`bd65fa424aac4dd77166240f7f2dea90bcd0b06d5a537d8c74c322bbe9c87942`,
2515271 bytes; index SHA256
`7a68ed058a40b31cadc85ff8cea838ee35b60d5fc593925137d75299a8a4704f`.
P1–P11 are HELD with no findings or proof gaps. Earlier unchanged compiler and
allocator proofs carry forward; no unrelated gauntlet was restarted. Authority
remains isolated scalar floating fetch. Complete API/caps, production guest
graphics, deployment and throughput remain unclaimed.
