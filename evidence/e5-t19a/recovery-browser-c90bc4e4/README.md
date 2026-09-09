# Repaired sound runtime in Linux/Chromium

This is relevant browser execution for E5-T19a. Both records are explicitly
E5-T26f diagnostics (`acceptance: false`), not a completed F roundtrip or timing proof.
Runtime source `9e8e1c22`, frozen native gate `1be872f2`, and built source/dist WASM
SHA-256 `551206882e7e3ec605dfe04571e53046a81678ebd542fdccafc2c08d8188c229`.

## Cold playback and immutable checkpoint

Command (exit 0):

```sh
E5_T26F_HEADED=1 E5_T26F_REQUIRE_HEAD=c90bc4e466358be1f0a02e5a0ff609eb0e129c6d \
E5_T26F_DIAGNOSTIC=create \
E5_T26F_DIAGNOSTIC_PROFILE=/private/tmp/e5-t19a-recovery-browser.zziUlb \
E5_T26F_DIAGNOSTIC_PORT=61627 \
E5_T26F_OUT=evidence/e5-t19a/recovery-browser-c90bc4e4 \
E5_T26F_IMAGE=target/e5-t26f/desktop-image-aplay-noresize/alpine-rootfs.ext4 \
E5_T26F_IMAGE_INFO=target/e5-t26f/desktop-image-aplay-noresize/desktop-info.json \
E5_T26F_DESKTOP_ASSET_DIR=target/e5-t26f/chunks/desktop-aplay-noresize \
node tools/verify/e5-t26f-browser-roundtrip.mjs
```

The real keyboard path ran the explicit ALSA command and conditional success
marker; producer index advanced 0 → 1440 with 1440 non-silent frames,
maxAbs 0.082000732421875, and the guest output attached. Two terminal windows and
the custom cursor were captured in a paused whole-machine checkpoint. Browser and
HTTP error arrays are empty. `diagnostic-checkpoint.json` SHA-256:
`e909778f7086cd9539fe2439762ea21d8828f0d86992f55eed34b870139287f8`.

The exact served-runtime binding is
`75000f36186a075ede719bdd16f1fb953b36830bd23ff3ea7ac29c64bd97297c`;
image SHA-256 `5530d6585776cf61fcedb98f7a2e75b4293d5f805809e5107cc181fa5dc62550`;
split manifest `b6257e6c0e6789dee28a4f0a7eae1089193fcec545d467d8a70d245226bb9592`.

## Restored fresh playback; F timing still fails

Repeat the command above with REQUIRE_HEAD
`1d3360b3d264aac24aab6fa979e5d0e1fbae9192`, DIAGNOSTIC=`reuse`,
OUT=`evidence/e5-t19a/recovery-restored-1d3360b3`, and
`E5_T26F_DIAGNOSTIC_KEY_DELAY_MS=5`. It used an isolated copy of the sealed profile;
the baseline was never relaunched. All runtime/kernel/image/origin bindings matched.

The actual first restored CRC equals `94da90ee`, and the snapshot digest equals
`5917353c7ce3a38f4ca8a2c197f9d2f09a8563d4d9838d050662fc9e00085641`.
Boot states are fetching → instantiating → restored, with a fresh HELLO and no
guest boot. The cursor matches at 786.255 ms. Physical `sh /tmp/a` produces its
conditional green marker and next prompt; the inspected screenshot has no ALSA
prepare error. The fresh producer again advances 0 → 1440 non-silent frames,
with output attached and AudioContext running. Buttons are released.

The run exits 1 because interaction completes at **3842.595 ms**, beyond F's
unchanged two-second budget (PCM observed at 3838.205 ms). Deferred coherence,
drag, and second reload are not reached or claimed. This failure does not refute
T19a's control-state criteria, but cannot verify F. Canonical retained artifacts
use the `failure-post-restore-interaction-checks` prefix in the sibling
`recovery-restored-1d3360b3` directory; duplicate convenience captures are not staged.

Canonical restored capture SHA-256:

- JSON: `9a83b529652f0bd9d72271d66e3227d9c95e219b1da5508f1dc868671142c04a`.
- Inspected PNG: `f50e85d164e63a0581edf9c705702991634c03e47b99563d4ba89cfae8cf11f3`.
- Server log: `b3693db94edbb7b48d54c4c4836b785a269d1bc49fc144645610bf89aaf0a360`.

No production deployment, PR merge, performance waiver, or Epic 6 work occurred.
