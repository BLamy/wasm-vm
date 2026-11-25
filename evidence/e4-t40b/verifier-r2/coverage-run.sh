#!/usr/bin/env bash
# Per-test hit counts from the instrumented release test binary (instrument_r2.py + instrument_atexit.py).
#   coverage-run.sh TEST_BINARY SCRATCH_DIR > coverage-hit-counts.txt
set -euo pipefail
BINT=$1; D=$2
mkdir -p "$D"; find "$D" -name '*.cov' -delete
TESTS=$("$BINT" --list 2>/dev/null | grep -E "^(turbo_equivalence_tests::|tests::(turbo_loop_takes_timer_interrupts_at_the_same_boundaries|replay_block_tail_is_unobservable|deferred_retire_accounting_is_unobservable): )" | sed 's/: test$//')
for t in $TESTS; do
  short=${t##*::}
  TURBO_COV_FILE="$D/$short.cov" "$BINT" --exact "$t" 2>&1 | grep -E "^test result" | sed "s/^/$short: /" >&2
done
python3 - "$D" <<'PY'
import sys, os, glob
d = sys.argv[1]
cols = {}
order = []
for f in sorted(glob.glob(d + '/*.cov')):
    name = os.path.basename(f)[:-4]
    counts = {}
    for line in open(f):
        _, n, key = line.split()
        counts[key] = counts.get(key, 0) + int(n)
        if key not in order: order.append(key)
    cols[name] = counts
worker = ['turbo_loop_takes_timer_interrupts_at_the_same_boundaries', 'replay_block_tail_is_unobservable', 'deferred_retire_accounting_is_unobservable']
committed = [n for n in cols if n not in worker]
print("E4-T40b verifier round 2: hit counts at runtime head a2233d307 (instrument_r2.py + instrument_atexit.py),")
print("release test binary, one process per test (`--exact`). Columns: the", len(committed), "committed")
print("turbo_equivalence_tests summed, the", len([n for n in worker if n in cols]), "older acceptance tests summed, all together.\n")
print(f"{'hunk':58} {'committed':>14} {'older':>12} {'all':>14}")
for k in order:
    a = sum(cols[n].get(k, 0) for n in committed); b = sum(cols[n].get(k, 0) for n in worker if n in cols)
    print(f"{k:58} {a:14d} {b:12d} {a+b:14d}")
print("\nPer test (the hunks of round-1 items 1-6, the assert site and the first-settle sites; zero rows omitted):")
keys = ['H_store_cleared_reservation','uncached_straddling_entry','uncached_straddling_entry_trap','inline_store_code_filter_false_positive','inline_store_code_hit_block_dropped','H_jalr','ordinary_op_live_work_accounting','ordinary_op_live_work_accounting_in_live_unrecorded_mode','enter_block_trap','H_variant_Lwu','H_variant_Lh','H_variant_Lhu','H_variant_Lbu','H_variant_Sh','H_variant_Blt','H_variant_Bge','H_variant_Bltu','H_variant_Bgeu','cached_block_entry_assert_site','code_write_log_NONEMPTY_at_block_entry','slow_op_is_first_settle_of_its_block','code_filter_hit_is_first_settle_of_its_block','settle_time_shadow_refresh']
for n in committed + [w for w in worker if w in cols]:
    print(f"\n{n}")
    for k in keys:
        v = cols[n].get(k, 0)
        if v: print(f"    {k:58} {v:12d}")
PY
