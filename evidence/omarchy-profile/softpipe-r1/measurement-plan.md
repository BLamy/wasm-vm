# T03f — isolated fresh-login measurement

This is a diagnostic submission, not a usable-desktop or release claim.

## Frozen preparation and native capture

- Tool commit: `18603922`.
- Native CLI SHA-256: `d5bc0b0f8c807117cee8822fe14d837cb4e39f4884e950cead54105e7ddd8bf6`.
- Built browser Wasm SHA-256: `c48e9c2d9ec550c7daf4875716fef1dc729072fdfc91b805394d379bee4b9305`.
- Original 4 GiB image: `2b4143df63085141f7cf017ed2d11c9808bd38dd30925bc86c4a15b4a64cf83c`.
- Candidate image: `c8b59adc0f26e10a3de6f7dbeea8f0e4f1445087e47fbc6f6cc449869e43e6d5`.
- Candidate receipt: `bc2dcd38cae820501d039ae2f6a2e28c2acacf1ff2734a6b9bc79fdee8eeb419`.
- Chunk manifest: `a1fcff5b192b316a10d48c41397974ab4f561ea57caaf95e4f406b3d54b867eb`.
- Canonical chunk-base identity: `48c4943825af88e5924a6ab167c119a6dce693047cdbfbd5377a18fbff351b25`.

Preparation completed with full-image comparison: only byte ranges
`[37498919,37498923)` and `[41357397,41357401)` differ, each `llvm` to `soft`.
All other bytes, including inode ownership and permission metadata, are unchanged.

```sh
node tools/verify/omarchy-softpipe-candidate.mjs prepare --out target/omarchy-softpipe-r1
python3 tools/chunk_image.py split target/omarchy-softpipe-r1/omarchy-profile-softpipe.ext4 --out target/omarchy-softpipe-r1/chunked --chunk-size 262144 --layout split
python3 tools/chunk_image.py verify target/omarchy-softpipe-r1/chunked/manifest.json --image target/omarchy-softpipe-r1/omarchy-profile-softpipe.ext4
OMARCHY_IMAGE=target/omarchy-softpipe-r1/omarchy-profile-softpipe.ext4 \
OMARCHY_CHUNKS=target/omarchy-softpipe-r1/chunked \
OMARCHY_SNAPSHOT_DIR=target/omarchy-softpipe-r1/pair \
OMARCHY_BOOT_LOG=evidence/omarchy-profile/softpipe-r1/native-serial.log \
OMARCHY_CAPTURE_TIMEOUT_MS=1200000 OMARCHY_KEEP_WORK=1 OMARCHY_EXPECT_RENDERER=softpipe \
bash tools/build-omarchy-snapshot.sh
```

The native run started at approximately 13:04:47 UTC on 2026-09-10. The
20-minute outer boot deadline is not a physical-input acceptance timeout.
The working copy is uniquely allocated by `mktemp`; retained copies are
diagnostic evidence only and will never be reused as an input to another arm.

## Predictions recorded before the renderer/input result

1. A valid softpipe arm must show a fresh graphical login, mapped Foot and the
   package-owned shell, an actual compositor environment requesting softpipe,
   no llvmpipe worker, and a successful nonempty GL renderer log identifying
   softpipe. Requested environment alone is insufficient.
2. Missing/ambiguous renderer evidence means **unproven**, not a renderer
   compatibility failure. A concrete renderer initialization failure can support
   only a compatibility result, never an input-performance result.
3. If launch and renderer identity pass, restore the bound pair in the actual
   built browser. Physical browser keyboard events must be the only writer of a
   fresh random nonce file; serial may only read it back. Preserve the existing
   120-second input deadline, screenshots, and failure evidence.
4. A comparative performance claim requires a baseline arm under the same final
   input harness. Existing baseline failures establish the current problem, not
   a measured speedup for this candidate.
5. No production files, permissions, release pins, or guest packages change in
   this measurement. A fresh critic owns the final verification decision.

## Baseline observability correction (before the repeated input test)

The first actual built baseline at `8f2051b0` stopped **before physical input**:
the current PID environment requested llvmpipe and its thread list contained
`llvmpipe-0`, but the expected GL labels were absent. This is an evidence gap,
not a new product failure or an input timing result. `baseline-built/report.json`
retains the original failure and those PID-bound environment/thread records.

The independent, read-only `renderer-label-inspection/diagnostic.json` records
the same restored artifact's current PID/instance, bounded unfiltered instance
log, system information, journal queries, and
`hyprctl -i 0 getoption debug:disable_logs` returning `bool: true` (default).
Neither file, journal nor rolling log contains the startup GL labels. The
renderer parser's spelling was correct; those DEBUG records were disabled.
The actual `renderer-desktop.png` was inspected: it contains the Hyprland bar
and mapped Foot, without the startup overlay. It does not prove usable input.

Before repeating the baseline input test, the fresh critic accepted a precisely
weaker baseline observation: **llvmpipe-worker-observed; GL label unavailable**.
Only the current compositor PID's literal driver-specific worker name can
support it; requested environment alone cannot. Present contradictory or
ambiguous GL labels remain failures. This fallback is forbidden for softpipe.
Both comparison arms still use the same input harness and 120-second deadline.

The baseline also logs the Aquamarine renderer-state errors seen in the QEMU
precheck, despite having a live compositor and desktop. Those errors alone
cannot establish a candidate compatibility failure. The fresh target-WASM run
must provide a causally linked terminal failure, or remain unproven.

## Corrected baseline physical-input result

`baseline-built-r2/report.json` binds the actual built demo and unchanged R3
pair at harness head `461ec122`. SHA-256:
`88496d6e239c36348e72d3c62a41c66b342071c3a4c08c81a8586de69e63ccc7`.
The PID-bound observation is `llvmpipe-worker-observed`, not a GL-label claim.
Physical typing started at `14:01:13.007Z` and completed at `14:01:15.668Z`.
Read-only nonce checks returned exit 75 (file absent), including the last
completed check at `14:03:11.972Z`. The next RPC hit the remaining-deadline
timeout; the final observation was captured at `14:03:15.700Z`. This is a
failed 120-second input measurement, not a product pass.

The final device observation reports zero pending, dropped or rejected input
events. Canvas focus and URL remained correct. Four actual presentations had
arrived, but `desktop.png` and `failure.png` are visibly unchanged bar/Foot
pixels; both were opened and inspected. The failure PNG SHA-256 is
`97fc180d4d35c68ca5941dc591afb315220550165469f3c4ead7827989cc2f3f`.
The run closed cleanly after preserving the failed report. No candidate image
or runtime change was published.

## Bound CPU profile (read-only follow-up)

`symbols/report.json` binds a name-bearing companion to all 11 executable
sections of the existing c48 WASM, byte for byte. No guest was rerun under
different code to produce the names. `symbols/profile-analysis.json` and its
Markdown companion aggregate the original 6,716 samples across exact symbols.
The largest self-time entries are `Machine::run` (19.968%), `Hart::execute`
(15.084%), `next_micro_op` (5.932%), and `BlockCache::get` (5.605%). The numeric
runtime bucket is 4.773%; the data does not support calling floating-point
arithmetic the dominant cost. These are host CPU samples, not guest-instruction
counts or proof that a particular optimization will fix responsiveness.

## Completed cold-WASM candidate: launch-crash, not a performance result

The fresh cold run used tool head `e27673f2` and the same c48 WASM / af7 kernel
identified above. Its report binds the eight-byte candidate and chunk manifest;
no snapshot, delta, persistent overlay, or reused worker entered this session.
It ran for 2,727,258 ms, within the separately declared 5,400,000 ms startup
budget. The 120-second physical-input acceptance was never attempted because
the desktop did not map.

The actual compositor was PID 486, `Hyprland --watchdog-fd 4`, in fresh boot
`670725d30d7b46958f53e2b2f6c2399c`. `cold-wasm/events.jsonl` lines 2058/2079
bind its live environment to `GALLIUM_DRIVER=softpipe`,
`LIBGL_ALWAYS_SOFTWARE=1`, and `LP_NUM_THREADS=1`. This proves requested
configuration only: there is no positive actual GL-renderer label.

Line 2519 records this PID with `CoreDumping: 1`. After the dump completed,
the separately successful `coredumpctl --no-pager info 486` at lines 2741/2753
records Signal 6 (ABRT), UID 1000, the same boot ID, the actual executable,
and a stored 6.1 MB core. Lines 2754/2767 then record `/proc/486` absent and
the user unit inactive/dead with MainPID 0 in that same boot. The wrapper's
`Result=success` is not the child's exit status and does not erase its ABRT.
Only after those terminal observations did line 2780 request a diagnostic
stop. The stop intentionally returns a failed report, never an acceptance pass.

The final screenshot was opened and visually inspected: a black console with
a small top-left cursor, not a mapped desktop. The 408 presentation calls
are not evidence of GUI readiness. The paused guest-state digest is
`444fface33168192651b46af89999d22240257b747191bcfe8163aa7da495d37`.
The serial log independently contains the token-delimited probe output used
above; the evidence gate must reparse it rather than trust the event captions.

Final file SHA-256 bindings:

- `cold-wasm/report.json`: `d3c1a6b179ab5d932f04bc3c30f3ca0e8d658222c5f9ecbe41576b37cd65ea44`
- `cold-wasm/events.jsonl`: `1b8aae8394a9aa1be9ab898f356c5b5595a67708fdaadd2aa3ecde6b0b4a2775`
- `cold-wasm/serial.log`: `c04e692a0f41a7371a674adac01607697665f91422d2b42c717b1e8bb484233d`
- `cold-wasm/guest.png`: `0d462e9383c68586effb38220c9b1bcd32e4d0cb0e1c3a6301d1f89dc660a672`
- `cold-wasm/input-integrity.json`: `26ff777eba176058b4ff1bb652eb24f10a63080cac6401aeaa01153c67e5eaea`

Conclusion: this exact isolated candidate suffered a compositor launch crash.
Neither the generic Aquamarine messages, missing GL label, nor the final black
pixels independently identifies the underlying EGL cause. No renderer-speed
conclusion, usable-desktop claim, permission change, or production change follows.
