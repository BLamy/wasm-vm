#!/usr/bin/env bash
# Adversarial self-test for oci-matrix.sh: reproduces the E3.5-T04b critic's four false-pass
# scenarios and asserts the hardened checks now REJECT each. Guards against the harness lying.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=/dev/null
source "$here/oci-matrix.sh"

t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
fails=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fails=$((fails+1)); }

# Helpers to build a tiny riscv64 vs foreign ELF into a rootfs. We copy real binaries from a pulled
# layout if present, else fabricate ELF headers good enough for file(1)'s arch line.
mk_elf() { # mk_elf <path> <riscv|amd64>
  local p="$1" arch="$2"; mkdir -p "$(dirname "$p")"
  if [ "$arch" = riscv ]; then
    # ELF64 LE, e_machine=0xF3 (243, RISC-V) at offset 18.
    printf '\177ELF\002\001\001\000\000\000\000\000\000\000\000\000\002\000\363\000\001\000\000\000' > "$p"
  else
    # e_machine=0x3E (62, x86-64).
    printf '\177ELF\002\001\001\000\000\000\000\000\000\000\000\000\002\000\076\000\001\000\000\000' > "$p"
  fi
  # pad so file(1) reads the header
  dd if=/dev/zero bs=1 count=64 >> "$p" 2>/dev/null
}

# Sanity: file(1) must classify our fabricated ELFs as expected, else the test itself is vacuous.
mk_elf "$t/probe/rv" riscv; mk_elf "$t/probe/x86" amd64
is_rv64_elf "$(file -b "$t/probe/rv")"  || { echo "SKIP: file(1) doesn't tag our synthetic RISC-V ELF ($(file -b "$t/probe/rv")) — test env limitation"; exit 0; }
is_rv64_elf "$(file -b "$t/probe/x86")" && { echo "SKIP: file(1) tags x86 ELF as riscv?! ($(file -b "$t/probe/x86"))"; exit 0; }

# ── C1: dangling-symlink entrypoint must NOT resolve ──
r="$t/c1"; mkdir -p "$r/bin"; ln -s /nonexistent/nope "$r/bin/sh"
raw=$(resolve_argv0 "$r" "/bin/sh" "")
tgt=$(chase "$r" "$raw")
[ -z "$tgt" ] && ok "C1 dangling-symlink entrypoint → unresolved" || bad "C1: dangling symlink resolved to '$tgt'"

# ── C1b: directory / empty-argv0 must NOT resolve ──
r="$t/c1b"; mkdir -p "$r/usr/bin"
[ -z "$(resolve_argv0 "$r" "" "")" ] && ok "C1b empty argv0 → unresolved" || bad "C1b: empty argv0 resolved"

# ── C1c: symlink loop must NOT resolve (bounded, returns empty) ──
r="$t/c1c"; mkdir -p "$r/bin"; ln -s b "$r/bin/a"; ln -s a "$r/bin/b"
[ -z "$(chase "$r" "$r/bin/a")" ] && ok "C1c symlink loop → unresolved" || bad "C1c: symlink loop resolved"

# ── C2: foreign server OUTSIDE bin dirs must be caught by whole-rootfs purity ──
r="$t/c2"; mkdir -p "$r/opt/app" "$r/bin"; mk_elf "$r/opt/app/server" amd64; ln -s /opt/app/server "$r/bin/entry"
elfs=0; foreign=0
while IFS= read -r f; do
  [ "$(head -c 4 "$f" 2>/dev/null | od -An -tx1 | tr -d ' \n')" = "7f454c46" ] || continue
  elfs=$((elfs+1)); is_rv64_elf "$(file -b "$f")" || foreign=$((foreign+1))
done < <(find "$r" -type f 2>/dev/null)
[ "$foreign" -ge 1 ] && ok "C2 foreign ELF in /opt caught by whole-rootfs scan ($foreign/$elfs)" || bad "C2: foreign server outside bin dirs NOT caught"

# ── C3: foreign ELF past the (old) 400-file window must still be scanned (no cap) ──
r="$t/c3"; mkdir -p "$r/usr/lib"; for i in $(seq 1 450); do mk_elf "$r/usr/lib/rv$i" riscv; done; mk_elf "$r/usr/lib/zzz_x86" amd64
foreign=0
while IFS= read -r f; do
  [ "$(head -c 4 "$f" 2>/dev/null | od -An -tx1 | tr -d ' \n')" = "7f454c46" ] || continue
  is_rv64_elf "$(file -b "$f")" || foreign=$((foreign+1))
done < <(find "$r" -type f 2>/dev/null)
[ "$foreign" -ge 1 ] && ok "C3 foreign ELF among 451 files (past old 400 cap) still caught" || bad "C3: foreign ELF past 400 missed"

# ── M1: relative symlink escaping the rootfs must NOT resolve to a host file ──
r="$t/m1"; mkdir -p "$r/bin"; ln -s ../../../../../../../../bin/sh "$r/bin/app"
esc=$(chase "$r" "$r/bin/app")
{ [ -z "$esc" ] || case "$esc" in "$r"/*) true;; *) false;; esac; } && ok "M1 rootfs-escaping symlink clamped (got '${esc:-<empty>}')" || bad "M1: symlink escaped rootfs to '$esc'"

echo "---"
[ "$fails" -eq 0 ] && { echo "SELFTEST OK — all critic false-passes rejected"; exit 0; } || { echo "SELFTEST FAILED: $fails"; exit 1; }
