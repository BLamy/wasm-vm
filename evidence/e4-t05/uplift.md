# E4-T05 CoreMark host-side uplift (native, back-to-back on the same idle machine)

The guest-reported CoreMark score is instruction-count-derived (guest mtime = retired instructions),
so it is identical (261.734 it/s) with or without the optimization — the emulator speedup is a HOST
wall-clock ratio.

| config | host_elapsed_s | guest_elapsed_s |
|---|---|---|
| cache OFF (legacy per-instruction device sync) | 431.7 | 22.9 |
| block cache + interrupt batching ON | 192.3 | 22.9 |

**Uplift = 2.244× (AC #1 ≥1.3× — MET).** The win comes from batching the
per-instruction device/interrupt re-sync (E4-T02: ~47% of host time) to block boundaries.
