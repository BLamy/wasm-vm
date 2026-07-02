#!/usr/bin/env bash
# Record a cargo test run under rr. The packed trace — not the terminal output — is the
# evidence unit (see AGENTS.md).
#
# Usage: tools/rr/record-test.sh [-p <crate>] [-o <trace-name>] [--chaos] [<test-filter>]
#
#   -p <crate>      restrict to one workspace crate
#   -o <name>       trace directory name under rr-traces/ (default: <crate|ws>-<timestamp>)
#   --chaos         randomize scheduling to shake out races (record several runs!)
#   <test-filter>   substring passed to the test binary (cargo test filter semantics)
#
# Builds first (cargo test --no-run) so the trace contains the test run, not the compiler.
# Only records test binaries that actually contain tests matching the filter. Forces
# --test-threads=1 for a readable timeline (rr serializes execution anyway). Packs the
# trace so the directory is self-contained and can be handed to a verifier machine.
set -euo pipefail
cd "$(dirname "$0")/../.."

CRATE="" NAME="" FILTER="" RR_FLAGS=()
while (( $# )); do
  case "$1" in
    -p) CRATE="$2"; shift 2 ;;
    -o) NAME="$2"; shift 2 ;;
    --chaos) RR_FLAGS+=(--chaos); shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) FILTER="$1"; shift ;;
  esac
done

tools/rr/preflight.sh >/dev/null
command -v jq >/dev/null 2>&1 || { echo "record-test.sh needs jq" >&2; exit 1; }

NAME="${NAME:-${CRATE:-workspace}-$(date +%Y%m%d-%H%M%S)}"
mkdir -p rr-traces

echo "building test binaries..." >&2
mapfile -t bins < <(cargo test ${CRATE:+-p "$CRATE"} --no-run --message-format=json 2>/dev/null \
  | jq -r 'select(.reason=="compiler-artifact" and .profile.test==true) | .executable // empty' \
  | sort -u)
(( ${#bins[@]} )) || { echo "no test binaries found${CRATE:+ for crate $CRATE}" >&2; exit 1; }

recorded=0
for bin in "${bins[@]}"; do
  # skip binaries with no matching tests — keep traces lean and on-topic
  if [[ -n "$FILTER" ]] && ! "$bin" --list "$FILTER" 2>/dev/null | grep -q ': test$'; then
    continue
  fi
  suffix=$([[ $recorded -gt 0 ]] && echo "-$recorded" || echo "")
  trace="rr-traces/${NAME}${suffix}"
  echo "recording $(basename "$bin") -> $trace" >&2
  RUST_TEST_THREADS=1 rr record "${RR_FLAGS[@]}" -o "$trace" \
    "$bin" ${FILTER:+"$FILTER"} --test-threads=1
  rr pack "$trace" >/dev/null
  echo "$trace"
  recorded=$((recorded + 1))
done

(( recorded )) || { echo "no test binary contained tests matching '$FILTER'" >&2; exit 1; }
echo "done: $recorded trace(s). Cite events via 'when' inside 'rr replay <trace>'." >&2
