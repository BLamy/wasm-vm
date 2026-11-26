---
id: E5-T41a
epic: 5
title: Replay desktop image — Node starts from a startup snapshot built at boot
priority: 0.387652
status: verified
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

### 2026-11-26 — verifier — VERDICT: verified

VERDICT: verified

Fresh session, head `a1f34ddcd` (change `4129b3343`). Image `target/e5-t41a/image/replay-desktop.ext4`, sha256
`20f03da7c51d…` (checked). Its stage manifest lists `usr/local/bin/node`, `etc/init.d/rcS` and
`usr/local/sbin/replay-desktop-monitor` with the same sha256 as those files at the head (`d571f712…`, `c7612828…`,
`04dac750…`). I wrote the predictions before any run: `evidence/e5-t41a/verifier/predictions.md`. Every boot ran on
the native CLI with the browser device topology (`tools/replay-desktop/native-shell.mjs`). My attack driver is
`evidence/e5-t41a/verifier/scripts/attack.mjs`. No rr and no `ssh dev` (2026-09-01 policy).

- **P1 acceptance rerun — HELD.** `node tools/verify/e5-t41a-node-snapshot.mjs --image target/e5-t41a/image/replay-desktop.ext4 --out evidence/e5-t41a/verifier/acceptance --baseline-ready 5.29`
  passes (`acceptance/result.json` sha256 `d31c966e…`). READY came at 5.30 s, then `REPLAY_NODE_SNAPSHOT bytes=6764734` at 9.71 s
  (`acceptance/console.log:28-29`). `node -e 0` medians: wrapper 0.32 s, real binary 0.80 s, wrapper with the blob moved away 0.80 s.
  The monitor used 0.04 s of CPU in 60 guest s, and the high-water mark went 183816 → 215488 KiB. The guest-second numbers match the
  worker's within 0.02 s. The blob is 9,992 B bigger than the worker's (6754742 B): it varies from boot to boot (6753966 to 6765998 B
  across my five boots), so its size is not a fixed value.
- **P2 build process and the half-written window — HELD.** In both kill boots the build was found at guest 1.33–1.35 s as pid 73,
  `comm` `node-MainThread`, parent pid 71 (the rcS subshell). Its stat showed nice=19, its environment had `RECORD_REPLAY_DONT_RECORD=1`,
  and its cmdline was `/opt/replay-node-26/bin/node --snapshot-blob /run/replay-node/startup.blob.tmp --build-snapshot /dev/null`.
  In the success boot, `node` ran through the wrapper while the build was still going: `/run/replay-node` held only `build.log`
  (neither `.tmp` nor `startup.blob`), and it printed `undefined 42` (no NODE_OPTIONS, slow path, correct) (`success/attack.json`,
  "node during build"). The rename publishes the file in one step, so no `node` start can see a half-written blob.
- **P3 build killed — HELD.** I ran `kill -9 73` at guest 1.35 s. READY still came at 5.37 s, then `REPLAY_NODE_SNAPSHOT_FAILED uptime=5.39`
  (`kill-node/console.log:74-75`), never `bytes=`. `/run/replay-node` then held `done` and `build.log` (which reads `Killed`), with no
  `.tmp` and no blob. The wrapper printed `undefined 42`, rc=0, and `node -e 0` took 0.82 and 0.81 s (one more run, 2.21 s, overlapped
  Chrome's late page events). This ran rcS's failure path (`&&` false, `rm -f`, `done`) and the monitor's `_FAILED` branch, which
  the worker's evidence had not run.
- **P4 rcS subshell killed — HELD as predicted.** I killed pid 71 (`/bin/sh /etc/init.d/rcS`) and left the build node running. READY
  came at 5.44 s. After 60 more guest seconds there was still no Node line (`kill-subshell/console.log`: READY only).
  `/run/replay-node` held a finished `startup.blob.tmp` (6,765,998 B), no `done` and no blob. The wrapper took the slow path (`undefined 42`,
  0.81 s ×3), and the monitor kept its 1-s sampling loop. READY still comes and Node still works, so the claim holds. The gap is for
  E5-T41b: a capture that waits on the Node line would wait forever here, or if the build hangs. It needs its own timeout (see follow-ups).
- **P5 Node line never before READY — HELD.** The code is built that way: the second loop starts only after the `break`.
  READY came before the Node line in the console of every boot (acceptance, success, kill-node).
- **P6 unusual arguments — HELD** (`success/attack.json` `args`, each compared with `env -u NODE_OPTIONS /opt/replay-node-26/bin/node`).
  - `node -- /tmp/a.js x`: same argv.
  - `./--build-snapshot.js` runs correctly; the wrapper adds nothing (NODE_OPTIONS `undefined`; this is the limit the worker disclosed).
  - Empty `NODE_OPTIONS=`: it becomes exactly `"--snapshot-blob=/run/replay-node/startup.blob"`.
  - `NODE_OPTIONS='--title="a b"'`: process.title is `a b` both ways, and the quoting is kept after the blob option.
  - Arguments with spaces or empty (`'a b' '' c`): kept as given.
  - A script argument `--snapshot-blob`: the wrapper adds nothing, and the output is correct.
  - stdin script (`node - x y`) and the REPL (`node -i`): same output both ways.
- **P7 npm-style shebangs — HELD (npm itself absent).** `#!/usr/bin/env node` gives the same output both ways
  (`envshebang 4 /tmp/envs function`). `#!/usr/local/bin/node` works: the kernel accepts the wrapper as a nested interpreter
  (`directshebang 3 /tmp/dirs`). The image ships no `npm` (`/opt/replay-node-26/bin/npm` does not exist), so there is no npm to
  test. `#!/usr/bin/env -S` fails because busybox `env` has no `-S`; that comes from the image's userland, not the wrapper.
- **P8 the user deletes the blob — HELD.** After `rm /run/replay-node/startup.blob`, `node` printed `undefined 42` with rc=0, and
  `node -e 0` took 0.80, 0.81 and 0.81 s.
- **P9 memory at READY — HELD (no hard budget exists).** The RAM high-water mark at READY, in KiB:
  - this image: 170,344 (acceptance boot) and 171,044 (worker);
  - E5-T36b's image: 163,604 (`ready-e5-t36b/attack.json`);
  - generation 1: 163,624 (`ready-e5-t34b/attack.json`);
  - this image with the build killed early: 160,672.

  So the build adds about 6.6 MiB at READY, below the 172,228 KiB that E5-T34b recorded at READY. My generation-1 READY of 5.27 s
  confirms the 5.29 s baseline. The build therefore delays READY by at most 0.03 s.
- **P10 novel attack, corrupt blob — HELD (robustness observation, not a refutation).** A 1 MiB truncation of the blob at the published
  path makes every `node` fail with `The startup snapshot is truncated.`. A zero-byte blob makes it fail with
  `The startup snapshot is not a Node.js snapshot blob.` (`success/console.log:246,255`): the wrapper tests only `-r`. rcS cannot
  publish either state: `mv` runs only after the build exits with 0, and `/run` has 489 MB free (`df`). The file is root-owned,
  mode 644. The desktop user (uid 1000) reads it and uses it (`--snapshot-blob=… 1000`).
- **P11 novel attack, inherited NODE_OPTIONS — HELD.** A `node` started inside `node` through `execSync("node …")` sees the option
  exactly once (`--snapshot-blob=/run/replay-node/startup.blob`), so the wrapper never adds it twice.
- **P12 mock hunt — HELD.**
  - Timing is the guest's own `/proc/uptime` (the retire-count clock), read inside the guest around each command. It is elapsed
    guest time, measured at idle. In my success boot, three wrapper runs right after the Node line took 0.99, 0.91 and 0.63 s while
    the late desktop start still competed for the CPU. The script's own measurement comes after the 60-s monitor window, when the
    guest is idle.
  - The "real binary" run is the same file with NODE_OPTIONS unset. The wrapper run pays an extra `/bin/sh` exec, so the comparison
    favours the baseline.
  - No golden value is computed by the code under test; the baseline 5.29 s is confirmed above.
  - Wording note: the acceptance text says `process.execArgv` is "empty for `node -e`", but real Node puts `-e`/`-p` and the code in
    execArgv (host Node: `[ '-e', '…' ]`). The script asserts equality with the real binary and the exact
    `["-p","JSON.stringify(process.execArgv)"]`, which is the intended property: no snapshot option leaks into execArgv.
- **P13 coverage — HELD.** Every changed hunk ran or is waived:
  - rcS success path: ran (acceptance). Failure path: ran (kill-node). `rm -f` with a `.tmp` actually present: waived (`rm -f`, no
    branch).
  - Wrapper: blob readable and added; caller's own option or `--build-snapshot` skipped; blob absent. All ran.
  - Monitor: READY `break`, `bytes=` branch, `_FAILED` branch, 1-s and 5-s waits, `sample` after READY (the high-water mark rose).
    All ran.
  - `assemble.py`: the `is_file` check ran in the image build at `4129b3343` (`evidence/e5-t41a/image/build.json`; the manifest entry
    comes from `payload/overlay`). The `raise SystemExit` branch is waived: it is a build guard.
  - The acceptance script ran in my rerun.

Not checked:
- No browser boot of this image. The worker's E5-T34b and E5-T36b reruns are cited, not repeated.
- No scratch image with a build that fails without being killed (for example, a non-zero exit). The live `kill -9` covers the same
  rcS branch.
- No hung build: no Node line, the same as P4.
- No OOM kill under memory pressure.
- No cold clone (medium risk, no portability claim).

The `*-r0-finder-missed` directories are my first two kill boots. My PID finder looked for `comm` = `node`, but the comm is
`node-MainThread`, so nothing was killed. I kept them for the record; they are not evidence either way.

Follow-ups (observations only; I filed no task):
1. E5-T41b's capture, which waits on the Node line, needs a timeout or must treat a missing line as a failure. Otherwise a killed rcS
   subshell or a hung build stops it forever (P4).
2. The wrapper could fall back to the plain binary when Node rejects the blob (P10). This only matters if something other than rcS
   ever writes the file.

SUITE: discard. The acceptance script is already this task's committed verify target. The attack driver and the console logs stay
as evidence; nothing in them is stable enough to be a golden fixture (the blob size varies from boot to boot).

Commands: `node tools/verify/e5-t41a-node-snapshot.mjs --image target/e5-t41a/image/replay-desktop.ext4 --out evidence/e5-t41a/verifier/acceptance --baseline-ready 5.29`;
`node evidence/e5-t41a/verifier/scripts/attack.mjs --mode success|kill-node|kill-subshell --image target/e5-t41a/image/replay-desktop.ext4 --out evidence/e5-t41a/verifier/<mode>`;
`… --mode ready-only --image target/e5-t36b/image/replay-desktop.ext4` and `… target/e5-t34b/image/replay-desktop.ext4`.
