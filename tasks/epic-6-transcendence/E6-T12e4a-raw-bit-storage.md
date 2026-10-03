---
id: E6-T12e4a
epic: 6
title: Preserve private raw shader lanes and masked bitwise operations
priority: 525.02699041
status: verified
depends_on: [E6-T12e3b]
estimate: S
risk: high
capstone: false
---

## Boundary

Add a bounded validated IR and an owned ESSL300 emitter for programs using AND,
OR, NOT, SHL or USHR. Keep private TEMP and immediate lanes as highp uvec4; MOV
preserves raw bits, and every shift masks its count with31 as TGSI requires.
Admit all checked decimal UINT32 words in these programs without applying the
legacy float-immediate predicate. Keep lane initialization, consumed swizzles,
partial writes and overlapping source/destination semantics exact.

Select this backend internally only when validated new bitwise operations occur.
Legacy-only programs retain their existing acceptance, full GLSL/metadata/error
results and v5 profile. New stages identify the owned path as
`virgl-webgl2-raw-bits-v1`; no caller backend/key overrides. The vendored compiler
stays untouched. Emit from validated operands and owned templates, never rewrite
arbitrary generated GLSL with text substitutions. Reject integer-bearing programs
that also use ADD/MUL/MAD/TEX until the later mixed-use boundary. UADD, comparisons,
UCMP, PRECISE, modifiers, control flow, ADDR and indirect access remain rejected.

The guarantee covers private raw lanes and integer use sites. Existing attributes,
GENERIC varyings and POSITION/COLOR remain the float ABI and do not become raw
integer channels. Track conservative known bits and float-origin lane identity:
raw outputs must be statically proven finite normal values or zero, otherwise
reject before emission. Existing float input values may pass through MOV under
the ordinary float-IO contract; this makes no NaN-payload or arbitrary raw-buffer
promise. Unknown raw CONST words are not automatically safe float outputs.
No new integer constant-command transport is admitted.

Keep all current capacities:179 non-END instructions, TEMP0..117, CONST0..45,
other banks0..7, eight immediates,16KiB text,8192 tokens,256 lines,512-byte lines,
64KiB GLSL, existing JSON bounds,16MiB fixed Wasm and256KiB stack. Explicitly account
for IR/storage and pair stack use. Both single and pair conversion must clean up
bounded allocation failures. Derive the same semantic/mask/interpolation key for
mixed legacy/owned pairs; preserve exact standalone FS output and only authorize
VS qualifier changes from the derived interface. Preserve the system-block and
uniform declaration/reflection contracts used by the command renderer.

## Deterministic acceptance

`make verify-E6-T12e4a` records native sanitizer and fixed-memory Wasm parity for
shared authored positive/negative shaders, all19 unchanged captured bodies, and
mixed-backend smooth/flat pair cases. Every newly admitted operation must execute
on actual WebGL2 in both stages with an independent raw-u32 reference oracle.
Use finite normal byte carriers and transform feedback for VS, and exact0/255
bit-plane pixel output for FS; reconstruct all32 bits. Include dynamic uniforms
so constant-folded literal results are not the only execution proof. Distinguish
such direct host-uniform probes from the unchanged finite guest wire boundary.
Record exact source/GLSL/metadata, raw output words/bytes, actual compile/link,
input ownership/recovery, unchanged bounds and maximal179-instruction execution.
Keep the12 accepted originals and7 PRECISE rejections; never strip PRECISE.
Record the final exact-head gate and one pristine clone proof. Production stays off.

## Adversarial verification

Attack0,1,0x7fffffff,0x80000000,0xffffffff, alternating bits, NaN/Inf encodings,
subnormal bits, signed zeros, high banks and initialized-lane neighbors. Test
shift counts0/1/31/32/33/63/0x80000000/0xffffffff, including dynamic per-lane counts.
Attack same-register swizzles and partial writes; unsafe raw-to-float output and
safe byte carriers; full UINT32 lexical overflow, signs, exponents and suffixes;
legacy-only rejection stability; mixed-backend pair interfaces and rollback.
Use independently authored native mutation seeds/recoveries and a bounded novel
hardware attack. Sabotage lost high bits, float-backed raw storage or shift-count
masking and require a failure in independently computed actual output. Account
for every changed executable hunk or demand missing evidence.

## Semantic sources

Pinned virglrenderer1.3.0 source `vrend_shader.c` declares float TEMP storage at
6642–6645, bitcasts integer results into floats at4308–4334 and emits unmasked
shifts at5768–5773. GLSL ES3.00 sections4.1.3,5.4.1,5.9 and8.3 govern integer
storage, conversions, shifts and the unspecified NaN/Inf float-bitcast domain:
<https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf>.
Exact captured Mesa26.2.2 TGSI docs explicitly mask shift counts with31:
<https://gitlab.freedesktop.org/mesa/mesa/-/raw/mesa-26.2.2/docs/gallium/tgsi.rst>
(lines1332–1375, SHA256
`6ec695d90ea0b3a5d471aab114352cc2431bcfc589f6b6e6ca88e4e1ca0caabe`).

## Verification log

### 2026-10-03 — worker — activation

Dependency E6-T12e3b is independently verified at
`f643c50d3379e4e27a1daf1784f67287fe36d562` and published as PR418. This slice
establishes raw private storage with observable bitwise operations; subsequent
arithmetic/masks and mixed float use stay in separate pending slices. The owned
emitter is required because merely admitting new opcodes into float-backed TEMP
storage cannot establish the requested all-bit guarantee. Legacy results remain
unchanged; no guest device or production behavior is activated.


### 2026-10-03 — worker — implemented submission

Runtime/fixtures frozen at `347dc59d60fa7e77cec58b14a36bcc8adb88db8d`;
final recording harness at `2484d01736e15b6aee05cef12a3215f283705762`.
The only intervening changes enable precise browser coverage in the new wrapper
and allow the successor receipt to carry unchanged regression recordings across
those two harness files. Every recorded runtime/source/artifact digest is still
checked. The initial aggregate reached all passing runtime gates but stopped on
missing `browserCoverage`; its complete log is retained. No runtime repair was
made during recorded submission. The two affected browser recordings and the
aggregate receipt were repeated, then the full gate passed once in a pristine
clone at the final harness head.

Commands:

```sh
EMCC=/tmp/wasm-vm-emsdk/wasm-vm-emcc VIRGL_RAW_BITS_EVIDENCE_DIR=evidence/virgl-raw-bits/worker make verify-E6-T12e4a
node tools/verify-virgl-raw-bits.mjs --output evidence/virgl-raw-bits/worker/hardware
node tools/verify-virgl-raw-bits.mjs --output evidence/virgl-raw-bits/worker/sabotage --sabotage shift-mask
python3 tools/virgl-raw-bits/receipt.py evidence/virgl-raw-bits/worker
python3 tools/virgl-raw-bits/cold.py --output evidence/virgl-raw-bits/cold-clone
```

The sabotage command must exit nonzero on actual readback. The clean-clone helper
runs `make verify-E6-T12e4a` with the documented build environment scrubbed; both
checkout status checks are empty. Its retained checkout is
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-raw-bits-cold-nqo7_wad/wasm-vm`.

Evidence and SHA256:

- `evidence/virgl-raw-bits/worker/receipt.json`:
  `b9f7b38a5c4f3d372ba260a1ba762e31096f36540d2181bb6ccb5b50533f0414`.
- `worker/native/native-report.json`:
  `cb39748e8786140e0fd5b0439c1407a302d9df353e5e0ecb9dec48dbd8ca2b7d`.
- `worker/hardware/report.json`:
  `088fe0f80137bfe5ff47ce3b419265b6a14e958b201bd050146ea872f5ef2527`.
- `worker/sabotage/report.json`:
  `27d4b5f6db245812d911f1c28b8962e6bb92cea77bf77aa0adbb09c47385720a`.
- `cold-clone/report.json`:
  `3b904909a23f599385cc5596163eea65878942af757c31a5b669068eaf54f0c4`.
- `cold-clone/acceptance/receipt.json`:
  `96fae8d6ea6011d7490eb59cae60c1f68c724e832aac9dfcf1c7481dd9c8f915`.

Paths after the first bullet are relative to `evidence/virgl-raw-bits/`.
All95 final worker record digests and102 copied cold artifacts were rechecked.
Both actual hardware screenshots (`worker/hardware/browser.png` and
`cold-clone/acceptance/hardware/browser.png`) have SHA256
`2587c795257a0a4ccf48f9aeaa63f6324fa1e69a5bd90dfaddf55abbf2bbe942`;
the worker inspected the image. Both builds produced Wasm SHA256
`64b4dd240932ab30031b81485d78e321cc1e6b4ec9d7cbf967e3ceebe87ca1a2`.

The native ASan/UBSan recording covers279 shared cases (172 accepted),22 pairs
(18 accepted),42,283 calls,4,096 seeded mutations,1,335 truncations,324 hostile
calls and24,136 standalone/12,068 mixed-pair recoveries. All19 original full
serialized results remain identical to verified E3b (12 accepted/seven PRECISE
rejections). LLVM counters and native per-function stack observations are retained;
the latter are explicitly not a total Wasm stack measurement. IR is26,232 bytes
on the heap, with fixed allocation/static-stack bounds documented in the header
and README. Each raw stage has two owned allocations and no vendor conversion.

Actual ANGLE/Metal WebGL2 executes MOV/AND/OR/NOT/SHL/USHR, aliases, all-bit
immediates and179-instruction programs in both stages using six dynamic vectors.
The receipt independently reconstructs480 u32 results from240 vertex captures
and1,920 fragment bitplanes, and checks14,880 non-edge interpolation pixels
across15 full/partial/mixed/inactive pairs. Actual UBO reflection is656/640;
nonzero-y feedback proves both coordinate signs. Both47-element declarations
upload only46 legal entries, leaving poisoned host-only padding unchanged after
every draw; unused arrays reflect absent. All303 GL objects are released.
Exhausted16MiB Wasm tests exercise IR and GLSL failures in both stages and raw/raw
pairs, restore allocator capacity at4KiB granularity, and recover both mixed
pairs. This is an owned-allocation claim, not new vendor OOM semantics. Exactly
four sabotaged dynamic count masks still compile/link but fail SHL lane-z byte0
(expected carrier `0x3f7f0000`, observed `0x3f7f8000`).

The full bank/component/pair/original shader and renderer regressions pass, as do
23 finite constant packet cases,45,056 constant-renderer pixels and the async
210-packet/three-draw replay with93 rejection attacks. Production negotiation,
finite guest constant transport and default demo artifacts remain unchanged;
this isolated compiler submission makes no guest acceleration or MIPS/FPS claim.
Independent verification is still required before `verified`.


### 2026-10-03 — independent verifier — VERDICT: verified

- **P01–P20 HELD.** Fresh critic predictions preceded implementation inspection;
  their SHA256 is `86bf220049e1ef3e434c1adc7e2bb78e4e09e83795df3c9a6b3973c3c7e17469`.
  Runtime `347dc59d60fa7e77cec58b14a36bcc8adb88db8d`, final harness
  `2484d01736e15b6aee05cef12a3215f283705762`, and worker submission
  `71dc9b428fbbc325f885f257c95e2fff8b9e8079` match the bounded claim.
  No product refutation or outstanding evidence gap was found.
- **Independent native/Wasm attacks HELD.** `verifier/native-report.json`
  (`ea99a7971c2122d604a37c0f94611a1505397f18eee02db976ed13974b59a4f7`)
  records 1,408 separately authored/mutated cases, 4,224 ASan/UBSan calls,
  2,816 exact recoveries and 28 full-object comparisons against a separately
  compiled verified parent. All 1,408 native/Wasm core results match; the
  unchanged public JS guard is asserted separately for 115 control-character
  cases. Examples: `verifier/audit-native.jsonl:190` rejects an uninitialized
  consumed lane; line 283 rejects decimal overflow; lines 469/472 distinguish
  an unsafe raw overwrite from a restored float origin; lines 1027/1030 prove
  the 179/180 instruction boundary. No runtime repair was needed.
- **Raw semantics and output proof HELD.** `verifier/knowledge-report.json`
  (`c2299973f503f6bc9c8806366efe79fc3390d9b1bbca659e6f17652553d2c9c0`)
  records 444,976 concrete known-bit/origin assertions, four new seeds,
  12,288 IR instructions and 16 schedules per trial. An independent TGSI
  interpreter checked all 480 worker words, 240 TF captures and 1,920 bit planes
  with 14,850 assertions in `verifier/worker-semantics.json`
  (`896fb15da6e6f1f72b8df63da49d5f15d354ec3c9a5a7ba3fcb0218e69c74810`).
- **Novel hardware attack and sabotage HELD.**
  `verifier/hardware/report.json`
  (`33d92f3384de850586a52f46c9d97b83d7e6447224a7f8b5e6767fe159ca4e21`)
  combines overlapping SHL, dynamic counts, retained raw neighbors and all five
  new operations, reconstructing 96 full words in both stages from 12 vectors.
  Actual UBO reflection is 656/640, TF guards survive, all 40 GL objects are
  released and browser errors are zero. In
  `verifier/sabotage/report.json`
  (`6c0ed51ff09fafc52cbc5e0dd70bb041984aa2812fa606db2de578e1334e9969`),
  changing the aliased SHL source `.y` to `.x` still compiles/links but changes
  vertex probe 0/vector 0/raw word 4 from expected `0x3f7f8000` to
  `0x3f008000`. The worker's separate count-mask sabotage also fails actual
  readback as claimed.
- **Coverage HELD with narrow waivers.** Every one of the 213 changed executable
  C lines is classified: 212 executed; `raw_bits.c:107` is the guard-excluded
  operand enum default. Actual fixed-memory browser pressure covers both owned
  allocation failure classes and pair cleanup. Fixed-format writer overflow/
  libc-error branches are defensive waivers: each instruction is at most
  318 bytes, all 179 plus declarations/templates/output fit below 64 KiB.
  Types/static assertions/docs are non-executable. Full per-line classifications,
  stack reasoning and exact citations are in `verifier/VERIFICATION.md` and
  `worker-semantics.json`; native stack observations are not claimed as Wasm
  totals. Existing unchanged upstream defensive paths carry prior evidence.
- **Exact-head, legacy and pristine-clone binding HELD.** A second independent
  helper performed 636,635 scalar/structure/digest assertions (not independent
  test-case count): complete input stream/results, pinned originals/vendor,
  native/Wasm parity, actual uniforms/readback, the exact two-file harness-only
  repair, all 102 copied cold artifacts, clean retained clone and scrubbed
  environment. `verifier/binding-audit.json` SHA256
  `7c616a2bbda8bf126e2e29316bae21060feab62978a252a742cb7e11015f2c51`.
  Both builds and independent browser use the same Wasm
  `64b4dd240932ab30031b81485d78e321cc1e6b4ec9d7cbf967e3ceebe87ca1a2`.
- **SUITE.** Preserve the independent native cases/driver, known-bit test, novel
  hardware fixture/runner and TGSI interpreter as reproducible verifier artifacts.
  `make verify-E6-T12e4a` remains the recurring acceptance target. Full commands,
  seeds, inputs, outputs, screenshots and record digests are retained under
  `evidence/virgl-raw-bits/verifier/`; final `audit.json` SHA256
  `c3ecc6f96f7c07873e1d3a6c14150640a370e2a90be76fe38a2dfe7d32099a0f`.
  The private-compiler boundary is verified; production, finite guest constant
  transport and default demo artifacts remain unchanged. No guest GPU or
  MIPS/FPS gain is claimed.
