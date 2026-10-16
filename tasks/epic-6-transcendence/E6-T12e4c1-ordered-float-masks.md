---
id: E6-T12e4c1
epic: 6
title: Preserve ordered binary32 comparison masks over raw words
priority: 525.026990431
status: verified
depends_on: [E6-T12e4b]
estimate: S
risk: high
capstone: false
---

## Boundary

Add FSLT/FSGE to the owned raw-lane backend using only integer classification and
ordering of binary32 encodings. Both operations produce exactly all-ones or zero.
Every signed quiet/signalling NaN is unordered; both signed zeros compare equal;
negative magnitude ordering reverses; all infinity and subnormal encodings retain
their order. Do not implement these operations with lossy float bitcasts.

Select a new v3 stage profile only after a new opcode passes full validation.
Preserve the existing IR allocation, instruction, bank, input/output and fixed
Wasm bounds; existing v1/v2/v5 results remain exact for inputs without a newly
admitted opcode. Preserve lane initialization, masked/swizzled aliases and the
raw-to-float output guard. An IN operand means the bits actually delivered by the
float interface, not a new raw payload guarantee across that interface. Numeric
ADD/MUL/MAD/TEX mixed use, PRECISE and control flow remain gated.

## Deterministic acceptance

`make verify-E6-T12e4c1` records native sanitizer/Wasm parity and actual hardware
VS/FS execution with an independent raw binary32 oracle and complete 32-bit mask
readback. Cover every ordered domain, same bits consumed by integer and floating
comparisons, dynamic operands, partial writes, aliases and mixed v5/v1/v2/v3
smooth/flat full and partial interfaces. Retain all unaffected earlier results
and browser gates; explicitly bind any newly supported historical input and its
adjacent unsupported replacement instead of weakening old receipts. All 19
originals stay unchanged. Record source coverage, bounded failure/recovery,
exact-head evidence and a pristine-clone run. Production stays off.

## Adversarial verification

Attack positive/negative zero, equal/adjacent positive and negative normals,
smallest/largest subnormals and the normal boundary, both infinities, and signed
quiet/signalling NaNs with varied payloads. Contrast USEQ on signed zeros with
ordered comparisons, and ensure FSGE is not a bare complement of FSLT on NaNs.
Require exact all-ones masks through integer operations and selection. Attack
missing consumed initialization, source aliasing, unsafe raw float outputs,
profile contamination and output bounds. Corrupt unordered handling, signed-zero
handling or negative ordering and require independent actual GPU failures. Audit
all changed executable paths and preserve applicable prior verifier results.

## Verification log

### 2026-10-03 — worker — ordered binary32 masks

Runtime, fixtures and proof harness frozen at `d549500106399ada00fcd48f1439bd107377ebc5`, based on verified integer-mask head `7be4e09748bc4acfcdf167bd66cd6f3d890132d5`. The owned v3 profile admits validated FSLT/FSGE through integer classification and ordering. Signed quiet/signalling NaNs are unordered; both signed zeros compare equal; negative magnitudes reverse; infinities and subnormals retain their encoded order. Every result is exactly all ones or zero. No arbitrary float bitcast carries these masks. Complete RHS snapshots preserve partial/swizzled aliases. Instruction/IR/native-profile sizes remain112/26,232/7,608 bytes, with fixed16MiB Wasm memory and256KiB stack. Numeric mixing, PRECISE and production GPU negotiation remain gated.

The recorded ASan/UBSan run covers1,159 cases (279 retained raw,426 retained integer,454 new),92 pairs,139,049 calls,74,096 exact single and55,572 exact pair recoveries,3,683 truncations,324 hostile calls and4,096 mutations across four seeds. The396 shared new cases comprise188 accepts/208 rejects, with58 hardware shaders. All unaffected prior full outputs and all19 originals remain exact. Six historical comparison inputs are promoted byte-for-byte; their old negative slots become adjacent FSEQ/FSNE unsupported cases with unchanged rejection results. The successor compatibility validator leaves historical receipts and browser oracles untouched. Measured native maxima are54,603/107,416 JSON bytes and51,845 GLSL bytes; new browser maxima are51,603/101,592 JSON bytes and50,380 GLSL bytes.

Actual GPU proof reconstructs768 words across eight operations/alias/stress probes,12 literal vectors and both stages:384 vertex byte-carrier captures and3,072 fragment bitplanes. Twelve vertex and12 fragment finite selections prove mask consumption;38 full/partial smooth/flat v5/v1/v2/v3 pairs yield37,696 independent nonedge pixel checks. Upload/readback identities, coordinate-system orientation,179-instruction stress, owned allocation exhaustion/recovery and all494 GL object releases are recorded. Three source-bound corruptions compile/link and fail actual output: unordered guard, signed-zero handling and negative ordering. Zero browser console/page/request errors occurred. The final screenshot is byte-identical to the visually inspected development capture.

Final recorded commands:

```sh
VIRGL_FLOAT_MASKS_EVIDENCE_DIR=evidence/virgl-float-masks/worker make verify-E6-T12e4c1
python3 tools/virgl-float-masks/cold.py --output evidence/virgl-float-masks/cold-clone
```

The gate preserves the complete bank/paired/component/captured/draw/state proof plus constant transport, asynchronous jobs and prior raw/integer hardware/sabotage oracles. This is an isolated compiler proof: default demo assets and guest capsets are unchanged. It establishes neither live Mesa acceleration nor guest MIPS/FPS. Independent verifier status remains the critic's responsibility.

Evidence paths under `evidence/virgl-float-masks/` (SHA256):

- `worker/receipt.json`: `0f1a1f4f753a5bdefc49f00c97e7f72a35a10fbea57df8e8c9388e97cef7a6ad`
- `worker/native/native-report.json`: `d2af1399a55e947170d0ba60981a9671d0d885c7ceff87f7717c9f98603286b3`
- `worker/hardware/report.json`: `65ec3ac7d7398df79828a68ee2311c2009ef6f915f4065952cac9a737e0e2e92`
- `worker/sabotage-unordered-guard/report.json`: `daa709c6e33131acae6c4cfa3d1659cc5df079ac3572304e97b2dd1528ac4a9f`
- `worker/sabotage-signed-zero/report.json`: `236fe1a68e1c79b6ebb132f241dd82e61de3c7e41ac864304c05dd85213bccbc`
- `worker/sabotage-negative-order/report.json`: `ddc9f556916662eec8d1fcba184a000c467ecc80a211d3d06ec50a002a762279`
- `cold-clone/report.json`: `10c8baac5620e61165168ec7da5ee065cad5be23236982d2423a18a7a9c034f9`
- `cold-clone/acceptance/receipt.json`: `42816f3d8912a53add1613a897252a9498ce47a0f146f4bc27102f2eb491ec22`
- `cold-clone/acceptance/native/native-report.json`: `13834301e8a60f65218c31164eb5b4095e0b486879675b87395f4c9a40bfeda6`
- `cold-clone/acceptance/hardware/report.json`: `9746ee79f311a6918ccb5131cfb4f07b8169ac36e83d095bfe2cc49164b674a7`
- `cold-clone/cold.log`: `6d59e43914e3f4bd7df85733ca7b2506ef56383bee20d60abac8c00575299dde`
- `worker/hardware/browser.png`: `f53d8e12d6d33a342ed5dba3b1410b219c82555d623e1addb15dded473618550`

Worker rehash:118 receipt records. Clean-clone rehash:126 copied files and118 receipt records; checkout began and ended clean at the frozen head. Both runs passed and emitted identical Wasm `8462e4459fce1152a86ac9a5f4f4985905c4060104a53182ddfdfd57bb9dd8d4` and hardware screenshot bytes. Worker sanitizer: `8ca417fa1b7918e6273ce8cd6f915f9227a18fe39afce8b8def9486a02161e53`. Retained clone: `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-float-masks-cold-njzadhle/wasm-vm`.

### 2026-10-03 — verifier — VERDICT: verified

All 20 pre-evidence predictions HELD against frozen `d549500106399ada00fcd48f1439bd107377ebc5` and worker submission `d21fc8a48fe9f9da1ea328ba56a427d5580e2377`. No runtime or worker-harness edits were made by this independent session. Full criterion-by-criterion results, exact capture points, commands, coverage classifications and proof scope are in `evidence/virgl-float-masks/verifier/VERIFICATION.md` (SHA256 `ae61e66931ecfe17e2abe465d264d4ea1199456efb2c428e44549c8d65f16db4`). Predictions remain `1b60d857daf075a80497f212c6c2cfddcfb69fbf157ff4ff203323a67f0f5554`; all verifier artifact digests are bound by `verifier/manifest.json` (`af9f6203fd331689ebd0ae85a2f515fa0a44b434fc88a61cc2b6692e065be6be`).

- **Semantics/known bits — HELD.** Independent sign/exponent/significand checks cover1,576,064 exact ordered comparisons. Five new seeds,51,200 IR instructions and32 concrete schedules/trial yield3,493,824 conservative-bit assertions plus94,240 origin and43,968 output-safety assertions. Exact-rational TGSI interpretation independently replays all768 worker GPU words,384 VS captures and3,072 FS bitplanes. Evidence: `verifier/knowledge-binding.json` (`8bfda979dc9442335bbc2c84bd83ea7030483f0c75aad441b3543e1f0a322ce0`), `verifier/worker-semantics.json` (`5258ee81fe05ff47ad953208cb02c95b53afa12360b6fd65b37a59f1ad356c62`).
- **Boundary/aliases/parity — HELD.** Independently compiled sanitizer/native and actual Wasm match all2,965 complete case results;8,895 calls,5,930 exact recoveries and718 full parent-result comparisons. Both-stage v3 GLSL-overflow attacks reject at `verifier/audit-native.jsonl:3625` and`:3628`, with recovery. The novel GPU probe checks192 words over24 vectors, overlapping FSLT source/destination lanes, integer-mask consumers and TF guard words. Evidence: `verifier/native-report.json` (`15a8d235a22bf777f3639d0338db4eb50a872bfabd110e9a84a588490d5f84a9`), `verifier/hardware/report.json` (`164ce04c3adf5e0881451e7742c51bca351691f9881dcfbd4d85b675a04c8c0a`).
- **Actual corruptions — HELD.** All three worker mutations compile/link and contradict independently predicted raw bytes. The additional alias y→x mutation fails `acceptance.vertex[0].vectors[0]` (`alias-sign-boundary`) after linking: expected`0x3f7f8000`, observed`0x3f000000`, with TF guards intact. Evidence: `verifier/controls-audit.json` (`2eb10d32bff14c44ff5eb8c5c1d74d3f7ae2b312c5a64d5971573375989e25d6`), `verifier/sabotage/report.json` (`f30fccff45acaa39f954ea418bb081f13edfc38d9d108f9c62711ea4c7ddeff3`).
- **Coverage/interfaces/recovery — HELD.** All31 changed executable C lines run.24 relevant new conditions cover both outcomes (48); declarative headers/docs/metadata are explicitly waived, with no new runtime waiver. Independently checked37,696 nonedge pair pixels,24 finite selections, allocator pressure/recovery, and all494 worker GL releases. Evidence: `verifier/coverage-branches.json` (`f2b5215a017dbcd1232ed3a925028784a2b1bced7ac15f757055a00b06a648fe`), `verifier/hardware-details.json` (`4f6da99012637d83a5fbeabe91aa028a7f3f2f291bf967d5343576779e184674`).
- **Historical/cold binding — HELD.** A separate helper's34,022 assertions verify six exact promotions/replacements, unchanged prior full results, all12 claim digests, every native input byte and call count,118 worker records,126 cold copied files/118 cold receipt records, and source/browser bindings. The retained clone remains clean at the frozen head; Wasm and screenshot match exactly. Evidence: `verifier/binding-notes.md` (`5d21791fa49afd3de1a6bc51ec39dae7a22dfb73069528faca6f5aedbc0aa5ee`), `verifier/binding-audit.json` (`12dddeb00f0ee20c5addf1d8a89b99e509c9d95a6bb519819e0aa67654ef9fcd`). Applicable prior HELD results are carried forward; historical receipts and original19 shaders are unchanged.
- **SUITE.** Retain the authored public-API cases, conservative-bit attack, exact-rational interpreter, actual GPU alias/sabotage, branch map and independent binding checker as deterministic verifier artifacts alongside `make verify-E6-T12e4c1`. Native executables/dSYM are excluded from Git; build commands and binary digests remain. This verifies private ordered-mask lowering only: numeric float shadows, live Mesa acceleration and MIPS/FPS remain outside the claim.
