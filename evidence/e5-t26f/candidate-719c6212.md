# T26f intermediate Chromium candidate — 2026-09-07

Outcome: failed at the immediate post-restore cursor read. This is an iteration
record, not a successful acceptance artifact or a verified task.

Frozen runtime head: `719c6212a5e028523ef70376c864c6411fdf5b48`.
Committed wasm SHA-256:
`15609dc18e2cda7e3c58aff799c2407b0711a445274275abef09077ef9c43abc`.
The run used local Chromium, headless (the default), an empty browser context,
and the following command:

```sh
E5_T26F_OUT=evidence/e5-t26f/whole-machine-candidate \
E5_T26F_IMAGE=target/e5-t26f/desktop-image-aplay-noresize/alpine-rootfs.ext4 \
E5_T26F_IMAGE_INFO=target/e5-t26f/desktop-image-aplay-noresize/desktop-info.json \
E5_T26F_DESKTOP_ASSET_DIR=target/e5-t26f/chunks/desktop-aplay-noresize \
node tools/verify/e5-t26f-browser-roundtrip.mjs
```

The process started at approximately 22:39 UTC. Its retained tool output ended:

```text
AssertionError [ERR_ASSERTION]: post-restore cursor was not guest-visibly rendered
    at file:///Users/blamy/Documents/Codex/wasm-vm/tools/verify/e5-t26f-browser-roundtrip.mjs:525:10
actual: null
expected: true
operator: '=='
```

By control flow, the run reached this assertion after the normal desktop boot,
shell/audio command, two-window setup, saved snapshot, repair-frame CRC, fresh
HELLO, and coherent whole-machine reload checks. However, the old runner only
wrote its full success record at the end and did not capture this assertion in
its nested failure handlers. Those intermediate observations therefore are NOT
promoted to complete retained evidence. The next runner must retain checkpoints
and capture any top-level failure before browser cleanup.

The cursor check read pixels immediately after the pointer RPC; the next candidate
will wait for the actual rendered cursor within the original two-second total
interaction budget. This does not waive that budget or claim the failure was
merely a harness race. The separate T26h native refutations also require a new
runtime build and final browser recording.
