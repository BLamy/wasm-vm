#!/usr/bin/env bash
# E1-T24 — the Level 1 exit gate, run end-to-end from a cold start.
#
# Runs the four compliance legs, emits ONE consolidated report (target/level1-report.md), and
# exits 0 ONLY when every leg is green AND both deferral lists are empty. It is deliberately
# HONEST: while any riscv-tests-allowlist / RISCOF-EXCLUSIONS entry remains (each a feature
# deliberately deferred out of Level 1), the threshold is NOT met and this exits nonzero with a
# precise account of what is left — it never reports a green Level 1 it did not earn.
#
#   tools/level1_gate.sh                # run available legs, write the report, gate
#   LEVEL1_ALLOW_DIRTY=1 ...            # skip the clean-tree precondition (dev convenience)
#
# Legs:
#   A  native riscv-tests   (tools/run_riscv_tests.sh + the in-crate suites)
#   B  native RISCOF        (tools/run_riscof.sh; needs `bash compliance/provision.sh` + Docker)
#   C  native==wasm equality (tools/determinism_check.sh — T22 fingerprint proof)
#   D  wasm artifact identity (sha256 of web/pkg/*.wasm, if built)
#
# A leg whose prerequisites are absent is recorded as SKIPPED (not PASS) and makes the gate
# INCOMPLETE, never green. The report records git revs + pinned shas so the run is reproducible.
set -uo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"
REPORT="${REPORT:-$REPO/target/level1-report.md}"
mkdir -p "$(dirname "$REPORT")"

# --- accumulators (plain vars — macOS ships bash 3.2, no associative arrays) -------------------
GREEN=1        # all legs PASS?
COMPLETE=1     # no leg SKIPPED?
A_STATUS=""; A_DETAIL=""; B_STATUS=""; B_DETAIL=""
C_STATUS=""; C_DETAIL=""; D_STATUS=""; D_DETAIL=""

record() { # leg key (A|B|C|D), status (PASS|FAIL|SKIP), detail
  printf -v "${1}_STATUS" '%s' "$2"
  printf -v "${1}_DETAIL" '%s' "$3"
  case "$2" in
    FAIL) GREEN=0 ;;
    SKIP) COMPLETE=0 ;;
  esac
}

section() { echo; echo "=== $* ==="; }

# --- precondition: clean tree (a cold-start gate must not measure dev residue) -----------------
if [ "${LEVEL1_ALLOW_DIRTY:-0}" != "1" ]; then
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    echo "level1_gate: working tree is dirty — a cold-start gate must run on a clean checkout." >&2
    echo "             commit/stash, or set LEVEL1_ALLOW_DIRTY=1 to override for a dev run." >&2
    exit 2
  fi
fi

GIT_REV="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"

# --- deferral accounting (the crux of the honesty contract) -----------------------------------
ALLOW_FILE="$REPO/tests/riscv-tests-allowlist.txt"
EXCL_FILE="$REPO/compliance/EXCLUSIONS.md"
# `grep -c` prints "0" AND exits 1 on zero matches; a `|| echo 0` would then append a SECOND
# "0" ("0\n0"), which breaks `$((…))` exactly on the future zero-deferral MET path. Swallow
# grep's exit with `|| true` (keeps its printed count) and default an unreadable/missing file
# to 0 via `${VAR:-0}` — so a legitimately-zero count arithmetics cleanly.
ALLOW_N=$(grep -vcE '^\s*#|^\s*$' "$ALLOW_FILE" 2>/dev/null || true); ALLOW_N=${ALLOW_N:-0}
EXCL_N=$(grep -cE '\.S($|\s|#)' "$EXCL_FILE" 2>/dev/null || true); EXCL_N=${EXCL_N:-0}
DEFERRED_TOTAL=$((ALLOW_N + EXCL_N))

# --- Leg A: native riscv-tests ----------------------------------------------------------------
section "Leg A — native riscv-tests"
A_LOG="$(mktemp)"
if cargo test -p wasm-vm-core --features zicsr-stub --test riscv_tests >"$A_LOG" 2>&1 \
   && bash tools/run_riscv_tests.sh >>"$A_LOG" 2>&1; then
  if grep -qE 'test result: FAILED' "$A_LOG"; then
    record A FAIL "in-crate riscv-tests reported FAILED (see log)"
  else
    oks=$(grep -c 'test result: ok' "$A_LOG")
    record A PASS "$oks green riscv-tests suites; ${ALLOW_N} allowlisted (deferred)"
  fi
else
  grep -qE 'test result: FAILED' "$A_LOG" \
    && record A FAIL "riscv-tests FAILED" \
    || record A SKIP "riscv-tests could not run (see log) — prerequisites?"
fi
tail -3 "$A_LOG"

# --- Leg B: native RISCOF ---------------------------------------------------------------------
section "Leg B — native RISCOF (vs Spike)"
if [ -x "$REPO/compliance/.venv/bin/riscof" ] && docker image inspect wasm-vm-toolchain:local >/dev/null 2>&1; then
  B_LOG="$(mktemp)"
  if bash tools/run_riscof.sh >"$B_LOG" 2>&1; then
    passed=$(grep -oE '[0-9]+ passed' "$B_LOG" | tail -1 | grep -oE '[0-9]+' || true)
    passed=${passed:-0}
    # A "green" RISCOF run that actually ran ZERO tests (missing suite path, half-provision)
    # is vacuous, not a PASS — require positive coverage so leg B can't rubber-stamp nothing.
    if [ "$passed" -gt 0 ] 2>/dev/null; then
      record B PASS "RISCOF green (0 unexcused); ${EXCL_N} EXCLUSIONS entries (deferred); ${passed} passed"
    else
      record B FAIL "RISCOF ran 0 tests (vacuous — suite path / provisioning issue), not a real pass"
    fi
  else
    record B FAIL "RISCOF reported an UNEXCUSED failure (see log)"
  fi
  tail -4 "$B_LOG"
else
  record B SKIP "not provisioned (need 'bash compliance/provision.sh' + Docker image wasm-vm-toolchain:local)"
  echo "  RISCOF prerequisites absent — leg skipped."
fi

# --- Leg C: native == wasm equality (T22 determinism fingerprints) ----------------------------
section "Leg C — native==wasm equality (determinism fingerprints)"
C_LOG="$(mktemp)"
if bash tools/determinism_check.sh >"$C_LOG" 2>&1; then
  record C PASS "native and wasm builds match the frozen golden fingerprints (T22)"
else
  grep -qiE 'wasm-pack|wasm32|target' "$C_LOG" && ! grep -qE 'test result: FAILED' "$C_LOG" \
    && record C SKIP "wasm toolchain absent (wasm-pack / wasm32 target) — equality leg skipped" \
    || record C FAIL "determinism check FAILED (native/wasm divergence or golden mismatch)"
fi
tail -3 "$C_LOG"

# --- Leg D: wasm artifact identity ------------------------------------------------------------
section "Leg D — wasm artifact identity"
WASM_ART="$(ls "$REPO"/web/pkg/*_bg.wasm 2>/dev/null | head -1 || true)"
if [ -n "$WASM_ART" ]; then
  WASM_SHA=$(shasum -a 256 "$WASM_ART" | awk '{print $1}')
  record D PASS "web/pkg $(basename "$WASM_ART") sha256=${WASM_SHA:0:16}…"
else
  WASM_SHA="(not built)"
  record D SKIP "no web/pkg/*_bg.wasm — run 'make web-build' to produce the browser artifact"
fi

# --- verdict ----------------------------------------------------------------------------------
THRESHOLD_MET=0
if [ "$GREEN" = 1 ] && [ "$COMPLETE" = 1 ] && [ "$DEFERRED_TOTAL" -eq 0 ]; then
  THRESHOLD_MET=1
fi

# --- write the consolidated report ------------------------------------------------------------
{
  echo "# Level 1 compliance gate report"
  echo
  if [ "$THRESHOLD_MET" = 1 ]; then
    echo "**VERDICT: ✅ LEVEL 1 THRESHOLD MET** — all legs green, zero deferrals."
  elif [ "$GREEN" = 1 ] && [ "$COMPLETE" = 1 ]; then
    echo "**VERDICT: ⏳ NOT YET MET** — all runnable legs green, but **${DEFERRED_TOTAL} documented deferrals remain** (the gate requires zero)."
  else
    echo "**VERDICT: ❌ NOT MET** — a leg FAILED or was SKIPPED (incomplete), and ${DEFERRED_TOTAL} deferrals remain."
  fi
  echo
  echo "- git: \`$GIT_REV\` (branch \`$GIT_BRANCH\`)"
  echo "- generated by \`tools/level1_gate.sh\`"
  echo
  echo "## Legs"
  echo
  echo "| leg | what | status | detail |"
  echo "|---|---|---|---|"
  echo "| A | native riscv-tests | ${A_STATUS} | ${A_DETAIL} |"
  echo "| B | native RISCOF vs Spike | ${B_STATUS} | ${B_DETAIL} |"
  echo "| C | native==wasm equality | ${C_STATUS} | ${C_DETAIL} |"
  echo "| D | wasm artifact identity | ${D_STATUS} | ${D_DETAIL} |"
  echo
  echo "## Deferral accounting (must reach zero for the threshold)"
  echo
  echo "- riscv-tests allowlist (\`tests/riscv-tests-allowlist.txt\`): **${ALLOW_N}**"
  echo "- RISCOF exclusions (\`compliance/EXCLUSIONS.md\`): **${EXCL_N}**"
  echo "- **total deferred: ${DEFERRED_TOTAL}**"
  echo
  echo "Remaining deferrals map to these Level-1-out-of-scope features (each its own follow-on task):"
  echo "Sv57 5-level paging (38) · 64-region PMP (4) · exception-priority §3.7.1 (1) ·"
  echo "unaligned-access mode / \`ma_data\` (1) · debug triggers tdata1/2 / \`breakpoint\` (1)."
  echo
  echo "## Pins (reproducibility)"
  echo
  echo "- wasm artifact sha256: \`${WASM_SHA}\`"
  echo "- toolchain image: \`wasm-vm-toolchain:local\` (Spike reference; see tools/toolchain/versions.env)"
  echo "- riscv-arch-test: pinned by \`compliance/provision.sh\` (\`riscof arch-test --clone\`)"
  echo
  echo "_Generated $([ -n "${SOURCE_DATE_EPOCH:-}" ] && echo "at SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH" || echo "on demand")._"
} > "$REPORT"

section "Summary"
echo "legs: A=${A_STATUS} B=${B_STATUS} C=${C_STATUS} D=${D_STATUS}"
echo "deferrals remaining: ${DEFERRED_TOTAL} (allowlist ${ALLOW_N} + EXCLUSIONS ${EXCL_N})"
echo "report: $REPORT"

if [ "$THRESHOLD_MET" = 1 ]; then
  echo "LEVEL 1 THRESHOLD MET ✅"
  exit 0
fi
if [ "$GREEN" = 1 ] && [ "$COMPLETE" = 1 ]; then
  echo "LEVEL 1 NOT YET MET ⏳ — ${DEFERRED_TOTAL} deferrals must be burned to zero." >&2
  exit 1
fi
echo "LEVEL 1 NOT MET ❌ — a leg failed or was skipped (see report)." >&2
exit 1
