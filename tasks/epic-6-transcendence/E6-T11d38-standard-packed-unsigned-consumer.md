---
id: E6-T11d38
epic: 6
title: Consume original packed unsigned samplers and COLOR0–3 surfaces
status: verified
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


### 2026-10-11 — fresh adversarial verifier — VERDICT: verified

VERDICT: verified

Fresh critic of worker submission `83b2e147f7134bb807b699500ba91bd4a42e9090`,
runtime/harness freeze `11326fe597196cb75d0853d230da0a3ed22683c5`, against verified
predecessor `f9f479c20d37d89d0d6da18675777a4a8fd7a7b9`. Read the full task and diff
before opening evidence. All twelve falsifiable predictions were written first
in sealed `critic/predictions.json` (SHA256
`eb2f686659d1f8556e2b33835a8541480506099fb2494085631ace5fe5bf5255`);
all are HELD in `critic/verdict.json`. No contradiction or coverage gap survived.
No runtime implementation was edited.

- **P1 authentication — HELD.** Independently reopened all 26639 worker archive
  members and all 123156 D37/D36 predecessor members, matched every size/digest,
  authenticated 871 worker closure sources and 290 unchanged storage/compiler
  sources, and reopened both exact-head receipts and the scrubbed pristine cold
  report. Freeze-to-submission changes contain only task/queue/seal material.
  `critic/authentication.json`, SHA256
  `c1ba4f97ab8cb131f0a0ba7f20a2f95ad43f534a4b24488cc95eef009cc579f8`.
  Carry unchanged predecessor HELD results, including module
  `6bb07a0b2a056d21ae52b22d7700ce10577854c1cdcf0877dd80be938e30e0fa`
  and Wasm `acbe036afcdc4f1d8aa8cfb0fb107f48ba27759a6af4a7b9d6c83e3aa679d6cc`.
  The authenticated final cold clone remains sufficient; no portability finding
  warranted repeating it.
- **P2 pure UINT conversion — HELD.** Independently generated and compiled the
  pinned original Mesa pack kernels: non-normalized pure uint channels clamp
  through `MIN2` to 1023/1023/1023/3 before shifts/masks. Alias 225 uses RGBA
  offsets 20/10/0/30 and alias 253 uses 0/10/20/30. Tested out-of-width/extremal
  operands against those original kernels. `critic/primary-audit.json`, SHA256
  `80cc64113cd3cee6f79a3335613f6e3cf370c0cdf5237ef8fe4555f319333b75`,
  pins original pack/parse/header descriptors. Public storage remains four
  bytes per pixel; diagnostic native integer reads remain sixteen.
- **P3 hardware saturation — HELD.** Original raw uint clear
  `[4294967295,1024,2147483648,4]` and out-of-width shader outputs produced
  `[1023,1023,1023,3]`, public word `0xffffffff`, on both native packed aliases.
  Worker `hot/hardware-targets/report.json` SHA256
  `0490e0e7389882b2d0a7a0acf250e464d7ef6ba892da27eeb0349cbcdacf6131`,
  `$.browserResult.result.frames[8..10].targets[slot=0|3]`: frame 8 is the raw
  clear; frames 9/10 are cold/warm draws. Raw native digest
  `29f0d41985de2cd1af5ec68275a0d23a2335d7bc725fca900a696c21f9a032b0`,
  complete public backing digest
  `dc6d1461a7dc1aad47ebc203a163594bb84fe1573708884b345787d1e7418eb3`.
  Sealed `critic/replay-audit.json` includes all twelve matching hot/cold points.
- **P4 complete target inverse — HELD.** Independently interrogated original
  packet/TGSI inversion, poisoned stored fixture expectations in separate replay
  reports, and reopened all native/public input blobs. Both worker runs retained
  36 target cases, 144 frames, 552 targets and 920 private mip planes; full uint
  lanes, mixed FLOAT/SINT/UINT blending, sparse/broadcast COLOR0–3 outputs,
  masks/scissors, public SG padding and untouched private levels matched.
  `critic/replay-audit.json`, SHA256
  `611ef79a10b59fd78ec0364565107d539d1c68f1d2f637159b23afd6405f8735`.
- **P5 both-stage samplers — HELD.** Both aliases executed TXF/TXL/nearest TEX
  across base/restricted/swizzled/constant views with original field extraction,
  typed `usampler2D` native enum 36306 and complete range/padding checks.
  Independently inspected 24 actual vertex links for `flat uvec4` CONSTANT
  varyings. Exact source/draw pointers and GLSL digests live in
  `critic/wire-audit.json`, SHA256
  `19398aacd1cdaad763b838f09bd6b344e0fddc791d31951a66487c5338722183`;
  each worker run retains 18 sample cases / 54 frames.
- **P6 refusal/failure — HELD.** Fresh original wire decoding keeps all twelve
  historical profiles closed (72 refusals per wire recording), and validates
  malformed, typed FLOAT/SINT, wrong-alias and linear-filter refusal boundaries.
  Recorded 549 scoped refusal points before guest draws/private copies, including
  actual nonzero native clear GLenum failure: fresh target seed 1541459225,
  `report.json` SHA256
  `9d7bea3b967fd7a4ebf553e820e5eefaf47e9595e90714314f19b415b21ee777`,
  `$.browserResult.result.runs[9].history[1]`, label
  `boundary/actual-nonzero-clear-error`, observed `backend-error` with retirement.
- **P7 fence/generation custody — HELD.** Independently checked every selected
  native sync create/poll/delete, monotonic event sequence, CPU read after actual
  successful physical completion and all prior writes including private blits,
  context/cache identity, retained ranges across ID reuse, zero terminal charges
  and once-only object retirement. Authenticated and decompressed 31708 blobs
  from 41 browser recordings. `critic/fresh-audit.json`, SHA256
  `5ced5e48c3e7650466550e19d5c5c8fed8896dfd5f45ebff8a99bdbbb9e17cea`,
  contains per-record source/blob/fence and exact refusal citations.
- **P8 physical controls — HELD.** Fresh wrong nonzero attachment, wrong sample
  texture and completed packed output corruption were recorded on real native
  storage and refuted by the unchanged full inverses. Worker and fresh control
  differences remain in `critic/replay-audit.json` / `critic/fresh-audit.json`;
  no result-array mutation substitutes for a physical control.
- **P9 governing coverage — HELD.** Independently repartitioned every changed
  decoder/state line at every nested V8 range boundary. Both hot/cold recordings
  prove 254 positive governing partitions and exactly 16 source-pinned unchanged
  operand waivers, with zero unexplained partitions: fourteen exact D36 critic
  regions, plus unchanged single-target `?? 0` and integer-disabled `: null`
  fallbacks unreachable under this selected profile. No packed-UINT lookup,
  guard, invocation, selection or integer-format operand is waived.
  `critic/coverage-audit.json`, SHA256
  `e7c7bd1dfedad13dcfd658cac6510631a6f9a0ce353594c71ba25b69df2888b1`.
- **P10 fresh varied attacks — HELD.** New seeds 1541459225, 2773480762 and
  3355599323 each passed complete target and sampler schedules, nineteen target
  frames and eight sampler lifetime runs / sixty frames, including both aliases
  across completion, cancellation and both disposal modes. Scoped feedback,
  incomplete-clear, nonfinite, capability/configuration and actual native error
  paths also held. Four authenticated affected historical paths passed their
  original independent inverses; no unrelated suite was added.
- **P11 novel attack — HELD.** Promoted a deterministic mixed-alias mip attack:
  `[225,FLOAT=31,SINT=200,253]`, only COLOR1/COLOR3 emitted, mask 5, interior
  scissor, FLOAT blend folding, two contexts, reversed packed aliases under reused
  IDs, retained old surfaces and cache reset/restore. Full inverse passed eight
  frames / thirty-two targets / 4096 native words / ninety-six private planes,
  400000 public/padding bytes and 40000 untouched replacement bytes.
  Final promoted clean report SHA256
  `274d6a285d355bd53b619acfb4f88bd1dee298acd5ea009ceb5c39593e589256`.
- **P12 promoted physical sabotage — HELD.** After completed old-generation
  COLOR3 native storage, actual upload changed pixel 9 R=17 to 16. Original
  sync 30 completed at sequence 1446; a distinct second physical sync 31 completed
  at sequence 1505. The unchanged inverse rejected frame 8, COLOR3, raw lane 36,
  expected 17 / observed 16, and the full private level 1 plane. Final promoted
  sabotage report SHA256
  `7f1acfa74b2f3e9d5ed637a3f8d42cf981e86f204dbe3eacb036ab7344457e9e`;
  `critic/promoted/sabotage/critic-audit.json` differences[0], native SHA256
  `c27cdf181488ff3f72959028d8c309d9ab35b79b4d19b5ba4a4d96752f77e75d`.
  The same complete inverse SHA256
  `c94820525c7d83313cd41e5aaf4b4ffb3cae173e8f3a60d0c5c1b8c5f076269c`
  verified clean and refuted control; `critic/promoted-integrity.json` also
  independently authenticated all 731 final promoted raw blobs and source pins.

SUITE: promoted `standard-packed-unsigned-consumer-critic.mjs`, actual headed
Chrome recorder `tools/verify-virgl-standard-packed-unsigned-consumer-critic.mjs`,
original-wire full inverse `tools/virgl-packed-unsigned-consumer/critic.py`, and
`make verify-E6-T11d38-adversarial`. That permanent target passed, including its
expected actual-storage sabotage failure and independent refutation. Recorded
zero console/page/request errors on Apple M4 Max Metal.

Commands: scoped Node syntax checks, Python compile checks, `git diff --check`,
`python3 tools/check_task_policy.py`; sealed `authenticate.py`, `primary.py`,
`replay.py`, `coverage.py`, `fresh.py`, `wire.py`, `promoted-integrity.py` and
`seal.py`; unchanged actual hardware runner in boundaries/sample-boundaries
modes for all three new seeds and fault modes nonzero-attachment/sample-plane/
completed-output; `make verify-E6-T11d38-adversarial`. Full exact commands and
logs are sealed with each source/input/native/browser/coverage recording.
After status change: `python3 tools/check_task_policy.py`, then
`python3 tools/build_queue.py`, then commit this verdict.

Complete fresh verifier seal: `evidence/virgl-packed-unsigned-consumer/verifier`,
7901 members reopened byte-for-byte, 399012542 raw bytes,
19875235 archive bytes, 876 source closure pins. Archive SHA256
`abd8363319ed7967177acb4927f1bffd55133bb21373a382ae574cc1e9c90db8`;
index `f174a0fc0b7bd4f8f92fe7787860a6a42febdc0e1c36a277c89653610a0bd3c6`;
manifest `2040d964cbba902d937a0d890f838a5c26b828c231a1485d7735cb6e3b92bec7`.
It includes complete fresh recordings, original packets/TGSI, every raw native/
public/input blob, all coverage source/regions, actual GPU/browser metadata and
screenshots, both final promoted target recordings, full audits and source
snapshots. Existing worker evidence was never modified. The verified boundary
remains this false-by-default isolated consumer; production guest/capset,
deployment and throughput remain assigned to parent E6-T11d.
