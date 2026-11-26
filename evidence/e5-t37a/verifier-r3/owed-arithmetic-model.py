#!/usr/bin/env python3
"""E5-T37a round-3 verifier — what mutant B11 changes, in numbers.

A line-for-line model of `IdlePacer::limit_deadline_after` (crates/core/src/time.rs at 7fd2e0160)
and of mutant B11 (`ticks_of(self.latest_host_ns - before)` -> `... - self.anchor_host_ns`). The
model is first checked against the real code: it must reproduce the values the passing test
`r3_owed_time_is_the_host_time_since_the_previous_consultation` asserts. Then a workload of
work/idle cycles with near deadlines shows how much a busy guest may skip afterwards.

    python3 evidence/e5-t37a/verifier-r3/owed-arithmetic-model.py
"""
U64 = 2**64 - 1
HZ = 10_000_000
T, N = 10_000, 1_000_000  # ticks / nanoseconds per millisecond


class Pacer:
    def __init__(self, host_ns, mtime, lag, mutant):
        self.anchor_host = self.latest = host_ns
        self.anchor_mtime = mtime
        self.lag, self.owed, self.mutant = lag, 0, mutant

    def consult(self, host_ns, current, deadline, worked):
        before = self.latest
        self.latest = max(self.latest, host_ns)
        ticks_of = lambda ns: min(ns * HZ // 10**9, U64)
        ceiling = min(self.anchor_mtime + ticks_of(self.latest - self.anchor_host), U64)
        if worked:
            bounded = min(current + self.owed + self.lag, U64)
            if ceiling > bounded:
                ceiling = bounded
                self.anchor_host, self.anchor_mtime = self.latest, bounded
        else:
            since = self.anchor_host if self.mutant else before
            self.owed = min(self.owed + ticks_of(self.latest - since), U64)
        limited = max(current, min(deadline, ceiling))
        self.owed = min(max(self.owed - (limited - current), 0), max(ceiling - limited, 0))
        return limited


def the_test(mutant):
    """The sequence of r3_owed_time_is_the_host_time_since_the_previous_consultation."""
    p = Pacer(0, 0, 50 * T, mutant)
    now = p.consult(30 * N, 10 * T, 11 * T, True)
    seen = [(now // T, p.owed / T)]
    for _ in range(3):
        now = p.consult(30 * N, now, now + T, False)
        seen.append((now // T, p.owed / T))
    now = p.consult(37 * N, now, now + T, False)
    seen.append((now // T, p.owed / T))
    now += 100 * T
    skipped = p.consult(10_037 * N, now, U64 - 1, True) - now
    return seen, skipped / T


def cycles(k, mutant):
    """k cycles of: 20 ms of host time during which the guest retires 2 ms of its own time, a
    deadline 1 ms ahead (after work), then three idle passes with the host clock standing still,
    each behind a deadline 1 ms ahead. Then a long busy stretch (10 s of host time, 100 ms of
    guest time) and nothing in the way: how far does the idle jump carry the guest?"""
    p = Pacer(0, 0, 50 * T, mutant)
    host, now = 0, 0
    for _ in range(k):
        host += 20 * N
        now += 2 * T
        now = p.consult(host, now, now + T, True)
        for _ in range(3):
            now = p.consult(host, now, now + T, False)
    host += 10_000 * N
    now += 100 * T
    return (p.consult(host, now, U64 - 1, True) - now) / T


seen, skipped = the_test(False)
assert seen == [(11, 0.0), (12, 0.0), (13, 0.0), (14, 0.0), (15, 6.0)] and skipped == 56.0, (seen, skipped)
print("model == real code on the test's sequence: (guest ms, owed ms) =", seen, "final skip", skipped, "ms")
seen, skipped = the_test(True)
print("mutant B11 on the same sequence:          (guest ms, owed ms) =", seen, "final skip", skipped, "ms")
print()
print("bound 50 ms; idle jump after a long busy stretch that follows k work/idle cycles:")
print("  k   original   mutant B11")
for k in (0, 1, 2, 3, 5, 10, 20):
    print(f" {k:2}   {cycles(k, False):6.1f} ms  {cycles(k, True):6.1f} ms")
