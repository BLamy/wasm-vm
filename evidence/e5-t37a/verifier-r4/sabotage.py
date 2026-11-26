#!/usr/bin/env python3
"""E5-T37a round-4 verifier — mutation run. Run from the repo root.

One mutant at a time. Each is run against the WORKER's tests
(`cargo test -p wasm-vm-core --lib paced_idle`, 24 tests) unless the mutant names other
filters. For every failing test the panic location and message are printed, so the log names
the assertion, not only the test. After each mutant every touched file is restored with
`git checkout`, re-touched (cargo fingerprints by mtime), and `git status --short crates` must be
what it was when the script started (empty in pass 1).

A mutant may also put a file back to an EARLIER revision for the run (`old=`): the same
mutation against the tests as they stood at the head round 3 verified shows whether it is the
round-4 lines that kill it.

  python3 evidence/e5-t37a/verifier-r4/sabotage.py                 # everything
  python3 evidence/e5-t37a/verifier-r4/sabotage.py B11 M1          # by name prefix
  python3 evidence/e5-t37a/verifier-r4/sabotage.py --suite M1 B11  # against the promoted
        verifier tests as well (`-- paced_idle v37a_ r2_ r3_ r4_`); needs them wired in
"""
import re
import subprocess
import sys

LIB, TIME = "crates/core/src/lib.rs", "crates/core/src/time.rs"
TESTS = "crates/core/src/turbo_equivalence_tests.rs"
R3 = "7fd2e0160"  # the head round 3 verified (crates identical at 7d25929a7)

B11 = (TIME, ".saturating_add(ticks_of(self.latest_host_ns - before));",
       ".saturating_add(ticks_of(self.latest_host_ns - self.anchor_host_ns));")
B3 = (LIB, "level(5, c.mtime >= self.sbi_state.stimecmp);",
      "level(5, c.mtime > self.sbi_state.stimecmp);")
FLAG = "        self.waiting = limited < deadline;"
GETTER = "    pub fn waiting(&self) -> bool {\n        self.waiting\n    }"
REBASE = ("        *self = Self::new(host_ns, mtime, self.timebase_hz);\n"
          "        self.max_busy_lag_ticks = max_busy_lag_ticks;")
M1 = (TIME, "            .min(ceiling.saturating_sub(limited));",
      "            .min(ceiling.saturating_sub(current));")
M2 = (LIB, "level(5, c.mtime >= self.sbi_state.stimecmp);",
      "level(5, c.mtime.saturating_add(1) >= self.sbi_state.stimecmp);")
M3 = [
    (TIME,
     "        } else {\n            self.owed_wait_ticks = self\n                .owed_wait_ticks\n"
     "                .saturating_add(ticks_of(self.latest_host_ns - before));\n        }\n",
     "        }\n        let waited_now = if worked {\n            0\n        } else {\n"
     "            ticks_of(self.latest_host_ns - before)\n        };\n"),
    (TIME,
     "            .saturating_sub(limited - current)\n            .min(ceiling.saturating_sub(limited));",
     "            .saturating_sub(limited - current)\n            .saturating_add(waited_now)\n"
     "            .min(ceiling.saturating_sub(limited));"),
]
SYNC = (LIB, ".set_mip_bit(5, mtime >= self.sbi_state.stimecmp); // STIP",
        ".set_mip_bit(5, mtime > self.sbi_state.stimecmp); // STIP")

# (name, edits, files put back to round 3's revision for the run, cargo test filters)
M = [
    # ── the round-3 verifier's three survivors, exactly as its sabotage.py applied them ──
    ("B11 owed time accumulates the whole span since the anchor at every consultation",
     [B11], [], ["paced_idle"]),
    ("B11@r3 the same, against the pacer test as round 3 saw it",
     [B11], [TIME], ["paced_idle"]),
    ("B3 fresh_mip: STIP level with `>`", [B3], [], ["paced_idle"]),
    ("B3@r3 the same, against the fresh_mip test as round 3 saw it",
     [B3], [TESTS], ["paced_idle"]),
    ("B12 the pacer's `waiting` flag never set (round 3's form)",
     [(TIME, FLAG, "        self.waiting = false;")], [], ["paced_idle"]),
    # ── W: `IdlePacer::waiting()` — is it decided by a test? ──
    ("W1 waiting() always false",
     [(TIME, GETTER, GETTER.replace("self.waiting\n", "let _ = self.waiting;\n        false\n"))],
     [], ["paced_idle"]),
    ("W2 waiting() always true",
     [(TIME, GETTER, GETTER.replace("self.waiting\n", "let _ = self.waiting;\n        true\n"))],
     [], ["paced_idle"]),
    ("W4 the flag set at a reached deadline too (`<` -> `<=`)",
     [(TIME, FLAG, "        self.waiting = limited <= deadline;")], [], ["paced_idle"]),
    ("W5 the flag judged before the jump (`limited` -> `current`)",
     [(TIME, FLAG, "        self.waiting = current < deadline;")], [], ["paced_idle"]),
    ("W6 a rebase keeps the flag",
     [(TIME, REBASE, "        let waiting = self.waiting;\n" + REBASE + "\n        self.waiting = waiting;")],
     [], ["paced_idle"]),
    # ── M: mine, in the lines the round-4 tests touch or claim to pin ──
    ("M1 the owed-time cap judged before the jump (`ceiling - limited` -> `ceiling - current`)",
     [M1], [], ["paced_idle"]),
    ("M2 fresh_mip: the S-timer level one tick early (`mtime + 1 >= stimecmp`)",
     [M2], [], ["paced_idle"]),
    ("M2@r3 the same, against the fresh_mip test as round 3 saw it",
     [M2], [TESTS], ["paced_idle"]),
    ("M3 the jump is taken from what was owed BEFORE this consultation's waiting time is added",
     M3, [], ["paced_idle"]),
    ("M3@r3 the same, against the pacer test as round 3 saw it",
     M3, [TIME], ["paced_idle"]),
    # ── P: probe, not a mutant of the task: the reference of the fresh_mip test moves with it ──
    ("P3b `>` in BOTH fresh_mip and sync_sbi_timer, against the whole core suite",
     [B3, SYNC], [], []),
]


def cargo(filters):
    out = subprocess.run(
        ["cargo", "test", "-p", "wasm-vm-core", "--lib", "--"] + filters,
        capture_output=True, text=True,
    )
    text = out.stdout + out.stderr
    failed = sorted(
        line.split()[1]
        for line in text.splitlines()
        if line.startswith("test ") and line.rstrip().endswith("FAILED")
    )
    ran = re.findall(r"test result: \w+\. (\d+) passed; (\d+) failed", text)
    panics = {}
    for block in re.split(r"\n---- ", text)[1:]:
        name = block.split(" ", 1)[0]
        lines = [l for l in block.splitlines()[1:] if l.strip()]
        keep = []
        for l in lines:
            if l.startswith("note: run with") or l.startswith("failures:"):
                break
            keep.append(l)
        panics[name] = keep[:6]
    return ran, failed, panics


def crates_status():
    return subprocess.run(
        ["git", "status", "--short", "crates"], capture_output=True, text=True
    ).stdout.strip()


# The tree the run starts from: clean (pass 1), or clean plus the promoted verifier tests
# (`--suite`: the include! lines in turbo_equivalence_tests.rs and the new directory). Every
# mutant must leave exactly this behind.
BASELINE = crates_status()


def restore(paths):
    for path in paths:
        subprocess.run(["git", "checkout", "--", path], check=True)
        subprocess.run(["touch", path], check=True)
    assert crates_status() == BASELINE, crates_status()


def report(label, ran, failed, panics):
    if not ran:
        print(f"    {label}: DID NOT BUILD", flush=True)
        return
    passed, nfailed = ran[-1]
    if not failed:
        print(f"    {label}: SURVIVED ({passed} passed, 0 failed)", flush=True)
        return
    print(f"    {label}: KILLED by {len(failed)} ({passed} passed, {nfailed} failed)", flush=True)
    for name in failed:
        print(f"      {name}")
        for l in panics.get(name, []):
            print(f"        | {l}")
    sys.stdout.flush()


def main():
    args = sys.argv[1:]
    suite = "--suite" in args
    only = [a for a in args if a != "--suite"]
    for name, edits, old, filters in M:
        if only and not any(name.split()[0] == o for o in only):
            continue
        touched = sorted({p for p, _, _ in edits} | set(old))
        if any(path in BASELINE for path in touched):
            print(f"{name}: skipped — it rewrites a file the starting tree has changed", flush=True)
            continue
        try:
            src = {}
            for path in touched:
                if path in old:
                    src[path] = subprocess.run(
                        ["git", "show", f"{R3}:{path}"], capture_output=True, text=True, check=True
                    ).stdout
                else:
                    src[path] = open(path).read()
            ok = True
            for path, a, b in edits:
                if src[path].count(a) != 1:
                    print(f"{name}: PATTERN x{src[path].count(a)} in {path} — not applied", flush=True)
                    ok = False
                    break
                src[path] = src[path].replace(a, b)
            if not ok:
                continue
            for path in touched:
                open(path, "w").write(src[path])
            print(name, flush=True)
            if old:
                print(f"    ({', '.join(old)} as at {R3}, plus the mutation)")
            label = "worker's tests (paced_idle)" if filters == ["paced_idle"] else "whole core lib suite"
            report(label, *cargo(filters))
            if suite:
                report("+ the promoted verifier tests (paced_idle v37a_ r2_ r3_ r4_)",
                       *cargo(["paced_idle", "v37a_", "r2_", "r3_", "r4_"]))
        finally:
            restore(touched)


if __name__ == "__main__":
    main()
