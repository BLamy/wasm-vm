#!/usr/bin/env bash
# Rebuild the golden guests in the pinned toolchain and byte-compare against the
# committed prebuilt/ ELFs (E0-T14). Runs INSIDE the T13 container:
#   tools/toolchain/run.sh -- guest/check-reproducible.sh
# Exits nonzero (loudly) on ANY divergence — this is what makes "the binary in the repo
# is the binary we tested" auditable.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
cd "${here}"

tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT

make clean >/dev/null
make >/dev/null

status=0
for elf in hello loops memops; do
  if cmp -s "${elf}.elf" "prebuilt/${elf}.elf"; then
    echo "OK   ${elf}.elf matches prebuilt"
  else
    echo "DIFF ${elf}.elf DIFFERS from prebuilt/${elf}.elf" >&2
    status=1
  fi
done

if [ "${status}" -ne 0 ]; then
  echo "reproducibility check FAILED — rebuilt ELFs differ from committed prebuilt/" >&2
fi
exit "${status}"
