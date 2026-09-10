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
