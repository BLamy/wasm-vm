# Restored playback XRUN diagnostic — not acceptance

Head: `6215c8d97d05e34925b082bfe96b817f1912f4bc`. The sealed checkpoint
created at `bd2ca267` was copied into an isolated diagnostic iteration; the
original profile was not relaunched. This is `acceptance: false` evidence.

Command (exit 1 after the 120-second conditional-marker deadline):

```sh
E5_T26F_HEADED=1 \
E5_T26F_REQUIRE_HEAD=6215c8d97d05e34925b082bfe96b817f1912f4bc \
E5_T26F_DIAGNOSTIC=reuse \
E5_T26F_DIAGNOSTIC_PROFILE=/private/tmp/e5-t26f-fixed-pcm.QrhhBP \
E5_T26F_DIAGNOSTIC_PORT=61627 \
E5_T26F_DIAGNOSTIC_KEY_DELAY_MS=5 \
E5_T26F_OUT=evidence/e5-t26f/paced-original-reuse-6215c8d9 \
E5_T26F_IMAGE=target/e5-t26f/desktop-image-aplay-noresize/alpine-rootfs.ext4 \
E5_T26F_IMAGE_INFO=target/e5-t26f/desktop-image-aplay-noresize/desktop-info.json \
E5_T26F_DESKTOP_ASSET_DIR=target/e5-t26f/chunks/desktop-aplay-noresize \
node tools/verify/e5-t26f-browser-roundtrip.mjs
```

The inspected screenshot shows real `aplay` output (480-frame period, 960-frame
buffer), an XRUN, then `aplay: xrun: prepare error: Invalid argument` and the next
shell prompt without the conditional green success marker. The record has 20
host keyboard frames and 15,426 changed pixels. These host counters alone do not
establish guest delivery; the actual terminal output establishes this command ran.

This capture predates producer-PCM inclusion in timeout diagnostics, so it cannot
establish whether fresh PCM was emitted before the error. No timing success,
coherence audit, drag phase, or second restore is claimed. The tiny 20-ms buffer
may induce an underrun; whether the failed recovery is a device defect requires
an independent native reproduction of the Linux driver sequence.

Retained canonical artifacts and SHA-256:

- JSON: `failure-command-e5t26f-post-aplay-completion.json` —
  `3fbd5708cb584ed78d1296e7b09b300e2f39fc7a68053d7d1c6c2e46a5c06fac`.
- Inspected PNG: `failure-command-e5t26f-post-aplay-completion.png` —
  `6522d686df47dc68c4d5e41caf1794a96d2acb16fe6ff6129402eb1fc1eedd3e`.
- Server log: `failure-command-e5t26f-post-aplay-completion-server.log` —
  `938835d82d376e9dc363204b81eac5b0cfd9d2fb7efd6afa570a40a4351bf7ab`.
