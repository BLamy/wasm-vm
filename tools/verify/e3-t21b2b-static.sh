#!/bin/sh
set -eu

repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/e3-t21b2b.XXXXXX")
trap 'rm -rf "$work"' EXIT

CARGO_TARGET_DIR="$work/target-a" "$repo/tools/build-file-agent.sh" "$work/agent-a"
CARGO_TARGET_DIR="$work/target-b" "$repo/tools/build-file-agent.sh" "$work/agent-b"

cmp "$work/agent-a" "$work/agent-b"
sha_a=$(shasum -a 256 "$work/agent-a" | awk '{print $1}')
sha_b=$(shasum -a 256 "$work/agent-b" | awk '{print $1}')
test "$sha_a" = "$sha_b"

description=$(file "$work/agent-a")
printf '%s\n' "$description"
printf '%s\n' "$description" | grep -qi 'ELF 64-bit'
printf '%s\n' "$description" | grep -qi 'RISC-V'
printf '%s\n' "$description" | grep -Eqi 'statically linked|static-pie linked'

if strings "$work/agent-a" | grep -E 'https?://|/bin/(sh|bash)|TcpListener|UdpSocket'; then
  echo "static agent contains forbidden capability strings" >&2
  exit 1
fi

printf 'E3-T21b2b static: OK sha256=%s\n' "$sha_a"
