---
id: E6-T12e3
epic: 6
title: Bound declaration banks and static budgets for the remaining corpus
priority: 525.0269903
status: implemented
depends_on: [E6-T12e2]
estimate: S
risk: high
capstone: false
---

## Boundary

Expand only the guarded declaration/storage and static-size boundary needed by
the remaining original inventory: CONST indices through 45, TEMP indices through
117, and a budget of 179 non-END instructions (the original maximum is 178
non-END / 179 including END, leaving one instruction of headroom). Preserve
independent small IN/OUT/IMM/SAMP/SVIEW/GENERIC banks through index7. Keep finite text,
token, line, response and allocation limits; justify each changed bound against
the original inventory. ADDR, indirect operands, new instructions and PRECISE
remain rejected. Do not infer an execution bound from static instruction count.

This is the v5 shader frontend/storage boundary only. Command constant uploads,
active uniform reflection and renderer restoration remain separately gated by
E6-T12e3b. Preserve the 16KiB text/stage, 8192-token, 256-line, 512-byte line,
64KiB GLSL/stage, fixed response, 16MiB Wasm memory and 256KiB stack limits.
Use canonical bounded decimal register indices without widening the independent
small banks. Preserve truthful upstream declared uniform extents, including the
CONST0-after-CONST45 declaration-order case; no text rewriting or false metadata.

## Deterministic acceptance

`make verify-E6-T12e3` records original inventory maxima and exercises each newly
addressable bank edge with independently authored straight-line shaders, through
native sanitizers, Wasm parity and real ESSL300 compile/link/pixels. Test the
declared final static budget and its first rejected neighbor. Preserve the
12/19 original result; the seven PRECISE-bearing bodies remain rejected.
Record exact-head and pristine-clone evidence.

## Adversarial verification

Attack overflow, aliases between file-specific banks, overlapping ranges,
uninitialized high registers, one-past boundaries, maximum output serialization
and recovery after rejection. A small numeric grammar must not silently widen
every register class.

## Verification log

### 2026-10-03 — worker — activation

E6-T12e2 is independently verified at
`43113616971d026744c377b6bbe8fb58aa7f7d20`. Original inventory inspection found
TEMP declaration117/direct113, CONST declaration45/direct25, 8800 text bytes,
191 nonempty lines, 80 bytes in one line, and 178 non-END instructions. The
acceptance records a fresh inventory and tests actual use of TEMP117/CONST45,
canonical decimal and file-specific rejection edges, 179/180 instruction
neighbors, both-stage fixed-memory pair recovery, and independent hardware
outputs. Exactly12 of19 original bodies remain accepted. Production stays off.

### 2026-10-03 — worker — implemented, awaiting independent verdict

Frozen runtime and acceptance harness:
`f88d7bb0c52cb4ac1189f7a05fb1dfdf77b03b91`, based on activation
`9ed66780d4e476634cbe4b5296b302ab0579feec` and verified E2
`43113616971d026744c377b6bbe8fb58aa7f7d20`.

Commands, both passing on their first final recorded attempt:

```sh
EMCC=/tmp/wasm-vm-emsdk/wasm-vm-emcc \
  VIRGL_BANK_EVIDENCE_DIR=evidence/virgl-banks/worker make verify-E6-T12e3
python3 tools/virgl-banks/cold.py --output evidence/virgl-banks/cold-clone
```

The v5 guard admits canonical TEMP0..117 and CONST0..45 while keeping the six
small banks at0..7, the instruction limit at179 non-END, and every other finite
capacity unchanged. All404 shared cases (209 positive), four exact stage pairs,
and all19 original results have complete native/Wasm parity. The original
outcome remains exactly12 translated and seven unsupported-feature rejections.
The widened declaration guard lets several originals reach valid but excluded
UINT32 domains or ADDR first; those now report unsupported-feature, while
malformed numeric tokens/overflow remain parse-error. No integer, indirect,
control-flow or PRECISE semantics were admitted.

The native recording contains39,647 ASan/UBSan translations:840 truncations,
320 hostile cases,4096 mutations under four seeds,22,640 standalone recoveries
and11,320 pair recoveries. Every new TEMP index is actually written/read and
every new CONST index read. Recorded maxima are11,791 GLSL bytes,14,229 raw
single-response bytes and27,791 pair-response bytes; these are observed fixture
maxima, not a proof of a mathematical worst case. The original inventory is
recomputed independently of the compiler from all unchanged SHA identities.

Actual headed Chrome/ANGLE Metal hardware passes1280 independent RGBA pixels
and96 exact binary32 transform-feedback values. Both stages use high banks;
low/high/low phases preserve a low TEMP17 sentinel after TEMP117 writes. The
179-instruction pair keeps vertex constants live through POSITION and executes
with both16KiB input texts,32 repeated maximum-pair calls and6115 observations
of the same fixed16MiB Wasm buffer. The driver retains declared array extents:
the reordered fragment declares/reflects47, uploads only46 guest entries and
still returns the expected pixels after host element46 is poisoned with
`[16,-8,4,-2]`. No guest CONST46 access is accepted. Actual generated-source
CONST45-to-CONST5 sabotage compiles/links, passes all vertex checks and the
first low draw, then fails pixel(8,8): expected `[64,191,128,191]`, observed
`[223,96,191,191]`. Both browser runs have zero console/page/request errors.

Evidence (SHA-256):

- `evidence/virgl-banks/worker/receipt.json`:
  `ad6ab447fa0ad3db82ceea27806b5f7e0aea989a15965b47f44e4146e1e76cae`.
- `worker/inventory.json`:
  `f43e6db7b4b0fc8ebc9ea95c5d63df69bcb629e7b98dcc1e47237358eab7cb7d`.
- `worker/native/native-report.json`:
  `c57fe63bba9a9bc1139b5f2d0e3ec5118b991e64a5b4b926fc52dac95c08a7c2`.
- `worker/hardware/report.json`:
  `4abebca2554c419a77be5df6ec3cc51273ec49248d90955e20b32fcb73a4dd9c`.
- `worker/hardware/browser.png`:
  `df8880488f965e3b48c47a671778f7ce8a4a60326d883ab7a4ed3238911f616d`.
- `worker/sabotage/report.json`:
  `3d3cc1e25b3fad81e5fdd30f713d4a0c9fe43c5959c68412357309568bc82063`.
- `worker/regression/receipt.json`:
  `88796ec0c09814006b23f425678388de63dcf7f8a43daac823256aff149a4549`.
- `evidence/virgl-banks/cold-clone/report.json`:
  `1031b269c9c8e30ce30474bb0e798c1d6b8242b5bc0efd03625803032c85470f`.
- `cold-clone/acceptance/receipt.json`:
  `5b48ed45c0998bcb9df308fc198808f65ac5d51e02095058b2776d5fb54e624e`.
- `cold-clone/cold.log`:
  `063e90b87c3aaf67d49a75d845d442b2b6731a832a9e417f16878f659e88a08a`.

All69 worker record digests and76 copied cold acceptance file digests were
rechecked after completion; both final hardware screenshots were inspected.
The retained clean clone is
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-banks-cold-s313ltpc/wasm-vm`.
It ran the identical command at the frozen head with scrubbed environment and
clean status before/after. The served Wasm is262,796 bytes, SHA-256
`c6cbaf76360d483783b63b4c0dddf82f01c0a02091b293c613232593f08f0f54`.
The gate also preserves every previous literal/captured/component/flat shader,
renderer-state and original draw acceptance and sabotage oracle. Command
constant transport and renderer reflection were not widened; E3b owns that
boundary. No default web/device change, production GPU enablement, new original
workload execution, deployment or performance claim is made by this slice.
