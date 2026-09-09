## Scope

Buffer the resident playback fixture's existing `/proc` text reads with
explicit BusyBox `cat` and parse them in memory. Preserve actual player
identity, FIFO/PCM guards, arming, finite audio feed, same-child wait, and
the three byte-identical observation print calls. Recheck identity after
captures and reject malformed, duplicate, truncated or oversized proc text.

No emulator scheduling, clock, JIT, cache, key pacing, restore timestamp or
two-second deadline changes. F remains in progress; this draft is not an
Epic 5 sign-off or production deployment.

## Proof

- Frozen code: `52b29b9a41103337aba77bc5d002090111991c2d`.
- 138 focused checks and84 actual native BusyBox tests pass. The earlier83/84
  run is preserved with a bounded shared-file visibility diagnosis and a
  test-only immutable-input correction.
- Independent Daybreak review holds old/new accepted-byte equivalence,
  explicit stricter refusals, same-player guards and a novel sabotage check.
- Built demo:126 passed,0 failed, no console/HTTP errors.
- Fresh helper-pinned1-GiB image and8192 chunks verify by SHA256.
- New authenticated cold/reuse Chromium record completes: actual same-player
  playback, restored CRC, physical input and1440 fresh non-silent frames hold,
  but the original two-second cap fails at11471.544999957085 ms. Cold exits0,
  reuse exits1 and diagnostic collector exits0; this is not F acceptance.
- Daybreak holds bounded diagnostic predictions B1-B6; F timing remains FAILED.
  Later coherence/drag/second-restore phases are not reached. No performance
  improvement or causal attribution is claimed.

Evidence index: `evidence/e5-t26f/buffered-proc.md`.
No GitHub Actions, merge or production release is performed by this PR.
