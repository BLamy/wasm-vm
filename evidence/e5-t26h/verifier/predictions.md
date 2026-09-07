# E5-T26h fresh-verifier predictions — 2026-09-07

Frozen implementation under review: `4ed9eaa5299338e513783722808576960919604b`.
These predictions were written after reading the task and frozen diff, before reading worker
evidence or executing the verifier attacks.

- P1 evidence integrity — the worker log hashes to the task-cited SHA-256, identifies the frozen
  commit, reports exactly 106 passing checks, and contains no panic/failure/ignored-test escape.
- P2 cursor continuity — nonzero cursors, including `u16` wrap from `0xffff` to `0`, restore the
  device shadow independently of the guest used index; an already consumed descriptor is not
  replayed and a pending descriptor completes exactly once.
- P3 detached refusal — corruption of each new section (GPU, keyboard, tablet, mouse, sound,
  console, RNG), including transport/ring metadata and component bytes, returns a typed error for
  that section and leaves a distinct target's serialized state byte-identical to its baseline.
- P4 topology — missing, duplicate, or source/target device-presence mismatch returns the relevant
  typed error before changing the target. Alternate valid assembly with the same required devices
  restores successfully.
- P5 host-session boundary — held key/pointer/button state is converted to release state; pending
  sound and console work crosses the snapshot and completes once; stale console application bytes
  and HELLO do not cross, while a fresh HELLO is accepted after the preserved close/open traffic.
- P6 sabotage sensitivity — changing one saved service cursor in a temporary exact-copy checkout
  causes a focused continuity assertion to fail (duplicate completion or wrong used index).
- P7 headless compatibility — a no-desktop source restores into a no-desktop fresh target.
- P8 fixture independence — the acceptance target begins with different RAM, empty device service
  queues, and absent GPU resources; expected post-restore state is not computed by deserializing the
  same snapshot through a second implementation path.
- P9 exact-head portability — one scrubbed-environment clean-copy run of the direct acceptance
  target passes at the frozen commit without relying on dirty workspace artifacts.
- P10 cross-section atomicity — any malformed payload rejected by `load_resume`, including a
  malformed non-desktop section after valid desktop sections, leaves desktop target state unchanged.
