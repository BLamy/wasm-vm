#!/usr/bin/env bash
# E0-T26 capstone (automated portion): prove the Level 0 threshold end-to-end. Runs the
# full epic regression, then executes `hello.elf` through THREE independent engines and
# byte-compares their instruction traces:
#
#   native (wasm-vm-cli --trace)  ==  node-wasm (WasmMachine.take_trace)  ==  Spike (normalized)
#
# "Byte-for-byte" = `cmp` exit 0 (never `diff -w`) over the E0-T16 canonical trace at commit
# level (pc + insn + rd writebacks), for the complete hello run from entry to HTIF exit.
#
# Cold start: run this from a pristine clone via `tools/verify/cold_clone.sh capstone-e0`
# (acceptance 1). Set CAPSTONE_SKIP_VERIFY_ALL=1 to skip the full `make verify-all` regression
# during fast local iteration (the trace proof always runs).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "${here}/../.." && pwd)"
cd "${repo_root}"

# The workload ELF — overridable so the sensitivity test can point the whole apparatus at
# a one-byte-mutated copy (it MUST then go RED).
hello="${CAPSTONE_ELF:-guest/prebuilt/hello.elf}"
expected_stdout="Hello from RV64"
# FROZEN content anchor (E0-T17): hello.elf's SHA-256 over 128 MiB of guest RAM at exit.
# The three-engine cross-check alone is golden-less — it would pass a mutation that keeps
# all engines mutually consistent and preserves stdout+count (verifier caveat). Pinning the
# digest to this committed constant catches such trace/state drift too.
golden_digest="df49438130a9da1733bd689ccf2327837ac09385f8e91ea685359f1b915ceb05"
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
nat="${work}/native.trace"
node="${work}/node.trace"
spk="${work}/spike.trace"

pass=0
row() { printf '  %-32s %s\n' "$1" "$2"; }
# gate(): print PASS/FAIL for a boolean check and set `pass` IN THE PARENT SHELL. Callers
# pass the check as already-evaluated `$?` via `if`, never inside `$(...)` — a `pass=1`
# inside a command substitution runs in a subshell and is silently lost (E0-T26 verifier
# bug: it made the stdout/exit/retired/digest rows cosmetic). Usage:
#   if <condition>; then ok "<label>" "<detail>"; else bad "<label>" "<detail>"; fi
ok()  { row "$1" "PASS${2:+ $2}"; }
bad() { row "$1" "FAIL${2:+ $2}"; pass=1; }

echo "== E0 capstone: epic regression =="
if [ "${CAPSTONE_SKIP_VERIFY_ALL:-}" = "1" ]; then
  echo "  (skipped make verify-all — CAPSTONE_SKIP_VERIFY_ALL=1)"
else
  make verify-all
fi

echo "== E0 capstone: build =="
cargo build --release -p wasm-vm-cli >/dev/null
wasm-pack build crates/wasm --target web --out-dir ../../web/pkg >/dev/null 2>&1

entry="$(python3 -c 'import struct,sys;f=open(sys.argv[1],"rb");f.seek(24);print(hex(struct.unpack("<Q",f.read(8))[0]))' "${hello}")"

echo "== E0 capstone: three engines =="
# 1) native — trace + byte-clean stdout + exit 0. (set +e so a nonzero exit is captured
#    into the summary rather than aborting under `set -e`.)
set +e
nat_out="$("${repo_root}/target/release/wasm-vm" run "${hello}" --trace "${nat}" 2>"${work}/native.meta")"
nat_rc=$?
set -e
nat_retired="$(sed -n 's/^retired=//p' "${work}/native.meta")"
nat_digest="$("${repo_root}/target/release/wasm-vm" run "${hello}" --dump-state 2>/dev/null | sed -n 's/^state sha256=//p')"

# 2) node-wasm — trace + digest + retired.
node "${here}/trace-node.mjs" "${repo_root}/${hello}" 128 > "${node}" 2>"${work}/node.meta"
node_retired="$(sed -n 's/.*retired=\([0-9]*\).*/\1/p' "${work}/node.meta")"
node_digest="$(sed -n 's/.*digest=\([0-9a-f]*\).*/\1/p' "${work}/node.meta")"

# 3) Spike — normalized to the E0-T16 canonical grammar, trimmed to our authoritative length
#    (Spike spins on the guest's post-exit tail; our trace ends at HTIF exit). Spike is
#    written to a file first — piping straight into `head` would SIGPIPE the container under
#    `pipefail`; the container/spike exit is expected-nonzero, so tolerate it and let the
#    real pass/fail be the `cmp` below.
n="$(wc -l < "${nat}" | tr -d ' ')"
rel_hello="$(python3 -c 'import os,sys;print(os.path.relpath(os.path.abspath(sys.argv[1]),sys.argv[2]))' "${hello}" "${repo_root}")"
"${repo_root}/tools/toolchain/run.sh" -- bash -c \
  "spike --isa=rv64i -m0x80000000:0x8000000 -l --log-commits '${rel_hello}' 2>&1 >/dev/null" \
  > "${work}/spike.raw" 2>/dev/null || true
# Tolerate a failed Spike leg (e.g. empty log → normalizer exit 3): let the resulting
# empty/short spike trace fail the line-count / cmp gates in the summary rather than abort
# the whole run here.
python3 "${repo_root}/tools/diff/normalize_spike.py" --entry "${entry}" \
  < "${work}/spike.raw" > "${work}/spike.full" 2>/dev/null || true
head -n "${n}" "${work}/spike.full" > "${spk}" 2>/dev/null || : > "${spk}"

# ── comparisons ──────────────────────────────────────────────────────────────
echo
echo "== E0 capstone summary =="
# Every check below runs its condition in the PARENT shell (via if), so bad() actually
# sets `pass` and fails the run. Never `pass=1` inside `$(...)`.
if [ "${nat_out}" = "${expected_stdout}" ]; then ok "native stdout == 'Hello from RV64'"; \
  else bad "native stdout == 'Hello from RV64'" "got '${nat_out}'"; fi
if [ "${nat_rc:-1}" -eq 0 ]; then ok "native exit code == 0"; else bad "native exit code == 0" "rc=${nat_rc}"; fi

ln="$(wc -l < "${nat}" | tr -d ' ')"; lo="$(wc -l < "${node}" | tr -d ' ')"; ls="$(wc -l < "${spk}" | tr -d ' ')"
row "trace line counts (native/node/spike)" "${ln}/${lo}/${ls}"
if [ "${ln}" -gt 0 ] && [ "${ln}" = "${lo}" ] && [ "${ln}" = "${ls}" ]; then \
  ok "line counts equal and > 0"; else bad "line counts equal and > 0"; fi

if cmp -s "${nat}" "${node}"; then ok "native  ==  node-wasm  (cmp)" "0 differing bytes"; \
  else bad "native  ==  node-wasm  (cmp)"; fi
if cmp -s "${nat}" "${spk}"; then ok "native  ==  spike-norm (cmp)" "0 differing bytes"; \
  else bad "native  ==  spike-norm (cmp)"; fi
if cmp -s "${node}" "${spk}"; then ok "node    ==  spike-norm (cmp)" "0 differing bytes"; \
  else bad "node    ==  spike-norm (cmp)"; fi

if [ "${nat_retired}" = "${node_retired}" ]; then ok "retired native==node" "(${nat_retired})"; \
  else bad "retired native==node" "${nat_retired} vs ${node_retired}"; fi
if [ "${nat_digest}" = "${node_digest}" ]; then ok "digest native==node" "${nat_digest}"; \
  else bad "digest native==node" "${nat_digest} vs ${node_digest}"; fi
# Frozen content anchor — catches self-consistent trace/state drift the golden-less
# cross-check would miss. (Only meaningful for the canonical hello.elf; a deliberate
# CAPSTONE_ELF override for the sensitivity test is expected to diverge here.)
if [ "${nat_digest}" = "${golden_digest}" ]; then ok "digest == frozen golden (E0-T17)"; \
  else bad "digest == frozen golden (E0-T17)" "${nat_digest}"; fi

echo
if [ "${pass}" -eq 0 ]; then
  echo "E0 CAPSTONE: PASS — Hello from RV64, native == node-wasm == Spike, byte-for-byte."
else
  echo "E0 CAPSTONE: FAIL" >&2
fi
exit "${pass}"
