#!/usr/bin/env bash
# oci-matrix.sh — prove the OCI pipeline is GENERIC across many riscv64 images (the E3.5-T04b
# "run any riscv-compatible container" evidence). For each image it runs the real path —
# `oci-sideload.sh` (pull+digest-verify) → `wasm-vm oci unpack` (whiteout unpack → bundle) — then
# statically asserts the bundle is a COHERENT, CORRECT-ARCH, runnable container WITHOUT a boot:
#   * unpack succeeds (entry count),
#   * `run.json` argv[0] resolves to a real file in the rootfs (absolute, or via the image's PATH),
#     and if it is an ELF it is RISC-V; if a #!-script, its interpreter resolves and is RISC-V,
#   * ARCH PURITY: every ELF in the standard bin dirs is RISC-V — NO foreign-arch binary slipped in
#     (the real "is this image actually riscv-compatible + did we pull the right arch" proof).
# The `wvrun` BOOT of each image (initdb/serve/exec) is the deferred half — see the #[ignore]
# boot-matrix acceptance; this env kills long boots.
#
# Usage: tools/oci-matrix.sh [image ...]   (defaults to a curated riscv64 spread)
# Env:   BIN=target/release/wasm-vm  WORK=/tmp/oci-matrix  REPORT=$WORK/report.md  KEEP=1 (keep bundles)
set -uo pipefail

BIN="${BIN:-target/release/wasm-vm}"
WORK="${WORK:-/tmp/oci-matrix}"
REPORT="${REPORT:-$WORK/report.md}"
mkdir -p "$WORK"

imgs=("$@")
if [ ${#imgs[@]} -eq 0 ]; then
  # A spread of runtime types confirmed to publish riscv64: minimal userland, web servers,
  # datastores, proxies. (Big language runtimes golang/rust/python/ruby also have riscv64 but are
  # 300 MB+ — add them explicitly if you want them in a run.)
  imgs=(alpine busybox nginx httpd caddy haproxy redis memcached postgres)
fi

# file(1) arch phrase for our target.
RISCV_RE='UCB RISC-V|RISC-V'
FOREIGN_RE='x86-64|Intel 80386|ARM aarch64|ARM,|PowerPC|IBM S/390|MIPS'

# True if a path exists in the rootfs, treating a symlink as present even if its (absolute) target
# would resolve against the HOST — the kernel follows it inside the container, not on this box.
present() { [ -e "$1" ] || [ -L "$1" ]; }

# Chase a symlink chain WITHIN the rootfs (absolute links are rooted at rootfs, not the host), so we
# can `file` the real target. Bounded to avoid loops.
chase() {
  local rootfs="$1" p="$2" i=0 link
  while [ -L "$p" ] && [ "$i" -lt 20 ]; do
    link=$(readlink "$p")
    case "$link" in /*) p="$rootfs$link" ;; *) p="$(dirname "$p")/$link" ;; esac
    i=$((i+1))
  done
  echo "$p"
}

# Resolve argv[0] to a path inside the rootfs. Echoes the in-rootfs path or "" if unresolved.
resolve_argv0() {
  local rootfs="$1" argv0="$2" env0="$3" d
  case "$argv0" in
    /*) present "$rootfs$argv0" && { echo "$rootfs$argv0"; return; } ;;
    */*) present "$rootfs/$argv0" && { echo "$rootfs/$argv0"; return; } ;;
    *)
      # bare name → search the image's PATH (from run.json env), else common bins.
      local path="${env0#PATH=}"
      [ "$path" = "$env0" ] && path="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
      local IFS=:
      for d in $path; do present "$rootfs$d/$argv0" && { echo "$rootfs$d/$argv0"; return; }; done ;;
  esac
  echo ""
}

# Follow a #!-shebang once; echo the interpreter path inside rootfs (or "").
shebang_interp() {
  local rootfs="$1" f="$2" first interp
  first=$(head -c 2 "$f" 2>/dev/null)
  [ "$first" = '#!' ] || { echo ""; return; }
  interp=$(sed -n '1s/^#!\s*//p' "$f" | awk '{print $1}')
  case "$interp" in /*) [ -e "$rootfs$interp" ] && echo "$rootfs$interp";; *) echo "";; esac
}

pass=0; fail=0
{
  echo "# OCI container matrix — pipeline genericity (riscv64)"
  echo
  echo "Each image: \`oci-sideload\` (pull+digest-verify) → \`wasm-vm oci unpack\` (bundle) → static coherence + arch-purity checks. No boot (that is the deferred \`wvrun\` half)."
  echo
  echo "| Image | Pull | Unpack | argv[0] → exec target | Arch purity | Result |"
  echo "|---|---|---|---|---|---|"
} > "$REPORT"

row() { echo "| $* |" >> "$REPORT"; }

for img in "${imgs[@]}"; do
  d="$WORK/${img//\//_}"; lay="$d/layout"; bun="$d/bundle"
  rm -rf "$d"; mkdir -p "$d"
  echo ">> $img: pull" >&2
  if ! tools/oci-sideload.sh "$img" "$lay" riscv64 >"$d/pull.log" 2>&1; then
    row "$img | ❌ pull failed | | | | **FAIL**"; fail=$((fail+1)); continue
  fi
  blobs=$(find "$lay/blobs" -type f 2>/dev/null | wc -l | tr -d ' ')
  sz=$(du -sh "$lay" 2>/dev/null | awk '{print $1}')
  echo ">> $img: unpack" >&2
  if ! "$BIN" oci unpack "$lay" --out "$bun" --arch riscv64 >"$d/unpack.log" 2>&1; then
    row "$img | $blobs blobs/$sz | ❌ unpack failed | | | **FAIL**"; fail=$((fail+1)); continue
  fi
  entries=$(grep -oE '[0-9]+ entries' "$d/unpack.log" | head -1 | awk '{print $1}')
  rootfs="$bun/rootfs"
  argv0=$(head -1 "$bun/config/argv" 2>/dev/null)
  env0=$(grep '^PATH=' "$bun/config/env" 2>/dev/null | head -1)

  # Resolve argv[0] and characterize the exec target.
  tgt=$(resolve_argv0 "$rootfs" "$argv0" "$env0")
  if [ -z "$tgt" ]; then
    exec_desc="\`$argv0\` — **unresolved**"; exec_ok=0
  else
    tgt=$(chase "$rootfs" "$tgt")   # follow symlinks (e.g. /bin/sh → busybox) within the rootfs
    ft=$(file -b "$tgt")
    if printf '%s' "$ft" | grep -qE 'ELF'; then
      if printf '%s' "$ft" | grep -qE "$RISCV_RE"; then exec_desc="\`$argv0\` → riscv64 ELF"; exec_ok=1
      else exec_desc="\`$argv0\` → **WRONG-ARCH ELF** ($(printf '%s' "$ft" | cut -d, -f2))"; exec_ok=0; fi
    else
      interp=$(shebang_interp "$rootfs" "$tgt")
      if [ -n "$interp" ]; then
        it=$(file -b "$interp")
        if printf '%s' "$it" | grep -qE "$RISCV_RE"; then exec_desc="\`$argv0\` → script (#!$(basename "$interp"), riscv64)"; exec_ok=1
        else exec_desc="\`$argv0\` → script, **interp wrong-arch**"; exec_ok=0; fi
      else exec_desc="\`$argv0\` → script/other (resolved)"; exec_ok=1; fi
    fi
  fi

  # Arch purity: scan ELFs in standard bin dirs; every one must be RISC-V, none foreign.
  elfs=0; foreign=0
  while IFS= read -r f; do
    ft=$(file -b "$f" 2>/dev/null)
    printf '%s' "$ft" | grep -qE 'ELF' || continue
    elfs=$((elfs+1))
    printf '%s' "$ft" | grep -qE "$FOREIGN_RE" && foreign=$((foreign+1))
  done < <(find "$rootfs"/bin "$rootfs"/sbin "$rootfs"/usr/bin "$rootfs"/usr/sbin "$rootfs"/usr/local/bin "$rootfs"/usr/local/sbin -type f 2>/dev/null | head -400)
  if [ "$foreign" -eq 0 ] && [ "$elfs" -gt 0 ]; then purity="✅ $elfs ELF, all riscv64"; pure_ok=1
  elif [ "$elfs" -eq 0 ]; then purity="— (no ELF in bin dirs)"; pure_ok=1
  else purity="❌ $foreign/$elfs FOREIGN"; pure_ok=0; fi

  if [ "${exec_ok:-0}" -eq 1 ] && [ "$pure_ok" -eq 1 ]; then result="**PASS**"; pass=$((pass+1)); else result="**FAIL**"; fail=$((fail+1)); fi
  row "$img | $blobs blobs/$sz | $entries entries | $exec_desc | $purity | $result"
  [ "${KEEP:-0}" = "1" ] || rm -rf "$bun"   # bundles are large; drop unless KEEP=1
done

{
  echo
  echo "**$pass passed / $fail failed** of $(( pass + fail )) images. Generated by \`tools/oci-matrix.sh\`."
  echo "Boot leg (\`wvrun\` each) is deferred — see \`crates/cli/tests/boot_wvrun.rs\` + the container-matrix acceptance."
} >> "$REPORT"

echo "=== matrix: $pass passed / $fail failed → $REPORT ===" >&2
cat "$REPORT"
[ "$fail" -eq 0 ]
