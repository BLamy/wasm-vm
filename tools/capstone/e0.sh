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

hello="guest/prebuilt/hello.elf"
expected_stdout="Hello from RV64"
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
nat="${work}/native.trace"
node="${work}/node.trace"
spk="${work}/spike.trace"

pass=0
row() { printf '  %-32s %s\n' "$1" "$2"; }

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
python3 "${repo_root}/tools/diff/normalize_spike.py" --entry "${entry}" \
  < "${work}/spike.raw" > "${work}/spike.full" 2>/dev/null
head -n "${n}" "${work}/spike.full" > "${spk}"

# ── comparisons ──────────────────────────────────────────────────────────────
echo
echo "== E0 capstone summary =="
row "native stdout == 'Hello from RV64'" "$([ "${nat_out}" = "${expected_stdout}" ] && echo PASS || { echo FAIL; pass=1; })"
row "native exit code == 0" "$([ "${nat_rc:-0}" -eq 0 ] && echo PASS || { echo FAIL; pass=1; })"

ln="$(wc -l < "${nat}" | tr -d ' ')"; lo="$(wc -l < "${node}" | tr -d ' ')"; ls="$(wc -l < "${spk}" | tr -d ' ')"
row "trace line counts (native/node/spike)" "${ln}/${lo}/${ls}"
if [ "${ln}" -gt 0 ] && [ "${ln}" = "${lo}" ] && [ "${ln}" = "${ls}" ]; then
  row "line counts equal and > 0" "PASS"
else
  row "line counts equal and > 0" "FAIL"; pass=1
fi

cmp_row() { # <label> <a> <b>
  if cmp -s "$2" "$3"; then row "$1" "PASS (cmp, 0 differing bytes)"; else row "$1" "FAIL"; pass=1; fi
}
cmp_row "native  ==  node-wasm  (cmp)" "${nat}" "${node}"
cmp_row "native  ==  spike-norm (cmp)" "${nat}" "${spk}"
cmp_row "node    ==  spike-norm (cmp)" "${node}" "${spk}"

row "retired (native/node)" "${nat_retired}/${node_retired} $([ "${nat_retired}" = "${node_retired}" ] && echo PASS || { echo FAIL; pass=1; })"
row "digest  (native/node)" "$([ "${nat_digest}" = "${node_digest}" ] && echo "PASS ${nat_digest}" || { echo "FAIL ${nat_digest} vs ${node_digest}"; pass=1; })"

echo
if [ "${pass}" -eq 0 ]; then
  echo "E0 CAPSTONE: PASS — Hello from RV64, native == node-wasm == Spike, byte-for-byte."
else
  echo "E0 CAPSTONE: FAIL" >&2
fi
exit "${pass}"
