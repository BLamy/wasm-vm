# Fresh browser screen after verified E5-T26m

Producer head: `657fb5a23b411bf02832b2d10ef943b43d0becf1`.
Command: `env -u RUSTDOCFLAGS node tools/verify/e5-t26f-browser-single-process-observer.mjs`.
Status: closed timing failure; **not F acceptance**. Cold child0, reuse child1,
outer wrapper0 after recording the expected cap failure and queue accounting.
No runtime, source, task metadata or HEAD changed during either recording.

## New seal, unchanged image

Cold recording started at2026-09-08T18:32:59Z and sealed at18:46:29Z. The wrapper
created `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26f-single-process-observer-9IMCYn`
and a new snapshot, then used `iteration-g6gfpr/profile`, never the seed, for
reuse. Origin is `http://127.0.0.1:61637`. The full invocation and proper-runner
binding are in the adjacent JSON files; no old seal was rebound.

- actual M runtime WASM:
  `18e53caa2e160819d16a6e0bf376530d45234e28f315c89b5042c48b1d791cc4`;
- served runtime-tree digest:
  `f3a4fbe4d5aee30a9fcaa6f38cef292d8a65959d56612c43f3a82c427701249d`;
- seed profile digest:
  `3d1f4671402fc69da3f4957cd32f1fd9d92ea3fb28e1d03d60e8f716a4c65a0e`;
- unchanged observer image:
  `d2fc4eab9bc1b5fe528a2956b58faefb20fcf18e2505c499ecafa8824d390f72`;
- new snapshot:
  `a91dd00f8b7b3552c75cbf98c6f9701952aaa4c39eb4009892cb1f98a32c7a88`,
  2820140 bytes, CRC`fa67bb62`, overlay generation637;
- saved PREPARED sound section:
  `330d02f9e91a4e67239bd3386715f87ca45cb0ea8052c387276a6c5450eeeafc`,
  zero pending transfers/bytes/events/kicks/reset/release, finite stereo
  S16/48-kHz parameters.

Main viewed `cold/resident-prepared.png` and `reuse/post-restore.png`. Both show
the real player PID1000/start26791, FIFO FD3 read-only, parent FD3 read/write,
PCM FD4 owned by1000, PREPARED, zero hw/appl pointers. The post image adds the
same-identity observation, successful conditional marker and same-child Done.
The old underrun in the lower terminal predates this snapshot; no whole-run
zero-XRUN claim is made here.

## Original unprofiled failure

Original T0 `1177.8849999904633`, original end `4879.879999995232`:
**3701.9950000047684 ms >2000 ms: FAILED** at proper runner line1930.
The later `postRestoreInteraction.elapsedMs` is not substituted for this endpoint.
Raw record: `reuse/failure-post-restore-interaction-checks.json`, SHA-256
`0c282602e307dd9a4c50995414ff3ecca27aa7212fd357d723b502830dc853d8`.

The new CRC restored, delayed pre-gesture samples were locked/suspended with
zero PCM, physical play produced10 matching guest/DOM keyboard edges,8500
changed pixels and the success marker with no red marker. Cursor render is
observed at765.890ms; focus is accepted and held buttons are empty. The final
audio sample is running/attached with4320 newly written PCM frames,4096 inspected,
2656 non-silent and max magnitude0.999969. This is **not** the prior run's1440
frame count; no stale numeric result is carried forward. The sample was taken
at command completion, not the first PCM arrival.

Defaults remain JIT enabled, decoded capacity4096, repack-off cap24, compile
queue256 and entry timers disabled. Queue accounting is conserved:
2606 staged =83 pending delta+1787 backpressure+736 popped;468 submitted and268
popped-unsubmitted. The observation is adjacent `observation.json`, SHA-256
`4f0fe7af9608a0b22a02828342984c01daa8cbde0c82cadf37810ff2f056dfed`.
These are sequential-RPC job counts, not unique PCs, exact interval attribution,
or a demonstrated timing cause. Discovery overflow/count loss remain zero.

Timing fails before the later normal coherence audit and drag/second-reload
phases. No freshly passing claim is made for those unreachable checks. This
diagnostic wrapper cannot set F verified even when fast; a complete normal
`make verify-E5-T26f` remains required. No merge, release, Omarchy boot or Epic5
completion is claimed. The fresh critic's independent review lives in
`../inline-context-runtime-verifier/`.

The closed unprofiled review is `browser-results.md` (SHA-256
`1421dc9a5986f8e1553a95f9d70ea0d5ad98593c242a7a1d3483f9b108bd2157`).
It explicitly separates reached functionality from the timing failure and
corrects the over-specific anticipated1440-frame count to the actual4320/2656.

## Separate existing latency sampler

Command: `node evidence/e5-t26f/single-process-observer-657fb5a2/run-latency.mjs`.
This self-hashed driver uses another copied iteration of the same new seal and
the unchanged existing read-only latency sampler. It pins source, actual runtime,
probe imports and observer artifacts before and after; no command/pacing/JIT/
clock/budget override. It refuses an existing output directory.

Child1, outer0; original T0 `1192.7849999666214`, end `4830.579999923706` =
**3637.7949999570847 ms: FAILED**. Raw SHA-256
`8064f99fce17507fded7ee9324fbac420ff5a697b5b6a54b8aefc004745a919a`
at `latency/record/failure-post-restore-interaction-checks.json`.
Last zero-PCM sample3108.2949999570847ms; first sampled fresh PCM at
3156.6549999713898ms (480 non-silent frames), bounded by the50-ms sampling cadence.
The first observed terminal marker is3613.4500000476837ms. The sampler's
collected worker windows show ongoing retirements and no asset-fetch waits;
they do not identify which guest path caused the delay. Sampling itself is
diagnostic, not an unprofiled benchmark or a claimed stable speedup.

Independent `latency-results.md` SHA-256:
`7f24edae3114ec9ae167ad57f13c8084347643b826778ed583478d171139b541`;
its passing `latency-audit-result.json` is
`9c48b7916879fa3f9c79fbc7e974c75ab9de5486e00d49c3b9cceaeda69ea476`.

Runtime correctness for M is independently verified. Neither this pair of
failed runs nor comparisons with different cold snapshots prove how much M
helped. The deadline is unchanged, and another measured/verified step is needed.
