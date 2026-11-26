#!/usr/bin/env python3
"""E5-T37a round-5 verifier — SUITE: promote the verifiers' tests into the crate.

This is the round-4 verifier's `evidence/e5-t37a/verifier-r4/promote.py` with three changes,
all of them about WHO and WHAT, none about any test body:

  * the headers name the round-5 verifier as the promoter (round 4 wrote its script expecting
    to promote; its verdict was `needs-evidence` and it promoted nothing — its entry in the task
    file says "whoever promotes must correct them");
  * round 4's own file (`verifier-r4/verifier_r4_tests.rs`) is promoted by this script too, as
    round4.rs, with a header that says so (round 4 left that copy to be made by hand);
  * if `verifier_r5_tests.rs` exists beside this script it is promoted as round5.rs.

Run from the root of the tree to promote into (the repository, or a scratch clone of it that has
`evidence/e5-t37a/verifier{,-r2,-r3,-r4}/` checked out):

  python3 <repo>/evidence/e5-t37a/verifier-r5/promote.py <an existing scratch dir>

What it does, and nothing else:

1. runs the ROUND 3 verifier's tool,
   `evidence/e5-t37a/verifier-r3/adapt-earlier-verifier-files.py <scratch dir> --lint`, which
   reads the round-1 and round-2 verifiers' evidence files and writes them adapted to the round-3
   contract (r1.rs, r2.rs) — see that tool's docstring for the edits;
2. replaces the header comment of each file (the block between its first two rule lines) with
   one that says who wrote the file, in which round, what was adapted and by whom, and who
   promoted it;
3. writes them to `crates/core/src/paced_idle_verifier_tests/round{1..5}.rs`, runs rustfmt on
   them (`cargo fmt` does not reach `include!`d files), and checks that below the header each
   promoted file is byte-identical to its source (rounds 3, 4, 5) or to the round-3 tool's
   output (rounds 1, 2);
4. appends the `include!` lines to `crates/core/src/turbo_equivalence_tests.rs` if they are not
   there.

Promoted tests must live under `crates/`: a cold clone without `evidence/` has to build.
"""
import hashlib
import os
import subprocess
import sys

scratch = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
RULE = "// " + "─" * 93 + "\n"
DEST = "crates/core/src/paced_idle_verifier_tests"
WIRE = "crates/core/src/turbo_equivalence_tests.rs"
SRC = {
    1: "evidence/e5-t37a/verifier/verifier_tests.rs",
    2: "evidence/e5-t37a/verifier-r2/verifier_r2_tests.rs",
    3: "evidence/e5-t37a/verifier-r3/verifier_r3_tests.rs",
    4: "evidence/e5-t37a/verifier-r4/verifier_r4_tests.rs",
    5: "evidence/e5-t37a/verifier-r5/verifier_r5_tests.rs",
}
TOOL = "evidence/e5-t37a/verifier-r3/adapt-earlier-verifier-files.py"
R5_FILE = os.path.join(HERE, "verifier_r5_tests.rs")
ROUNDS = (1, 2, 3, 4, 5) if os.path.exists(R5_FILE) else (1, 2, 3, 4)


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()[:12]


def split_header(src):
    """(header, body): the header is the block between the first two rule lines, inclusive."""
    assert src.startswith(RULE), src[:80]
    end = src.index(RULE, len(RULE)) + len(RULE)
    return src[:end], src[end:]


ORDER = ", ".join(f"round{n}" for n in ROUNDS)
COMMON = f"""\
// Part of the suite since the task's `verified` verdict (round 5, 2026-11-26): promoted from
// `evidence/` by the ROUND 5 verifier with evidence/e5-t37a/verifier-r5/promote.py.
// `include!`d by `../turbo_equivalence_tests.rs`, in order {ORDER}:
// each file uses that module's assembler and helpers and those of the files before it (rounds
// 1 and 2 also use `R3Vouch` and `r3_levels` from round3.rs). None of these tests has
// `paced_idle` in its path, so the task's acceptance command
// `cargo test -p wasm-vm-core --lib paced_idle` selects the worker's tests only, as before.
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
// The promoting verifier (round 5) wrote this header and changed no line below it.
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
// The promoting verifier (round 5) wrote this header and changed no line below it.
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
// Nothing differs from the source below this header (the promoting verifier, round 5, wrote
// the header only; the source was already rustfmt- and clippy-clean).
""" + RULE,
    4: RULE + f"""\
// E5-T37a — the ROUND 4 VERIFIER's tests (verdict `needs-evidence`, commit 84bb49b1a). Written
// by the first round-4 critic session, which was interrupted before it wrote a verdict, and
// checked by the second, which wrote it (neither is the worker or an earlier verifier): the
// pacer (`time::IdlePacer`) alone. Every test name starts `r4_`.
//
// Source: {SRC[4]} (sha256 {{src}}).
{COMMON}//
// Why they exist: the cap on owed waiting time judged BEFORE the idle jump instead of after it
// (`time.rs`, `.min(ceiling.saturating_sub(limited))` -> `…sub(current)`) survived every test
// that existed in round 4; it lets a busy guest skip a debt it has already been paid on top of
// its bound. `r4_nothing_is_owed_beyond_…` states the behaviour with numbers derived from the
// task's Boundary; `r4_pacer_agrees_with_an_anchor_free_model_…` holds the whole pacer against
// the same rules written a second time, without its bookkeeping. (Since round 5 the worker's
// `paced_idle_owed_time_is_capped_by_the_host_lead_after_the_jump` kills that mutant too.)
//
// Nothing differs from the source below this header (the promoting verifier, round 5, wrote
// the header only).
""" + RULE,
    5: RULE + f"""\
// E5-T37a — the ROUND 5 VERIFIER's tests (verdict `verified`). Written by a fresh critic
// session — not the worker and none of the four earlier verifiers. Every test name starts
// `r5_`.
//
// Source: {SRC[5]} (sha256 {{src}}).
{COMMON}//
// Why they exist: two mutants of the task's code that are not equivalent survived the worker's
// 25 `paced_idle` tests in round 5 (evidence/e5-t37a/verifier-r5/sabotage.log, F5 and G5).
// Each test below states the behaviour with numbers derived from the task's Boundary and fails
// on its mutant (sabotage-suite.log beside it).
//
// Nothing differs from the source below this header.
""" + RULE,
}

subprocess.run(["python3", TOOL, scratch, "--lint"], check=True)
subprocess.run(["mkdir", "-p", DEST], check=True)
staged = {1: f"{scratch}/r1.rs", 2: f"{scratch}/r2.rs", 3: SRC[3], 4: SRC[4], 5: R5_FILE}
src_for_sha = dict(SRC)
src_for_sha[5] = R5_FILE
for n in ROUNDS:
    _, body = split_header(open(staged[n]).read())
    header = HEADERS[n].replace("{src}", sha(src_for_sha[n])).replace("{tool}", sha(TOOL))
    long = [l for l in header.splitlines() if len(l) > 100]
    assert not long, long
    dest = f"{DEST}/round{n}.rs"
    open(dest, "w").write(header + body)
    subprocess.run(["rustfmt", "--edition", "2024", dest], check=True)
    promoted_header, promoted_body = split_header(open(dest).read())
    same = promoted_body == body and promoted_header == header
    tests = promoted_body.count("\n#[test]\n")
    print(f"{dest}: {tests} tests; below the header byte-identical to {staged[n]}: {same}")
    assert same

wire = open(WIRE).read()
lines = "".join(f'include!("paced_idle_verifier_tests/round{n}.rs");\n' for n in ROUNDS)
names = ", ".join(f"`{p}`" for p in ("v37a_", "r2_", "r3_", "r4_", "r5_")[:len(ROUNDS)])
if "paced_idle_verifier_tests/" not in wire:
    wire += (
        f"\n// ── E5-T37a: the {len(ROUNDS)} verifiers' tests, promoted with the `verified` verdict "
        "(round 5).\n"
        "//    Each file's header says who wrote it, in which round, and what was adapted. Their\n"
        f"//    names start {names}:\n"
        "//    none matches the worker's `paced_idle` filter. ──\n" + lines
    )
    open(WIRE, "w").write(wire)
    print(f"{WIRE}: include! lines appended for rounds {ROUNDS}")
else:
    print(f"{WIRE}: already wired")
