---
id: E5-T41a
epic: 5
title: Replay desktop image — Node starts from a startup snapshot built at boot
priority: 0.387652
status: implemented
depends_on: [E5-T36b]
estimate: S
risk: medium
capstone: false
---

## Boundary

Guest image sources only: `tools/replay-desktop/rootfs/etc/init.d/rcS`,
`rootfs/usr/local/bin/node` (new wrapper), `rootfs/usr/local/sbin/replay-desktop-monitor`,
and the one line of `tools/replay-desktop/assemble.py` that used to symlink
`/usr/local/bin/node`. No emulator, loader or published artifact changes here; the image this
task builds is local (`target/`), and E5-T41b publishes the next generation.

Why (measured in the live guest, 2026-11-26): Replay Node 26 is cross-built with
`node_use_node_snapshot=false` — the build cannot run a riscv64 `node_mksnapshot` — so every
`node` start runs the whole JavaScript bootstrap. `node -e 0` costs 0.82 s of guest time
(about 500 M instructions, 3 s on this emulator); from a snapshot built with
`node --build-snapshot` it costs 0.33 s. A script start, the REPL and a child started through
`process.execPath` gain the same 0.5 s each.

What changes:

1. **rcS** builds the snapshot once per boot into tmpfs (`/run/replay-node/startup.blob`,
   about 6.7 MiB), in the background at nice 19, so it always matches the binary and the CPU it
   runs on, and a warm RAM snapshot of the desktop carries it. `done` marks the end either way.
2. **`/usr/local/bin/node`** is a wrapper: when the blob is readable it passes it through
   `NODE_OPTIONS` (so `process.execArgv` stays what the user typed and children started with
   `process.execPath` get it too) and execs the real binary. It leaves alone a caller who names
   a snapshot of their own and `--build-snapshot`. Without the blob, Node starts as before.
3. **Monitor**: `REPLAY_DESKTOP_READY` is printed exactly when it was (the snapshot build does
   not delay it); after it, `REPLAY_NODE_SNAPSHOT bytes=N` (or `REPLAY_NODE_SNAPSHOT_FAILED`)
   once the build is done, always in that order. After READY the monitor no longer runs its
   per-second loop (awk, wc, ls, swaymsg, three greps, and sway serialising its tree — about
   2.6 M guest instructions an iteration): it samples memory and relays events every guest
   second until the Node line, then every 5.

The acceptance script and its native serial-shell helper (`tools/replay-desktop/native-shell.mjs`,
introduced by E5-T36b) are part of this task's diff.

## Deterministic acceptance

`node tools/verify/e5-t41a-node-snapshot.mjs --image <built image> --out evidence/e5-t41a/native`
boots the image on the native CLI (browser device topology, as the snapshot capture does) and
asserts, over the serial root shell:

- the console shows `REPLAY_DESKTOP_READY` and then `REPLAY_NODE_SNAPSHOT bytes=` (more than
  1 MiB), in that order, and READY's uptime is within 0.3 guest seconds of the same boot of the
  current published image;
- `node -p process.version` prints `v26.13.1`; `process.execArgv` is empty for `node -e`;
  `process.execPath` is the real binary; a script, an ES module, `--input-type=module` on
  stdin, a worker thread and a child via `process.execPath` all give the same output as the
  real binary without the blob;
- guest time of `node -e 0`: at most 0.45 s through the wrapper, at least 0.70 s for the real
  binary without the blob (three runs each, medians);
- with the blob moved away the wrapper still runs Node (and takes the longer time); with
  `NODE_OPTIONS` already naming a snapshot, and with `--build-snapshot`, the wrapper adds
  nothing;
- over 60 guest seconds after the Node line the monitor and its children use at most 0.15 s
  of guest CPU (the per-second loop it replaces: about 0.7 s, plus sway's side of `get_tree`),
  and `/run/replay-desktop/mem-hwm-kib` still follows memory use (48 MiB of tmpfs written
  during that minute raise it by at least 24 MiB).

The staged tree and the packed image pass `tools/privacy/check-no-replay-backend.py` (the build
script runs it).

## Adversarial verification

Medium risk. Attack list: a boot where the snapshot build fails or is killed (READY must still
come, Node must still work); READY delayed by the build; the Node line before READY; a blob
that is half written when `node` runs (the rename is the only publication); the wrapper with
unusual arguments (`--`, a script named `--build-snapshot.js`, empty `NODE_OPTIONS`, options
with spaces); `npm`-style shebang scripts; a user deleting the blob; memory high-water mark at
READY against E5-T34b's budget. One bounded novel attack of the verifier's choice.

## Verification log

### 2026-11-26 — worker — claim (head `4129b3343`)

Commit `4129b3343` (rcS, the `node` wrapper, the monitor, `assemble.py`, the acceptance script).
The image was built at that head (`bash tools/build-replay-desktop-image.sh target/e5-t41a/image`;
`evidence/e5-t41a/image/build.json` names the head; image sha256 `20f03da7c51d…`; the build's privacy
check passed on the staged tree, the image and the compressed image). It carries E5-T36b's
session too (this layer is stacked on it).

**Acceptance**: `node tools/verify/e5-t41a-node-snapshot.mjs --image target/e5-t41a/image/replay-desktop.ext4 --out evidence/e5-t41a/native --baseline-ready 5.29`
passes (`result.json` sha256 `76f1937470d8…`). The baseline 5.29 s is generation 1's READY uptime as
E5-T36b's verifier measured it.

- READY at guest uptime 5.3 s (baseline 5.29), then `REPLAY_NODE_SNAPSHOT bytes=6754742` at
  9.71 s, in that order.
- `node -e 0`, guest seconds, three runs each: through the wrapper [0.33, 0.33, 0.33] (median
  0.33); the real binary without the blob [0.81, 0.8, 0.8] (median 0.8); the wrapper with the blob
  moved away [0.81, 0.81, 0.8] (median 0.81) — Node still runs then.
- Same output through the wrapper and from the real binary without the blob for: version,
  execArgv, execPath, a script with arguments, an ES module, `--input-type=module` on stdin, a
  child via `process.execPath`, a worker thread, fetch/crypto/zlib/Intl, an exit code. Version
  `v26.13.1`, execArgv `["-p","JSON.stringify(process.execArgv)"]`, execPath `/opt/replay-node-26/bin/node`.
- `NODE_OPTIONS` carries the blob, also into a child through execPath; a caller's own
  `--snapshot-blob` in `NODE_OPTIONS` and `--build-snapshot` are left alone; other options are
  kept after it.
- The monitor: 0.06 s of guest CPU in 60 guest seconds after the Node line (limit 0.15),
  and 48 MiB written to tmpfs raised the high-water mark from 182780 to 215456 KiB.

**Unchanged around it, same image:** E5-T36b's acceptance passes (five moves, 64x64 plane,
`evidence/e5-t41a/hardware-cursor/`); the E5-T34b native acceptance passes (smoke page, sandbox,
keyboard, `node` v26.13.1 typed into the terminal; READY at 5.28 s;
`evidence/e5-t41a/native-boot/`).

**Memory.** RAM high-water mark at READY 179732 KiB, at the end of the E5-T34b run 202920 KiB, against
181932 KiB for the same run on E5-T36b's image: the snapshot build adds about 20 MiB of peak
use (its own heap while it runs) and the 6.4 MiB blob stays in tmpfs. A warm RAM snapshot taken
after it carries that tmpfs page; E5-T41b's compaction is what keeps the snapshot's size down.

**Limits.**
- The wrapper's check is a substring match on its arguments: any argument containing
  `snapshot-blob` or `--build-snapshot` (a script named so, or an `-e` string mentioning it)
  makes Node start without the snapshot — slower, never wrong.
- The snapshot is built on every boot (about 4 s of guest CPU at nice 19, after READY in
  practice); a desktop resumed from a warm snapshot that already holds it does not build again.
- A `node` started before the blob is renamed into place starts the slow way.
- I did not run the attack-list cases of a build that fails or is killed, or a half-written
  blob: the rename is the only publication, and `done` is written either way.
