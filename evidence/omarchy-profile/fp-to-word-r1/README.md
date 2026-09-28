# E5.5-T03y float-to-word worker evidence

## Boundary and preflight

Compile FCVT.W.S and FCVT.WU.S through the existing integer-only
`softfloat::f32_to_int` implementation. A pure helper receives canonicalized
source bits, signedness and validated rounding, returning low word bits plus
new flags. Generated code sign-extends both W and WU, publishes the integer
destination and sticky flags/FS Dirty, and never writes an FPR. FS-Off and
invalid rounding retain the original parcel and completed prefix with no helper
entry. Optional imports retain their allocated indices alongside arithmetic
and from-integer helpers. Decoder, interpreter, software backend and handoff
ABI are unchanged.

Worker self-validation passed native (three tests) and private/shared WASM
(two tests), with normal process exit. The 52,224-case corpus uses 33 literal
inputs, all static/dynamic rounding combinations, all FS states, boundary
registers, discarded x0 destinations, prior flags and seeded raw/malformed
boxes. Register/flags FNV is `9311f74cb245717f`, not a full-machine digest.
It compares every X/F register, PC, trap parcel, flags, frm, FS and reservation
against the interpreter. Further checks cover 192 real CSR-change, result-use
and fault cases, plus three actual machine-run-loop traps. Production and
worker-fixture Clippy passed. These are pre-freeze checks, not final evidence.

The old arithmetic/from-integer verifier unsupported contrast changes only
from FCVT.W.S to FCVT.L.S, since the newly admitted word instruction is no longer
a valid rejection witness. The remaining families and earlier tests retain
their previous claims. A fresh critic owns separate literal, instrumented,
chain, growth and sabotage fixtures in the sibling verifier directory.

## Acceptance remains physical

The production browser guest combines W/WU conversion, from-integer conversion,
arithmetic and immediate integer result consumption in one loop, then spills
actual FPR words and reads actual fcsr/mstatus. The full live suite and capability
pip are inspected alongside it. The Omarchy trial separately uses the unchanged
R3 snapshot, execution settings and 120-second physical-keyboard readback
deadline. An instruction pass is not a responsive-desktop verdict. Final frozen
commands, hashes, images, public bytes and pristine-clone results follow below.

## Frozen source and independent fixtures

Runtime, worker and promoted critic fixtures, browser harness, roadmap and bundle
are committed at `53a095a485787e4ce6177712830d76728342b083`. WASM SHA-256 is
`7feb3179f4088b4c9ef3f69c23804ff0d9691f412b7270c66f61bbd85dc5a6b9`
(1,596,468 bytes); service-worker version is `08f4ef471f59`. `frozen.json`
records the identity. The preceding `preflight-browser/` is explicitly a
self-check made before that commit and is not substituted for the final run.

Independent fixtures cover 21,120 literal states (FNV 4083560513975942652),
1,792 seeded states including 868 illegal exits (FNV 4721190114470949240),
12 control cases (FNV 8504544371684976080), and 2,048 instrumented helper cases
with 1,080 legal calls and zero illegal calls. They execute all optional import
combinations, the actual eight-import mixed module, same/cross-module budget
and fault paths, and six actual 65,536-byte browser memory growth scenarios.
An isolated deliberately wrong literal fails; restoring it passes. The critic
corrected only its seeded-input selection to take modulo before narrowing to
32-bit usize, then proved native/private/shared digest agreement. The original
log and correction are retained. No production semantic fix was needed.

## Frozen focused recording

`record-submission.py affected` completed normally from 23:32:54 to 23:37:58 UTC
at the frozen head. All nine commands exited 0: production Clippy, native and
WASM harness Clippy, core handoff, existing FP/fault regressions, native F/D ISA
verdicts, native WASM-library tests, no-host-float scan and `make verify-E5_5-T03y`.
Exact commands and timestamps are retained in `affected-commands.json` and
complete adjacent logs. The existing FP regression gate passes 31 tests across
eight targets, including both deliberately updated unsupported contrasts.

The final production built-page guest retires 4,000 instructions, 3,605 through
JIT, with 31 host entries, 717 direct entries and 686 links. Both interpreter
and JIT match all explicit X results, sign-extended WU values, immediate integer
consumption, actual FPR spills, fflags/frm/FS and retired counts. Guest ELF
SHA-256 is `00645db64ba22d39876c0db2fe80a05756004ce256e3583efe971338f67bc71f`;
the RAM-only digest is
`dc6e4da35c08d6733ee59187153ded08bc05a28b97e119120f38f9301ccc08b8`.
It is not a full architectural-state digest. All 127 live ISA tests pass with
zero page/console/HTTP errors; the word-conversion pip is live 1/1 and the
correct T03y detail is visible. Root and critic independently inspected all
three final screenshots. The legacy capability container is revealed only in
the labeled inspection capture; the physical desktop uses no test hooks.

## Actual desktop trial: failed

The unchanged R3 physical-input trial starts at 23:38:50.616 UTC and proves
startup at 23:40:57.169 (126,553 ms). All 128 browser input events are trusted
and accepted, with no pending, dropped or rejected events. Enter is sent at
23:40:59.984; the original 120,000 ms deadline expires at 23:42:59.984.
Thirteen completed independent file reads return 75 and one remains pending.
The nonce never appears. Frames remain 2→2, and both root and critic inspect
the byte-identical captures: the Foot prompt has no typed response. Cleanup
closes the browser normally; the harness exits 1, not through a watchdog.

`physical-summary.json` summarizes the raw
`physical-input/desktop/report.json`, whose SHA-256 is
`9fdf9604e54206d87c27c9e6fb40c1d297b8fbb92768aa270edd40913ec2f687`.
Retirement advances from 1,722,487,868 to 2,962,438,874. The final cumulative
JIT share is 0.4647125927500234; this is not a timing improvement or causal
claim. The recorded instruction-clock divider stays 64. No other task-owned
heavy process competes with this trial. T03q remains gated. The next pending
slice isolates FDIV.S, justified by the earlier dynamic count and the static
four-parcel scan in `saved-division-encodings.json`.

## Deployment identity

The tested bundle is published at https://f8fc09fa.wasm-vm.pages.dev and the
production alias https://wasm-vm.pages.dev. `cloudflare-public.json` records
eight HTTP 200 responses with exact local SHA-256 matches for WASM, JS glue,
roadmap and app HTML. The independent critic additionally checks the service
worker at both origins against frozen Git bytes (ten exact responses total).
An initial sandbox DNS failure is an environment limitation; the authorized
network retry succeeds. Only the deployment manifests and pending task plan
change after the frozen runtime, before the final cold-clone proof.

## Prescribed full local gauntlet

`make -k ci` runs from 23:44:10 to 23:53:17 UTC and exits 2. The receipt retains
`allPassed: false`. The same five inherited targets fail: macOS cannot build
the Linux-only seccomp helper, all-feature Clippy also sees the existing
`live_blocks`/`fetch_phys` dead code, default-WASM resume still asserts the old
VIRTIO_RNG support expectation, the zicsr-stub browser tests reference methods
absent in that feature configuration, and the determinism scanner catches old
test-only `Instant` use. `unchanged-boundaries.json` records the unchanged
source hashes against the verified parent. No broad pass is claimed.

The native ISA wall passes 128/128 and the ALU performance smoke test measures
25.1 MIPS against its 15 MIPS floor. Deployment finished before the performance
test and no cold build overlaps it. The CI receipt starts at frozen runtime
53a095a4; the later ISA report names 95c250fe because pending-task metadata and
deployment manifests were committed during the run. Runtime and test sources
remain unchanged throughout. All affected gates separately pass at 53a095a4.

## Final pristine clone

`run-cold.py` clones committed head
`95c250fe56fb15f28ee022a21a3766176adca054` into a fresh scratch directory,
asserts an initially empty Git status and removes all CARGO_* variables plus
RUSTFLAGS/RUSTDOCFLAGS/RUST_LOG. `make web-dist` reconstructs the exact frozen
WASM SHA-256 and service-worker version. `make verify-E5_5-T03y` exits 0 at
2026-09-16 00:03:42 UTC: 17 tests across five targets, no ignored or failed
tests, plus the production browser. Worker and critic digests match the
original recording on native, private and shared runtimes.

The cold browser again retires 3,605/4,000 instructions via JIT with the same
guest ELF and RAM digest, passes all 127 live tests and records zero browser
errors. Root visually inspected all three cold screenshots: 127/127 green,
the word-conversion capability live 1/1, and the correct task detail. The
committed task-data bundle still names the in-progress runtime freeze; later
planning/status metadata is not misrepresented as a rebuilt runtime. Complete
commands, timestamps and hashes are in `cold/report.json` and adjacent logs.
