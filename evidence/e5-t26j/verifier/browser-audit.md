# E5-T26j final Chromium evidence audit

Verdict scope: the explicit deterministic divider boundary and honest experiment
only. This audit does not verify E5-T26f, does not claim a speedup or wall-time
correctness, and does not promote divider 1 or change the default of 10.

## Frozen identity and cold seal

- Evidence-only head: `f5696211245d782cfa0341f4c874b1ed14b3a7da`.
- Runtime/test/metadata head exercised by Chromium:
  `054bb87f93b490645d5af921207f97af08629113`.
- Runtime source and built bytes are unchanged from runtime head
  `d2eda6857a2d17d19f8c64b037239a675901f2e6`.
- Browser: headless Chromium `Chrome/152.0.7977.76`.
- Comparison SHA-256:
  `1a58e7dfd6f5e04754d98cc42bde22d15477c32060917f9f8bcb6b9e910e9d35`.
- Full collector transcript SHA-256:
  `483284eceed610b83652b6c12dddde6ebc934fde1e2a15e99465c3d052c2fb05`.
- Cold record SHA-256:
  `fd1c50a92e03d7ed6afcc37917db7b1dc0cd4549c7fbdb3f005c86043272c902`.
- Seal file SHA-256:
  `6e12991a381e10597fbffeef826f98707cfe452515199e354d37909c049ddf41`.
- Retained seal:
  `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26j-clock-q33jA9`.
- Independently recomputed 149-file served-runtime tree:
  `43106f3e04a1c814a3d16994f1328755f8c10999a3ca6bc1818874e8812eb5c7`.
- Kernel: `af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce`.
- 1 GiB image: `5530d6585776cf61fcedb98f7a2e75b4293d5f805809e5107cc181fa5dc62550`.
- Chunk manifest: `b6257e6c0e6789dee28a4f0a7eae1089193fcec545d467d8a70d245226bb9592`.
- Decoded paused snapshot: 2,626,928 bytes,
  `82edb9b2f0203a5fa756d565dbbfc3fd7466544952e9b8a9ccca036f0212248a`,
  first-present CRC `23f83a92`, overlay generation 626.
- Independently recomputed sealed profile tree:
  `901b20969f43feec5232e698403d4898235a18130fdcb9558b616bdaea2736da`.

The cold record is diagnostic-only, uses create mode with no divider override,
passes its frozen-pause publication audit, records empty browser/HTTP errors, and
proves 454 physical setup transitions plus 1,440 fresh non-silent PCM frames at
maximum amplitude `0.082000732421875`. Four distinct iteration directories were
then copied from this seal. Their post-run tree digests are all different, as
expected after independent Chromium mutation; the collector authenticated each
copy against the sealed digest before launch.

## Four raw arms

| Arm | Divider | Interaction ms | Guest retired | JIT retired | mtime delta | Non-silent PCM | Raw JSON SHA-256 | Run-log SHA-256 | Screenshot SHA-256 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| 1 | 10 | 5168.225 | 59,471,941 | 21,859,366 | 5,947,178 | 1,920 | `e86906ccf47a93f8a98421e81ff8a9de071afb90d97b19d092d9d39575f9ec56` | `76dcf19ad49cee51d999fae7dd85475ff6e086d0a45ab221f2607c79ea0202ea` | `6fab03abcb63e07cf95e4f32c5a66fe4e05388c373f1c7789100b2e19c33216e` |
| 2 | 1 | 9530.715 | 99,054,144 | 25,750,829 | 99,054,002 | 960 | `5d4f58afa387f10723646d126a04dc257942f2c5ccbe17bd884264afa8fbbbed` | `174af6e922c73f23b655752643d3025e384030a37588d4e05dd4253524d6a0fe` | `edfc96c61e8e1bed637b97c935651acf6735a07e963e16b0bc1d871f2e46fd52` |
| 3 | 1 | 9371.235 | 98,021,519 | 26,678,453 | 98,021,394 | 1,920 | `15368821738020352da5d5382d38ee5ac60473ede63245f602d16f39ef18f02c` | `19b740c0968075ef36541bb2fed600ad9a7b23da27843079c3f5bb493f94c1e9` | `39c828614453ad2b6e91e49d333e52ad87955b1dc3318a01ee687e0864af7dd3` |
| 4 | 10 | 5098.315 | 58,972,558 | 22,913,894 | 5,897,239 | 2,880 | `ecd6349747cf0e349fc32e7caf53bcfc02e1224699b99850d4758d4b0fa2dc0e` | `01b71f6f94163c62a2ce8e89a56716c565de9004a8adf7f4a366eca1d713321c` | `dfb68f6982a84475ca4e8eebd9c8413a60a6d63f876199d31911817bc059d8af` |

Every raw record has exact head/runtime/kernel/image/manifest/origin/snapshot/profile
bindings; restores CRC `23f83a92` without a `booting` state; begins from the same
stored divider-10 receipt and preserves its `mtime` while selecting 10/1/1/10;
keeps a real executor, repack-off cap 24, region and dynamic chaining, and disabled
entry timing with zero timer reads; and records positive total/JIT retirement plus
an increasing active-divider `mtime`. The receipt is byte-identical before/after
each interaction. The before observation is inside the original restore interval;
the after observation follows its frozen end.

Every arm physically delivers exactly 20 matching keyboard and DOM events for
`sh /tmp/a`, renders the green conditional marker with no red marker, maps and
renders the cursor, releases all buttons, attaches guest output, advances rendered
audio, and records fresh non-silent PCM at maximum amplitude
`0.082000732421875`. Browser/HTTP error arrays are empty. The four canonical
screenshots were visually inspected: each shows the restored two-window desktop,
successful `aplay` marker, and shell prompt. Failure/post-restore PNG copies are
byte-identical within each arm.

All four child exits are 1 for exactly
`ERR_ASSERTION: post-restore interaction exceeded 2 seconds` at the unchanged cap.
There is no other admitted failure. Divider-10 mean is 5,133.270 ms; divider-1
mean is 9,450.975 ms, 4,317.705 ms or 84.112% slower in this bounded local ABBA.
This is a clear negative result for the timer-rate hypothesis, not an F pass.
