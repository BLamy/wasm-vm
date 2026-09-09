# JIT localization during restored interaction

Frozen harness head `43f4cac1ca87af3645a24d2eed12246e84c6593a`.
Diagnostic only (`acceptance: false`); no runtime changes or timing waiver.

```sh
E5_T26F_HEADED=1 E5_T26F_REQUIRE_HEAD=43f4cac1ca87af3645a24d2eed12246e84c6593a \
E5_T26F_DIAGNOSTIC=reuse E5_T26F_DIAGNOSTIC_LATENCY=1 \
E5_T26F_DIAGNOSTIC_PROFILE=/private/tmp/e5-t19a-recovery-browser.zziUlb \
E5_T26F_DIAGNOSTIC_PORT=61627 E5_T26F_DIAGNOSTIC_KEY_DELAY_MS=5 \
E5_T26F_OUT=evidence/e5-t26f/jit-latency-43f4cac1 \
E5_T26F_IMAGE=target/e5-t26f/desktop-image-aplay-noresize/alpine-rootfs.ext4 \
E5_T26F_IMAGE_INFO=target/e5-t26f/desktop-image-aplay-noresize/desktop-info.json \
E5_T26F_DESKTOP_ASSET_DIR=target/e5-t26f/chunks/desktop-aplay-noresize \
node tools/verify/e5-t26f-browser-roundtrip.mjs
```

Exit 1 at the unchanged two-second interaction assertion. Runtime binding is
unchanged (`75000f36186a075ede719bdd16f1fb953b36830bd23ff3ea7ac29c64bd97297c`),
and the same authenticated checkpoint is copied to
`/private/tmp/e5-t19a-recovery-browser.zziUlb/iteration-QoDHmx/profile`.
The original restore timestamp is `1169.1100000143051` page milliseconds.

Cursor pixels match after 785.945 ms. Fresh PCM appears in
`(3592.700, 3644.315] ms`; the conditional success marker is observed at
4919.430 ms, and interaction at 4937.410 ms. Completion contains 1440 new
producer frames, 960 non-silent, maxAbs 0.082000732421875. The inspected
screenshot shows one underrun (`at least 0.063 ms long`), followed by the
successful marker and shell prompt, not a PREPARE failure. This remains
functional playback evidence, not exact browser sample-count or timing acceptance.

Fifteen completed JIT samples show a real executor and disabled entry-cost
timers (`timingEnabled: false`, `timerReads: 0`). Over their 877.745–4670.990 ms
interval:

- Guest retirement delta: 48,479,407 (12.780 million instructions/second).
- JIT retirement delta: 17,892,685, or 36.908% of guest retirement.
- Host-entry delta: 1,200,375, or 14.906 JIT instructions per entry.
- Cumulative installs: 197 → 696; evictions: 7 → 105; retranslations: 0 → 254.
- State-copy byte counter: 51,330,032 → 261,438,400.

These counters exclude disabled-JIT and expensive entry-profiler timers as the
explanation. They show both interpreted work/retranslation and short compiled
entries; they do not assign host CPU time to either. Sampling adds diagnostic
RPCs and cannot serve as a clean performance A/B comparison or justify a policy
change. Marker-state reads consume only 11.765 ms total (max 3.555 ms).

Canonical prefix: `failure-post-restore-interaction-checks`.

- JSON SHA-256: `376d60bb1cb64cd8102f9f224ac6184be507c2e5214995b3f29ea1db06d28107`.
- Inspected PNG SHA-256: `f94c68314bf7564e593006f471744dc3586c8a7ce06982a5f6800833882258cd`.
- Server-log SHA-256: `08c14d937c67496d67bfcf97767f9f47822637162492fe4982bf3daebd80653c`.

The scoped helper suite passes 49 tests. JIT requests follow scheduler settlement,
retain completed scheduler data if a later JIT read stalls, and cannot mutate
stopped evidence. Default acceptance performs none of these JIT observations.
No production write, merge, Omarchy disk change, or Epic 6 work occurred.
