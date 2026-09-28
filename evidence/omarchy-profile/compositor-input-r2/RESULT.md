# AP: actual compositor input loss; desktop still unresponsive

Frozen diagnostic head: `9c5e197a65889f5301830b3a2ec4dd836e3980de`.
AO runtime and exact AJ R2 prepared pair are unchanged. This is a diagnostic,
not an uninstrumented responsiveness acceptance.

## Result

All 128 trusted physical key events produced 256 ordered acknowledged key/sync
calls. Enter was at 2026-09-16T10:46:13.241Z; the original 120-second deadline
expired at 10:48:13.242Z after 36 completed exit-75 missing-file checks, with no
pending read and no nonce. Frames advanced 4 to 5. The worker personally viewed
prepared-direct.png and failure.png: both show an empty Foot prompt, with no
typed command or returned prompt. The child exits 1; the diagnostic wrapper
exits 0 only because the negative result and observer record were collected.

`physical-r2/desktop/compositor-input.jsonl:136` records the real Hyprland
PID/TID417 reading fd21, char device3392/inode629, `/dev/input/event0`. Its
192 returned bytes are eight complete Linux input_event records: SYN_DROPPED,
SYN_REPORT, A-up, SYN_REPORT, Enter-down, SYN_REPORT, Enter-up, SYN_REPORT.
Only the last three of the 128 physical key events appear. Lines138 and140
record EAGAIN. Line132 records the complete seven-event tablet click sequence
on fd22/event1. Current entry/exit device identities match.

The observer was attached to all13 identified Hyprland TIDs; 58 reads captured
8464 bytes across1072 stops, without orphan exits, errors or budget exhaustion.
Its normal SIGTERM15 termination and independent after-snapshot show all13
same-identity threads alive and TracerPid0. Collection took64.522s within180s;
the owned browser closed normally without a watchdog. Per-read host timestamps
were not recorded: consumption is located within the bounded observation,
which extends after the physical deadline until collection sends SIGTERM.
No precise before-deadline read timing is claimed.

## Interpretation and next action

This proves input synchronization loss at the actual compositor's evdev read.
The cached Linux6.6.63 source has a minimum64-event per-client buffer and its
full-ring path replaces old events with SYN_DROPPED. An eight-event remainder
is consistent with four overflows while256 events arrive before a read
(256 - 4*62 = 8). This is an inference: SYN_DROPPED can also arise from other
paths, and ptrace perturbs scheduling. The trace does not uniquely prove buffer
overflow or any deadlock.

Next test a bounded larger evdev client buffer in an isolated Omarchy kernel,
prove actual Linux burst retention against the unchanged kernel control, then
cold-boot a new paired desktop state using that kernel. Reusing old RAM would
still execute the old kernel. Require a subsequent uninstrumented physical
nonce plus personally inspected visible command/returned prompt at the original
Enter+120s deadline before T03q. Keep original resolution and AO runtime.

## Commands and preserved failures

- `make verify-E5_5-T03ap COMPOSITOR_INPUT_OUT=evidence/omarchy-profile/compositor-input-r1`
  built/passed independent fixtures; argument-count guard failed before a browser
  could launch. Preserved pre-browser-argument-failure.log.
- Same target with compositor-input-r2 rebuilt/passed fixtures; old optional-mode
  guard failed before a browser could launch. Preserved pre-browser-guard-failure.log.
- Frozen corrected head: `node tools/verify/omarchy-compositor-input.mjs evidence/omarchy-profile/compositor-input-r2/physical-r2 evidence/omarchy-profile/compositor-input-r2/build/observer-riscv64 target/omarchy-direct-opaque-r2`.
  Raw run.json, desktop.log, audit.json, report.json, trace, serial and PNGs retained.
  Native source/binary identities carried unchanged from the r2 build receipt.
- `node --test tools/verify/omarchy-compositor-input.test.mjs tools/verify/omarchy-user-input.test.mjs tools/verify/omarchy-owned-trial.test.mjs tools/verify/omarchy-input-trial.test.mjs tools/verify/omarchy-desktop-live.test.mjs`:
  50/50 pass with local loopback permission. The prior sandbox-only run's one
  EPERM listen failure is retained separately; the other49 passed.

Observer source SHA256 b0d721abda8c550cf29ff0a8e4a7f6cfd857a207fc799e0260e372514255b091.
RV64 binary SHA256 10d9e82ce33bb8eafaf55e8aa5e8ee86bd7bdfa4998fd367f374ff70e3ff792d.
Report SHA256 c272930f9dcf5545aa83fdb97b614cdccdef79c1ecd3aabfa96f1bef1c5c3327.
Trace SHA256 b5a7263afeead83140f4e5f0cc5f59986aca72d2252fb287b34cf4071f68d9bf.
The adjacent sha256.txt binds every worker evidence file including this result.
