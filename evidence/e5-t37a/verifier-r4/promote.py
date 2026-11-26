#!/usr/bin/env python3
"""E5-T37a round-4 verifier — SUITE: promote the three earlier verifiers' tests into the crate.

Run from the repo root:

  python3 evidence/e5-t37a/verifier-r4/promote.py <scratch dir>

What it does, and nothing else:

1. runs the ROUND 3 verifier's own tool,
   `evidence/e5-t37a/verifier-r3/adapt-earlier-verifier-files.py <scratch dir> --lint`, which
   reads the round-1 and round-2 verifiers' evidence files and writes them adapted to the round-3
   contract (r1.rs, r2.rs) — see that tool's docstring for the edits;
2. takes those two files and `evidence/e5-t37a/verifier-r3/verifier_r3_tests.rs` and replaces the
   header comment of each (the old ones say how to build from `evidence/`, or name the round-3
   verifier as the promoter) with one that says who wrote the file, in which round, what was
   adapted and by whom;
3. writes them to `crates/core/src/paced_idle_verifier_tests/round{1,2,3}.rs`, runs rustfmt on
   them (`cargo fmt` does not reach `include!`d files), and
4. appends the `include!` lines to `crates/core/src/turbo_equivalence_tests.rs` if they are not
   there (round4.rs, the round-4 verifier's own file, is written by hand and included last).

No test body is changed by this script: `diff` of each promoted file against its source, below
the header, is printed and must be empty (round 3) or exactly the round-3 tool's edits (rounds 1
and 2). Promoted tests must live under `crates/`: a cold clone without `evidence/` has to build.
"""
import hashlib
import subprocess
import sys

scratch = sys.argv[1]
RULE = "// " + "─" * 93 + "\n"
DEST = "crates/core/src/paced_idle_verifier_tests"
WIRE = "crates/core/src/turbo_equivalence_tests.rs"
SRC = {
    1: "evidence/e5-t37a/verifier/verifier_tests.rs",
    2: "evidence/e5-t37a/verifier-r2/verifier_r2_tests.rs",
    3: "evidence/e5-t37a/verifier-r3/verifier_r3_tests.rs",
}
TOOL = "evidence/e5-t37a/verifier-r3/adapt-earlier-verifier-files.py"


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()[:12]


def split_header(src):
    """(header, body): the header is the block between the first two rule lines, inclusive."""
    assert src.startswith(RULE), src[:80]
    end = src.index(RULE, len(RULE)) + len(RULE)
    return src[:end], src[end:]


COMMON = """\
// Part of the suite since the task's `verified` verdict: promoted from `evidence/` by the
// ROUND 4 verifier (2026-11-26) with evidence/e5-t37a/verifier-r4/promote.py. `include!`d by
// `../turbo_equivalence_tests.rs`, in order round1, round2, round3, round4: each file uses that
// module's assembler and helpers and those of the files before it (rounds 1 and 2 also use
// `R3Vouch` and `r3_levels` from round3.rs). None of these tests has `paced_idle` in its path,
// so the task's acceptance command `cargo test -p wasm-vm-core --lib paced_idle` is unchanged.
"""

HEADERS = {
    1: RULE + f"""\
// E5-T37a — the ROUND 1 VERIFIER's tests (verdict `refuted`, commit dacc2ae14). Written by a
// fresh critic session, not the worker: own guests, own host clocks, own parameters. Every test
// name starts `v37a_`.
//
// Source: {SRC[1]} (sha256 {{src}}).
{COMMON}//
// A name ending `_REFUTES` marks a test that refuted the round-1 submission (it failed at head
// e4599fe73). They pass since round 2 and stay as regressions.
//
// What differs from the source, all of it made by the ROUND 3 verifier's tool
// ({TOOL} --lint, sha256 {{tool}})
// because round 3 narrowed the contract to "a reported wait is always true; a true wait is not
// always reported":
//   * the lockstep harness (`v_lockstep`) keeps its own predicate and requires a waiting `wfi`
//     to be reported only if, in addition, no enabled interrupt is pending per the levels the
//     boundary samples (`r3_levels`) and the subject's call can vouch for the devices
//     (`R3Vouch`);
//   * `v37a_busy_lag_is_exactly_the_bound_once_and_waiting_passes_in_full` single-steps to the
//     ENTRY of the `wfi`'s block instead of to the `wfi`, so that its long call begins at a
//     block boundary and reports its first `wfi`; the tick arithmetic covers that block;
//   * rustfmt.
// The round-4 verifier changed this header and no line below it.
""" + RULE,
    2: RULE + f"""\
// E5-T37a — the ROUND 2 VERIFIER's tests (verdict `refuted`, commit 8785603dd). Written by a
// fresh critic session, not the worker and not the round-1 verifier: own guests, own host
// clocks, own parameters. Every test name starts `r2_`.
//
// Source: {SRC[2]} (sha256 {{src}}).
{COMMON}//
// A name ending `_REFUTES` marks a test that refuted the round-2 submission (it failed at head
// d8db32db8). They pass since round 3 and stay as regressions.
//
// What differs from the source, all of it made by the ROUND 3 verifier's tool
// ({TOOL} --lint, sha256 {{tool}}):
//   * the lockstep predicate: round 3 reports a wait only when the run call can vouch for the
//     devices, so the harness's own device term ("no fabric access since the last sampled
//     boundary") is replaced by `R3Vouch`, and the PLIC's levels are counted (`r3_levels`);
//   * five clippy lints (`assert_eq!(x, true)`, four `% n == 0` -> `is_multiple_of`), no
//     behaviour; rustfmt.
// The round-4 verifier changed this header and no line below it.
""" + RULE,
    3: RULE + f"""\
// E5-T37a — the ROUND 3 VERIFIER's tests (verdict `needs-evidence`, commit 21f6a8413). Written
// by a fresh critic session, not the worker and not the round-1 or round-2 verifier: own guests,
// own host clocks, own parameters. Every test name starts `r3_`.
//
// Source: {SRC[3]} (sha256 {{src}}).
{COMMON}//
// The round-3 contract: "a reported wait is always true; a true wait is not always reported".
// SAFETY tests fail on any reported wait that something other than the host can end before its
// deadline. COMPLETENESS tests say when a true wait is reported and when it is not.
//
// Nothing differs from the source below this header (the round-4 verifier changed the header
// only; the source was already rustfmt- and clippy-clean).
""" + RULE,
}

subprocess.run(["python3", TOOL, scratch, "--lint"], check=True)
subprocess.run(["mkdir", "-p", DEST], check=True)
staged = {1: f"{scratch}/r1.rs", 2: f"{scratch}/r2.rs", 3: SRC[3]}
for n in (1, 2, 3):
    _, body = split_header(open(staged[n]).read())
    header = HEADERS[n].replace("{src}", sha(SRC[n])).replace("{tool}", sha(TOOL))
    assert all(len(l) <= 100 for l in header.splitlines()), [l for l in header.splitlines() if len(l) > 100]
    dest = f"{DEST}/round{n}.rs"
    open(dest, "w").write(header + body)
    subprocess.run(["rustfmt", "--edition", "2024", dest], check=True)
    _, promoted_body = split_header(open(dest).read())
    same = promoted_body == body
    tests = promoted_body.count("\n#[test]\n")
    print(f"{dest}: {tests} tests; body identical to {staged[n]} below the header: {same}")
    assert same

wire = open(WIRE).read()
lines = "".join(f'include!("paced_idle_verifier_tests/round{n}.rs");\n' for n in (1, 2, 3, 4))
if "paced_idle_verifier_tests/" not in wire:
    wire += (
        "\n// ── E5-T37a: the four verifiers' tests, promoted with the `verified` verdict. Each file's\n"
        "//    header says who wrote it, in which round, and what was adapted. Names start `v37a_`,\n"
        "//    `r2_`, `r3_`, `r4_` — none matches the worker's `paced_idle` filter. ──\n" + lines
    )
    open(WIRE, "w").write(wire)
    print(f"{WIRE}: include! lines appended")
else:
    print(f"{WIRE}: already wired")
