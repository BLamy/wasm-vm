#!/usr/bin/env python3
"""E5-T37a round-4 verifier, SECOND session — my own mutants. Run from the repo root.

Uses the interrupted first session's machinery (sabotage.py beside this file, read in full:
one mutant at a time; every touched file restored with `git checkout`, re-touched, and
`git status --short crates` asserted equal to what it was at start) with a different mutant
list. `@r3` rows put the TEST file (or time.rs, whose non-test part is identical) back to the
revision round 3 verified, to show which form of the worker's tests kills the mutant.

  python3 evidence/e5-t37a/verifier-r4/sabotage-2.py                # worker's 24 tests
  python3 evidence/e5-t37a/verifier-r4/sabotage-2.py --suite MY1 M1 # + promoted verifier tests
"""
import importlib.util
import os
import sys

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("sab", os.path.join(here, "sabotage.py"))
sab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sab)
LIB, TIME, TESTS = sab.LIB, sab.TIME, sab.TESTS

STIP = "level(5, c.mtime >= self.sbi_state.stimecmp);"
MY1 = (LIB, STIP, "level(5, c.mtime == self.sbi_state.stimecmp);")
BOUND = ("            let bounded = current\n"
         "                .saturating_add(self.owed_wait_ticks)\n"
         "                .saturating_add(self.max_busy_lag_ticks);")
MY2 = (TIME, BOUND,
       "            let bounded = current\n"
       "                .saturating_add(self.owed_wait_ticks.max(self.max_busy_lag_ticks));")

sab.M = [
    ("MY1 fresh_mip: the S-timer level only AT its deadline (`>=` -> `==`)",
     [MY1], [], ["paced_idle"]),
    ("MY1@r3 the same, against the fresh_mip test as round 3 saw it (999 / MAX)",
     [MY1], [TESTS], ["paced_idle"]),
    ("MY2 a guest that worked may skip max(owed, bound), not owed + bound",
     [MY2], [], ["paced_idle"]),
    ("MY2@r3 the same, against the pacer test as round 3 saw it",
     [MY2], [TIME], ["paced_idle"]),
    # The first session's M1, re-run here only with --suite (its own pass was interrupted).
    ("M1 the owed-time cap judged before the jump (`ceiling - limited` -> `ceiling - current`)",
     [sab.M1], [], ["paced_idle"]),
]
sab.main()
