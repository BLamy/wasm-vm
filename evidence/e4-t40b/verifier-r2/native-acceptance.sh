#!/usr/bin/env bash
# E4-T40b verifier round 2: the native acceptance commands at HEAD, one configuration of my own,
# and the same workloads under a release build with debug assertions and overflow checks on
# (the attack on the new `debug_assert!` at turbo.rs:365).
#   native-acceptance.sh HEAD_BIN DBGASSERT_BIN      (run from anywhere; logs land beside this file)
set -uo pipefail
E=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$E/../../.." && pwd)
cd "$REPO"
BIN=$1
DBG=$2
turbo_lines() { for f in "$1"/logs/*.err; do printf '%-18s %s\n' "$(basename "$f" .err)" "$(grep -h '^turbo:' "$f" || echo 'no turbo line')"; done; }
panics() { grep -l 'panicked\|assertion' "$@" 2>/dev/null | sed 's/^/PANIC in /' || true; echo "panic scan done"; }

echo "== A2 oracle (HEAD binary) $(date -u +%FT%TZ)" > "$E/oracle.log"
shasum -a 256 "$BIN" >> "$E/oracle.log"
bash tools/perf/oracle.sh "$BIN" target/verifier-r2-oracle >> "$E/oracle.log" 2>&1
diff -r evidence/perf-overhaul/oracle-baseline target/verifier-r2-oracle/digests >> "$E/oracle.log" 2>&1
echo "diff rc=$? (1 with only the README line = reproduced)" >> "$E/oracle.log"
turbo_lines target/verifier-r2-oracle >> "$E/oracle.log"
mkdir -p "$E/oracle-digests" && cp target/verifier-r2-oracle/digests/*.txt "$E/oracle-digests/"

echo "== A3 turbo-equivalence.sh 2000000000 (HEAD binary) $(date -u +%FT%TZ)" > "$E/equivalence-2b.log"
BIN=$BIN bash tools/perf/turbo-equivalence.sh 2000000000 target/verifier-r2-equiv >> "$E/equivalence-2b.log" 2>&1
echo "rc=$?" >> "$E/equivalence-2b.log"

echo "== A3b own configuration: N=1618033989 seed=271828 quantum=9973 (HEAD binary) $(date -u +%FT%TZ)" > "$E/equivalence-own.log"
REPO=$REPO BIN=$BIN SEED=271828 QUANTUM=9973 bash "$E/turbo-equivalence-param.sh" 1618033989 target/verifier-r2-equiv-own >> "$E/equivalence-own.log" 2>&1
echo "rc=$?" >> "$E/equivalence-own.log"

echo "== D-a oracle fast cases, release + debug-assertions + overflow-checks $(date -u +%FT%TZ)" > "$E/oracle-dbgassert.log"
shasum -a 256 "$DBG" >> "$E/oracle-dbgassert.log"
ORACLE_CASES="busybox-fast alpine-fast" bash tools/perf/oracle.sh "$DBG" target/verifier-r2-oracle-dbg >> "$E/oracle-dbgassert.log" 2>&1
for c in busybox-fast alpine-fast; do
  cmp evidence/perf-overhaul/oracle-baseline/$c.txt target/verifier-r2-oracle-dbg/digests/$c.txt >> "$E/oracle-dbgassert.log" 2>&1 \
    && echo "$c: digest equals the baseline" >> "$E/oracle-dbgassert.log" || echo "$c: DIGEST DIFFERS OR MISSING" >> "$E/oracle-dbgassert.log"
done
turbo_lines target/verifier-r2-oracle-dbg >> "$E/oracle-dbgassert.log"
panics target/verifier-r2-oracle-dbg/logs/*.err >> "$E/oracle-dbgassert.log"

echo "== D-a desktop equivalence 2000000000, release + debug-assertions + overflow-checks $(date -u +%FT%TZ)" > "$E/equivalence-dbgassert.log"
REPO=$REPO BIN=$DBG bash "$E/turbo-equivalence-param.sh" 2000000000 target/verifier-r2-equiv-dbg >> "$E/equivalence-dbgassert.log" 2>&1
echo "rc=$?" >> "$E/equivalence-dbgassert.log"
panics target/verifier-r2-equiv-dbg/*.err >> "$E/equivalence-dbgassert.log"
echo "NATIVE_DONE $(date -u +%FT%TZ)"
