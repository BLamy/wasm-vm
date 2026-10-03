---
id: E6-T12e4c1
epic: 6
title: Preserve ordered binary32 comparison masks over raw words
priority: 525.026990431
status: implemented
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
