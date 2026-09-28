# AP observer review R1 — before guest evidence

Reviewed `tools/verify/omarchy-input-observer.c` before opening its fixture
results. No observer or harness implementation changed by this verifier.

## Refuted observer behavior

- **P10 signal semantics — FAILED.** Prediction: an external SIGSTOP prevents
  target progress until SIGCONT. The independent bounded attack against ARM64
  observer SHA256
  `70fddb3a2b5e2e04a7f0e36096f0885e07dbbce85283ea0d23d358d98f23d7f6`
  observed **13 iterations during the 350 ms stopped window**, with `/proc`
  reporting `S (sleeping)` and the observer exiting 0. Source line 233 treats
  every `PTRACE_EVENT_STOP` as signal zero; line 236 then restarts the group-stop.
  The signal is actually recorded at `group-stop-original/observer.jsonl:4`.
  `group-stop-original/result.json` records the stop/continue host timestamps,
  counts 6→19, statuses and exact binary digest. Demand: preserve group-stop
  behavior, or explicitly fail/limit the observer while detaching without
  restarting an external group-stop. Rerun the same bounded attack.
- **P10 initial pending signal — source defect, same boundary.** Source line
  298 starts every initially stopped TID with signal zero although
  `stopped_event` stores a signal-delivery stop in `pending_signal` at line 235.
  A signal that wins the initial interrupt race is therefore suppressed.
  Demand: preserve the recorded pending signal during the initial restart.
  This race has not been claimed as dynamically reproduced.

## Held local fixture results

All nine files in `target/omarchy-input-observer/fixture-r1/sha256.txt` rehashed
correctly. The worker's runner and raw records were inspected independently.

- **P3/P4 per-thread read pairing and actual bytes — HELD for the local cases.**
  Seven independently specified literal results match: 24-byte short read,
  two raw `-11` unsuccessful reads with empty capture, 48-byte readv split
  across 7+41 bytes, a 25-byte partial event, interleaved main/worker read
  entry/exits, and reused fd. The main read entry remains outstanding across
  the worker's two reads; no global entry/exit toggle is used.
- **P6 identity — HELD for the bounded pipe attack.** TID 7 fd 3 changes inode
  487590→487594; both reads remain FIFO identities and `evdev: false`, despite
  payloads consisting of valid event-shaped bytes. Main/worker ids are 7/8.
- **P10 detach — HELD only for demonstrated normal and partial-attach paths.**
  The first observer attaches both threads with TracerPid 10 and releases both
  to TracerPid 0. The fixture emits post-detach worker progress and DETACHED.
  In the partial-attach case, the observer attaches main TID 12 then receives
  EPERM for worker TID 13 already held by the runner. It releases TID 12;
  statuses independently show main TracerPid 0 and worker still owned by the
  runner (1). These held results do not cancel the group-stop counterexample.

## Remaining sufficiency checks

The all-threads/clone path has not yet been exercised by the two-existing-thread
fixture; a subsequent read by a newly cloned thread should be witnessed if the
worker claims that coverage. The source retains per-TID state and explicit
capture/stop limits, but syscall elapsed-window coverage still needs the host
harness records. Process name/executable matching to actual Hyprland is a
harness responsibility because the observer accepts an arbitrary target PID.
Guest attachment, raw evdev decoding, trusted sequence comparison, actual
images, fixed runtime/pair/budgets, observer cleanup and the final diagnostic
conclusion remain **NEEDS EVIDENCE**. No guest run has been inspected.

## Reproduction

`group-stop-attack.py OBSERVER_AARCH64 NEW_OUTPUT_DIR` in the same local ARM64
Linux image, network disabled, with SYS_PTRACE and seccomp unconfined. It starts
only its own target and observer, observes 500 ms around SIGSTOP, sends SIGCONT,
detaches, captures /proc state, and terminates only its owned target. The test
exits 1 on the original observer, preserving the expected negative result.
