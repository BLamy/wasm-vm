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
