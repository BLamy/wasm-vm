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
