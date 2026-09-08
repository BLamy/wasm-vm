# Single-process resident observation candidate

Parent PR367 (`a7d1556a`) closes the buffered POSIX read candidate with
independently reviewed functional evidence and an11.471545-second failure of
the unchanged2000-ms limit. This new candidate is not a performance claim.

Replace multiple shell/proc observations with one read-only static RV64GC
musl process. Preserve the old buffered helper and its tests. A separate
shell helper and `resident-observer-v1` fixture select the new observer;
arming, finite PCM payload/feed, same-child wait and three printed observations
stay byte-identical. No emulator scheduling, JIT, cache, guest clock, keyboard
pacing, restore T0, or acceptance deadline changes are in scope.

The observer closes inherited FD3 before observation, proves its physical
parent and the actual prepared aplay PID/start/executable identity, exact FIFO
read/write descriptors, pipe_read, PCM ownership/PREPARED/zero pointers,
available proc accounting, then rechecks process identity. It performs bounded
POSIX reads without subprocesses or production path overrides. Its one-line
result cannot arm playback or emit a success marker. The shell remains the
owner of feeding and waiting for its actual child.

Luna owns the C implementation/tests and a separate pinned local Zig cross-build
helper/tests. Main owns shell integration, image construction and evidence binding.
Daybreak will predict then attack parser, identity, short-read and build/image
boundaries. Controlled tests are not real guest proof. Once sources are frozen,
build a new SHA-bound image/chunks and NEW authenticated Chromium checkpoint,
then retain one unchanged-policy cold/reuse result, including any failure.

F remains in-progress. No old checkpoint is rebound, no Epic5 verification is
inferred, and no merge, Omarchy mutation, deployment or Epic6 work is performed
by this candidate. Completed risk-tier evidence from unchanged boundaries is
carried forward; new proof is scoped to the changed guest fixture/build boundary.

## Submission commands and initial checks

`make verify-E5-T26f-single-process-observer` passes the sanitized C fixture
driver (10389 checks including fixture-IO bookkeeping), real physical-parent/
FD3 transport and wrong-parent refusal, a killed zero-pointer mutant, and81
focused Node tests with zero failures/skips. `single-process-initial-gates.log`
is the pre-freeze self-validation record, not browser evidence. A first shell
test falsely matched the word read in a comment; its lexical assertion now
omits comment lines, while the byte-identical playback comparison is unchanged.
The new helper clears any stale observation before acquiring a new record.

Frozen submission re-runs this selected gate. The new cross-build command is
`node tools/verify/e5-t26f-observer-build.mjs --out target/e5-t26f/observer-build-v1
--source-sha256 FROZEN_C_SHA`; actual outputs are not yet claimed. Installed
Zig0.16.0's `std/Target/riscv.zig:2598` defines baseline_rv64 as64bit/I/M/A/C/D
with required dependencies; the recorded lp64d/static compiler arguments and
ELF headers establish the intended RV64GC-compatible target, not hardware
execution. `node tools/verify/e5-t26f-observer-native.mjs` separately compiles
ARM Linux binaries and uses cached Alpine/BusyBox with controlled proc fixtures.
It proves native libc/parent/FD transport only, not a RISC-V player or speedup.

The image command is `node tools/verify/e5-t26f-observer-image.mjs --out
target/e5-t26f/resident-image-single-process-observer-v1 --helper-sha256
FROZEN_HELPER_SHA --build-dir target/e5-t26f/observer-build-v1
--build-info-sha256 FROZEN_BUILD_INFO_SHA`. Split/verify its output into
`target/e5-t26f/chunks/resident-single-process-observer-v1` using the held
chunk tool. `node tools/verify/e5-t26f-browser-single-process-observer.mjs`
creates a NEW authenticated cold profile on61637, then one unchanged-policy
play/5ms reuse with17 bound source/metadata/binary inputs. Actual cross-build,
native run, image, chunks and browser outcomes will be appended after closure.

## Frozen local submission and actual image

Frozen head `05b82bc688a34e6a1abef7b6c761c01bf4a3f7c6`, PR368, preserves old
buffered source/tests. C source SHA256
`4ce161e7c1d82c19d2bd924c5f93d3d097c93a1ab6c53cec397e8ec1d2ee30e9`;
new5098-byte shell SHA256
`5807b908fc1bd84ff19c96e269df6b69ac86d3a62412a032f476dc8ea7f581d9`.
The final frozen gate passes81 Node tests without skips, sanitized C fixture
checks, actual production observer_main with real getppid/close and controlled
proc/device data, wrong-parent refusal, and a killed zero-pointer mutant.
`single-process-final-gates.log` SHA256:
`4aa135d68b0c9dd8208bc758b12e4538f58a47804115b30c6bd4c069746eddda`.
The C CHECK total includes fixture-IO/bookkeeping assertions, not10389
independently named tests. The identical native ARM suite reports10393 such
checks; both complete without a failure.

The actual static RISC-V binary is30960 bytes, SHA256
`cdb72cc93a20ec360f3fb63a23911b77059feaa4230ad84d6963a92e25809350`.
The compiler is `/opt/homebrew/Cellar/zig/0.16.0_1/bin/zig`, version0.16.0,
SHA256 `747a9b519198afe71ad190a2387ce28cee879894d7ebc4e34c042b3ebf623c08`.
Actual build-info SHA256
`04bb3b3ca42ca5efdc71ffb1b7c7587b73e3499ebc690b9f7c76eb7810fcda3b`.
ELF validation and `file` identify ELF64LE RISC-V ET_EXEC, RVC/double-float ABI,
flags5,8 program headers and3 load segments, no dynamic interpreter/linker.
The actual embedded architecture attribute is
`rv64i2p1_m2p0_a2p1_f2p2_d2p2_c2p0_zicsr2p0_zmmul1p0_zaamo1p0_zalrsc1p0_zca1p0_zcd1p0`.
These are build/format observations, not a guest execution claim.

The separate native ARM build and cached Alpine/BusyBox1.36.1 run close0.
Actual new shell command substitution executes the fixture-backed production
observer_main with real physical-parent and FD3 closure, accepts the exact
record, and leaves the parent's writer usable. No injected getppid happy-path
authority is used in this transport mode. Only proc/device data are substituted.
`single-process-native.log` SHA256
`d51aa44e748b49057f8a67f538c48d5fdc17be9fa4377d292fd58121d74c0bd1`;
native raw result SHA256
`7142b91a565e363e419a46cde3cae9860057b20ca315bee7e8c6eafd9867ab90`.

The fresh1-GiB ext4 image is
`d2fc4eab9bc1b5fe528a2956b58faefb20fcf18e2505c499ecafa8824d390f72`;
image-info SHA256
`b6a1f79e2d9f865411fec1907a9b56e6a9d208eb2fd90bcfe95571fc5a5b8c7a`.
The unchanged package manifest is
`f578113d65a0be90635d8ad9a87630583f9e4cfa49e6f50e67f606301d8f752a`;
the extended file manifest is
`826ae6242881740ccf3a85712e0c761208f0a8ad8abd82cf7975d7335d85a10e`.
Both actual extracted files hash to their frozen inputs, with root:root
0444/0555 modes and all four inode times1731542400. Read-only fsck completes
all five passes. Base/source/binary/build-info hashes are rechecked after the
overlay.8192x131072 chunks reassemble to the same image; split-manifest SHA256
`e02a9af547773f9d54e47151419ab3b118c55d3a4c90b25dcc434487db8dc9f5`.

`single-process-build-records.tar.gz` retains the actual RISC-V/native binaries,
build provenance, native script/results, image installation/readback/fsck records
and split manifest, excluding giant image/chunk data and build caches. Archive
SHA256 `0092e0d952233954218e10ceadd110cd9aa42d6f371aa34f143e018c1d92b0b8`.
Gzip integrity and the extracted RISC-V binary hash are checked. Original outputs
remain under target/e5-t26f. No old evidence or image is overwritten.

The new cold/reuse recording starts16:16:13.404Z on61637 at05b82bc6 with
retained profile `e5-t26f-single-process-observer-IKBhyX` and17 source bindings.
Its closed records are `single-process-observer-05b82bc6/` and adjacent outer
log. Cold exits0; reuse exits1 at the original two-second assertion. Original
T0 `1222.0550000667572` to frozen end `5584.254999995232` is
**4362.199999928474 ms**, so F remains in progress. The outer wrapper then
also exits1 because its discovery collector accepts only the older fixture
label. No original observation.json exists. This is a postprocessing bug,
not a different browser failure or authority to rewrite/relabel the raw run.

The actual static RV64 observer executes in the guest: both pre-save records
and the post-restore record show PID1000/start31468, exact executable identity,
pipe_read, read-only child FIFO3, RDWR parent FD3, PCM4 owned by1000, PREPARED
and zero pointers. The actual screenshot shows green completion and `[1]+ Done`.
The old lower-terminal2.289-ms underrun is present before save; no zero-XRUN
claim is made. Physical play produces10 matched keyboard/DOM transitions,
8465 changed pixels and1440 fresh non-silent PCM frames. PCM is observed at
completion, not at a measured first-PCM timestamp in this unprofiled run.

First-present CRC `9c53f290` equals the paused pre-save CRC. Snapshot SHA256
`87477fbfe7b1d31edfb75336f0f49f0001f175106a6506933cef733d579699e7`,
2820040 bytes, overlay generation652. Prepared sound section SHA256
`330d02f9e91a4e67239bd3386715f87ca45cb0ea8052c387276a6c5450eeeafc`;
no pending transfer/bytes, next-XRUN, event, reset or release. Actual runtime
SHA256 `f897f34951ca3ab59909f0ce6bbe2e8a68a6620cdace4d1e4eca617cbd601ce8`;
sealed profile SHA256
`f7a2bc52a45ed895eb1edd71f722ab1fb5c5ccf106a0753a6630b17f84940685`.
Fresh HELLO generation2 and no booting state hold. Two locked/zero PCM
observations precede the delayed gesture. Cold browser/HTTP errors are empty;
generic failed reuse lacks complete error arrays. Later coherence/drag/second
restore are not reached. No speedup follows from an unpaired comparison.

Daybreak's source review holds P1–P10 within the explicit fixture/build domain:
`single-process-verifier/source-review.md`. It independently kills a late/split
ignored-PCM-key duplicate mutant while retaining positive accepted-byte
equivalence. Those are controlled tests, not browser timing evidence. The
closed browser review and any postprocessing repair are separate addenda.

## Postprocessing-only fixture admission repair

The corrected discovery collector supports the explicit observer fixture while
requiring identical run/binding provenance, fixed base/install/source paths,
bounded build paths, valid size/mode/SHA pins and matching binary readback.
Legacy resident-aplay records retain their existing contract. It reads the
closed record, not mutable current build outputs, and never changes its bytes,
T0, end, cap error or acceptance flags.24 focused collector/wrapper regressions
pass, including the exact SHA-bound real failed observer record through the
real collector and CLI, plus missing/mismatched/malformed provenance refusals.
`single-process-collector-gates.log` SHA256
`65b83ca58cfc82f2d8c30c10ea9fbd2e7154c28ad8e43c6874758e566ca88df8`.

Separate `posthoc-observation.json` and `posthoc-provenance.json` retain the
corrected output, exact command and parser/input pins. Original raw SHA256
`0881a4aa55808bd0884b5a6ef2f05af4da9601b119e188390cef94b4c667002a`;
posthoc output SHA256
`7a0ec6b45330319c6a49457365f968538bbda0ce78bf6fad38565f984d01dc50`.
The original wrapper remains failed, not retroactively successful. The repaired
parser source is423019e85fc480cb3badf91c412a558a1f7ffaf44ac54c033eac31e5c0f1380f.
Actual same-generation2670 staged jobs conserve as73 additional pending,
1797 backpressure drops and800 pops.570 are submitted,230 popped but not
submitted; drops split1184 incoming rejections/613 resident displacements.
Discovery stale/overflow/counter-loss totals stay0. These are aggregate jobs,
not unique PCs or a demonstrated cause of the4.362200-second failure.

## Separate read-only localization on the unchanged seal

`node evidence/e5-t26f/single-process-observer-05b82bc6/run-latency.mjs`
uses the existing latency-only diagnostic on a new copy of the same sealed
profile, with unchanged proper runner/helper/binary/image/runtime and physical
play/5ms. The original unprofiled run above is not edited or superseded. Its
child closes1 and diagnostic wrapper0. T0 `1180.4750000238419` to end
`5445.259999990463` is **4264.784999966621 ms**, still FAILED. PCM remains zero
at3305.210000038147 ms and is first sampled non-silent at3355.899999976158 ms;
first completion marker is sampled at4248.325000047684 ms. Sampling does not
provide an exact first-arrival timestamp. Thus the late marker is not the
only observed delay. The same1440 fresh non-silent frames and matching CRC
hold. Raw record/logs are under the run directory's latency/ subdirectory;
`single-process-latency-05b82bc6.log` retains the outer transcript.

`node evidence/e5-t26f/single-process-observer-05b82bc6/run-cpu.mjs`
separately selects the existing CPU-only owned-worker profiler, without the
periodic latency/JIT probes. Child closes1, wrapper0. Original elapsed is
**4064.1699999570847 ms**, FAILED, with2181 saved samples. Raw CPU SHA256
`1ca58077d82dda63ab722e9a58d12da102f7ac215669fee43b6433cfafa70b9a`.
The only served release remains WASM SHA256
`39c674d0707a1a0d4348df078128b8a83cd9bec0b5fe943239f25497b3bf127c`.
Any offline name recovery must authenticate every non-custom executable
section against that release. These perturbed diagnostics neither establish
a speedup nor satisfy F; no new cold boot or policy change accompanies them.
