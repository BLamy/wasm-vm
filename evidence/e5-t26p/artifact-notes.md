# E5-T26p compiled-artifact submission (not a semantic or speed verdict)

Baseline source is `d7d308a58825e6856db532822e36e1681230027a`; candidate is the
three-file runtime overlay pinned in `production-candidate-r1/result.json` and the
matched probe result. Runtime source hashes were unchanged across both builds.
The identical external probe exercises the actual public methods, including both
Machine cache settings, and uses a HashSink recording positive control. Its smoke
run is only a link/reachability check, not the full semantic acceptance matrix.

`artifact-baseline-d7d308a5-r2/result.json` and
`artifact-candidate-d7d308a5-r1/result.json` record the same builder, Rust 1.96.0,
lock, profile, codegen-units=1, features and probe. The pruned probe lock is
`82b300ce814c8742002c86b733ebd60c7e344fbec6cd228c04eb0ff760d408b3`.
The earlier baseline attempt omitted archived toolchain/config files: it is
preserved and is explicitly **not** matched baseline evidence. The corrected
source archive is not the final pristine-clone acceptance run.

The actual production release is a separate build, using the repository's normal
`wasm-pack build crates/wasm --target web` packaging, not the probe's CGU override.
`name-release.mjs` reruns bindgen and `wasm-opt -O -g` on each retained Rust WASM
input. `bindNames` authenticates all eleven non-custom sections against that exact
production release before names are used. Both `binding.json` files retain the
section digests, commands, versions and names. No browser profile was recorded.

| Artifact | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| Native probe file | 868,936 | 885,768 | +16,832 |
| Native `__text` | 490,312 | 497,424 | +7,112 |
| Actual release WASM file | 1,549,483 | 1,555,346 | +5,863 |
| Actual release WASM code section | 1,335,611 | 1,341,461 | +5,850 |

The native file digests are `fdd9c6a82272499a1d68a272c50e93799cf44b7744915b0980fb81a57a9e4913`
and `53d3793e0d03808ea646113cf577e0397d1d7a1248d0b521eb095a9f02155215`.
The release digests are `20f58e0d44cc94f9d0629478789680e4a87345ba800162aa0737ddc763bfd238`
and `a3ce02529ae2e6ec175066f4c838451ca7d1472b5f6bd2f5b2d5cbff805c8b42`.
`index-artifacts.mjs` generates `artifact-index.json` from the actual binary
disassemblies and parses the WASM code section for exact per-function body lengths
and digests. Native spans count actual AArch64 instructions, including any listed
alignment. Full raw disassemblies, not just selected snippets, are retained.

## Native actual caller/callee observations

In baseline `artifact-baseline-d7d308a5-r2/native-disassembly.txt`, direct unit
probe line7072 reaches execute `h7e56b87b362db8d9E` at call address `0x100007708`.
Its common successful retirement at lines3441 onward writes PC to Hart, then
stores returned value, rd, memory address/value pair and width to return-area x0
at `0x100003e0c..0x100003e18`; the return discriminant store follows at
`0x100004300`. These are five store instructions (the pair stores two words).

Candidate `artifact-candidate-d7d308a5-r1/native-disassembly.txt` line9191 calls
unit step `h554b26f86291c404E`, which calls unit execute `h18e7948cbcf78d24E`.
At lines3746 onward (`0x1000042c8`) execute writes the same architectural PC,
then places the successful Result discriminant 16 in a register and returns.
There is no retirement tuple return-area traffic at that boundary. The required
Trap result is still represented; removing it is not the claim.

Actual Machine::run is separately linked from the core crate: baseline line43971
uses ordinary step `h2fa3e9613bd7e7daE` and cached direct execute
`h136fbd3eb1c0d9b8E`; candidate line45761 uses ordinary unit step
`h23b5b01d5e4f6d65E` and cached unit execute `ha20e3ca6d1178e46E`.
The latter direct call is at `0x10002df58`. Recording probes instead reach
`h97b87f7b6584463cE` / execute `h7bb8b758bc135fbaE`, retaining tuple/callback work.
The complete callsites and body spans are indexed, including ordinary wrappers.

Direct execute body: 8,888 baseline bytes; 7,828 candidate unit bytes and 9,200
recording bytes. Separately linked Machine unit execute: 8,968 → 7,888 bytes.
Machine::run: 6,448 → 6,408 bytes. These are static code-size observations, not
instructions retired or a latency estimate; specialization adds machine code.

## Actual production WASM observations

Baseline Linux run_chunk is function266, calls function192 at `0x088cd3` and
`0x088ce9`; ordinary and cached paths in192 call execute175 at `0x043319` and
`0x043463`. Candidate Linux269 calls actual untraced Machine::run183 at
`0x08bfb7` and `0x08bfcd`; ordinary and cached paths in183 call unit execute175
at `0x029d67` and `0x029f71`. This is the actual production module, not a probe.

In baseline `release-baseline-d7d308a5/disassembly.txt` lines23291–23316,
execute175's successful common tail stores width/address/value/rd/result value
at return-pointer offsets32/24/16/8/0, and a discriminant at33: six store
instructions. Candidate `release-candidate-r1/disassembly.txt` lines23240–23245
uses one i64 store at return-pointer offset0 for the successful Result tag16,
and still writes the architectural PC at Hart offset3080. Fault paths still
return the required cause/tval pair at offsets0/8. The tuple fields are absent;
do not count retained trap traffic as retirement-metadata overhead.

Recording positive control remains in Machine::run_with_capture187 and its
recording execute174; its distinct unit branch reaches176. The raw disassembly
and exact body hashes are in the index for adversarial inspection.

WASM optimized bodies can differ across crate/monomorphization boundaries:
baseline Machine::run182→execute174 is 15,417 bytes; the old Linux-specific
run_traced192→execute175 is 13,305 bytes. New Machine::run183→unit execute175
is 14,649 bytes. Thus the unit body shrinks against old Machine::run but grows
against the old Linux NullSink specialization despite eliminating returned
metadata. Reporting only the favorable comparison would be misleading.
The net production code section grows 5,850 bytes. No timing benefit follows
from these static observations. Fresh Daybreak must admit the artifact gate
before broad semantic submission, demo, final clone, or a new F boot.
