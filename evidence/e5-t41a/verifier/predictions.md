# E5-T41a verifier predictions (written before any run)

Head `a1f34ddcd` (change `4129b3343`), image `target/e5-t41a/image/replay-desktop.ext4`
sha256 `20f03da7c51d3965cf8a97fda77dd376b0301014951ba8731a578b42fd300b8c`.

P1 Acceptance rerun. `e5-t41a-node-snapshot.mjs --baseline-ready 5.29` passes again: READY uptime in
   [4.99, 5.59]; `REPLAY_NODE_SNAPSHOT bytes=` > 1 MiB after READY in the console; wrapper median <= 0.45,
   real median >= 0.70; monitor <= 0.15 s CPU / 60 s; HWM rises >= 24 MiB. Guest numbers equal the worker's
   within 0.02 s (they are instruction counts).
P2 Build during boot. While the build runs: `/run/replay-node/startup.blob.tmp` exists and grows,
   `startup.blob` does not; the build's node process has nice 19 in /proc/PID/stat (field 19) and
   RECORD_REPLAY_DONT_RECORD=1 in its environ; `node -p process.env.NODE_OPTIONS` through the wrapper
   prints `undefined` (slow path) and Node works. (The half-written-blob attack: the rename means a
   running `node` never sees the .tmp.)
P3 Killed build. `kill -9` of the build's node process before it finishes: the subshell's `&&` fails,
   `mv` is skipped, `.tmp` is removed, `done` is written; the monitor prints `REPLAY_DESKTOP_READY`
   then `REPLAY_NODE_SNAPSHOT_FAILED` (never `bytes=`); READY uptime is within 0.3 s of 5.29 (killing
   early can only make it earlier); `node -p 6*7` through the wrapper prints 42 with NODE_OPTIONS unset.
P4 Killed subshell (not node). If the `( … ) &` subshell itself is killed, `done` never appears: the
   monitor never prints a Node line and keeps sampling every 1 s; READY still came; Node still works
   (slow path, or fast if node still renamed — it cannot, the mv lives in the killed shell). Expect no
   Node line at all: a liveness gap only for E5-T41b's capture (which will wait on that line), not this task.
P5 Order. The Node line can never precede READY (structural: second loop only after `break`). In every
   console of my runs, READY index < Node-line index.
P6 Wrapper arguments (blob present), each compared with `env -u NODE_OPTIONS /opt/replay-node-26/bin/node`:
   a. `node -- /tmp/a.js x` → same output; NODE_OPTIONS carries the blob.
   b. a script named `--build-snapshot.js` (run as `node ./--build-snapshot.js`) → runs correctly; the
      wrapper adds nothing (substring match, the worker's disclosed limit), NODE_OPTIONS undefined.
   c. `NODE_OPTIONS= node -p process.env.NODE_OPTIONS` → exactly `--snapshot-blob=/run/replay-node/startup.blob`.
   d. `NODE_OPTIONS='--title="a b"'` → process.title `a b` both ways; argv with spaces (`'a b' c`) preserved.
   e. `node -e 'process.exit(0)' -- '--snapshot-blob'` style arg → wrapper skips; still correct.
P7 Shebangs. `#!/usr/bin/env node` and `#!/usr/local/bin/node` scripts run and print the same as the real
   binary (kernel nested interpreter); argv[1] is the script. If npm ships in /opt/replay-node-26/bin,
   `npm --version` works through the wrapper and gives the same version as with the real binary.
P8 User deletes the blob (`rm` as root): next `node` works, slow (>= 0.70 s), NODE_OPTIONS unset.
P9 Memory. HWM at READY on this image is within +25 MiB of E5-T36b's/E5-T34b's at READY (172,228 KiB in
   E5-T34b's log): the build (~20 MiB heap) runs concurrently with the desktop start. No hard budget number
   exists in E5-T34b, so this is a measurement, not a pass/fail (the image has 1024 MiB RAM).
P10 Novel attack — corrupt blob. A truncated `startup.blob` (e.g. first 1 MiB) at the published path makes
   every `node` through the wrapper fail (V8/Node aborts on a bad snapshot); the wrapper does not validate.
   This state cannot be produced by rcS (rename after successful exit) — it needs a root user writing it —
   so it is a robustness observation, not a refutation, unless rcS can publish a truncated blob (tmpfs full
   with exit 0). Prediction: rcS cannot (node exits non-zero on write failure — checked by inspection only).
P11 Novel attack — inherited NODE_OPTIONS. A node process's children inherit
   `NODE_OPTIONS=--snapshot-blob=…`; a child wrapper invocation sees it and adds nothing (no duplicate).
   `node -e 'execSync("node -p process.env.NODE_OPTIONS")'` prints the single option.
P12 Mock hunt. Timing comes from guest /proc/uptime (retire-count clock) read in the guest around the
   command — honest guest time; the real-binary run is the same binary with NODE_OPTIONS unset (honest),
   and the wrapper run pays the extra /bin/sh exec, so the comparison favours the baseline, not the claim.
P13 Coverage. Unexecuted in the worker's runs: rcS failure path (`&&` false → rm, done), monitor
   `REPLAY_NODE_SNAPSHOT_FAILED` branch, assemble.py `raise SystemExit` (guard). P3 executes the first two.
