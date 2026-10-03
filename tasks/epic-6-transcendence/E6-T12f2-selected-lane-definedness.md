---
id: E6-T12f2
epic: 6
title: Prove selected-away interpolation lanes without inventing values
priority: 525.0269912
status: implemented
depends_on: [E6-T12f1]
estimate: S
risk: high
capstone: false
---

## Boundary

Implement one bounded observational-definedness family for the captured outer
ELSE/interpolation/final-UCMP forms in 5a243fc7 and a6143f11. On the relevant
predecessor the interpolation operand is unwritten, but the final selector
provably discards its entire result. Preserve predicate/lane versions and
control predecessor identity. Guard or sink the arithmetic so emitted ESSL does
not read the unwritten value on that path. Do not union initialization masks,
zero-initialize missing data, or assume zero times an undefined value is zero.

This does not resolve the separate radial TEMP2.x alternate-root gap. A missing
selected arm or a changed selector must still reject. Preserve runtime/IR/flow
caps and original body identities; PRECISE remains independently gated.

## Deterministic acceptance

`make verify-E6-T12f2` proves independently authored instances of both captured
selection forms with exact words/pixels and checked predecessor traces. Exercise
both defined and discarded predecessors, all destination lanes, aliases and
nested control. Record native/Wasm parity, complete retained outcomes, actual
hardware through the shared renderer and final pristine-clone evidence.

## Adversarial verification

Reverse the final selection, overwrite an aliased selector, change zero to
nonzero, remove one selected lane and insert a NaN intermediate. Sabotage the
demand/certificate check and require an independent poison witness to fail.
Changed arithmetic must execute or have an explicit unreachable-path proof;
no shader-hash allowlist or manufactured initialization is permitted.

## Verification log

### 2026-10-03 — worker — activation

Dependency E6-T12f1 is verified at
`2a0d0359de37452d5a78bb9ab6fbf8583c69cb7c`. Implement the one captured
join/weight/interpolation/selection family with an owned bounded certificate,
guarded interpolation publication and lazy final selection. Initialization
masks stay intersected; unrelated missing reads, the radial gap and PRECISE
remain rejected. Preserve all full F1 recorded stage/pair/original outcomes.
Submit sanitizer/counter, fixed-memory Wasm, independent hardware word/pixel,
actual certificate/emitter fault and pristine-clone evidence for a fresh critic.

The compiler remains isolated from the demo's guest negotiation, so this slice
does not deploy or claim guest execution, all19 closure or desktop 300 MIPS.


### 2026-10-03 — worker — implemented, fresh verifier required

Runtime commit `e332abb975d6a4b7793717b680e65fd630fd87eb`; final proof source
head `5a34d6e5aeba3e52365484700aa921a24cb2d3f6`. The intervening commit adds
only a missing JSON import to the retained hardware receipt validator. Native
and Wasm source/counter/parity checks were carried forward by their complete
unchanged source digests; affected browser/fault recordings were refreshed at
that exact final head. The final pristine clone ran the whole acceptance there.

Commands: `EMCC=/tmp/wasm-vm-emsdk/wasm-vm-emcc
VIRGL_SELECTED_LANES_EVIDENCE_DIR=target/evidence/selected-lanes-worker make
verify-E6-T12f2`; after the receipt-only import repair, rerun
`tools/virgl-selected-lanes/browser.mjs`, the unchanged F1 hardware wrapper,
`faults.py`, both actual-fault browser modes, `receipt.py`,
`receipt_attacks.py`, and final `receipt.py`. Full command transcripts are in
the worker archive's `acceptance.log`. Final confirming command:
`python3 tools/virgl-selected-lanes/cold.py --output
target/evidence/selected-lanes-cold-final` (scrubbed `make verify-E6-T12f2`,
exit0, clean before/after, unchanged exact head).

Evidence: `evidence/virgl-selected-lanes/manifest.json`, SHA-256
`142e1ea6caa60ae7f9e6f322c656dc57ce2c9074b14636ed658fa85d19ff7b85`.
Lossless `worker.tar.gz` SHA
`c6d03d170a783b339c407759d0b7552231f632987605e5a703b670ce422ef30b` and
`cold.tar.gz` SHA
`2e68bfcdc53dff0fe12ac9768e25b66bd6949279e5fbe57559e9457ed09dc3ec`
preserve every original logical record, including the full186MB GPU JSON;
README gives extraction commands. Worker receipt SHA
`07bdb94f284666735cb6c466da00e4ae54deb87fd514d40a33a321e7c3238edd`;
cold receipt SHA
`2b58dceebd023bb123835feb2b3c8b13d0ce898c6be7350e95324a4057309db2`.
Original sanitizer binaries are included with their actual report digests and
LLVM coverage mappings. Screenshot: `evidence/virgl-selected-lanes/browser.png`.

Claim: a compact owned certificate proves one graph's initialized true
predecessor and signed-zero discarded predecessor; initialization intersections
and logical destination kills remain strict. Guarded interpolation and exact
lazy final selection preserve both-stage words across all destination masks,
safe aliases, swizzles, nested paths, finite payload/width contracts and a
selected-away NaN intermediate. Unsafe selected lanes, modified predicates,
nonzero/NaN zero arms, fallback clobbers, unconditional result reads and second
graphs reject. Native ASan/UBSan records4300 stages/378 pairs,802797 calls,
62 allocation failures,4096 mutations,324 hostile cases and3954 truncations;
all4152 retained stages,298 pairs and19 originals are full-result exact. Wasm
records19246 calls, fixed16MiB memory,32/30-profile recovery,30 real pressure
attempts and recovered allocation capacity. Shared actual Metal/WebGL2 renders
1216 exact words/1245184 pixels and196608 demand-observer pixels in88 fully
released rigs; retained F1 records640 words and8 unchanged migrated bodies.
Real emitter and width-certificate faults fail independent demand/poison
witnesses in both stages. All21 promoted recorded-data forgeries reject. Each
submission binds202 sources and48 records. Both worker and final cold receipts
pass. IR26464/profile7616/flow52644 remain below32768/8192/53248 caps.

The original capture outcome remains12/19. PRECISE and the separate radial
TEMP2.x gap remain gated; no guest execution, production negotiation, deployment
or300MIPS is claimed. This is a worker submission, not a verified verdict.
