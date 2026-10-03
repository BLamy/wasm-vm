---
id: E6-T12e4b
epic: 6
title: Preserve wrapping integer arithmetic masks and selection
priority: 525.02699042
status: implemented
depends_on: [E6-T12e4a]
estimate: S
risk: high
capstone: false
---

## Boundary

Extend the verified private raw-lane backend with UADD, ISGE, USEQ, USNE and UCMP.
UADD wraps modulo2^32; ISGE compares two's-complement signed32 values. Comparisons
produce exactly0xffffffff or0. UCMP selects each raw payload lane using condition
bits!=0, including noncanonical true words. No float numeric conversion or float
mix may carry arbitrary raw results. Preserve swizzles, definite initialization,
partial writes, same-register snapshots and safe float-IO policy. Do not admit
FSLT/FSGE, float arithmetic mixed with raw operations, control flow or PRECISE.

## Deterministic acceptance

`make verify-E6-T12e4b` records native sanitizer/Wasm parity, actual hardware VS/FS
execution for every new operation and independent full-u32 oracles using the
proven lossless output encodings. Include wrap/carry, signedness disagreement,
all-ones masks, per-lane distinct conditions and payloads, dynamic operands and
mixed-backend pairs. Preserve prior gates, capacities and unchanged19 originals.
Record exact-head and pristine-clone evidence. Production stays off.

## Adversarial verification

Attack0,1,2,0x7fffffff,0x80000000,0xffffffff; wrap in every lane; signed/unsigned
comparison divergence; noncanonical true conditions; NaN/Inf/subnormal payloads
as raw words; source aliasing and masked writes; missing consumed initialization.
Sabotage signed comparison, all-ones mask or UCMP arm selection and require an
independent actual hardware bit failure. Audit all changed executable paths.

## Verification log

### 2026-10-03 — worker — bounded integer masks and raw selection

Runtime, fixtures and acceptance harness frozen at
`1e8f2586a125efd91460db3a7e11049855acb495` (parent verified raw-bit head
`98314e2ddb082cf372a46ab90871b7cfdb77d587`). The new v2 stage profile is selected
only by validated UADD, ISGE, USEQ, USNE or UCMP. Private values remain highp
unsigned words. Addition wraps; signed comparison uses a sign-bit order transform;
comparison true masks are all ones; UCMP treats every nonzero condition as true.
The complete RHS is read before partial writes. Compact three-source storage
preserves112-byte instructions,26,232-byte IR and7,608-byte native profiles.

Known-bit output analysis admits exact constant arithmetic/comparisons, known
UCMP arms and conservative unknown-arm joins, with an ordinary float origin only
when the selected/merged value is proven to be the same input. It rejects unsafe
raw float outputs, uninitialized consumed lanes, unsupported float/control/PRECISE
features and excessive generated GLSL. The three migrated historical UADD inputs
remain in the new fixture with their exact now-supported or malformed outcomes;
only their old unsupported-op slots become adjacent UMUL negatives.

Recorded native sanitizer run:705 cases (279 retained +426 new),47 pairs (22
retained +25 new),84,167 calls,45,870 exact standalone recoveries,30,580 exact pair
recoveries,2,520 truncations,324 hostile calls and4,096 mutations across four
seeds. All retained full results and all19 originals remain identical. New shared
cases:377 (197 accept/180 reject), plus49 hardware programs. Native LLVM counters
and sanitizer stack observations are recorded; they are not a total or Wasm stack
measurement. Runtime maxima are54,603/107,416 serialized bytes and51,845 GLSL bytes.

Hardware proof reconstructs704 raw words using352 byte-carrier vertex feedback
captures and2,816 fragment bitplanes;8 vectors for each of11 operation/alias/stress
probes execute in both stages. Direct finite UCMP outputs add8 captures and8
pixel draws. Eighteen v5/v1/v2 smooth/flat full and partial-interface draws produce
17,856 independently checked nonedge pixels. Actual uniform uploads/readbacks,
source identities, system-block orientation, all object ownership and fixed16MiB
allocation failure/recovery are recorded. Three source-bound corruptions must
compile/link and fail actual GPU results: signed comparison, all-ones mask and
UCMP condition. Guest constant transport and production GPU negotiation remain
unchanged; no Mesa-guest activation or MIPS/FPS claim is made.

Final recorded commands (both passed at the frozen head):

```sh
EMCC=/tmp/wasm-vm-emsdk/wasm-vm-emcc VIRGL_INTEGER_MASKS_EVIDENCE_DIR=evidence/virgl-integer-masks/worker make verify-E6-T12e4b
python3 tools/virgl-integer-masks/cold.py --output evidence/virgl-integer-masks/cold-clone
```

The full gate includes the prior E4a gate (including original captured shaders,
components, pairs, banks, command state/draw, constants and asynchronous renderer
jobs), then all new hardware probes and three expected sabotage failures. No
historical receipt was weakened. Both recorded runs have zero browser console,
page and request errors. All362 new-proof GL objects are released. The final
screenshots were visually inspected through an identical development capture
and their byte-identical worker/cold PNGs; the final hash is recorded below.

Evidence paths under `evidence/virgl-integer-masks/` (SHA256):

- `worker/receipt.json`:
  `e4cf1d4710acb1c954be20182b6fd9e74db15aca318b01b50eafb59f612b2320`
- `worker/native/native-report.json`:
  `a61a45c7f3a4eadb09d535acca247edc515d3bdb644ab37ff8bf5919e48ca0b4`
- `worker/hardware/report.json`:
  `4dd3db917f3b9179aaca695f4427b60c4f39f9d475ff2828c728620f45cc37f4`
- `worker/sabotage-signed-compare/report.json`:
  `5330960d9546101a13cda24c825987db8bb799ee9220696e41f12527a07c6e48`
- `worker/sabotage-all-ones-mask/report.json`:
  `e5931938d638213d294a6d48e4351c8b19125a68d5809898830e06bedf09f170`
- `worker/sabotage-ucmp-selection/report.json`:
  `45c1b1ead5253a7954f3a23e451fae2e4a5997a074f2e1896c03e59000c12b85`
- `cold-clone/report.json`:
  `bddb7ed52873ed04be221f4e3bb828ed6f9ed95cf833d7db90d0e78a248f61c7`
- `cold-clone/acceptance/receipt.json`:
  `07cc0df293e60d9be178be948fbe05cec5b1d59e1978cf2ee1045c9d4797cb92`
- `cold-clone/acceptance/native/native-report.json`:
  `85a413dd282f97e8a2311f4185fadc7bb1ccf94a2f84b2e1913f2f4df8c594ca`
- `cold-clone/acceptance/hardware/report.json`:
  `3fea47ae1264797d5dc595948ed1758a7b8b2f108949d1eb22a765a7db158f3b`
- `cold-clone/cold.log`:
  `119740475be98f1c7c272edb56594d9c7353680ae9bf5984ce9074f7a4081b3d`
- Identical worker/cold `hardware/browser.png`:
  `d492f6549ceddb5220ff21bf02b9a14b81804bb5cf761835a3cce859334b2fa8`

The worker independently rechecked all118 receipt record digests. The pristine
clone began and ended clean at the same head; all127 copied acceptance files and
all118 cold receipt records were rechecked. Both builds emitted identical Wasm
`d007009e9fd7a2685dfe87f83fd69da1ed3fd35d178a856e73485e4a19d328cc`.
Worker sanitizer binary:
`a21971951d96eb9a3ce43f3bc4267c9a5cb1326a992890372831cff6223b488d`.
Retained clone:
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-integer-masks-cold-7s5htub_/wasm-vm`.

This is an isolated compiler proof; neither the default demo bundle nor guest
capsets changed. It does not assert live Mesa or guest instruction throughput.
Independent verifier evidence and status remain the critic's responsibility.
