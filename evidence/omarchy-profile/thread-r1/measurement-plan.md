# T03g — isolated renderer-thread configuration

This is a measurement, not a usable-desktop or publication claim. Predictions
and conditions are declared before observing startup or keyboard results.

- Image-preparation tool head: `9432d6a8`.
- Verified source image SHA-256: `2b4143df63085141f7cf017ed2d11c9808bd38dd30925bc86c4a15b4a64cf83c`.
- LP0 candidate SHA-256: `bbd63fcc64bdd21d7348af600276bd2b52f433d7b4d61161006e424e973c2637`.
- Image size: 4,294,967,296 bytes.
- Only changed bytes: offsets 37,498,943 and 41,357,421, ASCII `1` to `0` in
  the two declared `LP_NUM_THREADS` environment assignments. No other bytes
  differ. Read-only pinned debugfs inspection confirms identical ext4 inode
  ownership, mode, timestamps and allocation before/after.
- Native executable: `d5bc0b0f8c807117cee8822fe14d837cb4e39f4884e950cead54105e7ddd8bf6`.
- Target-WASM executable: `c48e9c2d9ec550c7daf4875716fef1dc729072fdfc91b805394d379bee4b9305`.
- Kernel: `af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce`.
- Preparation receipt: `d518fd1f4b4439c9802eec77e2058250f767f0767c3c2dec634ddb0a10209942`.
- Split-chunk manifest: `38e8d3144e2e0be26290763a8fd1a712e93b70fc39f93131d80ed3937cbb09fc`.
- Snapshot base binding: `d8b4cae45af2365434d4542bf0cbb5bce65a0ade8528bb216488275426d828c4`.
- All 16,384 chunks were checked against the full candidate image before startup.

## Planned authoritative run

Cold native capture, using an exclusive disposable working image, unchanged
browser device topology and icount divider 64. Permit at most 5,400,000 ms for
startup. Before creating paired RAM/disk artifacts, require a fresh mapped
Foot, the package-owned Omarchy shell, and the actual compositor PID's unique
llvmpipe / LP0 / software-rendering environment. Preserve negative output;
startup timeout is unproven, not a compatibility conclusion.

Restore that bound pair on the actual built demo. The initial unlogged arm may
classify only `lp0-configuration-observed`, with no active-GL-renderer claim,
when the current PID has the exact environment, no llvmpipe worker, and a blank
GL-label stream. Present GL labels still use the strict parser. The baseline
is T03f's corrected LP1 built run, whose physical input failed at 120 seconds.

The physical nonce must be written only through browser keyboard events into
focused Foot, then read independently over serial. Keep the existing
120-second readback deadline and inspect actual screenshots. A failed run
means the exact configuration did not fix the problem. A success is provisional
until the task's matched fresh GL-labelled arms pass; do not silently attribute
causality or publish a candidate on requested environment values alone.

No production assets, permissions, packages or emulator semantics change in
this diagnostic. No Epic 6 work is authorized by it.

## Recording commands frozen before launch

The commit containing this plan freezes the modified native/built harness and
its thread-setting helper. The capture's accompanying launch record names the
full commit and executable hashes before starting the process.

Native capture launched at `2026-09-10T15:14:20Z` from
`0d3e609629e45021357b0e07f09ab70f9765edf8`; its helper, dependencies and native
executable remain unchanged during execution. Before any built restore, the
browser-only recording additions were frozen at
`91a45c236b07974a9d7c87a0f8fa66f37e6f7e15`. They record all locally served
resource bytes, browser requests, physical DOM keys, unmodified worker serial
traffic (including quiet RPC output), and input acknowledgements. The browser
nonce's lookup filename now uses an independent same-length random identifier;
the nonce content never enters serial input. Exact start/deadline/failure times
come from the existing 120-second readback window. This is instrumentation,
not a changed guest, renderer, input timeout, or production build.

```sh
OMARCHY_IMAGE=target/omarchy-thread-r1/omarchy-profile-lp0.ext4 \
OMARCHY_CHUNKS=target/omarchy-thread-r1/chunked \
OMARCHY_SNAPSHOT_DIR=target/omarchy-thread-r1/pair \
OMARCHY_BOOT_LOG=evidence/omarchy-profile/thread-r1/native-serial.log \
OMARCHY_CAPTURE_TIMEOUT_MS=5400000 \
OMARCHY_KEEP_WORK=1 \
OMARCHY_EXPECT_RENDERER=llvmpipe \
OMARCHY_EXPECT_LP_NUM_THREADS=0 \
bash tools/build-omarchy-snapshot.sh

OMARCHY_CANDIDATE_PAIR_DIR=target/omarchy-thread-r1/pair \
OMARCHY_CANDIDATE_CHUNKS=target/omarchy-thread-r1/chunked \
OMARCHY_EXPECT_RENDERER=llvmpipe \
OMARCHY_EXPECT_LP_NUM_THREADS=0 \
OMARCHY_BROWSER_TIMEOUT_MS=600000 \
node tools/verify/omarchy-desktop-live.mjs local \
  evidence/omarchy-profile/thread-r1/built-input verify
```
