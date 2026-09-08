# Compile-queue observer — closed browser review

**P5 HELD for the read-only observer increment. F remains IN PROGRESS/unverified:
4313.125 ms exceeds the unchanged 2000-ms cap.** No material observer refutation,
speedup, causal attribution or default-policy recommendation.

Frozen source/build `2ace135363cf0fa3cf7ba978fe6810e564eecc03`. Predictions precede evidence in
[preflight.md](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/compile-queue-verifier/preflight.md);
P1–P4, the independent collector attack and built-demo result carry unchanged from
[gates-results.md](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/compile-queue-verifier/gates-results.md).
This closes only the new authenticated cold/reuse accounting observation.
Prior F functional and L/K/H/I/J/T19a architectural dispositions are not reopened.

## P5 provenance and actual execution — HELD

Independently read the invocation, both closed child records/logs, canonical
failure JSON and aggregate; viewed both canonical PNGs. A read-only Node audit
at `2026-09-08T14:37:03.824Z` rehashed actual files, compared all eight invocation
source bindings against both current bytes and frozen Git, reproduced the aggregate
from the raw record through the actual pure collector, and independently checked
the equations with BigInt. Both calculations agree; raw input was not altered.

The new headless Chromium seal is
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26f-compile-queue-GhPcGG`,
origin `http://127.0.0.1:61635`, Chrome/152.0.7977.76.
Cold started 14:20:11.639 UTC; seal metadata was created 14:34:16.132 and publication
completed 14:34:16.575. Reuse used the separate `iteration-J8KCEx/profile` copy,
not the sealed source profile. The retained child exits are cold0/reuse1, neither
signalled; outer0 means successful collection only.

Independent tree hashing using the driver's sorted path/size/content convention
found the original sealed profile unchanged: **812 files**,
`0f1cf069e42283764ea9757d36d39e158c2eafb507baf5e4dd2fe8364fdea523`. The matching served-runtime tree is
**150 files**, `83ef1097b58fde5be5440871acae201aa750aaabbcf5e7a568fa1e47f53ff4fb`.
Source and dist WASM both hash to `39c674d0707a1a0d4348df078128b8a83cd9bec0b5fe943239f25497b3bf127c`.
The actual kernel, 1-GiB resident image, chunk manifest and helper were rehashed
against the invocation; their pins are below. This is a new observer-build seal,
not a rebound old L/F checkpoint. Known unrelated dirty dist manifests remain
outside the held runtime-tree claim.

The actual sealed desktop envelope decodes to **2,818,820 bytes**, SHA256
`06901857ddb25196d8f9212ad981782ba02eae45d0eb456e792a287239339bfb`, CRC **4a8f326b**, generation **645**.
The cold record's frozen audit shows paused/stillPaused, decision resume and
generation/finalGeneration645. Re-parsing the authenticated envelope and sound
section (SHA256 `330d02f9e91a4e67239bd3386715f87ca45cb0ea8052c387276a6c5450eeeafc`) confirms Prepared state2,
playback stream0, parameters present: stereo S16/48kHz, buffer3840/period1920;
zero pending transfers/bytes/release/XRUN/events/reset, all four kicks zero,
including actual playback TX index2. This is existing parser/native-boundary
carry, not a new sound-format or queue-order claim.

Canonical reuse `milestones.normalRestore` (JSON139–254) retains the exact
envelope, first restored CRC4a8f326b and fresh HELLO generation2. Boot-state
events reach `restored`, not `booting`. Display checks pass. The initial
channel disconnect/new HELLO request is retained; it is not mistaken for an
application-ready old session.

## Real input, guest identity and fresh PCM — HELD within diagnostic scope

The cold PNG shows two actual Foot terminals. Upper pre1/pre2 values are
PID999/start26812, executable aplay inode match, `pipe_read`, read-only child
FIFO FD3 flags0100000, parent FD3 flags0100002, no child writers, PCM FD4 owned
by999 Prepared with hw/app pointers0. The reuse PNG shows physical `play`,
the same post identity and a new green `e5t26f-aplay` token.

That green token follows the authenticated helper's identity comparison, finite
FIFO feed, original writer close and **successful wait on the saved child**
(`tools/guest/e5-t26f-resident-aplay.sh:145–172)); it is not evidence of mere
playback start. **No final Done notification or shell prompt is visible after
the new green token in this capture**; neither is claimed. The lower window
retains the earlier cold playback's recovered **0.063-ms underrun**. This is
not a zero-XRUN claim.

Two pre-gesture observations are locked/suspended with all producer/inspected
PCM counters zero. The actual pointer down/up follows those checks. Reuse has
the expected ten guest key frames and ten non-repeated DOM key events for
P/L/A/Y/Enter down/up, configured physical delay5ms. Guest cursor pixels
acknowledge the move at **828.400 ms after T0**, focus is accepted, and the
command produces **5679 changed guest pixels**, new green and no new red token.
These are actual input/pixel observations, not just host-held-button bookkeeping.

Immediate completion capture has fresh **1440 written /1440 inspected /
1440 nonsilent frames**, maxAbs **0.999969482421875**, both ring indices1440,
fill0. Output is attached, unlocked and running. JSON `residentBeforeGesture`,
`postRestoreAplay`, `postRestorePcmAtCompletion`, `postRestoreAudioAfter`
and input-frame records retain the raw observations (under `milestones`);
the actual PNG was checked independently, not inferred from the collector.

## Original clock and coverage limit — timing FAILED

The raw milestones are:

| Quantity | Observed value |
|---|---:|
| postRestoreStart | 1191.6350001096725 ms |
| postRestoreEnd | 5504.760000109673 ms |
| Exact cap subtraction | **4313.125 ms** |
| Later interaction ledger | 4313.524999976158 ms |
| PCM completion sample elapsed | 4279.709999918938 ms |

The frozen end precedes the later ledger and after-stats RPC; neither replaces
the original endpoint. There is **no first-PCM timestamp** in this run.
The completion sample cannot establish when PCM first appeared or suggest a
marker-only timing correction.

The retained error is the exact `ERR_ASSERTION`,
`post-restore interaction exceeded 2 seconds` at the unchanged proper driver's
cap assertion. No COMPLETE/profiler/latency/command/pacing/clock/capacity override
is admitted in this observation. Both stats endpoints report executor enabled,
repack-off24, decoded capacity4096 and compile queue capacity256; timing remains
disabled. Clock/default implementation carry is unchanged, not a new clock
measurement.

This fail-fast run does **not** reach the later normal coherence audit, drag or
second-restore/no-stuck sequence. Their unchanged prior HELD evidence carries;
this capture does not newly prove them or all F criteria. Cold JSON explicitly
has empty browser/http error arrays. The generic failed reuse JSON has **no
complete top-level error arrays**: presentation errors are empty, and its embedded
server output exactly matches the retained server log, whose HTTP failures are
two favicon404s. Do not extend cold/demo's empty arrays into a claim of complete
reuse browser-error coverage.

## Accounting from the raw endpoints — HELD

Same discovery generation5, safe monotone cumulative counters, unchanged policies,
and the owned same-Machine/no-other-drain flow satisfy the collector's premises.
Discovery overflow/stale/count-map drops are zero at both endpoints. Queue
backpressure is a different counter and is positive here.

| Actual field | Before | After | Delta |
|---|---:|---:|---:|
| Discovery successful nominations | 271 | 3122 | 2851 |
| Discovery FIFO depth | 0 | 78 | 78 |
| Compile admitted | 271 | 1682 | 1411 |
| Compile backpressure drops B | 0 | 1908 | 1908 |
| Compile stale cancellations C | 0 | 0 | 0 |
| Compile pops P | 96 | 888 | 792 |
| Compile resident depth Q | 175 | 248 | 73 |
| Validated submitted U | 95 | 647 | 552 |
| Compile high-water (gauge) | 221 | 256 | — |

Direct independent arithmetic agrees with the collector
(`e5-t26f-compile-queue-observation.mjs:39–55`):

    Staged S = 2851 − 78 = 2773
    S = ΔQ + ΔB + ΔC + ΔP = 73 + 1908 + 0 + 792
    S − ΔU = 2221 = 73 + 1908 + 0 + 240
    Incoming rejected = S − ΔA = 1362
    Resident displaced = ΔA − ΔQ − ΔC − ΔP = 546
    1362 + 546 = 1908 backpressure drops
    Popped but unsubmitted = 792 − 552 = 240

These are queue-job event counts, **not unique PCs, permanent lost work, or
2221 unexplained losses**. The 240 residual is pre-submission refusal,
not 240 known compiler failures or proven decoded-cache misses. Backpressure
and recount are existing policy; its observed frequency does not establish a
latency cause or a policy defect.

Before-RPC spans1454.135–1463.210, after-RPC5505.595–5548.5; guest execution
continues across sequential observations. Counter deltas are not an exact
frozen F window. CompiledBlocks94→116 is a live-gauge change, not22 compiles.
An unpaired4313.125-ms result cannot establish a speedup over any prior run.
No new runtime/default recommendation follows.

## Closure and mechanically audited pins

P1–P4 and demo carry; **P5 closes HELD for honest observer collection**. F timing
remains FAILED and F unverified. No new blocker or additional run is requested.
No gates, clone, browser, source, status or queue changes were made for this
increment. The wrapper retention limitation remains closed-child transcripts and
exits, not a guarantee for process-creation errors.

All22 entries of `evidence/e5-t26f/compile-queue-digests.txt` independently passed
`shasum -a 256 -c`. The canonical failure record is the observation input;
duplicate post-restore captures add no proof. This report's hashes below are
generated from the independent actual-file audit, not recopied worker citations.

| Actual file | SHA256 |
|---|---|
| [evidence/e5-t26f/compile-queue-2ace1353.log](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/compile-queue-2ace1353.log) | `1bf23ab9d1c3106f580d5faa800d196afd510c262d82a1e5c93a043b45a8bd62` |
| [evidence/e5-t26f/compile-queue-2ace1353/invocation.json](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/compile-queue-2ace1353/invocation.json) | `4b375537c9c47462aa504fb834a52b26ea016d2eee02ce3ad6527b392f99af41` |
| [evidence/e5-t26f/compile-queue-2ace1353/observation.json](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/compile-queue-2ace1353/observation.json) | `0129166967db0ebe7bab273629740759cdce801a92e86b0be64b6248ba786d75` |
| [evidence/e5-t26f/compile-queue-2ace1353/cold/diagnostic-checkpoint.json](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/compile-queue-2ace1353/cold/diagnostic-checkpoint.json) | `837da48ffc265a1674e86f6c2ad773f15b8fa81152e61f2ec55343cb7f91806a` |
| [evidence/e5-t26f/compile-queue-2ace1353/cold/resident-prepared.png](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/compile-queue-2ace1353/cold/resident-prepared.png) | `0b190c15d3a399a0ea24f6d11de0f57e6f5275d11ac30030275da017ce376c66` |
| [evidence/e5-t26f/compile-queue-2ace1353/cold/run.log](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/compile-queue-2ace1353/cold/run.log) | `eb2a3ec128f5e930e471eccc676a5a8cf60fd9433e06323519f9c5581d176f89` |
| [evidence/e5-t26f/compile-queue-2ace1353/cold/exit.json](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/compile-queue-2ace1353/cold/exit.json) | `bcebd13d238a77ac126cc4e2019b18ca63df4a97ac56ee163379a4c768d3acd3` |
| [evidence/e5-t26f/compile-queue-2ace1353/reuse/failure-post-restore-interaction-checks.json](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/compile-queue-2ace1353/reuse/failure-post-restore-interaction-checks.json) | `3380858371a65c4896301382d8967dffa25dc50cab3dca10337a40ce2f45bbf7` |
| [evidence/e5-t26f/compile-queue-2ace1353/reuse/failure-post-restore-interaction-checks.png](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/compile-queue-2ace1353/reuse/failure-post-restore-interaction-checks.png) | `ce13ccc20d056152cd308c74f635ca3e47ba0c201d1b6ed76075badddb0f675d` |
| [evidence/e5-t26f/compile-queue-2ace1353/reuse/failure-post-restore-interaction-checks-server.log](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/compile-queue-2ace1353/reuse/failure-post-restore-interaction-checks-server.log) | `0185354cb48acd194b6966054386e328d5bb94096d973a5a5bfa1acf6c062da4` |
| [evidence/e5-t26f/compile-queue-2ace1353/reuse/run.log](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/compile-queue-2ace1353/reuse/run.log) | `af9b187775ecaea9a864c09b4cf1a54f3ed6eabd210d97e96d6314de37d5f4f1` |
| [evidence/e5-t26f/compile-queue-2ace1353/reuse/exit.json](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/compile-queue-2ace1353/reuse/exit.json) | `0cf195d64edfa93e108082da543b5fe976bc4709e8021c314b822c486255c3d7` |
| [/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26f-compile-queue-GhPcGG/normal-checkpoint.json](/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26f-compile-queue-GhPcGG/normal-checkpoint.json) | `886ceb056f1fb8321b144bde1abfc95676f073ff7f2d5c65506d42a5191373d6` |
| [/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26f-compile-queue-GhPcGG/e5-t26f-owner.json](/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26f-compile-queue-GhPcGG/e5-t26f-owner.json) | `c7ee02f01b9150b608defd5cbee99f9782bc1518847f0e2326a794da88d6dae7` |
| [evidence/e5-t26f/compile-queue-verifier/preflight.md](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/compile-queue-verifier/preflight.md) | `b7bc983d6acae34272ea22784e8fc984ebdc2a44b444cf59eeac9676630a0f2e` |
| [evidence/e5-t26f/compile-queue-verifier/gates.md](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/compile-queue-verifier/gates.md) | `29cf8a3161e7c7786df8663f45bdd82dc04dd26b32934b052e552ed9eb918748` |
| [evidence/e5-t26f/compile-queue-verifier/gates-results.md](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/compile-queue-verifier/gates-results.md) | `b2c9f13a8de84cb023f5cf04bb5f18932c541be1cb2115171211ee6c62445bcb` |
| [/Users/blamy/Documents/Codex/wasm-vm/releases/kernel/6.6.63/Image](/Users/blamy/Documents/Codex/wasm-vm/releases/kernel/6.6.63/Image) | `af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce` |
| [target/e5-t26f/resident-image-2ae65408-a/alpine-rootfs.ext4](/Users/blamy/Documents/Codex/wasm-vm/target/e5-t26f/resident-image-2ae65408-a/alpine-rootfs.ext4) | `27c2e8f2789b18efac214837c295dbfb22559beea350fb5788f71edfdc0f0a8e` |
| [target/e5-t26f/chunks/resident-2ae65408/manifest.json](/Users/blamy/Documents/Codex/wasm-vm/target/e5-t26f/chunks/resident-2ae65408/manifest.json) | `2245a4d8b8b804bb200079c1ce00dee868762324f18627fa5d2b11fe032639ef` |
| [tools/guest/e5-t26f-resident-aplay.sh](/Users/blamy/Documents/Codex/wasm-vm/tools/guest/e5-t26f-resident-aplay.sh) | `2ae65408985f18be8b1287521bad23803282d652bb8f98421a135a351dac213c` |
| [tools/verify/e5-t26f-browser-roundtrip.mjs](/Users/blamy/Documents/Codex/wasm-vm/tools/verify/e5-t26f-browser-roundtrip.mjs) | `bfcdc06f6d6ec330815d7ad12b7a0c101035a11d50348828fe2d39a7370cb219` |
| [tools/verify/e5-t26f-resident-proof.mjs](/Users/blamy/Documents/Codex/wasm-vm/tools/verify/e5-t26f-resident-proof.mjs) | `28742ad80ee2b8628ae18ffc3d24b02f32a7e9c2d8706ec900bb244e1b548d6c` |
| [tools/verify/e5-t26f-discovery-observation.mjs](/Users/blamy/Documents/Codex/wasm-vm/tools/verify/e5-t26f-discovery-observation.mjs) | `4bc9e00027a42465a37364cad1b707c87da78806a1c0d20d5729109728004d04` |
| [tools/verify/e5-t26f-compile-queue-observation.mjs](/Users/blamy/Documents/Codex/wasm-vm/tools/verify/e5-t26f-compile-queue-observation.mjs) | `fff0cf5e7bbbf9c822bbe6b62cb2dcf936076da1eeb3d455d3cdd7a915c02dcc` |
| [tools/verify/e5-t26f-browser-compile-queue.mjs](/Users/blamy/Documents/Codex/wasm-vm/tools/verify/e5-t26f-browser-compile-queue.mjs) | `cd2ef6a05280f0845792bcac48b63822a4fb877a2afff95e39bdb0236dd6d2ef` |
| [crates/core/src/compile_queue.rs](/Users/blamy/Documents/Codex/wasm-vm/crates/core/src/compile_queue.rs) | `678d51e6c333e076caeb99f3960fac52a0886941cc85ebf6638062878c751b15` |
| [crates/core/src/lib.rs](/Users/blamy/Documents/Codex/wasm-vm/crates/core/src/lib.rs) | `7ff782fec3aa18b1b3729ac57e96dd999162b5c92b6fa36ef080cd9953bc2d3c` |
| [crates/wasm/src/lib.rs](/Users/blamy/Documents/Codex/wasm-vm/crates/wasm/src/lib.rs) | `d9b100a0b434688a34fdcd943e8f21f683c3c77e27d9fe6c240ee001399a38be` |
| [web/pkg/wasm_vm_wasm_bg.wasm](/Users/blamy/Documents/Codex/wasm-vm/web/pkg/wasm_vm_wasm_bg.wasm) | `39c674d0707a1a0d4348df078128b8a83cd9bec0b5fe943239f25497b3bf127c` |
| [web/dist/pkg/wasm_vm_wasm_bg.wasm](/Users/blamy/Documents/Codex/wasm-vm/web/dist/pkg/wasm_vm_wasm_bg.wasm) | `39c674d0707a1a0d4348df078128b8a83cd9bec0b5fe943239f25497b3bf127c` |
