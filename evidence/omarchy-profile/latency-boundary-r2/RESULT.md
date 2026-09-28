# T03h — completed diagnostic, desktop still not responsive

Recorded on 2026-09-14 UTC at frozen helper head
`ea77bfa1c3d50b9b08ecd381025bbfc393741b52`. The runtime and guest artifacts
were unchanged. This is not a successful desktop-input acceptance run.

## Reproduction and observations

```sh
node tools/verify/omarchy-input-diagnostic.mjs \
  evidence/omarchy-profile/latency-boundary-r2 64 1 \
  --pair-directory target/omarchy-sdr-r3-snapshot \
  --chunk-dir target/omarchy-profile-chunks-sdr-r3-256k --headed
```

Command stream, in order (manual intervals are bound by recorded timestamps):

```jsonl
{"op":"stats"}
{"op":"screenshot","name":"before-input.png"}
{"op":"type","text":"x","delay":100}
{"op":"stats"}
{"op":"screenshot","name":"after-input-immediate.png"}
{"op":"stats"}
{"op":"screenshot","name":"after-input-window.png"}
{"op":"process-sample","targets":[{"pid":417,"tids":[462]},{"pid":503},{"pid":504}],"timeoutMs":300000}
{"op":"process-sample","targets":[{"pid":417,"tids":[462]},{"pid":503},{"pid":504}],"timeoutMs":300000}
{"op":"stats"}
{"op":"screenshot","name":"final-process-state.png"}
{"op":"quit"}
```

The process exited 0. `identities.json` binds the helper files, actual HTTP
response bodies, requested URL and actual restored machine state: boot snapshot
restored, ICount divider 64, JIT enabled, headed Chrome. No guest clock, cache,
renderer, production artifact or runtime setting changed during this run.
The four artifact digests are the R3 digests in the frozen recording plan.

`wire.json` records one trusted KeyX down at 03:15:57.833Z and up at
03:15:57.939Z, with canvas focus. Worker keyboard calls 263/266 and sync calls
264/267 returned true by 03:15:57.947Z. Controller observations had zero pending,
dropped and rejected input events. That proves delivery to the emulator and
queue drainage, not Linux/Hyprland/Foot consumption.

Immediate stats at 03:15:58.366Z and post-window stats at 03:18:18.750Z
bracket 140.384 host seconds. Another 1,071,998,561 instructions retired;
the guest clock advanced 1.6749978 seconds. Frames received and successful
presents both remained at one, with no pending presentation or display error.
No explicit diagnostic guest command ran during this window; the app's own
readiness RPCs remained active and are in the raw wire log.
The observer also recorded 727 agent-bridge messages of 18 bytes across the
run. Their payloads are represented only by length, so no byte-level agent
payload or idle/observer-free guest claim is made.

Both read-only process samples completed after the input window, in 50.053
and 35.358 host seconds. Both bind boot ID
`450d9a5f-1fc8-440a-9d2a-21bff69195d1`, leader starttimes and per-thread
starttimes. Uptime brackets are 136.44–136.51 and 139.92–139.98 guest seconds.
Between sample completions, 339.062 host seconds / 3.47 guest seconds elapsed.
Sequential per-thread CPU counters (`CLK_TCK=100`) changed as follows:

| Task | Starttime | Observed state / wait | CPU tick delta |
| --- | --- | --- | --- |
| Hyprland 417/417 | 3468 | S / futex_wait_queue | 1 user + 1 system |
| llvmpipe-0 417/462 | 3695 | R / 0 | 332 user + 0 system |
| Foot 503/503 | 3846 | S / do_epoll_wait | 1 user + 0 system |
| Quickshell 504/504 | 3872 | S / poll_schedule_timeout.constprop.0 | 0 |

All four schedstat files were absent. Runnable-wait time is **unknown**, not
zero. The renderer accumulated 3.32 guest CPU seconds while the main thread
accumulated 0.02. This does not identify the exact executing PC, input-consumer
boundary, futex owner or specific renderer fence. The sample interval includes
the sampler work; it is not a clean input-latency benchmark.

The coordinator personally inspected the actual PNGs. Immediate and 140-second
screenshots are byte-identical: restored Foot/bar with the real waiting dialog
and no typed x. The final screenshot shows the actual Foot/bar without the
dialog, still with no x. Final frame count is three. Eventual extra frames do
not retroactively pass the failed input observation window.

## Supported boundary and next hypothesis

The host delivered the key and continued advancing the VM. During the measured
input window no new frame arrived; a host presentation backlog does not explain
the stall. The later process pair supports investigating CPU-heavy software
rendering while the compositor main thread waits. It does not prove deadlock,
crash, starvation, nor that the key reached the compositor.

One falsifiable next hypothesis is that recurring translation-eligible renderer
blocks stay interpreted because the bounded discovery hotness table cannot
admit new entries when full. The precise missing probe is a recurring physical
block entry, stable generation/bytes, actual admission reason and installation/
unsupported status, with counts sufficient to estimate contribution. Aggregate
`countsDropped` alone is insufficient. A clock-divider experiment would instead
test timer sensitivity, not establish a rendering-throughput remedy. No remedy
is claimed by this task; any eventual fix must pass the unchanged 120-second
physical nonce/readback and actual post-input screenshot acceptance.

## Evidence digests

| File | SHA-256 |
| --- | --- |
| diagnostic.json | d489c680d72ab5310ed9b3a8ac4324df369f47a43cef6d3a40b7386b5d4682c8 |
| wire.json | c68b0478a371de9818398efaebd1b00d67c5dab359e867072837c41e083a8ffa |
| identities.json | 10b6842465078ea73faaa6ef890697c5cfc8a1a5c4e9872608753e8da548eced |
| before-input.png | e9e97d1afcbaf32fba419933c1ac580983d21901d6d195e9c710258776533ee9 |
| after-input-immediate.png | eb4b181dc1480935a2ef49f1480d082eeb8371d5229dbef13a473b1c05c3da3e |
| after-input-window.png | eb4b181dc1480935a2ef49f1480d082eeb8371d5229dbef13a473b1c05c3da3e |
| final-process-state.png | 97fc180d4d35c68ca5941dc591afb315220550165469f3c4ead7827989cc2f3f |

Frozen helper tests: `node --test tools/verify/omarchy-process-sample.test.mjs
tools/verify/omarchy-input-diagnostic.test.mjs
tools/verify/omarchy-live-recording.test.mjs` — 27 passed, zero failed/skipped;
output in `../latency-boundary-tests.log`. No full runtime rebuild was needed
for these diagnostic-only changes. Recorder errors are not a global browser
console-error capture; no zero-console-error claim is made.

Offline receipt command: `node tools/verify/omarchy-latency-receipt.mjs
evidence/omarchy-profile/latency-boundary-r2` — passed. It rechecks 84 served
responses (70 unique paths), frozen helper/dist bytes, raw physical delivery,
read-only fenced process responses, parsed same-identity deltas and PNG hashes.
The output is `receipt.json`; it expressly sets desktop acceptance and guest
input-consumption proof to false. The checker is an offline audit added after
the recorded run; it did not run in the guest or change the recording.
