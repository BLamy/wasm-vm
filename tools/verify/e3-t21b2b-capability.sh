#!/bin/sh
set -eu

repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
lib="$repo/crates/file-agent/src/lib.rs"
main="$repo/crates/file-agent/src/main.rs"

test "$(grep -c 'TcpStream::connect_timeout' "$lib")" -eq 1
grep -q 'TcpStream::connect_timeout(&ENDPOINT.into()' "$lib"
grep -q 'Ipv4Addr::new(10, 0, 2, 2), 10021' "$lib"

if grep -nE 'pub fn .*(addr|host|port|url|path|command|listener|destination)' "$lib"; then
  echo "file-agent exposes forbidden transfer authority" >&2
  exit 1
fi
if grep -nE 'https?://|Command::|process::Command|TcpListener|UdpSocket|ToSocketAddrs|lookup_host' \
  "$lib" "$main"; then
  echo "file-agent contains forbidden network/process capability" >&2
  exit 1
fi
grep -q '"/var/lib/wasm-vm/transfer/inbox"' "$main"
grep -q '"/var/lib/wasm-vm/transfer/outbox"' "$main"
grep -q '"vm-download"' "$main"

echo "E3-T21b2b capability: OK (one fixed connector, fixed roots, no proxy/process authority)"
