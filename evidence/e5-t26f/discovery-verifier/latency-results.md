# Discovery latency — bounded independent review

Disposition: **HELD as diagnostic evidence; F's unchanged 2,000 ms criterion FAILED.** No task verification, performance waiver, default/policy change, or causal attribution follows. This closes only the existing latency recording; the prior discovery preflight/gates and baseline browser report remain HELD.

## Recording identity and the refused attempt

Both invocations bind release `690e23245b4b376c55c0b830f7690c8a0f72059e` and the unchanged proper runner. The replay uses a fresh profile copy of the already authenticated discovery checkpoint, not a rebound seal: snapshot SHA-256 `263ba774eb5dd211775ef26dc9896e2d784ccbb59f4866d9541ad20d19db34c6`, CRC `80ab2d17`, generation 631. Its runtime/profile/source bindings agree with the baseline report and retained invocation. Existing `LATENCY=1` is the diagnostic addition; physical `play` remains at 5 ms, without CPU, command, clock, or policy overrides.

The initial `latency/` attempt wrote its invocation into the protected child output directory. The proper runner refused this nonempty directory at its output guard, before browser launch; exit 1 is **not a measurement**. The original script, invocation, log and exit record remain intact. The corrected wrapper puts its invocation outside `latency-replay/record/`; this is an orchestration-path correction, not a runtime or oracle change.

## Original-clock measurements

All following elapsed values use the same restore T0, `1171.2150000333786`; the probe does not reset it. Raw citation: `latency-replay/record/failure-post-restore-interaction-checks.json`, `milestones.postRestoreStart` (line 255), `interactionLatency` (330), `firstWrite/firstPcm/firstMarker` (2548–2573), and `postRestoreEnd` (2645).

| Observation | Milliseconds after original T0 |
|---|---:|
| Last sampled zero write index | 3767.2400000095367 |
| First observed fresh PCM | 3818.1599999666214 |
| First successful marker observation | 4670.02999997139 |
| Frozen interaction end minus T0 — actual cap | **4726.939999938011** |

The frozen end is `5898.15499997139`; later interaction telemetry is `4727.340000033379`, **not** the cap. The canonical error is the original 2-second AssertionError, with child exit 1.

All 77 PCM samples were checked: 59 zero, then 18 positive; timestamps are nonregressing and correctly T0-relative. The observed zero-to-positive bracket is 50.920 ms, not an exact timestamp of the guest's write. Zero samples also bracket the deadline at approximately 1968.515 and 2018.235 ms. First PCM contains 1,440 inspected/non-silent fresh frames, maximum absolute amplitude 0.999969482421875; final immediate PCM is likewise positive. Thus this recording does not support “PCM was timely and only the completion oracle was late.” First PCM still cannot substitute for successful completion.

The held probe source (runner lines 797–944) retains bounded 50 ms PCM sampling, 250 ms scheduler sampling, and an independent first-marker record. Its T0+6,000 ms resource deadline is not an acceptance extension. Marker state reads report 229 calls, 13.954999685287476 ms total and 4.304999947547913 ms maximum. Only the first 120 call records are retained; the aggregate includes all calls and the later first-positive marker has its own record.

## Actual guest output and sampler limits

I independently viewed the canonical native screenshot. It shows the two terminal windows, physical `play`, matching pre/post PID 999/starttime 28696 and saved FIFO/PCM identities, the green aplay token, original-child completion and prompt. No XRUN text is visible in this PNG; that is not a claim that no XRUN occurred anywhere. The image is byte-identical to the baseline capture. Actual record checks retain ten matched DOM/guest key edges, 8,462 changed pixels, no new red marker, cursor acknowledgement, locked zero PCM before the gesture, fresh HELLO generation 2 and matching first CRC without boot. Full later coherence/drag/second-restore audits were not reached: their older HELD evidence is carried, not re-proven here.

All 14 completed scheduler observations and their sequential JIT responses were checked, not merely a summary. They report `scheduler.postTask`, zero fetch waits/requested chunks/fetch-wait time, zero timer yields and zero main-thread yields; scheduler retirement advances 12,489,950 → 55,971,669 across slices 25 → 112. JIT responses retain an executor and disabled timing/timer reads. The sampler owns one logical slot through scheduler then JIT; completed intervals do not overlap. Its fifteenth request is explicitly `pending-at-stop`, not a completed zero-valued sample. This is not a claim that every unrelated RPC globally had only one request in flight.

The samples show ongoing execution and no reported fetch-wait/timer-yield bottleneck. They do **not** identify a dominant guest/runtime cost, exclude other scheduling or device costs, or establish that instrumentation is free. The observed marker-read total is small, but the additional RPCs make this a diagnostic, not an unprofiled performance baseline. Removing visible-completion observation alone cannot turn this run's late observed PCM into a demonstrated 2-second success. No speedup, causal fix or F promotion is established.

## Artifact digest audit

Every file digest below was mechanically recomputed from actual bytes. Paths are repository-relative. The baseline report carries the unchanged release/seal/runtime pins; those bindings were compared with this replay. No tests, builds, browser launches, source/status edits or commits were performed for this review.

| Artifact | SHA-256 |
|---|---|
| `evidence/e5-t26f/discovery-690e2324/run-latency.mjs` | `4b1858d2069e30f7acf89d146eabe08bbf0743fd4c6808f40f3ee93e91dbeb7e` |
| `evidence/e5-t26f/discovery-690e2324/latency/invocation.json` | `494c4fc252f9326af59371d48f104c69abe848e1485de7d994e643032b3ca666` |
| `evidence/e5-t26f/discovery-690e2324/latency/run.log` | `3ae68e5b61a552f2fc19220cc76ecc75f038afbe969a0a097412f7bbaaee741c` |
| `evidence/e5-t26f/discovery-690e2324/latency/exit.json` | `0cf195d64edfa93e108082da543b5fe976bc4709e8021c314b822c486255c3d7` |
| `evidence/e5-t26f/discovery-690e2324/run-latency-replay.mjs` | `c3e60e97fbad4eaa4c20cb87698a050ee84ee97d0c4abbf35c08f71edbb877f9` |
| `evidence/e5-t26f/discovery-690e2324/latency-replay/invocation.json` | `b3ec743c156c666ca89bc1ab1f066e4b6c58f91c59dc26438229b059b61d3e88` |
| `evidence/e5-t26f/discovery-690e2324/latency-replay/run.log` | `7773f5683bd8106e844aba4778a90ca3eb079b0d902428f73c88bef3ec7a08cb` |
| `evidence/e5-t26f/discovery-690e2324/latency-replay/exit.json` | `0cf195d64edfa93e108082da543b5fe976bc4709e8021c314b822c486255c3d7` |
| `evidence/e5-t26f/discovery-690e2324/latency-replay/record/failure-post-restore-interaction-checks.json` | `ad72cf160e0774b4eb7c8605ccfe8e29cb3a76f112437c63f16e8d1d29a13503` |
| `evidence/e5-t26f/discovery-690e2324/latency-replay/record/failure-post-restore-interaction-checks.png` | `57f35b0c1ac35da7ba873f7067b9ff577e5ce7ed349de2ceb4454f4478377b0d` |
| `evidence/e5-t26f/discovery-690e2324/latency-replay/record/failure-post-restore-interaction-checks-server.log` | `2e534ab1853736738ba8fc3a201cf3b929d14c6d97b3623a1af108a57f99027d` |
| `evidence/e5-t26f/discovery-verifier/browser-results.md` | `10bf03d79f77f7b6bfa5ce811236aa67462b3b213908281826581115e7766094` |
| `tools/verify/e5-t26f-browser-roundtrip.mjs` | `bfcdc06f6d6ec330815d7ad12b7a0c101035a11d50348828fe2d39a7370cb219` |

