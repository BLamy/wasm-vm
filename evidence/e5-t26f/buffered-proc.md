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

## Frozen initial candidate and image

Code head `44e5ed3ee31da1c2fc14f779d79e869d65d45279`; helper SHA256
`324e0acddd88bd2d41b0310444e32e2262dedd3129132240134dac857d4eec2e`.
The local fixture gate completes138 tests, zero failed/skipped:
`buffered-proc-gates.log`, SHA256
`b6b5dfe0970788b8052ce2af4c59e9beb80ce74a54e830b5e24c313a009c0759`.
The built demo passes126/0 with empty console/HTTP errors; its screenshot is
`buffered-proc-demo/demo-suite.png`. This is the ISA/roadmap smoke, not a
desktop resume. Source/dist WASM remain byte-identical at
`39c674d0707a1a0d4348df078128b8a83cd9bec0b5fe943239f25497b3bf127c`.

The offline image builder completes and rechecks preserved base/helper bytes.
Image SHA256 `4cb3424f637ba55d709171ce21a6b7b42a67e7bdfaef7848d7f1d7c02976ec18`,
size1073741824; its helper readback is byte-identical, root:root0444 with fixed
1731542400 inode timestamps, and read-only fsck completes all five passes.
`buffered-proc-image-build.log` is the exact image-info JSON, SHA256
`2917a5db27613fb04e4ef7474ab844d9755b642609cf67d07469d175db4301cf`.
The8192x131072 split chunks reassemble to the same image digest:
`buffered-proc-chunks.log`; manifest SHA256
`6b648e57c713325d2ce3df86eeb459cf3e27c873ec2088f562ea94168b66dd08`.

The initial actual native BusyBox run is retained as a FAILURE,83/84:
`buffered-proc-busybox.log`, SHA256
`ba8cb5cbdc687b50430e59f8feba99837cf7c89016ae77683b7cb44950589aa5`.
Its repeated-file capture test expects `pipe_read` after rewriting an empty
host file; the next container returns empty with exit0. The other83 tests
pass. This initial run is not fully passing and says nothing about browser
performance. No browser candidate has run yet.

The bounded four-case diagnosis in `buffered-proc-native-fixture/check.json`
and its raw transcript proves stale shared-file visibility before the helper:
at15:14:19.613Z, the host's rewritten inode34749046 contains9 bytes, while the
next container's `stat` and `od` see an empty inode16904. The unchanged helper
correctly captures the bytes visible to it. A fresh immutable filename is9
bytes on both host/container and returns the exact9 bytes. Test inputs now
use a new file per vector; no sleeps, helper edits or image rebuild are used
to conceal the failed run. A final native suite remains required.
