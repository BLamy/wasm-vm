# E6-T12f4a ordered destination-mask evidence

The frozen compiler and recording harness are
`2815f3d23806aa5b7aaa6a12cef03d5ce54ade90`. `manifest.json` binds the complete
worker and cold-clone recordings, their receipts, replayable native/Wasm
artifacts and GPU screenshot.

Extract the recordings into separate directories:

```sh
mkdir -p /tmp/ordered-mask-worker-evidence /tmp/ordered-mask-cold-evidence
tar -xzf evidence/virgl-ordered-masks/worker.tar.gz -C /tmp/ordered-mask-worker-evidence
tar -xzf evidence/virgl-ordered-masks/cold.tar.gz -C /tmp/ordered-mask-cold-evidence
```

Every original recorded file is included. Each archive member was streamed
back and checked against its original size and SHA-256; the originals were
checked again after packaging. The cold archive includes the pristine-clone
report and full canonical log, with the complete recording under `acceptance/`.
LLVM source filenames identify the original build root; replay its source-bound
receipt reader in the exact clone identified by `cold-report.json`.

Both canonical runs record 1,429,106 ASan/UBSan native calls over 4,643 single
cases, 693 pairs and all 19 original captured shader bodies. They include
720,360 single and 695,520 paired recoveries, 3,128 truncations, 324 hostile
cases, 4,096 seeded mutations and 229 real allocation failures, including 20
upstream malloc/realloc sites. Wasm records 51,287 calls with complete native
result agreement, 64 maximum-size stress calls and 31 actual heap-pressure
calls. Its memory remains 16 MiB with the same backing buffer.

The shared renderer records 182 rigs and 542 hardware draws. An independent
literal TGSI oracle predicts all 2,168 words and 2,220,032 pixels. Recordings
include actual shader source/compile/link events, geometry and uniform
readbacks, complete RGBA bytes, coverage, hardware identity, zero browser
errors and fully released object budgets. Arbitrary private shader words enter
through finite 16-bit carriers and are observed through ordinary zero/one bit
projections. This does not claim arbitrary exceptional raster transport.

Every one of the 15 nonempty ordered destination subsets runs in both stages
with raw copies, aliased/swizzled sources, ordinary word operations, numeric
operations and untouched output neighbors. Duplicate/reversed/empty/too-long
masks, undeclared writes, declaration/source grammar and MAD restrictions
remain fail closed. The 179-instruction boundary is accepted and 180 rejected.
Four isolated changes to actual compiler C source widen yz, pack source lanes,
overwrite neighbors or publish an aliased destination early. Each separately
built Wasm artifact fails an independent physical pixel prediction.

The complete F4 corpus is retained with unchanged inputs. Its migration ledger
contains 24 newly admitted historical mask candidates and 30 candidates that
now reach the existing uninitialized-source parse rejection. Four MAD/TEX
negatives remain unchanged. The original glmark2 lighting body
`12f6d594f42e244d2d35c6a0b51cee809d219cc0729d9cee697b40725139f373`
and kmscube body
`d4f702f7a846a93b6f767bc73ed99a9c0f4fbe5fcb55662bca99e3f07f47d450`
compile, link and render unchanged with their existing finite-bank and
instruction-local precision contracts. Original acceptance is now 14/19.
All unrelated complete F4 results remain unchanged.

Production instruction/IR/profile/flow bounds remain unchanged: 26,480-byte IR,
7,616-byte profile and 112-byte instruction; 52,644-byte flow stack remains
below 53,248 bytes. Maximum stage GLSL is 58,201 bytes, below 65,536. The private
test pair inventory capacity increased to accommodate the recorded corpus;
no production cap changed. Retained PRECISE, equality, selected-lane and radial
hardware leaves and promoted allocation/consumer regressions pass again.

The production diff only extends the existing destination grammar to ordered
unique nonempty subsets. Source snapshots, component authority and arithmetic
remain governed by the existing checked compiler. This compiler/shared-renderer
slice does not enable production guest GPU negotiation or establish desktop
300 MIPS. Owned-bank output authority and precise ADD/MUL remain separate work.
