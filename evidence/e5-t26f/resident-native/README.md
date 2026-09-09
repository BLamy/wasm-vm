# Resident aplay — bounded native precheck, not F acceptance

## Actual native result (2026-09-08)

The retained `precheck.py` ran real Alpine 3.20/aarch64 `aplay` 1.2.11 on local
Colima with ALSA **file-over-null**, not hardware. The original owned scratch was
`/private/tmp/e5-t26f-resident-aplay.t61mn7`. No guest image/runtime was modified.

Two observations 150 ms apart reported PID **15**, starttime **57405488**,
executable `/usr/bin/aplay`, `pipe_read`, actual FIFO fd **4**, and actual ALSA
file-PCM fd **5**. FIFO availability and output PCM length were both zero; the
child I/O counters were unchanged. `observations.json` transcribes those actual
successful-run stdout values; it is not a new measurement or a hardware claim.

The parent pre-opened the FIFO O_RDWR with a non-inheritable descriptor. The child
successfully executed aplay, opened the FIFO O_RDONLY, opened the PCM output,
and blocked reading the empty FIFO. `syscalls.log:1,41,42` anchors executable and
descriptor ordering. After those observations, the parent fed exactly 3840 bytes
(960 S16_LE stereo frames at 48 kHz) and closed its writer. Actual aplay exited
zero (`syscalls.log:51`); `pcm.raw` is 5760 bytes including aplay padding, with its
first 3840 bytes exactly matching the non-silent input. No PCM was fed before the
empty/open observations. `aplay.stderr` retains the real format announcement.

Reproduction used a disposable local container (the initial macOS `/private/tmp`
bind was not visible in Colima and failed before aplay; Docker copy fixed that):

```sh
docker create --name e5-t26f-resident-aplay-native-t61mn7 alpine:3.20 sh -c 'apk add --no-cache alsa-utils strace python3 && cp /work/asound.conf /work/.asoundrc && python3 /work/precheck.py'
docker cp /private/tmp/e5-t26f-resident-aplay.t61mn7/. e5-t26f-resident-aplay-native-t61mn7:/work
docker start -a e5-t26f-resident-aplay-native-t61mn7
docker cp e5-t26f-resident-aplay-native-t61mn7:/work /private/tmp/e5-t26f-resident-aplay.t61mn7/native-result
```

Only the individual source/config/trace/stdout/stderr/PCM files are retained
here, not container roots, package caches, or the FIFO special file. Re-run in a
fresh work directory: the precheck intentionally refuses an existing FIFO.

## Implemented guest guard and deterministic tests

`tools/guest/e5-t26f-resident-aplay.sh` is sourced in the actual terminal shell as
`. /usr/libexec/wasm-vm/e5t26f-resident.sh && e5_prepare`. It generates escaped
finite PCM before save, opens the parent FD3, and closes that inherited writer
in the child before exec of real `/usr/bin/aplay -Dhw:0,0`. Preparation accepts
only two matching observations of actual executable inode, PID/starttime/parent,
sleeping `pipe_read`, exactly one child FIFO descriptor with read-only flags,
only parent FD3 referencing that FIFO (O_RDWR), actual PCM descriptor and owner,
PREPARED state and zero hardware/application pointers. When the kernel exposes
task I/O accounting, its availability and counters must also remain unchanged;
this supplemental check does not require CONFIG_TASK_IO_ACCOUNTING (the shipped
`releases/kernel/6.6.63/config:111` disables CONFIG_TASKSTATS).
It saves the observation in the parent's RAM and prints actual values plus a
conditional green `e5t26f-prepared` marker.

The physically typed post-gesture command is **`play`**, a thin alias for
`e5_play`. The same parent shell compares actual proc values against saved RAM,
prints the post observation, feeds 3840 bytes, closes its sole writer, waits for
the same child, and prints green `e5t26f-aplay` only after exit zero. Refusal/feed/
exit failures emit red and cannot emit successful completion. The post path
uses only shell builtins and proc reads; no new shell/player is launched.

Self-gates:

```sh
sh -n tools/guest/e5-t26f-resident-aplay.sh
node --test tools/verify/e5-t26f-resident-aplay.test.mjs
```

35 tests pass. Tests execute the actual shell source with filesystem paths
replaced **only in the test copy**: deterministic fake proc files exercise
wrong PID/starttime/executable/FIFO/PCM, pointer/IO changes, failed feed and
nonzero child exit. They also execute the actual finite payload expression,
builtin-only `play`, and bounded two-observation preparation control flow.
The preparation orchestration tests explicitly stub observations, while the
identity/refusal tests execute the actual observer. None is hardware evidence.

## Remaining proof boundary

The retained native run does **not** prove `/dev/snd` ownership, PREPARED hardware
state, kernel PCM pointers, whole-machine restore, browser gesture/input/rendering
or latency. The actual guest helper deliberately requires those hardware proc
checks and fails closed if they are unavailable. The browser must retain readable
pre/post values, source/image/snapshot hashes, actual fresh non-silent and rendered
PCM, successful physical text/cursor/focus/gesture and the original **2000-ms**
interval. Keep the original completed pre-save playback separately. A new shell
cannot inherit the function or wait this original child. F remains unverified;
this fixture is not a timing waiver, performance result, or default change.
