# Resident guest-profile localization and quiet-probe limits

These are diagnostic/scratch captures reported at head `3174e1c5013cb551f88ccd258ffb9c2e596139ea`, uncommitted when inspected. They are not an exact clean-head acceptance submission or an F pass. Raw captures are preserved; this note extracts named scalars only. In particular, quiet A/B JSON embeds a roughly 2.8 MB snapshot as a roughly 70 MB object and was not dumped.

Git retains lossless `.json.gz` versions of those two oversized JSON records;
the original expanded files remain locally unchanged. Use `gzip -dc` to read or
authenticate the original bytes. Exact A/B/C driver copies and archive hashes
are recorded in [the source archive](resident-scratch-sources/README.md).

## Shared provenance

The records bind runtime `42aced7a2dfc4d0a69e1ea5a15685f5d9a605f797f8df1c5db89f95051ba0425`, kernel `af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce`, and 1,073,741,824-byte image `27c2e8f2789b18efac214837c295dbfb22559beea350fb5788f71edfdc0f0a8e`. Chunk-manifest SHA256 is `2245a4d8b8b804bb200079c1ce00dee868762324f18627fa5d2b11fe032639ef`.

The `resident-aplay-v1` fixture installs `/usr/libexec/wasm-vm/e5t26f-resident.sh`, helper SHA256 `2ae65408985f18be8b1287521bad23803282d652bb8f98421a135a351dac213c`, over base image `5530d6585776cf61fcedb98f7a2e75b4293d5f805809e5107cc181fa5dc62550`. Checkpoint creator is `7da050620031145b6e76cf150a894ed2710bd5b2`; sealed-profile digest is `59f3f2483c95331fad64c5cf6014a60f42b3b9fb89a50ec7b2d1c8853d9c70b5`.

The log headers retain these common settings (output directory varies by capture):

```sh
E5_T26F_REQUIRE_HEAD=3174e1c5013cb551f88ccd258ffb9c2e596139ea
E5_T26F_FIXTURE=resident-aplay-v1
E5_T26F_DIAGNOSTIC=reuse
E5_T26F_DIAGNOSTIC_PROFILE=/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26f-resident-FUBCo4
E5_T26F_DIAGNOSTIC_PORT=61631
E5_T26F_IMAGE=target/e5-t26f/resident-image-2ae65408-a/alpine-rootfs.ext4
E5_T26F_IMAGE_INFO=target/e5-t26f/resident-image-2ae65408-a/desktop-info.json
E5_T26F_DESKTOP_ASSET_DIR=target/e5-t26f/chunks/resident-2ae65408
E5_T26F_TIMEOUT_MS=1200000
E5_T26F_OUT=evidence/e5-t26f/<capture-name>
```

These are provenance settings, not an instruction to reuse an existing output directory. Scratch script digests below distinguish the quiet revisions; head alone does not bind their uncommitted source.

## Map lookup: observed mapping, not unique profiler ownership

The [map record](resident-map-3174e1c5/command-e5t26f-post-aplay.json), [PNG](resident-map-3174e1c5/command-e5t26f-post-aplay.png), and [transcript](resident-map-3174e1c5.log) record `node tools/verify/e5-t26f-browser-roundtrip.mjs` with `E5_T26F_DIAGNOSTIC_COMMAND='grep -Hs 7fff9b /proc/[0-9]*/maps;play'`. The PNG exposes:

```text
/proc/962/maps:7fff9b1bc000-7fff9b250000 r-xp 00000000 fe:00 486 /lib/ld-musl-riscv64.so.1
```

Other visible PID 962 mappings include Weston/Wayland libraries. That is consistent with a compositor-related address space, but the command did not print PID 962's executable identity. More importantly, the earlier histogram has no PID, ASID, or SATP: a matching virtual address is not proof that this process uniquely owned those samples.

Restore completed at the original T0 `1112.9250000715256` ms, with CRC `940993e9` matching the saved snapshot (`b2e057ccf0150eb892ed4ae53c0642e5757d8d52293306776d52dd4bf94b86b9`, generation 626). The command-completion wait timed out after 120,000 ms. The screenshot shows the resident post observation, green `e5t26f-aplay`, job completion and a shell prompt, but the retained marker predicate is false: baseline green pixels 369 versus final 348, despite visual difference 53,542. This is evidence of a scrolling-sensitive observation limitation, not a measured successful finish. `postRestoreEnd` and `postRestoreAplay` are absent.

At failure, audio was unlocked/running, ring write/read indices were both 1440, and 1440 inspected frames were non-silent (maximum absolute sample 0.999969482421875). The generic `writtenFrames`/`inspectedFrames` value 4096 is an unbased ring-scan window, not evidence that 4096 fresh frames were produced. No exact completion latency or zero-XRUN claim follows from this capture.

## Candidate ELF offsets and exact symbol limits

The retained extraction is `target/e5-t26f/guest-symbols.LIWp5R/ld-musl-riscv64.so.1`, SHA256 `ba4e8d99383bfd3748ed571f1676577c8abaa9b0e386864afa5bf9c88fd51129`. Its ELF code LOAD segment has file offset and virtual address zero, size `0x936c4`; the retained disassembly identifies GNU objdump 2.40. This note checks the retained ELF/symbol artifacts, not an independent re-extraction from the image.

For this candidate mapping, `ELF offset = virtual region base - 0x7fff9b1bc000 + 0`. Each histogram bucket spans 64 bytes, with the following exclusive-end bounds:

| Virtual region base | Candidate ELF window | Cumulative interpreted samples | Supported localization |
| --- | --- | ---: | --- |
| `0x7fff9b209c80` | `[0x4dc80, 0x4dcc0)` | 610 | Entirely within exported `memcpy`; start is `memcpy + 0x4a`. |
| `0x7fff9b209cc0` | `[0x4dcc0, 0x4dd00)` | 1671 | Entirely within exported `memcpy`; start is `memcpy + 0x8a`. |
| `0x7fff9b203a00` | `[0x47a00, 0x47a40)` | 407 | Straddles the end of exported `fwprintf`; cannot assign the whole bucket to it. |
| `0x7fff9b2061c0` | `[0x4a1c0, 0x4a200)` | 396 | Outside exported `vdprintf`; no overlapping exported `DF .text` symbol found. |

`musl-symbols.txt` line 825 bounds `memcpy` at `[0x4dc36, 0x4dfd6)` (size `0x3a0`). `memcpy-hot.txt` contains the copy load/store loop at `0x4dcb6..0x4dcd6`; region boundaries are not necessarily instruction boundaries, call sites, or caller identities.

`fwprintf` is `[0x479ee, 0x47a10)` (size `0x22`, symbols line 1574): only the first `0x10` bytes of the `0x47a00` bucket are inside it, and the next `0x30` are outside. `vdprintf` is `[0x49176, 0x491bc)` (size `0x46`, symbols line 1446); `0x4a1c0 - 0x49176 = 0x104a`, or `0x1004` beyond its exclusive end. Objdump labels such as `<fwprintf+0x22>` or `<vdprintf+0x...>` use a nearby symbol and do not establish function containment. Neither formatting bucket proves a printing call site or cause.

The [prior raw histogram](resident-guest-profile-2934524b/failure-post-restore-interaction-checks.json) and [Daybreak scope note](resident-verifier/guest-profile-results.md) concern virtual guest PCs, sampled approximately once per 1024 **interpreted** retires; JIT-retired PCs are absent. The top ten regions are cumulative, not interval deltas. These four after-buckets total 3084/36323 samples (about 8.49% of cumulative interpreted samples), not 8.49% of host time or all guest execution. They are absent from the before top ten, which does not establish zero prior counts. The profiler has collisions/weak-slot eviction and no process tag. Its activation also enables existing JIT entry timing. Thus this localization provides candidate memory-copy/nearby-code leads, not unique ownership, whole-guest coverage, host-time dominance, or a demonstrated printing bottleneck.

## Quiet probes, chronologically

All three use `node tools/verify/e5-t26f-quiet-probe-scratch.mjs` and physically install this RAM-only function replacement before saving their separate scratch snapshot:

```sh
e5_print_observation(){ :; };printf '\033[42mquiet-probe-ready\033[0m\n'
```

That changes the observation function in guest RAM; it is not the unchanged installed helper or an acceptance run. Each preparation recorded 160 matching physical keyboard/DOM transitions, its green preparation marker, and visual difference 3241. The timed command, where reached, remained physical `play`.

- **A — [record](resident-quiet-probe-3174e1c5/failure-command-quiet-probe-ready-completion.json), [transcript](resident-quiet-probe-3174e1c5.log):** scratch script SHA256 `15ab6fa29d5fe36fd93d50e484d0fefeab717c7c80c48089dc6911623584d1b6`. The paused 2,844,850-byte snapshot had CRC `ece56c3b`, generation 626, SHA256 `785b6794caebc5507eafa9c7bd48501406fe90b419f4e15ca6e9f8bc41294204`. `auditFrozenSnapshot` refused `unknown frozen checkpoint kind`. There is no normal restore, post-restore T0/end, or timed `play` result. Zero PCM at that point is not an audio failure: timed playback was never reached.
- **B — [record](resident-quiet-probe-b-3174e1c5/failure-restore-normal-display-checks.json), [transcript](resident-quiet-probe-b-3174e1c5.log):** scratch script SHA256 `da724a0892afeffab991e3abedda574985a13cb2a45f7351baaa9cbbe2378f98`. The paused/frozen audit passed for generation 626, snapshot SHA256 `f5cad8a4d0b2e97c7a258e7dc75eaa7b16a0f3dd504052cae07afd991bf68956`, 2,844,850 bytes. Restore completed at `1024.6999999284744` ms, but actual first-frame CRC **`9af7787c` differed from saved `ece56c3b`**. It failed before timed `play`; post-restore interaction start/end/completion fields are absent. This cannot compare quiet/default latency or establish an audio failure.
- **C — [record](resident-quiet-probe-c-3174e1c5/failure-command-e5t26f-post-aplay-completion.json), [PNG](resident-quiet-probe-c-3174e1c5/failure-command-e5t26f-post-aplay-completion.png), [transcript](resident-quiet-probe-c-3174e1c5.log):** scratch script SHA256 `7b827daaf0815570bedbcf9af5683e56899c15d1c2b8d56b9d962fb076b5149f`. Preparation included a physical cursor acknowledgement at guest `(720,430)` and a 2000 ms **setup** settle before snapshot/reload. Snapshot SHA256 `1c57ab093c4da6d4f6270d8e05e7fdefa9f501cff7c0c531391532108b0b8994`, 2,847,892 bytes, generation 626 passed the frozen audit; restored CRC **`a74f4503` matched**. Original restore T0 was `1027.4650000333786` ms. Audio remained locked/suspended with zero PCM through the delayed pre-gesture observations. The timed cursor acknowledgement was observed at `1808.2099999189377` ms (780.7449998855591 ms from T0).

  C delivered `play` with **10 matching physical keyboard/DOM transitions**, terminal marker true, red marker false, and green pixels 528 → 636. However, `finishCommand` returned **`accepted:false`** and threw because visual difference **1154 was below the unchanged 2000-pixel functional threshold**. The generic error text says `ls command was not visibly rendered`, but its attached command is `play`. The PNG shows the green completion marker; failure audio is unlocked/running with fresh write/read indices 1440, 1440 non-silent frames and maximum absolute sample 0.999969482421875. These observations do not override the failing functional assertion. `postRestoreEnd` and `postRestoreAplay` were never recorded: failure occurred before the final two-second cap assertion. The setup settle was not added to or substituted for the original timed budget. C is neither a two-second pass nor definitive evidence that printing caused earlier latency.

No quiet probe provides an accepted, bounded quiet-versus-default comparison. No new verifier verdict is claimed, and no raw artifact, runtime, helper, clock, or threshold was changed by this analysis.

## Artifact SHA256 inventory

Paths in the first block are relative to `evidence/e5-t26f/`; duplicate capture files are listed explicitly. All hashes below were read from the retained files.

```text
8f7fe9247fb3b694f30d8a33fe3f9093f9f45e4d0d886bafa2eff19c5decf7f2  resident-map-3174e1c5/command-e5t26f-post-aplay-server.log
d896392275361bcf4a7d8fca2637ad053793de592d50432b1d08a3d9be5dc3ee  resident-map-3174e1c5/command-e5t26f-post-aplay.json
b0d7173c9d6cd8331529b2ff6df09ba4a79945c96d843dc212221e6c3b9919c6  resident-map-3174e1c5/command-e5t26f-post-aplay.png
8f7fe9247fb3b694f30d8a33fe3f9093f9f45e4d0d886bafa2eff19c5decf7f2  resident-map-3174e1c5/failure-command-e5t26f-post-aplay-completion-server.log
3c4f7a6244675cf0c92e0a97232f0f6cc397f95c3cd4d2b7b7a2b154edbed7ae  resident-map-3174e1c5/failure-command-e5t26f-post-aplay-completion.json
b0d7173c9d6cd8331529b2ff6df09ba4a79945c96d843dc212221e6c3b9919c6  resident-map-3174e1c5/failure-command-e5t26f-post-aplay-completion.png
e12ee9227ebcff66c3f14a9ca890a98c447b94e778a7c99f7b86c79b548b4c7c  resident-map-3174e1c5.log
ee09e2d63d41c7172a70a6fafec42c7b7cd4554c48f48f11d4f1020d0681d5f0  resident-quiet-probe-3174e1c5/failure-command-quiet-probe-ready-completion-server.log
1a45eb3abce834aacc05c15e84e833460480aed2cd9e33e1a0f614e35b109635  resident-quiet-probe-3174e1c5/failure-command-quiet-probe-ready-completion.json
068fb436b7d8233234f20b57db5f52827ca1905f50ceb01481c0274693d9bb30  resident-quiet-probe-3174e1c5/failure-command-quiet-probe-ready-completion.png
6ccc3dbe479d9740680510ad7edb97d1e3f0a4207e5fc9e567fe5aae96de9bc3  resident-quiet-probe-3174e1c5.log
0379f611cb95475eb7d38ea27ebb7cdfc88b5e7d15d1291ce38010479ddfd568  resident-quiet-probe-b-3174e1c5/failure-restore-normal-display-checks-server.log
a4de6a1e3746c08008fa8c9e110cad999f3313d850f4f02c5c1d6f8df3b2f8d9  resident-quiet-probe-b-3174e1c5/failure-restore-normal-display-checks.json
833fc03d2d5a4f1eddb14356573ba4e607e88656bba8c412d438ea646394dcdf  resident-quiet-probe-b-3174e1c5/failure-restore-normal-display-checks.png
068fb436b7d8233234f20b57db5f52827ca1905f50ceb01481c0274693d9bb30  resident-quiet-probe-b-3174e1c5/quiet-prepared.png
cc5182551d499d5ce4a40c80adc5d8d74c0022c8ed913153122fecd960584dde  resident-quiet-probe-b-3174e1c5.log
8bf5dde4a91373fb28fb40199d61fa90ef247933c9c213823bdcaaf8b1b7e867  resident-quiet-probe-c-3174e1c5/failure-command-e5t26f-post-aplay-completion-server.log
211126675b9ad83a5c333f22e43cfd3ec6d87c67c0d366e9aa9f75db0610d6c4  resident-quiet-probe-c-3174e1c5/failure-command-e5t26f-post-aplay-completion.json
39321a88e7a89ab5dc921d182b2089edf3f5f44dc0b7e280794440ca7c342a69  resident-quiet-probe-c-3174e1c5/failure-command-e5t26f-post-aplay-completion.png
753b2c1f04353e87872bc2f660c70b5828658d1a9c4d2ccbde1d0484c8ed58b1  resident-quiet-probe-c-3174e1c5/quiet-prepared.png
b649b01eec073a38cc5eed6501902ece4ba7deb573fedc8934ed3099aa5df55b  resident-quiet-probe-c-3174e1c5.log
```

Symbol extraction files, relative to `target/e5-t26f/guest-symbols.LIWp5R/`:

```text
ba4e8d99383bfd3748ed571f1676577c8abaa9b0e386864afa5bf9c88fd51129  ld-musl-riscv64.so.1
410ecbc211020e6bd990e08d48211d17c98d57fc97f6a55f1a26bda9055cf67e  musl-symbols.txt
39bf6298e3a5fd6fd0156a68962fad2d2bbb03ca6802c8568d4e94a8e07b6794  program-headers.txt
caa59900c4c53285be86e9c92691285c5f3eef63231d26548746285183b9d4a1  memcpy-hot.txt
c5e9a377cc818502b24e6c58eabfb4f4c68b964bd759d63c6355faf5f4c42c09  format-hot-1.txt
38f3ae3a20b952a0f13fce556ae733affc42094cefa88b56f847023c3812919b  format-hot-2.txt
144f46ac26321a6f7770208a7470083a27ad9b8c446b697a1dbd63d76233e116  tool-version.txt
```
