#!/usr/bin/env bash
# E0-T25 `make verify-list`: print the target↔task map and FAIL if any Epic 0 task file
# lacks a `verify-E0-Tnn` target (script-checked against the directory listing).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "${here}/../.." && pwd)"
cd "${repo_root}"

missing=0
printf '%-16s  %-8s  %s\n' "TARGET" "STATUS" "TASK"
for f in $(ls tasks/epic-0-ignition/*.md | sort); do
  id="$(basename "$f" | sed -E 's/^(E0-T[0-9]+).*/\1/')"
  title="$(sed -n 's/^title:[[:space:]]*//p' "$f" | head -1)"
  if grep -qE "^verify-${id}:" Makefile; then
    status="OK"
  else
    status="MISSING"
    missing=1
  fi
  printf '%-16s  %-8s  %s\n' "verify-${id}" "${status}" "${title}"
done

if [ "${missing}" -ne 0 ]; then
  echo "verify-list: a task file has no verify target — add one to the Makefile" >&2
  exit 1
fi
