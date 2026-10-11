---
id: E6-T11d38
epic: 6
title: Consume original packed unsigned samplers and COLOR0–3 surfaces
status: implemented
estimate: S
risk: high
priority: 525.027039000378
depends_on: [E6-T11d37]
capstone: false
---

## Boundary

One false-by-default selected original packed UINT command consumer in decoder
and state only. Admit original B10G10R10A2_UINT=225 and R10G10B10A2_UINT=253
sampler views and COLOR0–3 surfaces through D37 native storage. Reuse the held
integer compiler, resource generations, image-range/job ownership and native
integer readback. Preserve original aliases, unsigned sampler/output masks,
nearest-compatible filters, raw UINT clears and per-slot blend bypass. All
historical command profiles, default device and production caps remain closed.

## Deterministic acceptance

`make verify-E6-T11d38`

Authenticate D37 storage and D36 consumer seals/source closures incrementally.
The negative command below records six complete original view/surface refusals
at the independently verified predecessor. Execute both aliases through original
TXF/TXL/nearest operations in both shader stages, base and restricted mip ranges,
constant/swizzled views and complete raw UINT output planes with zero tolerance.
Integer vertex varyings must retain the held CONSTANT contract.

Execute each COLOR0–3 slot at base and nonzero levels, distinct fields and field
extrema, sparse and broadcast integer outputs, scissor/color masks, raw integer
clears, and mixed FLOAT/SINT/UINT attachments with float-neighbor blend folding.
Derive packed field widths/swizzles from primary Mesa/header descriptors. Pin
Mesa's pure integer packing conversion and prove out-of-width uint shader/clear
conversion on actual RGB10_A2UI targets; never reuse normalized float or masking
assumptions. Invert original TGSI/packet words into complete native uint lanes,
original packed public words, full SG padding and untouched mip planes.

Prove typed/FLOAT/SINT/alias/filter and old-profile refusals before any native
guest draw or private image copy. Run three varied retained-range, resource ID,
context, cache, finishing-fence and disposal schedules. Physically substitute
an incorrect sampler texture and nonzero color attachment; corrupt completed
native packed output after a distinct second fence. The unchanged full independent
inverse must catch every control. Record actual native binding types/levels,
compiler selectors, cold/warm cache identity, once-only retirement and zero
terminal charges. Held storage budgets remain D37's four-byte packed storage and
sixteen-byte native integer reads.

Run scoped syntax/diff/task policy checks, affected historical consumer paths,
and rebuild the unchanged actual C/Wasm bridge with held digests. Account for
every changed governing V8 partition, preserving reasoned exact predecessor
waivers only for unchanged operands. Record one exact-head hot acceptance and
one pristine scrubbed cold clone, and reopen the complete worker source/input/
native/coverage/browser/screenshot archive. This selected isolated consumer is
not reachable through the demo; parent E6-T11d retains production guest bring-up,
built-page/live deployment and independently measured throughput acceptance.

## Adversarial verification

A fresh critic reads the task/diff and predicts before opening recordings.
Authenticate all source/member pins, original numeric aliases, pure integer
field conversion, exact cold proof and unchanged compiler/storage boundaries.
Carry HELD facts forward only with unchanged source and dependency digests.
Independently derive native/public values from complete original packets/TGSI,
including uint extremal fields, mixed target masks, raw integer clears, sampler
stage/types/ranges, padding and private mip isolation. Interrogate every changed
governing partition and complete fence/generation/native retirement custody.

Run three new varied schedules, scoped refusal/failure attacks and one bounded
novel mixed-alias/partial-output/generation attack. Sabotage actual completed
native packed storage after a distinct new physical fence and require the
unchanged full inverse to refute it. Promote one useful deterministic attack,
seal its full recordings and mark verified only if no contradiction or proof
gap survives. Do not repeat an unchanged final cold clone absent a portability
finding. Production guest/capset/throughput claims are outside this boundary.

## Verification log

### 2026-10-11 — worker — original packed UINT consumer refusal

D37 is independently verified at
`f9f479c20d37d89d0d6da18675777a4a8fd7a7b9`. Reproduce:

```sh
node evidence/virgl-production-readiness/standard-packed-unsigned-consumer-gap.mjs
```

The complete pinned record
`evidence/virgl-production-readiness/standard-packed-unsigned-consumer-gap.json`
shows six unsupported-feature refusals through the D36 selected command
consumer: both aliases at base and swizzled restricted mip sampler views, plus
nonzero mip color surfaces. This is synthetic original-wire refusal evidence,
not a guest/native draw. D37 storage and the unchanged integer pair compiler
permit this one selected consumer prerequisite; no complete API or positive
production capability follows from it.

### 2026-10-11 — worker — selected packed UINT command submission

Runtime/harness freeze: `11326fe597196cb75d0853d230da0a3ed22683c5`.
Verified dependency: `f9f479c20d37d89d0d6da18675777a4a8fd7a7b9`.
Only decoder/state runtime changed; D37 storage, the constant domain, actual
C/Wasm compiler, crates, guest tooling and the production demo remain unchanged.

Commands, in order:

```sh
env EMCC=/Users/blamy/.cache/wasm-vm/emsdk/4.0.22/wasm-vm-emcc VIRGL_PACKED_UNSIGNED_CONSUMER_EVIDENCE_DIR=target/evidence/virgl-packed-unsigned-consumer-final-hot make verify-E6-T11d38
python3 tools/virgl-packed-unsigned-consumer/cold.py --output target/evidence/virgl-packed-unsigned-consumer-final-cold
python3 tools/virgl-packed-unsigned-consumer/seal.py target/evidence/virgl-packed-unsigned-consumer-final-hot target/evidence/virgl-packed-unsigned-consumer-final-cold evidence/virgl-packed-unsigned-consumer/worker
```

Hot and scrubbed pristine cold both passed at that exact freeze with zero
browser/console/request errors on headed Chrome 155.0.8059.39, Apple M4 Max Metal.
Each recorded 36 target cases / 144 frames / 552 targets / 920 complete private mip
planes, 18 sampler cases / 54 frames across TXF/TXL/nearest in both stages, and
three target/sampler boundary schedules (seeds 362514859, 2882400001, 1629686191).
Each schedule recorded 19 target frames and 8 sampler lifetime runs / 60 frames,
including both aliases for completion, cancellation and both disposal modes.
The four affected historical MRT/integer/FLOAT/packed-UNORM paths also passed.

The full independent Python inverses derive native uint lanes and original
public packed words from the complete original TGSI/packet/input bytes. They
hold exact 10/10/10/2 saturation for out-of-width shader and raw clear values,
per-slot integer blend bypass with FLOAT neighbor folding, typed/alias/linear
filter refusals before guest draws or private copies, every public SG/padding
byte and untouched private mip, caches/contexts/reused generations, physical
fence custody and once-only native retirement with zero terminal charges.
Three real native controls are refuted by the unchanged inverses: wrong sampler
storage, substituted nonzero attachment, and completed packed R=1023 corrupted
to 1022 after a distinct new native fence. No result-array mutation is evidence.

D37/D36 authentication reopened 123156 predecessor archive members and pinned 290
unchanged compiler/storage sources, both generated compiler binaries and primary
Mesa 26.2.2 integer pack/parse sources. The generated module remains
`6bb07a0b2a056d21ae52b22d7700ce10577854c1cdcf0877dd80be938e30e0fa`;
Wasm remains `acbe036afcdc4f1d8aa8cfb0fb107f48ba27759a6af4a7b9d6c83e3aa679d6cc`.
Nested V8 accounting has 254 positive governing partitions and 16 explicitly
source-pinned legacy operand waivers, 14 carried at the exact D36 partitions and
two unchanged single-target/disabled-integer fallbacks. No new packed-UINT
lookup, guard, invocation or profile operand is waived; no unexplained zero
partition remains.

Full worker seal: `evidence/virgl-packed-unsigned-consumer/worker`, 26639 reopened
members,545436693 raw bytes, 18851139 archive bytes. Archive SHA256
`8faad34f84ccfce10b8645598ad92f53a2e3b58414949d4dee6fc59a5ed7a0c6`;
index `a9004074786c4e82196bf4177986b7cf150c16bdd6f611ecda330f8c314cb567`;
manifest `59503b08e0af721884fd8496d02ba4bc72f17c7982208c13d5ded7354fb66e3e`.
Hot receipt `3b25b9a5a58139decdcb807a3feef5a7179bcd035634a0fa9a109a3a465160d7`;
cold receipt `61801e6a8853e61c1900edc65ada84156347346a00db44e7714c86461c449ce6`;
cold report `0a25da170eb7f46b8e46c984f272b37cc17cd2ae9f70961613abcbcd116ba8e6`.
The seal contains complete sources, raw native/public/input blobs, browser/GPU
metadata, original requests/responses, full coverage regions, logs and screenshots.
This is a worker claim for one selected isolated consumer. Production caps,
real RISC-V guest graphics, deployment and 300 MIPS remain unproven.
