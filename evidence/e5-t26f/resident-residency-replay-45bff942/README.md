# Resident residency ABBA — local diagnostic, all four timing caps failed

Actual browser source head: **`45bff9424b15585022bc5d2c1bfd104daea395c5`**.
This is not the later collector's Git head and is not F acceptance or verification.
The coordinator ran the proper runner directly; afterward, the actual extracted
`collectResidencyRecord` / `assertSameBindings` functions validated the four closed
records offline. The collector's top-level orchestrator was **not imported or
spawned**, and offline validation did not rerun a browser. Its exact source SHA is
pinned in [comparison.json](comparison.json).

## Recorded invocation and initial negative attempt

The [outer log](../resident-residency-replay-45bff942.log) records the command
`node tools/verify/e5-t26f-browser-roundtrip.mjs`, with this common configuration:

```text
E5_T26F_REQUIRE_HEAD=45bff9424b15585022bc5d2c1bfd104daea395c5
E5_T26F_FIXTURE=resident-aplay-v1
E5_T26F_DIAGNOSTIC=reuse
E5_T26F_DIAGNOSTIC_JIT=1
E5_T26F_DIAGNOSTIC_PROFILE=/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26f-resident-FUBCo4
E5_T26F_DIAGNOSTIC_PORT=61631
E5_T26F_IMAGE=target/e5-t26f/resident-image-2ae65408-a/alpine-rootfs.ext4
E5_T26F_IMAGE_INFO=target/e5-t26f/resident-image-2ae65408-a/desktop-info.json
E5_T26F_DESKTOP_ASSET_DIR=target/e5-t26f/chunks/resident-2ae65408
E5_T26F_TIMEOUT_MS=1200000
```

Each arm adds `E5_T26F_DIAGNOSTIC_RESIDENCY` from the table and `E5_T26F_OUT` equal
to `evidence/e5-t26f/resident-residency-replay-45bff942/` plus its arm directory.
`E5_T26F_HEADED` was **omitted**, preserving headless mode. No command, key-delay,
clock, divider, CPU/profile, or COMPLETE override was selected. The process timeout
above does not change the original **2000-ms interaction cap**.

The [earlier headed attempt log](../resident-residency-45bff942.log) remains negative
evidence. Its [launch-failure JSON](../resident-residency-45bff942/1-repack-off/failure-browser-launch.json)
records `checkpoint browser differs`: actual `headless:false`, required `true`,
before restore; it is **not a completed performance arm**. The collector fix now
sets resident `HEADED=0` and preserves legacy `HEADED=1`; its targeted 18-test run
passed, including inherited-environment guards. The four replay arms above used
the direct runner, not that collector fix.

## Closed results

Times are original `postRestoreEnd - postRestoreStart`, rounded to six decimals
in seconds. Counts are within-arm JIT endpoint deltas; JIT share is delta
`retiredViaJit / guestRetired`, not the difference of cumulative ratios.

| Arm directory | Policy | Seconds | JIT share | Retranslations / evictions | Block builds |
| --- | --- | ---: | ---: | ---: | ---: |
| [1-repack-off](1-repack-off/failure-post-restore-interaction-checks.json) | repack-off (24) | 4.585095 | 38.9418% | 297 / 98 | 764,797 |
| [2-cap-256](2-cap-256/failure-post-restore-interaction-checks.json) | cap-256 | 4.028975 | 62.0922% | 0 / 0 | 701,018 |
| [3-cap-256](3-cap-256/failure-post-restore-interaction-checks.json) | cap-256 | 4.013550 | 61.1938% | 0 / 0 | 670,993 |
| [4-repack-off](4-repack-off/failure-post-restore-interaction-checks.json) | repack-off (24) | 4.745285 | 39.5501% | 275 / 105 | 807,475 |

All four exited **1** with the exact final cap AssertionError. Each retained actual
`play`, 5-ms physical key edges, ten matching keyboard transitions, accepted fresh
green output, 1440 non-silent PCM frames, and restored CRC `940993e9` without a
booting state. Executor/policy/cap matched before and after. Runtime/image/fixture,
closed-profile and snapshot bindings stayed identical across all four arms.

Local two-observation means: **4.665190 s** repack-off versus **4.0212625 s** cap-256,
a **0.6439275-s (13.8028%)** reduction in this ABBA only. Cap-256 had zero measured
retranslation/eviction deltas and higher JIT retirement share, but still about
671–701k decoded builds. All arms had zero decoded flush/discard deltas: no recorded
bulk invalidation in these intervals, not proof against capacity/conflict churn.
Cap-256 ended at 9,350,020 / 9,012,014 code bytes versus repack-off's
1,764,059 / 1,577,823; this is a measured memory tradeoff, not a default promotion.

No generalized speedup, warmup trajectory, per-PC membership, or F success follows.
Endpoint RPC windows are not exactly T0→end. `entryCost.timingEnabled=false` at both
ends of every arm; zero reported compile-time deltas **do not prove free compilation
or the 5-ms compile-pause target**. Clock overrides were absent; no new clock receipt
was sampled or invented.

## SHA-256 pins

Hashes below were recomputed from the retained files. `J`, `P`, and `L` mean each
arm's `failure-post-restore-interaction-checks.json`, `.png`, and `-server.log`.
Full runtime/kernel/image/helper/profile/snapshot bindings remain in comparison.json.

```text
comparison.json
f8e71c6d4a548a77b19c854398c41eac9164d539c885e9c29b183198d8e9f519
../resident-residency-replay-45bff942.log
a7a4d75b2d53f51739e7953a48103b4a65b88288ad8cd08ccca3a4b18fc1051e
../resident-residency-45bff942.log (negative headed attempt)
6f6d7ede9e5313194b0e347ef5f293ecfb985af513ca7f778fccaa68480a59d8
negative failure-browser-launch.json
3470a1ae849e6b295cc7fbf14393b373127e6fa91dd1a47ce70e86619e64fcd8
1 J aefed12c99faf67bac54615854a02c339bfca047abc912c5b7c1df948c15ef23
2 J 9c3cfdace8357103ab5cd8c9f19c3fd515f927bd4facc604563fa1f0ea2cf3f1
3 J c4efd8cdf12f9618f7ccaa0ff4e0a82d44dd2a1237ebadc6918952042606aa59
4 J 716598b5a5138920f5d7b080ca70a8ac557c01bc6f3d787d40e8e3fe05236b4b
1/2/4 P d4537508f5cb7f9be48b0819bf90eea066d5bf4a699d670fcdf004554cec8bd6
3 P c9f31831f20fca65a12f4ab54eea76b19caa547d62c2d20fb086aff163703c27
1 L 5861236ecf76356d62da83cbbb99233cde5cecd3dcbeb000af8969cc789ff6e0
2 L 74474b387a0c9d88f809b1294071c01a53e022d8fba20826034058b7da81afdb
3 L 89a25975a400504d0ea982f038c624ced9ee33f2c7a267c114d1ad99ff8b229c
4 L bd23c2ed725abfca262c9b5df297ec5892ff95bdd3138502261951d28febe2bd
offline collector source
bfb6a63ff1450afbbd94fff579ed570d30495ad64dc55a3beece1f2f534ed610
collector tests (18 passed; no rerun for this README)
2f5b667b38f9bb58e377e43703d71dd130b4dc785e1fce477e3a97624146bba4
proper-runner source (outer-log binding)
7001fe7f4320e9b996b5b9537fb7276e0527f751ecfc9d531bab77dd49e8c309
resident admission source (outer-log binding)
452b861012761eb112e39097a05eff44cadcfabbcc89ac789f1e7c373cd4c4da
```
