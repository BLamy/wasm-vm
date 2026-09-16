VERDICT: verified

Scope: E5.5-T03ap's bounded compositor-input diagnostic only. Desktop
responsiveness remains unproven and T03q stays gated.

## Predictions

- **P1/P2 attachment and thread coverage — HELD.** The actual reader is
  `/usr/bin/Hyprland`, TGID/main TID 417, start time 3468. All 13 TIDs in the
  before/attached/after `/proc` samples match the trace identity records and
  retain their start times. Trace lines 2–28 record attachment and READY; no
  clone, orphan exit, unsupported syscall format, or observer error occurred.
  The separate frozen clone fixture covers a thread created after attachment.
- **P3/P4 pairing and returned bytes — HELD.** Independently paired all 58
  `read` ENTRY/EXIT records, RV64 audit architecture `0xc00000f3`, fd/TID/request
  identity, return signs and exact byte lengths. All 8,464 captured bytes are
  complete; zero orphan exits. The local fixture separately exercises readv,
  short reads, two EAGAIN paths, cross-thread pairing and descriptor reuse.
- **P5/P6 actual input decoding and identity — HELD.** At
  `compositor-input-r2/physical-r2/desktop/compositor-input.jsonl:136`, main TID
  417 fd 21 returns 192 bytes from stable character device `/dev/input/event0`
  (rdev 3392 = 13:64, inode 629, input subsystem). Independent Python struct
  decoding yields eight events: SYN_DROPPED, SYN_REPORT, A release,
  SYN_REPORT, Enter press, SYN_REPORT, Enter release, SYN_REPORT. Lines 138
  and 140 return -EAGAIN with no bytes. Line 132 independently records 168
  bytes from tablet event1, fd 22, rdev 3393 = 13:65. `/proc/bus/input/devices`
  names event0 the wasm-vm virtio keyboard and event1 the virtio tablet.
  Pipe literals in the adversarial fixture never become input devices.
- **P7 fixed input contract — HELD.** All 38 source-helper identities match
  frozen commit `9c5e197a65889f5301830b3a2ec4dd836e3980de`. No crates or web
  artifact differs from AO. The runtime remains SHA256 `36b4f1cc…e87a916`,
  with the exact AJ R2 pair, cap 256/recycling ON and original 1280×800
  presentation (1280×832 resource). The raw wire contains all 128 trusted
  keyboard events and 256 ordered successful key/sync acknowledgments, with
  no nonce injected through serial. Independently decoded compositor keys
  match only the final three physical events.
- **P8 interval and budgets — HELD.** Preparation finishes in 215,422 ms,
  within 300 s. Typing takes 2,692 ms. Enter is 10:46:13.241Z; deadline is
  10:48:13.241Z and failure is recorded one millisecond later. Independent
  serial-fence reconstruction finds 36 empty exit-75 nonce replies and zero
  success. The observer is still alive at the post-deadline boundary sample,
  then host SIGTERM starts at 10:48:19.159Z. Trace READY/end guest monotonic
  times are 157,732/166,540 ms; stopSignal is 15 with no stop-budget/error
  termination. Collection/detach takes 64,522 ms within its separate 180 s
  bound. Browser cleanup closes normally; no parent watchdog fires.
- **P9 claim limits and images — HELD.** Personally inspected the original
  `prepared-direct.png` and `failure.png`: both show the initial empty shell
  prompt, without the typed command and its returned prompt. The byte hashes
  differ and no image-equality claim is made. The compositor consumed three
  keyboard events plus a drop/resynchronization marker during the recorded
  interval; this is stronger than host acknowledgment and is weaker than a
  proof that all 128 entered the Linux client queue. Per-read host times were
  not recorded, so no precise pre-deadline read time is claimed. Ptrace can
  perturb scheduling, and SYN_DROPPED alone does not uniquely prove overflow.
- **P10 cleanup — HELD after correction.** Original group-stop behavior was
  dynamically refuted and preserved. Fixed one- and three-thread attacks
  keep targets stopped until SIGCONT while detaching every owner, then prove
  untraced progress. The final guest trace lines 145–157 detach all 13 TIDs;
  independent subsequent status samples show TracerPid 0 and running or
  sleeping states with unchanged identities. Guest observer exit is 0.

## Coverage and retained suite

The actual guest run exercises binary transport/digest binding, real Hyprland
selection, thread discovery/attachment, scalar reads, raw memory capture,
character-device identity, the complete trusted key path, deadline failure,
trace collection and detach. The frozen native fixture supplies readv,
interleaving, short/error reads and fd reuse; the clone fixture supplies
post-READY thread ownership and read capture; the group-stop counterexample
and corrected runs supply multi-owner error cleanup. The two original
pre-browser wrapper guard failures remain recorded; the corrected argument
and experiment guards execute in the actual frozen guest invocation.

Untriggered defensive size/architecture/memory-copy guards and their error
formatting are reviewed as fail-closed reporting outside this run's concrete
read claim. They do not justify a general all-inputs or all-failures guarantee.
CLI constants, build declarations and logging are waived by inspection against
the recorded invocation and returned bytes. No guest runtime capability is
promoted through those waivers. The deterministic C fixtures and Python
runner remain reusable acceptance tests; `make verify-E5_5-T03ap` retains the
build/fixture/guest command chain. The independent group-stop regression
drivers and raw traces are retained with the original failure.

## Evidence anchors

- Raw guest report SHA256:
  `c272930f9dcf5545aa83fdb97b614cdccdef79c1ecd3aabfa96f1bef1c5c3327`.
- Raw guest trace SHA256:
  `b5a7263afeead83140f4e5f0cc5f59986aca72d2252fb287b34cf4071f68d9bf`.
- Frozen RV64 observer SHA256:
  `10d9e82ce33bb8eafaf55e8aa5e8ee86bd7bdfa4998fd367f374ff70e3ff792d`.
- Initial image SHA256:
  `97fc180d4d35c68ca5941dc591afb315220550165469f3c4ead7827989cc2f3f`.
- Failure image SHA256:
  `b18a805c328b7b2b0b5d85b8866d452516aa2b5a41b8eb90a99a19a314a7efe6`.

Independent commands: `python3 audit-guest.py` (DEVELOPER_DIR set to CommandLineTools);
the same folder's group-stop drivers in local ARM64 Docker; frozen source,
binary and fixture index rehash in `frozen-fixture-audit.json`. No verifier
guest rerun, deployment, runtime edit, or unrelated gauntlet was performed.

## Narrow next action

Test the guest-side input-buffering boundary against the same physical burst
and prove event retention. Any remedy then requires a fresh **uninstrumented**
nonce readback by the original Enter+120 s deadline and an actually viewed
typed command/returned prompt before T03q. This diagnostic is not that proof.
