# E6-T12f4b owned-bank raster authority evidence

The compiler, consumer and recording harness are frozen at
`4999a81ad93496fc25e78cbb0aeb7adec66006e3`. `manifest.json` binds the complete
worker and cold-clone recordings, receipts, replayable native/Wasm artifacts
and hardware screenshot.

Extract the recordings into separate directories:

```sh
mkdir -p /tmp/raster-bank-worker-evidence /tmp/raster-bank-cold-evidence
tar -xzf evidence/virgl-raster-bank/worker.tar.gz -C /tmp/raster-bank-worker-evidence
tar -xzf evidence/virgl-raster-bank/cold.tar.gz -C /tmp/raster-bank-cold-evidence
```

Every original recorded file is included, including the actual source-fault
builds. Each archive member was streamed back and checked against its original
size and SHA-256, and originals were checked again after packaging. The cold
archive includes the pristine-clone report and complete log, with the full
acceptance recording under `acceptance/`. LLVM source filenames identify the
original build root; replay its source-bound receipt reader in the exact clone
identified by `cold-report.json`. For receipt replay, restore the recording at
its original relative `target/evidence/` path so source-fault URLs retain the
recorded paths. The archives can also be inspected independently by digest.


Both complete acceptance runs record 1,501,326 native calls over 4,816 single
cases, 851 pairs and all 19 original bodies. They include 756,480 single and
731,264 paired recoveries, 3,128 truncations, 324 hostile cases, 4,096 seeded
mutations and 244 real allocation failures, including 15 new raster allocations
and 20 upstream sites. Wasm records 45,696 calls with full native parity,
64 maximum-input stress calls and 51 actual heap-pressure calls. Its 16 MiB
memory retains the same backing buffer.

Each of three hardware schedules executes 40 rigs and 192 draws, observing
400 exact copied words and all 786,432 pixels, plus 96 rejected operations.
The consumer records 2,560 independent exponent-class checks, 158 closed
contracts, 3,222 bank cases and 644 hostile inputs. Complete uniform and geometry
readbacks, object budgets, state snapshots, V8 counters, physical pixels and
screenshots are preserved. Fragment RGBA8 observations prove colors; exact
32-bit word observations use flat vertex carriers and bit planes.

The unchanged production IR is 26,480 bytes, the profile 7,616 bytes and the
flow arena 52,644 bytes. The new measured 16,516-byte analysis allocation stays
below 32 KiB. Maximum stage GLSL remains 58,201 bytes, below 65,536. The complete
migration ledger records 24 single programs, three pairs and four original
gradients; all unrelated baseline results are unchanged. Retained mask,
PRECISE, equality, selected-lane and radial hardware leaves and their promoted
regressions also pass.

The runtime grants ordinary output authority only for the normal-or-signed-zero
components demanded by a bounded copy certificate. A checked control graph
walks backwards from final output components, including ordered partial writes,
source aliases, both conditional/selection payloads and certified loop reads.
It preserves existing numeric authority and rejects integer/bitwise manufacture,
uninitialized predecessors and copied loop-count data. Finalized certificates
reuse dead TEMP facts without enlarging the IR or flow stack.

The outer v27 metadata retains an explicit existing base profile and all its
finite, indirect, count, radial and instruction-local precision obligations.
The consumer owns and freezes the complete approved bank prefix. Linking,
upload and draw use that approval, while restoration skips invalid banks and
asynchronous interference cannot replace the held generation.

The independent domain oracle uses binary32 decoding, rather than the runtime
bit predicate. The recordings check all exponent classes, both zero signs,
normal/subnormal neighbors, nonfinite words, every demanded component, hostile
descriptors and erased simultaneous contracts. Three isolated changes to actual
compiler/consumer source drop one component, remove the guard or decode another
bank word. The first two reach an independent safety oracle before any unsafe
GPU call; the last produces an independently predicted physical pixel mismatch
using allowed normal words.

Four unchanged captured gradient bodies now compile, link and render under
their explicit contracts. Test banks force the original copied-alpha paths with
visible output; no original shader text or alpha calculation is rewritten.
All nineteen original hashes remain unchanged and eighteen bodies are admitted.
The remaining body needs the separate exact PRECISE ADD/MUL task.

This compiler/shared-renderer boundary does not enable production guest GPU
negotiation or establish desktop 300 MIPS. Real radial workload banks, full
shader closure, formats/state and guest bring-up remain dependent work.
