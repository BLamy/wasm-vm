# Epic 9 performance measurement method

Status: qualification in progress. No T22 acceptance or performance result is
claimed. The unchanged T01 contract remains the source of all workload amounts,
asset identities and budgets.

## Reference amendment before measurement

`session-replay-performance-reference-v1.json` explicitly amends only the
browser patch release from Chrome 155.0.8059.80 to 155.0.8059.85. The original
contract and its SHA-256, complete workload and numerical budgets are retained.
This is a reference environment amendment under the contract's amended-baseline
rule. It changes no event/checkpoint codec and admits no GPU asset or clock
policy. Every campaign must record actual host/browser/runtime versions and
check the foreground, AC, fresh-profile, one-VM, no-profiler and no-background-
compiler/emulator conditions before starting. A later difference requires a new
explicit reference amendment before timing.

## Qualification evidence and remaining boundaries

The full original 512 MiB Alpine image has completed a local development boot
through the exact session's owned immutable-block path. Its setup recording is
`target/evidence/e9-t22-alpine-qualification-1`; the original report SHA-256 is
`2d1ba8d5a1dc6ef67ad0215f37d55e9cd6066c87c6048a76dc37aaa6bd4c7064`.
The recording retains the initial and final native images, one past keyframe,
the real IDB rows/chunks, serial output, executed sources and a Playwright trace.
The after file is the literal frozen value, and 32 retained entropy bytes match
the guest's SHA-256. This development run is headless, stops after setup and
contains no HTTP exchange. It is not a performance sample, a complete workload,
a recording-off comparison, GPU qualification, or a replay acceptance verdict.

The unchanged T01 GPU probe cross-build receipt is
`target/evidence/e9-t22-gpu-development-probe-1/report.json`; the RV64 binary is
`3080482f8bd8749f8947371d762570dcf699da00b952887c8eb1449a3652e213`.
Compilation does not qualify the desktop. The binary must run inside the real
guest desktop using its EGL/GLES2 libraries, report hardware GL_RENDERER,
GL_ERROR=0 and the complete frozen red readback. Preserve the original source,
compiler, sysroot/library and binary receipts. The original pinned Omarchy image
manifest is retained under `target/evidence/e9-t22-gpu-development-preflight`.
The legacy paced warm pair cannot be relabelled as a pure-ICount exact session.

A valid equal-work recording-off path must disable native source/event capture,
dirty-page recording and the durable journal. Disabling only the JavaScript
writer would measure incremental storage cost and undercount recorder overhead.
Use the same guest image, topology, clock policy, execution settings, live
provider and fixed input/work amounts in each pair. Any required runtime/API
extension must have its own explicit risk and deterministic proof boundary
before the medium-risk measurement campaign uses it. Live HTTP requires real
guest Ethernet/TCP traffic and a counted local HTTP server; a marker, fixture-only
reply or a live provider opened during replay cannot substitute for that proof.

## Campaign obligations

Before collecting samples, freeze the final executable method and exact source
head. Complete both full real profiles, five alternating off/on A/B pairs each,
seed 17, 100 inputs at the frozen offsets, ten file rewrites, ten witnessed
1 KiB HTTP responses, 20 independent LCG-selected seeks and the 600,000 ms
observation window. Preserve unfavorable and first-load attempts. Do not
truncate slow runs or change their work. Report short/long history separately,
initial versus cached loads, preview, restore, replay-forward, cancellation,
raw samples, p50/p95, recording ratio, bytes/minute, cadence and actual peak
additional recorder working memory. Compare to the original numerical budgets.
Bind file, entropy and HTTP bytes plus complete architectural, RAM, device,
disk, clock, pending-work and event-cursor witnesses. Require zero replay
egress. A thumbnail is not restored state. Only a fresh actual Daybreak verifier
may accept the final task after interrogating the recorded evidence and diff.

## Ordered execution slices

Daybreak's read-only design audit identified the missing runtime boundaries.
The cancelled E9-T22 planning container is replaced by E9-T22a (high-risk genuine
unrecorded control), E9-T22b (high-risk shared owned Slirp/local HTTP), E9-T22c
(full real-workload qualification) and E9-T22d (the entire original measurement
campaign). E9-T23 and the capstone remain gated on E9-T22d. No budget or workload
requirement was removed. Only T22a is active.

The first development prefix is preserved with Daybreak's findings. Corrected
`e9-t22-alpine-qualification-2` is explicitly offline. It checks the complete
rootfs and boot-manifest pins, bounds console bytes, retains/reopens identical
RTC/entropy source receipts and hashes 32 literal guest CRNG bytes. The direct
filesystem oracle reads the original before/final snapshots' owned COW sectors
and recovers scratch copies to prove both literal state files. This avoids
altering the frozen guest setup to add an extra shell command. The guest CRNG
output is independently hashed; it is not equated to raw virtio-rng provider
bytes, which the Linux entropy pool transforms. These are development prechecks;
full networking, GPU desktop, replay and measurement acceptance remain gated.
