---
id: E9-T22c
epic: 9
title: Qualify both full pinned performance workloads
priority: 524.92203
status: in-progress
depends_on: [E9-T22b, E9-T22h, E9-T22j, E9-T22k]
estimate: S
risk: medium
capstone: false
---

## Goal

Qualify the unchanged real software and hardware GPU desktop workloads before timing.

## Boundary

One qualification harness and explicit reference/profile receipts. Reuse the
original software kernel/rootfs and GPU kernel/chunked-image/probe source pins.
Retain the old reference and every development failure. Explicitly document any
necessary supported-profile amendment before timing; never coerce a legacy
paced checkpoint or relabel a software renderer. Runtime semantic changes must
be their own prerequisite, not hidden in this harness task.

## Acceptance criteria

- [ ] Complete the frozen full Alpine workload with literal before/after bytes, real RTC/entropy receipts, 100 exact scheduled inputs, ten rewrites and ten counted 1 KiB HTTP responses.
- [ ] Boot the real Omarchy desktop in the accepted exact profile, compile the original frozen probe for RV64 against its qualified EGL/GLES libraries, execute it inside that guest and retain hardware GL_RENDERER, GL_ERROR0 and the complete red readback. Exercise the frozen viewport sequence.
- [ ] Prove both full recordings reopen/replay with complete architectural, RAM, device, disk, clock, pending/cursor, literal file/entropy/HTTP and GPU witnesses; zero live replay egress. Do not substitute tiny Linux, idle or bare-MMIO GPU fixtures.
- [ ] Seal executable source/asset/compiler/binary/renderer/reference receipts before the later timed campaign. Obtain a fresh actual Daybreak qualification verdict with one bounded novel attack; no performance/budget claim belongs here.

## Deterministic acceptance

`make verify-E9-T22c`. Planned target for full real-workload qualification and
affected harness/build/browser proof. The original development setup prefix
and frozen GPU probe cross-build are inputs to inspect, not passing acceptance.

## Adversarial verification

Corrupt an unrequested base chunk, vary workload seeds, dirty RAM/files,
sustained real HTTP and GPU readback. Independently read snapshots/filesystems
and count live server calls. Refuse software renderer or changed probe/assets,
missing GL results, hidden live replay I/O and an incomplete long recording.

## Verification log

### 2026-10-24 — worker — v7 cold-run prefix retained; v8 network-readiness qualification

The clean exact-head `1252a6c61170645ec0136e9a5e635d3f78947d81` run of
`E9_OUT=target/evidence/e9-t22c-submission-1252a6c61 make verify-E9-T22c`
passed full Alpine and its literal-file oracle. The original Omarchy image
reached systemd after the v7 COW root-getty bootstrap passed, but remained
behind NetworkManager's readiness gate at transition `6300000000`: 126
committed periodic checkpoints, 1,194 receipts and 467 authenticated base
completions, with no serial getty or SDDM output. The run was intentionally
closed through its recorded `STOP` control and is **not** a desktop/GPU/replay
qualification. Its failed report is
`target/evidence/e9-t22c-submission-1252a6c61/desktop/report.json`, SHA-256
`8a8423387605e23afe7bb9c2d713e1a6112ba1e1472566166d34e6c40580f8bb`;
the saved graph index is SHA-256
`9db516a7de3bd107dec5a4d87f3494a995854a09959fe28fed0d431542229685`.

Fresh actual Daybreak independently reconstructed the pinned systemd units
from the earlier retained COW/base and found that this image holds both getty
and SDDM behind `NetworkManager.service`'s D-Bus name, via `network.target`
and `systemd-user-sessions.service`. Its narrow proposal is a test-only COW
drop-in setting `Type=simple`, preserving the original NetworkManager
executable and dependencies while releasing the desktop service chain when
the daemon starts. Qualification v8 records and hash-checks this drop-in
alongside v7's root getty override before `exec /sbin/init`; the direct oracle
must find the exact bytes in every saved COW state. The original base image,
frozen workload, 50M checkpoint cadence, and budgets remain unchanged.
The full v8 run, real HTTP, GPU probe, complete replay and fresh Daybreak
final verdict are still required.

A separate fresh Daybreak v8 preflight held the exact drop-in bytes, SHA-256,
bootstrap shell command, v7→v8 serialization chain and four-point COW oracle,
but rejected the first v8 proof scope: `Type=simple` alone says only that
systemd launched NetworkManager. It does not show the daemon stayed alive or
owned its D-Bus name; manually configured guest HTTP cannot establish either.
The harness now records `systemctl is-active`, a live nonzero `MainPID`, and
`org.freedesktop.NetworkManager` bus ownership before and after the full
workload, requiring the same PID at both points. The independent report oracle
checks both recorded command results. That amended source still needs its own
frozen full run and final critic. Daybreak's follow-up preflight returned
**GO for the long run** with no deterministic command/parser blocker; its
read-only diagnostic is `target/evidence/e9-t22c-daybreak-network-dependency/report.md`,
SHA-256 `004b5b74b50ebaee21da4d50e13afac8464dba2d8e44b3a4b975ca812c82278c`.
That report states the exact pinned unit bytes could not be re-extracted in
this pass because the Docker/debugfs reader lacked Colima socket access; the
full run's live service and D-Bus observations remain required evidence.

### 2026-10-24 — worker — authenticated tty interleaving in the Alpine leg

At clean exact head `df2499fa0b3c39b963de022cbd47569f618c7ec4`, the
v7 `make verify-E9-T22c` run stopped in Alpine before desktop. Its failed
software report is `target/evidence/e9-t22c-submission-df2499fa0/software/report.json`,
SHA-256 `ed7df1b2e452ee7c7da022d70d6805627fdcbc922241aa1e89586819a49b51f6`;
the saved graph index is SHA-256
`72c567686a0a539ba435fdb239baa36b783d7ab585bbaa0f03f4ccf46b7a78b5`.
The 100 scheduled offers and ten real HTTP responses were recorded, but the
old output-marker checker demanded every marker occupy an entire tty line.
Input 9's `E9_INPUT_009` output instead appeared at the end of the concurrent
echo of frame 10's frozen `busybox wget -qO` command. The failed run has no
final file oracle or replay result; neither is inferred from the partial
recording.

A fresh actual Daybreak critic independently checked saved receipt sequence
205 at transition 358,694,304: frame 9's exact 27 input bytes were accepted
in full, with the scheduled ledger's SHA-256. The raw serial stream has the
expanded `E9_INPUT_009\r\n` token exactly once. Input 10's separately
authenticated echo is the prefix on that line. This is a checker false
negative, not a missing guest instruction. The amended checker first validates
all exact scheduled source receipts, then accepts an interleaved output only
when its prefix matches the immediately following authenticated frame's echo;
arbitrary prefixes, suffixes, duplicates, omissions and nonadjacent echoes
still fail. The failed console itself now passes this narrow rule with exactly
one classified interleaving. The desktop direct oracle will independently
read the v7 getty override from reconstructed COW media at every saved point,
as requested by Daybreak preflight. A new frozen full run is required.

### 2026-10-24 — worker — v6 bootstrap refuted by the pinned guest; v7 COW getty amendment

The clean exact-head `e51274fdbea7bb2a83ac125a770f040b76a8bd0e` run of
`E9_OUT=target/evidence/e9-t22c-submission-e51274fdb make verify-E9-T22c`
again passed the full Alpine phase and its direct file oracle. The desktop
phase cold-booted the original pinned Omarchy image into the recorded PID-1
root Bash prompt, then `cbootstrap` exited 1 at transition 595,088,768. The
failed report is `target/evidence/e9-t22c-submission-e51274fdb/desktop/report.json`,
SHA-256 `f6adb22acfbc8af9771d3372bd8d1a0aa83317b6fb4608fa5de7041a69e40023`;
saved storage index SHA-256 is
`821f26a6eca79bc9d06ebc6474f3507823efc28d5014eb1596d23d772b1e3fb8`.
It retains the initial/failure native states, 11 periodic checkpoints, 316
receipts, 105 authenticated base requests, browser trace and serial output.
This is a failed bootstrap, not desktop, probe or replay qualification.

A fresh actual Daybreak independent diagnostic reconstructed the exact pinned
guest filesystem from the retained native COW sectors and authenticated base.
It found the first false command predicate was `command -v sudo`: PID-1 Bash
was root and `/sbin/init` was executable, but the image has no `sudo`,
`visudo` or `/etc/sudoers`. The v6 policy cannot work on this image. The v7
qualification amendment preserves v6 as the failed attempt and replaces that
test-only policy with an exact serial-getty root autologin override written to
the guest COW, hash/mode checked and synced before `exec /sbin/init`. The
original image, manifest, T01 workload, budgets and production image remain
unchanged. The harness must then prove the new root getty shell and complete
the real desktop, GPU probe, whole replay and direct file oracle at a new clean
head. The desktop direct oracle and software provenance now bind the active v7
serialization instead of misidentifying v5 as active.

### 2026-10-24 — worker — preserve failed cold attempt and amend test bootstrap

The clean exact-head `67eea6f160631f0c93912c16bf59902e98cfb66c` run of
`E9_OUT=target/evidence/e9-t22c-submission-67eea6f16 make verify-E9-T22c`
passed the complete unchanged Alpine leg and its direct filesystem oracle.
The desktop leg crossed the earlier 6.4-billion local-graph failure and
committed 188 periodic checkpoints with 1,325 receipts and 533 actual base
chunk requests. It was intentionally stopped through its recorded `STOP`
control at transition `9437748736`, while still booting. Its complete failed
report, trace, saved IndexedDB graph, console and failure state remain under
`target/evidence/e9-t22c-submission-67eea6f16/desktop/`; report SHA-256 is
`0e9a04b1b04a71a738880bdb8aebf8646b4feef3ce8282a7fa33521172906bd0`
and saved storage index SHA-256 is
`db81a461c43c630212d2bc0212f690feab929573a3003b8a37bca9be7ff64438`.
This is not desktop qualification or timing evidence.

A fresh actual Daybreak read-only diagnostic compared the harness with the
same pinned image's authentic E9-T17 serial log and image sanitation source.
The image autologins `omarchy`; the harness's bare `login:` wait cannot reliably
match its `login: omarchy (automatic login)` line. The sanitized image also
removes `/etc/sudoers` and every sudoers drop-in, locks root, and grants
`omarchy` no privileged group; the subsequent `sudo -n -s` cannot yield the
required `/root` shell. These are source/fixture contradictions found before
the current run reached login; the intentional stop preserves its actual
prefix without mislabelling either predicted failure as observed at that
position. The guest's NetworkManager wait was still retiring instructions and
delivering UART receipts at stop, although longer than the older paced run.

The v6 qualification amendment preserves the original kernel, 12 GiB manifest,
T01 command bytes, 100-input/10-rewrite/10-response amounts, 50M cadence and
all numeric budgets. It records a PID-1 Bash bootstrap after the pristine
initial witness, writes a minimal `/etc/sudoers` policy only in the guest COW,
validates and syncs it, then `exec`s the original systemd image. The serial
autologin then supplies the ordinary user shell; a recorded exact-command
sudo invocation must prove UID 0 and `/root`. No production image, runtime
semantic path or deployed privilege policy changes. The task remains medium
risk as a qualification harness/profile change. The amended full cold run and
all desktop/replay/file witnesses are still required before implementation.

### 2026-10-24 — worker — blocked on local witness-graph admission boundary

At clean exact head `b4071260307146339230ec0986daafcd9661dbeb`, run
`E9_OUT=target/evidence/e9-t22c-submission-b40712603 make verify-E9-T22c`.
The complete Alpine leg passed its literal file, RTC/entropy, 100 scheduled
input, ten rewrite/HTTP and beginning-to-end replay checks. Its report is
`target/evidence/e9-t22c-submission-b40712603/software/report.json`, SHA-256
`069a3ae44b9d57a4c61c4fa35dadce1dcd9f219b21f08b8f2c61c5bcb36c3911`.
The genuine cold Omarchy leg crossed the prior 2.2-billion streamed-journal
failure and committed the repaired full parked-chain keyframe at 4.5 billion.
It then failed while publishing the next checkpoint at transition
`6400000000`, after 127 committed checkpoints and 1,054 receipts, with
`SessionStoreError: Corrupt: BundleBound: archive byte/object bound` from
`session-store.js` `#references`/`#publish`. No login, GPU probe, full workload
or replay was reached. Its immutable report is
`target/evidence/e9-t22c-submission-b40712603/desktop/report.json`, SHA-256
`f69bd158e704c185f1bef08893a641ea054f6f64f1e167cb14257ec2162f6389`;
the exported failed-prefix store is `desktop/saved/storage.json`, SHA-256
`89291c38bb8f5a3351ad37b835099d956ca223835e88b60d217b97fcbb56e36e`.
The existing independent closure oracle with `--allow-incomplete` rehashed all
3,652 physical chunks and 1,172 objects, and resolved 1,166 reachable refs and
128 witness pages; report SHA-256
`e3b95c7993fdda7d1f045526c2f070a32287c116e5c3ba28e23aa10477f9cc8b`.

Fresh actual Daybreak reconstructed the rejected candidate rather than
inferring from the browser error. The last committed authenticated graph is
4,281,733,856 logical bytes, 13,233,440 below the portable 4 GiB archive
cap. Six durably staged objects and the next manifest take the real candidate
to 4,311,983,484 bytes, 17,016,188 over that cap; the production graph
inventory rejects the reconstructed candidate with the same `BundleBound`.
Physical stored chunks are only 2,981,235,217 bytes under the already
configured 8 GiB local retention limit. This is a local runtime admission
boundary, not a workload-fixture or timing failure. E9-T22k must separate
bounded local publication/open/GC/reader inventory from the unchanged 4 GiB
portable archive guard before C resumes. Preserve this complete failed run,
the original pinned workload, 50M cadence and all numeric budgets.

### 2026-10-23 — worker — blocked on exact-GPU full-keyframe prerequisite

The complete v5 cold Omarchy attempt at exact clean head
`29fade9013c4a48e5ffd6736f27f756f3ca53e76` failed at transition
`4500000000`, sequence 881, after the original pinned base chunk was supplied
at that exact before-boundary. Reproduce the attempt with
`node tools/verify/e9-workload-desktop-browser.mjs --development --output
<new-directory>` at that head. Its retained report is
`target/evidence/e9-t22c-desktop-development-13/report.json` SHA-256
`e1298b9391aefb1a4b317f12f99bab5c6df1ee54bcf45a616521f3fa49f968f6`;
the independent prefix-closure report SHA-256 is
`265904da28efd1f0a8c32fab65ce5b69d780fde518c178226cc96c5657263912`.
The first 89 periodic checkpoints through `4450000000` were committed; the
next full keyframe refused with `gpu_session: NotQuiesced { reason: Chunk,
in_flight: 1 }`. The saved prefix, 842 objects, 2,413 chunks and 90 witness
pages authenticate. No in-guest GPU probe, complete workload, or replay was
reached. The fresh persistent Chrome profile was readable and reported
1,912,825,101 bytes used against a 12,650,243,341-byte quota. This is separate
from the earlier nonpersistent-profile `NotReadableError` at 4.95 billion.

Fresh actual Daybreak independently decoded the failure's native section 20 and
rehydrated earlier authenticated GPU frames. It found a visible, accepted owned
block completion, resident bytes and an empty broker, with one legitimate
parked virtio-blk chain. Several previously successful **delta** keyframes
serialized that same shape. Only the **full** GPU keyframe path rejects it, and
the journal must take a full frame at this point because the previous delta
depth is eight. Diagnostic report:
`target/evidence/e9-t22c-daybreak-quiesce-diagnostic/report.md`, SHA-256
`98881ffeb390809ade23866da001a8ef5fcc77ebdb09752b437d8b38faad4c3c`.
This is a runtime-semantic boundary, so ordered high-risk E9-T22j must fix and
be independently verified before C resumes. The unchanged 50M cadence, full
Omarchy workload, 8 GiB setting, original RV64 probe and complete replay remain
required. This failure is neither C acceptance nor a performance result.

### 2026-10-23 — worker — resume qualification after runtime prerequisites

E9-T22e/i/f/g/h and E9-T22b are verified. E9-T22h's independent Daybreak
publication verdict is committed at `0ecb2283f`; the canonical main deployment
is `9bafecaa`. Resume the original pinned Omarchy cold workload and its full
replay using the now-verified bounded GPU journal, witness, reader, continuation
and browser boundaries. Carry the separately verified software-phase evidence
only where its source and dependency digest are unchanged. This entry does not
claim C acceptance, timing, or a completed GPU run.

### 2026-10-22 — worker — begin complete real-workload qualification

Activated only after fresh actual Daybreak verified E9-T22b at
`8b99d05a0e5b3ee23198e72ea9d4d324eb3e8744`, including actual main deployment
`a14eb837` / release `3efeff9dd069d94c3577cefd4eb9439870ef32d3`.
The native branch `codex/e9-real-workload-qualification` is the next layer;
all 29 preceding PRs remain open/unmerged/unqueued. This task alone occupies
the active lane. Risk is medium for the qualification harness/reference
boundary; no runtime semantic change is included.

A preparatory fresh actual Daybreak read-only design audit is retained at
`target/evidence/e9-t22c-daybreak-design/final-message.md`, SHA-256
`b60fed572468ef464510251985c058edc1f1cd06d765875de1c85dc876c80768`.
It establishes no acceptance verdict. Compose the genuine full-Alpine owned
HTTP path with a sealed absolute-transition scheduler and complete journal;
boot the original full Omarchy kernel/chunk manifest in fresh 1 GiB pure
ICount/64, use the production physical renderer, transfer/execute the original
RV64 EGL/GLES probe and verify both adopted viewports. Reopen both stores and
replay from their actual initial frames through the complete histories, with
full state/files/source/network/GPU witnesses and zero replay egress.

Seal original source/asset/compiler/library/ELF/renderer identities and explicit
profile receipts before execution/timing. Preserve the original Chrome .80
reference and existing .85 amendment, all workload amounts, all numeric budgets,
and every failed attempt. The pinned Omarchy manifest is authoritative (12 GiB
base, distinct from 1 GiB RAM); do not substitute a different base for stale
4 GiB prose. Keep setup, exactly 100 scheduled UART deliveries, and auxiliary
GPU controls separate and seal the exact payloads/origin. No performance claim
belongs in this task.

The 4096-receipt/64 MiB GPU inspection window is an immediate capacity risk to
check against the real boot. If it or another runtime boundary prevents the
full qualification, retain the exact repro and create an ordered prerequisite;
do not hide semantic fixes, raise constants in a harness, truncate history,
begin after boot, reuse a paced warm pair, or label a software renderer GPU.
A fresh actual Daybreak critic must independently audit the complete frozen
proof and apply one bounded novel attack before marking verified. T22d, T23
and T24 remain required, and no merge is authorized.


### 2026-10-22 — worker — qualification input preparation (development only)

Adds the exact frozen schedule serializer, absolute-u64-coordinate checks,
accepted-offer validator and a disjoint byte-identified ledger for every UART
producer. The immutable input helper authenticates original manifests/kernels,
the complete Alpine raw base, and every materialized cached desktop chunk,
including unused local cache members. It preserves the original 12 GiB desktop
base, reference amendment and all numeric budgets. This is input preparation;
`make verify-E9-T22c` and the two complete qualifying workloads are not yet
implemented or accepted.

`node --test tools/verify/e9-workload-schedule.test.mjs
 tools/verify/e9-workload-assets.test.mjs` passes six direct tests; the latest
log is `target/evidence/e9-t22c-direct-harness-development-2.log`.
`target/evidence/e9-t22c-assets-development-1.json` separately retains the
original source-asset loader self-check (before the later ledger clarification).
The original negative-test fixture failure is preserved: an aliased
`Buffer.slice` changed the expected filename when corrupting its body; the
helper correctly failed closed. An independent copy fixed the test fixture.
No runtime or acceptance result was relabelled.

The fresh actual Daybreak bootstrap source audit is retained at
`target/evidence/e9-t22c-daybreak-bootstrap/final-message.md`, SHA-256
`f7fd3c1fd531a5142132a42cd052c3d8780f12dbf06d8eb45e9dc6ec177399ef`.
It proved missing production-terminal replies in the diagnostic page, the need
for complete input-ledger partitioning, and that the current journal's lifetime
limits do not reset at keyframes. It confirmed first real pending TX is a valid
provider-open boundary: the emulated net device advertises no carrier-status
feature, so the hub's initial link field is not guest carrier-down. This is a
source audit, not a task verdict or an accepted runtime failure.

Development attempts remain preserved separately. Attempt 1 was operator-stopped
because the driver flushed every small batch and repeatedly authenticated the
whole stored closure. Attempt 2 reached original Omarchy userspace and captured
partial native/renderer state, but its Node parent exhausted its default heap
while handling large numeric-byte-array/trace transfers; no complete report,
trace or store export exists. Its raw files, OOM log, later STOP chronology and
own-orphan-browser shutdown are retained under
`target/evidence/e9-t22c-desktop-development-2/` and the adjacent log. Those facts
do not establish a production-workload capacity verdict. Attempt 3 uses the
actual pinned production terminal bridge, records its responses separately,
streams raw receipt sidecars instead of returning large arrays, and keeps
screenshots/source/action traces with network snapshots disabled. It is a new
run, not a patch to either earlier attempt. It remains development only.

Next: finish the genuine corrected bootstrap and full software/desktop workloads,
seal the RV64 original-probe/compiler/guest-library/renderer receipts, prove all
literal and full-state witnesses through beginning-to-end offline replay, then
freeze the medium-risk submission for a fresh actual Daybreak critic. Correct
checkpoint scheduling must stay within the original 50M gap; do not silently
accept a late capture. Any actual runtime prerequisite must be its own ordered
task, never a harness limit change or a shortened history. All PRs stay open.


### 2026-10-22 — worker — authenticated capacity prerequisite and software proof repair

The corrected original cold Omarchy attempt 3 completed its failure capture at
`target/evidence/e9-t22c-desktop-development-3/`. Reproduce the diagnostic with
`node target/evidence/e9-t22c-boot-prototype-v3.mjs --output <new-directory>`;
its immutable executed browser/page copies, full report, all raw receipts,
rejected batch, retained IndexedDB graph and browser trace remain preserved.
The report SHA-256 is
`56fd66815fe3b78144ebbdb54791a0cd98e74c90c00b6086c890a333d91b65b1`.
Production `SessionGpuJournal.stage` rejected sequence 702 / transition
`2207340032` at `67179533` lifetime envelope bytes versus `67108864`, with
only `524420` resident pending+candidate bytes. The 256 block envelopes alone
exceed the lifetime bound; flush/keyframe changes cannot repair this.

A fresh actual Daybreak evidence-only audit independently rehashed all 1174
physical chunks and 473 logical objects and reconstructed the exact published
701-event prefix. Report:
`target/evidence/e9-t22c-daybreak-capacity/report.md`, SHA-256
`a341f3ffc80ca87b347d97cc1ea6e2270323e1004e752fcd6db47a4a2f9d53ec`.
Its requested/returned model is `gpt-daybreak-blue-latest`, `daybreakBlue`,
fallback disabled, completed without errors. The report's generic model
self-description does not replace that controller routing receipt. Its
ordering/length mutations were rejected. Failure-state/renderer witnesses
are diagnostic only: a full native/end-queue snapshot was refused because
33 block-chunk requests remained in flight. This is no completed/replayable
recording, desktop qualification or performance result.

Ordered high-risk S prerequisites E9-T22e/f/g/h now specify durable bounded
publication, authenticated bounded reading, bounded exact replay continuation
and browser integration. Each needs its own frozen proof and NEW actual
Daybreak critic. Original assets, cold profile, 50M gap, amounts and budgets
remain fixed. Witness/checkpoint/storage bounds remain prospective, not waived.

The new software harness runs the complete original full-Alpine workload,
records every UART producer, reopens its full store and replays from the
actual initial state with the original provider machine freed. Development
attempt 1 failed when the caller requested a ninth delta instead of a full
checkpoint; it is retained. Attempt 2 corrected that caller selection and
passed all 100 offers, ten rewrites and counted wire HTTP responses, 846
receipts/23 witnesses and byte-identical 27863837-byte final/replay native
states, SHA-256
`9d42ace6c6f197374f992445fede2a56d1cb3f264081d56e519775fcf9750440`.
Its report is `target/evidence/e9-t22c-software-development-2/report.json`,
SHA-256 `f5dbbe92ce81e345702cce1619f666e2552e815023435daf4868b59c4870d2a6`.

Fresh actual Daybreak separately audited this development phase at
`target/evidence/e9-t22c-daybreak-software-development/report.md`, SHA-256
`d6482bc3a8939a307184c989b3318cd1eecdeeb75c5b2a54ffc71c61b53dda1f`.
Routing completed on the same requested/returned Daybreak model without
errors. It independently reconstructed all 846 saved receipts, 284 chunks,
171 objects, the literal 100-offer schedule/UART partition, ten TCP GETs and
1024-byte response bodies, RTC and derived guest entropy, full native replay
and zero live replay calls. A mutated scheduled byte was rejected. This is a
limited evidence audit, not C verification or frozen final acceptance.

The later direct filesystem oracle failed at origin entropy because the
unchanged setup syncs before creating entropy. Daybreak independently found
the bytes in captured RAM/page cache and found complete final/replay entropy
and HTTP files on disk; this does not relabel the failed worker oracle.
Preserve its failed report/log. The repaired harness records an auxiliary
sync after setup and another before final inspection, outside the unchanged
100 scheduled offers; the qualification serialization states this origin
explicitly before timing. The oracle now seals/copies its own source,
continues through all points and files, and always rechecks the immutable
base. A new full run and complete direct oracle are required next. The trace
uses snapshots:false to bound capture memory; its empty trace.network is not
an independent network enumeration. Listener/tripwire results and decoded
actual guest Ethernet/TCP frames remain the network evidence.

`make verify-E9-T22c`, full GPU qualification, the original probe execution,
final risk-tier submission and final fresh Daybreak verdict remain required.
Only C currently occupies the active lane while finishing this independent
software capture repair. All PRs remain open and production remains verified B.


### 2026-10-22 — worker — blocked on long-history runtime prerequisites

C is blocked on E9-T22e/f/g/h. The exact corrected Omarchy repro, original
runtime/asset identities, rejected sequence/byte arithmetic, retained durable
prefix and completed independent Daybreak capacity audit are recorded above.
No smaller batch, extra flush or earlier legal checkpoint avoids the lifetime
limit. The full original desktop workload, probe and whole-history replay
remain impossible through the current writer/reader/admission boundaries.
This removes C from the active lane so the ordered runtime work can proceed;
it does not waive or complete any C criterion, timing budget, T23 or T24.

The corrected software-only frozen phase at
`e87a5894c31e1bbc708017c03a623daccc4a7233` passed its complete worker run:
`node tools/verify/e9-workload-software-browser.mjs --output
 target/evidence/e9-t22c-software-qualification-3`.
Report SHA-256
`196c5d51ed86e430cac8c5ee7dc7d786fcf37861f4760e2dfc4a9bca57b7e424`.
It has 100 original scheduled offers, ten rewrites/HTTP responses, 108 total
UART offers including eight auxiliary offers, 854 saved receipts and 23
witnesses. All beginning-to-end replay native bytes match at 27875178 bytes /
SHA-256 `fc130f82f7c636ec1a0432ad4b530455e0d21b68b6f1d139f24fb5013065b9ff`;
fetch/socket replay counts and page/missing/external errors are zero.

`python3 -B tools/verify/e9-workload-software-files.py --directory
 target/evidence/e9-t22c-software-qualification-3` separately passes all four
before/origin/final/replay points. The complete direct oracle report is
`literal-files-oracle/report.json`, SHA-256
`7501e128aa86c96bcf299748bb0d9a8694f1a30196fabce436040be042778185`;
its copied executed source is
`fbddedaa0ab95df7ee9a58974fa64bddcf6f7c3e190c6d77ceeb0ff261b5da5b`.
Every literal state/entropy/HTTP byte matches, final/replay pre-recovery COW
media match, and base/source integrity checks pass. Explicit auxiliary syncs
are recorded outside the unchanged 100-offer schedule. Six schedule/asset
unit checks pass in `e9-t22c-direct-harness-development-3.log`.

A NEW actual Daybreak evidence-only audit is running at
`target/evidence/e9-t22c-daybreak-software-qualification-3/`; no final software
critic result is claimed here. Its scope is this frozen software phase only,
including a bounded novel attack on the repaired proof harness. Future C
acceptance must account for any later changed dependency boundary, complete
the real GPU workload and final submission, and obtain the final fresh critic.


### 2026-10-22 — worker — corrected software phase survives fresh critic

The NEW actual Daybreak corrected software-phase audit completed with all
16 sealed predictions HELD, none FAILED or NEEDS EVIDENCE. Report
`target/evidence/e9-t22c-daybreak-software-qualification-3/report.md`, SHA-256
`7e931a27c50113f89f13908c057cc689a62c8bf0ba2ca99983f2aa9a1cd4b454`.
The controller requested/returned `gpt-daybreak-blue-latest`, `daybreakBlue`,
without fallback or errors. It independently authenticated the complete
clean-head source/assets, 100 exact offers and 108-offer UART union, both sync
fences, ten TCP HTTP bodies, real RTC/entropy, 854 receipts/23 witnesses,
all applicable literal files, full native replay and zero live replay calls.
Its missing-origin scratch attack refused the bad proof while processing
final/replay and rechecking the immutable base. This is only the software
phase; no C status, GPU, timing or whole-epic verdict follows. C remains blocked.

A further fresh Daybreak format projection from the authentic 45-keyframe
Omarchy prefix concretely exposed v1 witness bytes: 9888 versus the unchanged
8192-byte extension limit, first overflow at witness 38. The actual production
Wasm rejects the candidate; an otherwise identical two-endpoint format control
passes. The original incomplete recording is untouched. Report
`target/evidence/e9-t22c-daybreak-witness-capacity/report.md`, SHA-256
`ac298bc3f0691b1093fc728ea9cd5c41cd37bcce29dfac52856322170f7f9975`.
All five predictions held. Add E9-T22i after E and before F as the distinct
high-risk bounded durable witness-commitment boundary. No constants, 50M
cadence, workload amount or numeric performance budget is waived.
