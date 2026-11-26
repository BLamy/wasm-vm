#!/usr/bin/env python3
"""E5-T37a round-5 verifier — mutation run, my own script and my own mutants.

Every mutant is applied ALONE to a scratch checkout of the head under test (never to the main
working tree: `--tree` must not be the repository this file lives in), the tests are run there,
and the files are restored with `git checkout`, re-touched (cargo fingerprints by mtime) and
`git status --short crates` is compared with what it was before the mutant.

  python3 sabotage.py --tree <scratch clone> [--suite] [name-prefix ...]

Without --suite the tests are the task's acceptance command, i.e. the WORKER's tests:
    cargo test -p wasm-vm-core --lib paced_idle
With --suite (the four verifier files promoted into the scratch clone first) the verifiers'
tests run as well:
    cargo test -p wasm-vm-core --lib -- paced_idle v37a_ r2_ r3_ r4_ r5_

Groups:
  S*  the round-4 finding: the S-timer level in `Machine::fresh_mip` (`>`, `==`, one tick early)
  P*  the same three made in `fresh_mip` AND in the boundary's own `sync_sbi_timer` (round 4's
      probe P3b: a test that only compares the two cannot see these)
  M1  round 4's mutant outside its verdict: the owed-time cap judged before the jump
  M1b the same, sparing the test's first table row — is the second row (a deadline in the
      way) live?  (added after reading the test)
  F*  NEW, mine: other ways to get the S-timer level wrong on that line
  T*  NEW, mine: the same positions for the machine timer level (the test now walks it too)
  G*  NEW, mine: other ways to get the cap on owed time wrong on those two lines
  C1  a liveness probe of the test's direct MTIP assertion (added after reading the test)
"""
import os
import re
import subprocess
import sys

LIB, TIME, CSR = "crates/core/src/lib.rs", "crates/core/src/time.rs", "crates/core/src/csr.rs"
CLINT = "crates/core/src/dev/clint.rs"

STIP = "                level(5, c.mtime >= self.sbi_state.stimecmp);\n"
SYNC = "                .set_mip_bit(5, mtime >= self.sbi_state.stimecmp); // STIP\n"
MTIP = "            level(7, c.mtip());\n"
PAY = "            .saturating_sub(limited - current)\n"
CAP = "            .min(ceiling.saturating_sub(limited));\n"
SHADOW = (CSR, "        self.time = mtime;\n    }\n",
          "        self.time = mtime;\n    }\n\n    pub fn time_shadow_mutant(&self) -> u64 {\n"
          "        self.time\n    }\n")


def stip(expr):
    return (LIB, STIP, f"                level(5, {expr});\n")


def sync(expr):
    return (LIB, SYNC, f"                .set_mip_bit(5, {expr}); // STIP\n")


M = [
    # ── the round-4 finding ──
    ("S1 S-timer level `>=` -> `>` (not due on the deadline's own tick)",
     [stip("c.mtime > self.sbi_state.stimecmp")]),
    ("S2 S-timer level `>=` -> `==` (due only AT the deadline; round 4's MY1)",
     [stip("c.mtime == self.sbi_state.stimecmp")]),
    ("S3 S-timer level one tick early (`mtime + 1 >= stimecmp`)",
     [stip("c.mtime.saturating_add(1) >= self.sbi_state.stimecmp")]),
    ("P1 `>` in fresh_mip AND in sync_sbi_timer",
     [stip("c.mtime > self.sbi_state.stimecmp"), sync("mtime > self.sbi_state.stimecmp")]),
    ("P2 `==` in fresh_mip AND in sync_sbi_timer",
     [stip("c.mtime == self.sbi_state.stimecmp"), sync("mtime == self.sbi_state.stimecmp")]),
    ("P3 one tick early in fresh_mip AND in sync_sbi_timer",
     [stip("c.mtime.saturating_add(1) >= self.sbi_state.stimecmp"),
      sync("mtime.saturating_add(1) >= self.sbi_state.stimecmp")]),
    ("M1 the owed-time cap judged before the jump (`ceiling - limited` -> `ceiling - current`)",
     [(TIME, CAP, "            .min(ceiling.saturating_sub(current));\n")]),
    ("M1b the cap judged before the jump only when a deadline is in the way (a far one spared)",
     [(TIME, CAP, "            .min(ceiling.saturating_sub(if deadline >= u64::MAX - 1 {\n"
                  "                limited\n            } else {\n                current\n"
                  "            }));\n")]),
    ("MY2 round 4's mutant, re-applied to see WHICH assertion of the new test it reaches: a guest "
     "that worked may skip max(owed, bound), not owed + bound",
     [(TIME, "                .saturating_add(self.owed_wait_ticks)\n"
             "                .saturating_add(self.max_busy_lag_ticks);\n",
             "                .saturating_add(self.owed_wait_ticks.max(self.max_busy_lag_ticks));\n")]),
    # ── new: the S-timer level ──
    ("F1 STIP follows the MACHINE timer's compare (`c.mtime >= c.mtimecmp`)",
     [stip("c.mtime >= c.mtimecmp")]),
    ("F2 STIP set-only, a latch not a level (never cleared by fresh_mip)",
     [(LIB, STIP, "                if c.mtime >= self.sbi_state.stimecmp {\n"
                  "                    level(5, true);\n                }\n")]),
    ("F2b STIP clear-only (never set by fresh_mip)",
     [(LIB, STIP, "                if c.mtime < self.sbi_state.stimecmp {\n"
                  "                    level(5, false);\n                }\n")]),
    ("F3 a deadline of 0 treated as disarmed",
     [stip("c.mtime >= self.sbi_state.stimecmp && self.sbi_state.stimecmp != 0")]),
    ("F4 wrapping compare (`mtime - stimecmp < 2^63`): the far sentinel u64::MAX reads as due",
     [stip("c.mtime.wrapping_sub(self.sbi_state.stimecmp) < (1 << 63)")]),
    ("F5 stale clock: STIP judged against the `time` CSR shadow of the LAST sync, not mtime now",
     [SHADOW, stip("self.hart.csr.time_shadow_mutant() >= self.sbi_state.stimecmp")]),
    ("F6 without the built-in SBI a stale STIP is cleared instead of left alone",
     [(LIB, STIP + "            }\n",
       STIP + "            } else {\n                level(5, false);\n            }\n")]),
    ("F7 the S-timer level taken although the built-in SBI is off (no guard)",
     [(LIB, "            if self.builtin_sbi {\n" + STIP + "            }\n", STIP)]),
    # ── new: the machine timer level at the same positions ──
    ("T1 machine timer level `>`", [(LIB, MTIP, "            level(7, c.mtime > c.mtimecmp);\n")]),
    ("T2 machine timer level `==`", [(LIB, MTIP, "            level(7, c.mtime == c.mtimecmp);\n")]),
    ("T3 machine timer level one tick early",
     [(LIB, MTIP, "            level(7, c.mtime.saturating_add(1) >= c.mtimecmp);\n")]),
    ("T5 stale clock for the machine timer level",
     [SHADOW, (LIB, MTIP, "            level(7, self.hart.csr.time_shadow_mutant() >= c.mtimecmp);\n")]),
    ("C1 `ClintState::mtip` itself `>=` -> `>` (shared by fresh_mip and sync_clint: only the "
     "test's direct MTIP rule can see it; outside the task's diff, a liveness probe)",
     [(CLINT, "        self.mtime >= self.mtimecmp\n", "        self.mtime > self.mtimecmp\n")]),
    # ── new: the cap on owed time ──
    ("G1 cap, THEN pay (`min(owed, lead after) - jump`)",
     [(TIME, PAY + CAP, "            .min(ceiling.saturating_sub(limited))\n"
                        "            .saturating_sub(limited - current);\n")]),
    ("G2 one bound of slack in the cap (`lead after + max_busy_lag`)",
     [(TIME, CAP, "            .min(\n                ceiling\n                    .saturating_sub(limited)\n"
                  "                    .saturating_add(self.max_busy_lag_ticks),\n            );\n")]),
    ("G3 the lead measured from the anchor, not from where the guest lands",
     [(TIME, CAP, "            .min(ceiling.saturating_sub(self.anchor_mtime));\n")]),
    ("G4 the cap applied only to a guest that waited (not after work)",
     [(TIME, CAP, "            .min(if worked {\n                u64::MAX\n            } else {\n"
                  "                ceiling.saturating_sub(limited)\n            });\n")]),
    ("G5 the cap applied only to a guest that worked (not while waiting)",
     [(TIME, CAP, "            .min(if worked {\n                ceiling.saturating_sub(limited)\n"
                  "            } else {\n                u64::MAX\n            });\n")]),
    ("G6 a jump after work does not pay off owed time",
     [(TIME, PAY, "            .saturating_sub(if worked { 0 } else { limited - current })\n")]),
    ("G7 a jump while waiting does not pay off owed time",
     [(TIME, PAY, "            .saturating_sub(if worked { limited - current } else { 0 })\n")]),
]

args = sys.argv[1:]
tree = os.path.abspath(args[args.index("--tree") + 1])
del args[args.index("--tree"):args.index("--tree") + 2]
suite = "--suite" in args
only = [a for a in args if a != "--suite"]
here_repo = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../.."))
assert os.path.realpath(tree) != os.path.realpath(here_repo), "never mutate the main working tree"
os.chdir(tree)
CMD = ["cargo", "test", "-p", "wasm-vm-core", "--lib"] + (
    ["--", "paced_idle", "v37a_", "r2_", "r3_", "r4_", "r5_"] if suite else ["paced_idle"])


def sh(*a):
    return subprocess.run(a, capture_output=True, text=True).stdout


base_status = sh("git", "status", "--short", "crates")
print(f"tree {tree} at {sh('git', 'rev-parse', 'HEAD').strip()}")
print(f"git status --short crates before: {base_status.split()!r}")
print("$ " + " ".join(CMD))
sys.stdout.flush()
killed = survived = 0
for name, edits in M:
    if only and not any(name.startswith(o + " ") for o in only):
        continue
    paths = sorted({p for p, _, _ in edits})
    src = {p: open(p).read() for p in paths}
    new_src = dict(src)
    bad = [(p, old) for p, old, _ in edits if new_src[p].count(old) != 1]
    if bad:
        print(f"{name}: PATTERN not found exactly once in {bad[0][0]} — NOT APPLIED")
        continue
    for p, old, new in edits:
        new_src[p] = new_src[p].replace(old, new)
    try:
        for p in paths:
            open(p, "w").write(new_src[p])
        out = subprocess.run(CMD, capture_output=True, text=True)
        text = out.stdout + out.stderr
        results = re.findall(r"^test result: .*$", text, re.M)
        failed = sorted(l.split()[1].split("::")[-1] for l in text.splitlines()
                        if l.startswith("test ") and l.rstrip().endswith("FAILED"))
        if not results:
            print(f"{name}: DID NOT BUILD\n" + "\n".join(text.splitlines()[-15:]))
        elif failed:
            killed += 1
            print(f"{name}: KILLED by {len(failed)}: " + ", ".join(failed))
            for m in re.finditer(r"thread '([^']+)' (?:\(\d+\) )?panicked at ([^\n]+):\n([^\n]+(?:\n[^\n]+){0,3})", text):
                msg = " | ".join(s.strip() for s in m.group(3).splitlines()
                                 if s.strip() and not s.startswith("note:"))
                print(f"    {m.group(1).split('::')[-1]} @ {m.group(2)}: {msg[:330]}")
        else:
            survived += 1
            print(f"{name}: SURVIVED  ({results[-1].strip()})")
    finally:
        for p in paths:
            subprocess.run(["git", "checkout", "--", p], check=True)
            os.utime(p, None)
        after = sh("git", "status", "--short", "crates")
        assert after == base_status, f"tree not restored: {after!r}"
    sys.stdout.flush()
print(f"TOTAL killed {killed}, survived {survived}; git status --short crates after: "
      f"{sh('git', 'status', '--short', 'crates').split()!r}")
