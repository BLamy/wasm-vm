# SDR-R3 native pair receipt

Status as of 2026-09-10 04:08Z: the SDR-R3 chunk manifest and objects have a
successful Cloudflare R2 publish receipt. This is not an interactive
verification record and does not claim that the Omarchy desktop acceptance
criteria passed.

## Frozen source and producer

- Source/tool head: `dd39c73ca79833b7cc88762278992621a8eca8e0`.
- Image build receipt: [`build-receipt-r3.json`](build-receipt-r3.json), SHA-256
  `febe0c338c6468d0782691e1e9af1d3ee4afee63d86433fd2939f0be8f905ba2`.
- Image/chunk integrity record: [`integrity-r3-256k.log`](integrity-r3-256k.log),
  SHA-256 `8020fcd6642383d69bd82af041c882d6d3d7c46b5e9da576ba619cb11b83f39e`.
- Linux image-test log: [`tests-linux-sdr-r3.log`](tests-linux-sdr-r3.log),
  SHA-256 `4a27948d72fbcec7dfa8cab39272c03648c9827e75e0b134e8617709e43691bb`.
- Snapshot producer [`tools/build-omarchy-snapshot.sh`](../../../../tools/build-omarchy-snapshot.sh)
  SHA-256 `ffb586f4385c20a6701aafcd1eda525db8220eec909929f0d916134f45a1d929`.
- Native capture helper [`tools/verify/omarchy-native-capture.mjs`](../../../../tools/verify/omarchy-native-capture.mjs)
  SHA-256 `362d4b57463a7d63775cfa3b03dc64c89cf6ed3a0ba5ecf0e9aac70e0f726890`.

The build receipt records the current builder/configurator/sanitizer/demo-session
digests and `desktopVerified: false`; those are provenance fields, not a GUI
verification result.

## Actual capture binding

The recorded native capture was launched with this explicit candidate binding:

```sh
OMARCHY_IMAGE=target/omarchy-profile-sdr-r3.ext4 \
OMARCHY_CHUNKS=target/omarchy-profile-chunks-sdr-r3-256k \
OMARCHY_SNAPSHOT_DIR=target/omarchy-sdr-r3-snapshot \
OMARCHY_BOOT_LOG=evidence/omarchy-profile/sdr-build-r3/native-desktop-capture.log \
bash tools/build-omarchy-snapshot.sh
```

The producer's complete native argv uses the release CLI, kernel
`releases/kernel/6.6.63/Image`, a temporary APFS clone of the candidate image,
1024 MiB RAM, browser topology, ICount divider 64, JIT, block cache, interrupt
batching, quantum 500000, `plymouth.enable=0`, max instructions 150000000000,
the desktop-ready snapshot trigger, and the manifest-derived snapshot core/base
IDs. The transient APFS clone pathname was not retained in the evidence log; it
is intentionally not reconstructed here. The kernel SHA-256 is
`af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce`.

## Paired artifacts

| Artifact | Path | Size | SHA-256 |
| --- | --- | ---: | --- |
| SDR ext4 image | `target/omarchy-profile-sdr-r3.ext4` | 4,294,967,296 | `2b4143df63085141f7cf017ed2d11c9808bd38dd30925bc86c4a15b4a64cf83c` |
| SDR chunk manifest | `target/omarchy-profile-chunks-sdr-r3-256k/manifest.json` | 1,097,812 | `5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44` |
| Captured RAM | `target/omarchy-sdr-r3-snapshot/omarchy-ready.snap.gz` | 205,050,833 | `2231a21eb8ebc8d3965d1352a3523501faebc87bda31e2c8dc184320219235f5` |
| Overlay delta | `target/omarchy-sdr-r3-snapshot/omarchy-overlay-delta.bin.gz` | 1,209,196 | `1f56d0bd44c945fab3ec1c201d04f39dd3f590320f54c8d2224446ebffb7e7da` |

## Successful SDR-R3 Cloudflare R2 publish receipt

The actual successful publish receipt is
[`sdr-publish-r3-retry/receipt.json`](../sdr-publish-r3-retry/receipt.json).
It records 1,245 newly uploaded objects, 9,290 verified existing objects,
10,535 unique objects total, 16,384 manifest chunks, and the immutable key:

`chunked-omarchy/manifest-5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44.json`

The receipt binds R3 image SHA-256
`2b4143df63085141f7cf017ed2d11c9808bd38dd30925bc86c4a15b4a64cf83c`, manifest
SHA-256 `5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44`,
publisher SHA-256 `49e7b3c7bb64ee6be5bd205ac782caa5364ec85588bc28954a04c5e0bc5d5131`,
and publish source head `15920228047d056bc08c54d036f42282f984df56`. This is an
R2 artifact-publish receipt, not interactive desktop verification or a Pages
production/live-RAM acceptance claim.

## Immediate repaint diagnostic

The immediate zero-guest-run observation is [`sdr-r3-immediate-repaint/report.json`](../sdr-r3-immediate-repaint/report.json), SHA-256
`9f3c550eda6e6fa6ef60665239dcb79b082a23e509ccff93714c42a350198ffc`, with
[`restored-before-execution.png`](../sdr-r3-immediate-repaint/restored-before-execution.png),
SHA-256 `c87dabeec3733a3aac5aebed2d73f7d908eedee864b87c37d2754d3eed32b65b`.
It records `guestRunCalls: 0`, one post-load frame, visible fraction
`0.9614896334134615`, and 413 sampled colors. This is a real repaint observation,
not interactive or desktop acceptance proof.

The native capture log is [`native-desktop-capture.log`](native-desktop-capture.log),
SHA-256 `d525632d1dd551af578dc1bfdbc6082cb501e0b7148a6ad801b6c8fee216cb29`.
The captured native producer binary was `target/release/wasm-vm`, SHA-256
`6462f9624ec44f3f28d99f5eeb28590499e640f0bdf971b7451b7b909faa7c13`.

## Concise diagnostic notes

- The older baseline eventually rendered physically typed `ab` after the A/B
  presses; the retained screenshot is
  [`held-input-after-thirteen-minutes.png`](../input-held-baseline/held-input-after-thirteen-minutes.png),
  SHA-256 `fde9836660aafda6d447dd9baca75d9a42c33df75bbaf17bb9558687703a5c7d`.
  This disproves total keyboard loss but does not establish usable interaction.
- In the SDR candidate diagnostic, the explicit 640 resize observation remained
  black/non-acceptance; see
  [`sdr-explicit-640-result.png`](../sdr-r3-input/sdr-explicit-640-result.png),
  SHA-256 `99c00c7c983f090c49cdca0d9329a8d8f93a080295d22035af9c4ce7659245ce`,
  and [`diagnostic.json`](../sdr-r3-input/diagnostic.json). Its hash is
  intentionally not recorded: this diagnostic log is still growing and is not
  a frozen evidence artifact.
  This note does not claim that the resize result is a complete causal or
  acceptance test.

No growing diagnostic hash set is frozen by this receipt.
