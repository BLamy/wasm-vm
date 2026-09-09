# Restore interaction latency localization

Frozen harness head: `2e9d9771477bda265342ac928a25fc6e2d769b25`.
This is a diagnostic iteration, explicitly `acceptance: false`; it does not
verify F, waive the two-second deadline, or replace a final full roundtrip.

## Command

```sh
E5_T26F_HEADED=1 E5_T26F_REQUIRE_HEAD=2e9d9771477bda265342ac928a25fc6e2d769b25 \
E5_T26F_DIAGNOSTIC=reuse E5_T26F_DIAGNOSTIC_LATENCY=1 \
E5_T26F_DIAGNOSTIC_PROFILE=/private/tmp/e5-t19a-recovery-browser.zziUlb \
E5_T26F_DIAGNOSTIC_PORT=61627 E5_T26F_DIAGNOSTIC_KEY_DELAY_MS=5 \
E5_T26F_OUT=evidence/e5-t26f/latency-2e9d9771 \
E5_T26F_IMAGE=target/e5-t26f/desktop-image-aplay-noresize/alpine-rootfs.ext4 \
E5_T26F_IMAGE_INFO=target/e5-t26f/desktop-image-aplay-noresize/desktop-info.json \
E5_T26F_DESKTOP_ASSET_DIR=target/e5-t26f/chunks/desktop-aplay-noresize \
node tools/verify/e5-t26f-browser-roundtrip.mjs
```

Exit 1: `post-restore interaction exceeded 2 seconds`. No command override;
the real keyboard types `sh /tmp/a`. The isolated retained iteration is
`/private/tmp/e5-t19a-recovery-browser.zziUlb/iteration-kb3LPd/profile`.
The sealed baseline was not relaunched or changed.

## Result

The original restore timestamp is 1129.4700000286102 ms on the page's clock.
Matching cursor pixels appear 775.490 ms after it. Producer index stays zero
through 2883.100 ms, then first non-silent PCM is sampled at 2933.050 ms:
1920 newly written/non-silent frames, maxAbs 0.082000732421875. The conditional
successful `aplay` terminal marker appears at 4439.320 ms. At command completion,
the producer has written 3360 frames, including 2400 non-silent frames. Interaction
is observed at 4488.445 ms. The inspected screenshot shows the actual command,
ALSA format message, green success marker, and next shell prompt; no PREPARE error.

The existing marker predicate ran 218 times but spent only 9.245 ms total in
`state()` (maximum 3.665 ms). Fourteen bounded scheduler reads completed in
2.535–42.690 ms. Worker retired instructions increase from 12,489,917 to
57,972,076 over the sampled interval; total slice time increases from 1083.960
to 4604.310 ms. Fetch waits are zero, the quantum is 500,000, maximum slice
50.250 ms, and scheduling uses `scheduler.postTask`. These observations rule out
multi-second marker-read or chunk-fetch cost in this run; they localize the
remaining delay to guest execution/presentation, not a fabricated early success.
They do not yet identify a particular guest routine or prove a performance fix.

The snapshot digest remains
`5917353c7ce3a38f4ca8a2c197f9d2f09a8563d4d9838d050662fc9e00085641`,
with matching first-present CRC `94da90ee`, fresh HELLO, and no cold boot.
The exact served runtime binding remains
`75000f36186a075ede719bdd16f1fb953b36830bd23ff3ea7ac29c64bd97297c`;
image SHA-256 `5530d6585776cf61fcedb98f7a2e75b4293d5f805809e5107cc181fa5dc62550`.
Coherence, drag, and second reload were not reached. No production write occurred.

## Evidence digests

Canonical files use the `failure-post-restore-interaction-checks` prefix:

- JSON: `9ce88d0de2b848077f36fcc3b15bc99dce9ac31f0958f1084f80843e2b0438f0`.
- Inspected PNG: `b91a764e90acadbc082b08d4e07c48d368986796da538b6909a5571e0c3c5d44`.
- Server log: `74e5202bd745d30ae8d7fbc52476212c6c98ecb88b0ac70b96df93442b48fad9`.

`node --test tools/verify/e5-t26f-browser-roundtrip.test.mjs` passed 44 tests;
syntax and scoped diff checks passed. Frozen runner SHA-256:
`1f90c2351c7bb322bc15856ca0dcbbdae961fbf1bb9857ffd001d5aa74683bc3`;
test SHA-256: `562a8ee769e338fafd046edfde2f8a292a8a9656430688fc72dc6dcabcdda78f`.
The make acceptance target now refuses diagnostic modes before any build/browser
command; neither a successful checkpoint creation nor a reuse can report F verified.
