---
id: E5-T37
epic: 5
title: Stop spinning a host core while the desktop is idle (planning parent)
priority: 0.38766
status: pending
depends_on: [E5-T34g]
estimate: M
risk: high
capstone: false
---

## Why this exists

Measured on the warm Replay desktop on 2026-11-24: with nobody touching it the browser worker
retires about 145 M instructions per second, forever. The guest is 96% idle in its own time
(3.6 s busy in 87 guest seconds), but under the retire-count clock an idle `wfi` jumps guest
time to the next timer deadline, so the worker replays guest time about 5.8 times faster than
real time and never rests. Consequences: one host core pegged (heat, battery), guest timeouts
and animations running several times too fast while idle, and periodic guest work (Chrome's
thread pool, the session monitor) executing at full host speed.

`paced-icount` already stops idle jumps from outrunning the host clock, but the run slice
then spins on `wfi` instead of yielding, and the loader refuses the mode without accelerated
graphics.

## Direction (split before starting)

1. Core: when a `wfi` finds the next deadline in the paced future, end the run slice and
   report how long the guest can sleep. The retire stream is unchanged; only where a slice ends
   moves.
2. Loader: sleep that long (or until input, a device completion or a display request) instead
   of scheduling the next slice at once; wake immediately on input.
3. Replay desktop: switch to the paced clock after restore; prove idle host CPU drops, that a
   key held for a short press does not repeat, and that the E4-T40a latencies do not regress.

## Verification log
