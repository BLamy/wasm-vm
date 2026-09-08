# Fixed sound: real PCM restored, interaction deadline missed

Diagnostic only (`acceptance:false`), not final T26f acceptance. The sealed baseline
was created from `bd2ca26721a21d3ba8be5a58b7347cea40990421`; this isolated copy ran
`28bf565e15fbe457a3beabac2b17c990f300e237`, with identical runtime/image bytes.
WASM: `95d1f68df359850d23b4c1b27a76baae393f89efe2cca99b68c2bfa23251c3e3`.

```sh
E5_T26F_HEADED=1 E5_T26F_REQUIRE_HEAD=28bf565e15fbe457a3beabac2b17c990f300e237 E5_T26F_DIAGNOSTIC=reuse E5_T26F_DIAGNOSTIC_PROFILE=/private/tmp/e5-t26f-fixed-pcm.QrhhBP E5_T26F_DIAGNOSTIC_PORT=61627 E5_T26F_OUT=evidence/e5-t26f/fixed-sound-reuse-28bf565e E5_T26F_IMAGE=target/e5-t26f/desktop-image-aplay-noresize/alpine-rootfs.ext4 E5_T26F_IMAGE_INFO=target/e5-t26f/desktop-image-aplay-noresize/desktop-info.json E5_T26F_DESKTOP_ASSET_DIR=target/e5-t26f/chunks/desktop-aplay-noresize node tools/verify/e5-t26f-browser-roundtrip.mjs
```

Exit 1: the final interaction exceeded two seconds. Snapshot SHA-256
`de7769605e11a4fb6bb7bba7fccce0f611b975a94800c7ae9a0421775b765921`, 2,768,852 bytes,
overlay generation 617. First-present CRC matches `49d5e923`; boot states are only
fetching/instantiating/restored; a fresh generation-2 HELLO completes. The 94-pixel
cursor matches (684,392) at 856.565 ms after the original restore boundary.

The new physical `sh /tmp/a` command produces actual fresh PCM: producer index
0 to 1440, all 1440 inspected frames non-silent, maxAbs 0.082000732421875, attached
guest output and running/unlocked audio. Its completion is observed at 4799.225 ms;
the final interaction observation is 4806.345 ms. There are no held buttons. This
localizes the earlier zero-PCM defect as repaired, but does not satisfy the timing
criterion. Deferred coherence and drag/second-reload phases were not reached.

Retained final failure JSON SHA-256:
`a5cbace82c0ac163ed7a84aa1726f57b75803c37c08b1665f53b770938a5919e`;
inspected PNG SHA-256:
`652e6c4604c28ffa47feda3b1c625e9143329286eae023f0c440b866bda4f68a`.
Both use the `failure-post-restore-interaction-checks` prefix. The screenshot shows
the verbose ALSA hardware report and a real conditional completion marker; the
cost of that verbosity is a hypothesis for the next diagnostic, not a finding.
