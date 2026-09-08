# Buffered guest proc observation — candidate, not acceptance

Parent: `7f15d76646a9f94e9c089b53bb7202fb1278a18c`; activation:
`f23275fc`. F remains in progress. This candidate changes only the resident
fixture's proc-text acquisition and parsing, not emulator/browser policy.
The earlier arm64 syscall count is a hypothesis, not browser causality.

The guest helper's actual PID/start/executable/parent, FIFO descriptors and
flags, PCM ownership/PREPARED/zero pointers, optional I/O accounting, paired
pre-save observations, arming, finite feed, and original-child wait remain
required. The three observation print calls are unchanged. Stricter malformed
input refusals are tested explicitly. Mock proc trees prove parser/refusal
behavior, not a real player or sound device.

Local fixture gate: `make verify-E5-T26f-buffered-proc`. The independent
review plan is `buffered-proc-verifier/preflight.md`. It explicitly does not
require injecting a legacy helper into the real guest or adding a new guest
transport; controlled old/new equivalence plus a fresh real-player browser
proof cover this changed boundary.

Fresh image output is `target/e5-t26f/resident-image-buffered-proc-v1`; fresh
chunks are `target/e5-t26f/chunks/resident-buffered-proc-v1`. Build with the
actual frozen helper SHA using `e5-t26f-resident-image.mjs`, then split and
verify with `tools/chunk_image.py`. Never substitute the old helper's image.

`node tools/verify/e5-t26f-browser-buffered-proc.mjs` creates a NEW authenticated
cold profile on port61636, then runs one unchanged-policy physical `play`/5ms
reuse. It pins13 source/metadata inputs and uses the held queue collector.
The original restore T0 and2000-ms cap are unchanged. An outer exit0 means a
valid diagnostic record, not F verification. Every child failure is retained;
non-cap failures cannot produce an accepted timing observation.

Build, frozen-source gates, native BusyBox portability and real browser records
will be appended only after they have actually completed. Existing HELD
evidence is not promoted into a fresh run or a performance claim.
