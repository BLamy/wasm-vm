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
to conceal the failed run.

## Final local gates and independent source review

Final frozen head `52b29b9a41103337aba77bc5d002090111991c2d` changes only the
capture test's input filenames relative to44e5ed3. Its test SHA256 is
`1f4543e1d67757724578b1889bd39b84d489b853418ffdc0dcc248cbeca07654`;
helper, image, chunks, runtime and browser wrapper are unchanged.
`buffered-proc-gates-final.log` passes138/138, SHA256
`ce18c11c283084be5d3ac45baa776f519a242f96973876699f90cb7075c4a7b5`.
`buffered-proc-busybox-final.log` passes84/84, SHA256
`bb4793d90acaeb41769578924f3cd0f24f5564cd36be10491db8f1ae0c4bdabf`.
Neither suite has skipped tests.

Daybreak's source verdict is HELD for this bounded fixture claim, not F:
`buffered-proc-verifier/source-review.md`, SHA256
`cbd76e01f29ec41063e9901647845ee5fe68058dbcb89885c60ef045fd25fdb3`.
Three accepted old/new proc fixtures produce byte-identical observation and
printer output; stricter malformed-input refusals and an independent unknown
I/O-key sabotage hold. The provisional signed-counter finding is withdrawn:
the pinned Linux6.6.63 formatter emits all seven I/O fields with unsigned
decimal format, including the `u64` cancelled-write counter. The source report
links the exact kernel formatter and type; no helper change was warranted.

All five verifier fixture trees, including setup failures and the historical
false-positive r4, are retained in `buffered-proc-verifier/equivalence-raw.tar.gz`,
SHA256 `a7dee5d89c97dc3e94c46adcd2f28ca895baab3f5c5b3f4775fa82c052636399`.
The archive preserves raw files, symlinks and FIFO entries; macOS reports
unsupported extended attributes on special entries. The original trees are
also retained. Gzip integrity and extracted r5 results, bindings and accepted
output hashes match the source files. Regenerate fixtures with the recorded
verifier script at its frozen head, not by executing extracted absolute-path
scratch helpers. Final r5 result SHA256:
`b9f445ff8476658e91793a5d4dcbe7f50b58a2e476b9b5e020fb2f159727358c`.

## Closed real-browser result: timing FAILED

`node tools/verify/e5-t26f-browser-buffered-proc.mjs` runs at52b29b9a on61636
from15:20:59.469Z to15:35:29.233Z. Cold exits0, reuse exits1 solely at the
original two-second assertion, and the diagnostic collector exits0. The
retained `buffered-proc-52b29b9a/observation.json` explicitly has acceptance,
fVerified and fTimingPassed false. Frozen T0 `1230.9800000190735` to end
`12702.524999976158` is **11471.544999957085 ms**, not an acceptance pass.
The later accounting timestamp is not substituted for either endpoint.

Both cold pre-save observations and the post-restore observation identify
actual PID999/start27640, `/usr/bin/aplay` inode match, pipe_read, child FIFO
FD3 flags0100000, parent FD3 flags0100002 and PCM FD4 owned by999, PREPARED
with zero pointers. The sealed snapshot restores CRC `e0ec6452`, freshHELLO2
and full repair without a booting state. Two locked/suspended, zero-PCM
samples precede physical `play` at5ms,10 matching keyboard/DOM events and8442
fresh terminal pixels. Cursor movement changes94 pixels. The same player
completes with1440 fresh non-silent frames, amplitude0.999969482421875,
attached output and rendered frames47798 to559158. The failure screenshot
shows the green completion, child Done and returned prompt. This is actual
guest execution, not the controlled source fixtures.

The RPC accounting interval (not the precise F interval) stays at generation5:
12567 staged jobs =71 more pending +10456 backpressure +0 cancellations
+2040 pops. Of2040 pops,1414 submit and626 do not. Backpressure splits into
7801 incoming rejections and2655 resident displacements. Guest retirement
advances127440960, JIT retirement40694820 and decoded builds2055910.
Discovery stale/overflow/count-map-loss totals are zero. These are jobs, not
unique PCs or measured latency causes; no speedup or causal attribution is
claimed from this unpaired screen.

Cold browser/HTTP errors and reuse presentation errors are empty. The generic
failed-reuse record does not contain complete browser/HTTP-error arrays.
Later coherence, drag and second-restore phases are not reached; retain their
earlier scoped HELD results without claiming fresh coverage. F remains active.

Retained profile `e5-t26f-buffered-proc-VprFCc` is bound to runtime tree
`ce156e701a52057dbdd8436133ac09cdecb2e6360fca90bd528981e3396b6c71`,
profile tree `b4facf9d0c1c8214e62b2a1b0dcaf39b7f9da74079ed87c07bf3b0437d09c943`,
2808178-byte snapshot
`dd5ee19ced147f572e91df14db5eb871f84db2556c5eb00173e55fbe3ff95fbd`,
overlay generation641 and sound section
`42dfc147f4ad0d0b98490c3cb39bb8f3932f785a8266335fcd151de18b56858f`.
Never reuse or rebind this seal after changing its sources, assets or image.

Daybreak's independent B1-B6 review is `buffered-proc-verifier/browser-results.md`.
It holds the bounded diagnostic/functional predictions, not F's deadline.
Closed artifact hashes are indexed in `buffered-proc-digests.txt`.

After the critic closed, `make tasks-json` and `make web-dist` refresh only
the task timeline/status metadata and service-worker stamp `8c6d08671f72`.
Both WASM copies remain39c674d0 above; F remains in-progress296/464. Build
transcript: `buffered-proc-metadata-build.log`. The two unrelated dirty dist
artifact manifests are restored byte-for-byte from their prior backup. This
served-metadata refresh invalidates the52b runtime seal for future reuse;
it does not rewrite the closed browser evidence or require another ISA smoke.
