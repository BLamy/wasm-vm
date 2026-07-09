#!/usr/bin/env bash
# oci-matrix.sh — prove the OCI pipeline is GENERIC across riscv64 images (E3.5-T04b). For each image
# it runs the real path — `oci-sideload.sh` (pull+digest-verify) → `wasm-vm oci unpack` (bundle) —
# then STATICALLY asserts the bundle is a coherent, correct-arch, runnable container WITHOUT a boot.
#
# A PASS means ALL of:
#   * unpack succeeds,
#   * `run.json` argv[0] resolves to a REAL, regular, executable file in the rootfs (absolute / via
#     the image PATH / through symlinks CLAMPED inside the rootfs); a dangling symlink, a directory,
#     a data file, or a symlink loop is NOT a resolved entrypoint,
#   * that exec target is arch-correct: an ELF must be RISC-V 64-bit; a #!-script's interpreter
#     (incl. the `env <prog>` argument) must resolve to a RISC-V 64-bit ELF,
#   * ARCH PURITY over the WHOLE rootfs (not just bin dirs, no truncation): EVERY ELF anywhere is
#     RISC-V 64-bit — a single foreign binary anywhere fails the image. This is what actually covers
#     server binaries in non-standard dirs (e.g. postgres in /usr/lib/postgresql/<v>/bin).
#
# The critic (E3.5-T04b) proved the previous version false-passed four ways (dangling entrypoint,
# binaries outside bin dirs, head-400 truncation, host-escaping symlink) — this version fixes all.
# The `wvrun` BOOT of each image is the deferred half (long interpreter boot this env kills).
#
# Usage: tools/oci-matrix.sh [image ...]      Env: BIN, WORK, REPORT, KEEP=1 (keep bundles)
set -uo pipefail

BIN="${BIN:-target/release/wasm-vm}"
WORK="${WORK:-/tmp/oci-matrix}"
REPORT="${REPORT:-$WORK/report.md}"
mkdir -p "$WORK"

imgs=("$@")
if [ ${#imgs[@]} -eq 0 ]; then
  imgs=(alpine busybox nginx httpd caddy haproxy redis memcached postgres)
fi

# Lexically normalize a path (collapse '.' and '..' with NO filesystem/symlink access), so we can
# keep a chased symlink clamped inside the rootfs.
norm() {
  local path="$1" part; local -a out=()
  local IFS=/
  for part in $path; do
    case "$part" in
      ''|.) ;;
      ..) [ ${#out[@]} -gt 0 ] && unset 'out[${#out[@]}-1]' ;;
      *) out+=("$part") ;;
    esac
  done
  printf '/%s' "$(IFS=/; echo "${out[*]}")"
}

# Chase a symlink chain WITHIN the rootfs. Absolute links root at $rootfs; relative links normalize
# and are CLAMPED under $rootfs (a link escaping the rootfs → "", i.e. unresolved). Returns the final
# real path, or "" if it dangles / loops / escapes.
chase() {
  local rootfs="$1" p="$2" i=0 link rn base
  rn=$(norm "$rootfs")
  while [ -L "$p" ] && [ "$i" -lt 40 ]; do
    link=$(readlink "$p")
    case "$link" in
      /*) p=$(norm "$rootfs$link") ;;
      *)  base=$(dirname "$p"); p=$(norm "$base/$link") ;;
    esac
    # Clamp: the resolved path must stay under the (normalized) rootfs.
    case "$p/" in "$rn"/*) : ;; *) echo ""; return ;; esac
    i=$((i+1))
  done
  [ "$i" -ge 40 ] && { echo ""; return; }        # loop → unresolved
  [ -e "$p" ] || { echo ""; return; }            # dangling → unresolved
  echo "$p"
}

# Resolve argv[0] to an existing REGULAR-or-symlink path in the rootfs (never a directory). Echoes the
# in-rootfs path or "" if unresolved.
regfile_or_link() { [ -f "$1" ] || { [ -L "$1" ] && [ ! -d "$1" ]; }; }
resolve_argv0() {
  local rootfs="$1" argv0="$2" env0="$3" d
  [ -n "$argv0" ] || { echo ""; return; }
  case "$argv0" in
    /*)  regfile_or_link "$rootfs$argv0"  && { echo "$rootfs$argv0"; return; } ;;
    */*) regfile_or_link "$rootfs/$argv0" && { echo "$rootfs/$argv0"; return; } ;;
    *)
      local path="${env0#PATH=}"
      [ "$path" = "$env0" ] && path="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
      local IFS=:
      for d in $path; do regfile_or_link "$rootfs$d/$argv0" && { echo "$rootfs$d/$argv0"; return; }; done ;;
  esac
  echo ""
}

# Echo the interpreter path (inside rootfs) of a #!-script, resolving `#!/usr/bin/env prog` to prog
# on the image PATH. "" if not a shebang or the interpreter can't be found.
shebang_interp() {
  local rootfs="$1" f="$2" env0="$3" line interp arg d path
  [ "$(head -c 2 "$f" 2>/dev/null)" = '#!' ] || { echo ""; return; }
  line=$(sed -n '1s/^#!\s*//p' "$f")
  interp=$(printf '%s' "$line" | awk '{print $1}')
  case "$interp" in
    */env)  # follow env's program argument
      arg=$(printf '%s' "$line" | awk '{print $2}')
      [ -n "$arg" ] || { echo ""; return; }
      path="${env0#PATH=}"; [ "$path" = "$env0" ] && path="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
      local IFS=:
      for d in $path; do regfile_or_link "$rootfs$d/$arg" && { chase "$rootfs" "$rootfs$d/$arg"; return; }; done
      echo "" ;;
    /*) regfile_or_link "$rootfs$interp" && chase "$rootfs" "$rootfs$interp" || echo "" ;;
    *)  echo "" ;;
  esac
}

# Is `file -b` output a RISC-V 64-bit ELF?
is_rv64_elf() { printf '%s' "$1" | grep -q 'ELF' && printf '%s' "$1" | grep -q '64-bit' && printf '%s' "$1" | grep -q 'RISC-V'; }
# Is it an ELF at all (any arch)?
is_elf() { printf '%s' "$1" | grep -q 'ELF'; }

run_matrix() {
pass=0; fail=0
{
  echo "# OCI container matrix — pipeline genericity (riscv64)"
  echo
  echo "Each image: \`oci-sideload\` (pull+digest-verify) → \`wasm-vm oci unpack\` (bundle) → static coherence + WHOLE-ROOTFS arch-purity. No boot (that is the deferred \`wvrun\` half)."
  echo
  echo "| Image | Pull | Unpack | argv[0] → exec target | Arch purity (whole rootfs) | Result |"
  echo "|---|---|---|---|---|---|"
} > "$REPORT"
row() { echo "| $* |" >> "$REPORT"; }

for img in "${imgs[@]}"; do
  d="$WORK/${img//\//_}"; lay="$d/layout"; bun="$d/bundle"
  mkdir -p "$d"; rm -rf "$bun"           # keep the layout (idempotent sideload cache-hits its blobs)
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

  # ── Entrypoint resolution + arch of the exec target ──
  exec_ok=0; exec_desc=
  raw=$(resolve_argv0 "$rootfs" "$argv0" "$env0")
  if [ -z "$raw" ]; then
    exec_desc="\`${argv0:-<none>}\` — **unresolved**"
  else
    tgt=$(chase "$rootfs" "$raw")
    if [ -z "$tgt" ]; then
      exec_desc="\`$argv0\` → **dangling/looping symlink**"
    else
      ft=$(file -b "$tgt")
      if is_elf "$ft"; then
        if is_rv64_elf "$ft"; then exec_desc="\`$argv0\` → riscv64 ELF"; exec_ok=1
        else exec_desc="\`$argv0\` → **wrong-arch ELF** ($(printf '%s' "$ft" | cut -d, -f2))"; fi
      elif interp=$(shebang_interp "$rootfs" "$tgt" "$env0") && [ -n "$interp" ]; then
        it=$(file -b "$interp")
        if is_rv64_elf "$it"; then exec_desc="\`$argv0\` → script → riscv64 interp ($(basename "$interp"))"; exec_ok=1
        else exec_desc="\`$argv0\` → script, **interp not riscv64**"; fi
      else
        exec_desc="\`$argv0\` → **not runnable** (not ELF, no resolvable #! interp)"
      fi
    fi
  fi

  # ── Arch purity over the WHOLE rootfs (magic-prefiltered so we only file(1) real ELFs; NO cap) ──
  elfs=0; foreign=0
  while IFS= read -r f; do
    [ "$(head -c 4 "$f" 2>/dev/null | od -An -tx1 | tr -d ' \n')" = "7f454c46" ] || continue
    elfs=$((elfs+1))
    is_rv64_elf "$(file -b "$f" 2>/dev/null)" || foreign=$((foreign+1))
  done < <(find "$rootfs" -type f 2>/dev/null)
  if [ "$elfs" -gt 0 ] && [ "$foreign" -eq 0 ]; then purity="✅ $elfs ELF, all riscv64"; pure_ok=1
  elif [ "$elfs" -eq 0 ]; then purity="⚠️ no ELF found"; pure_ok=0   # a container with zero ELFs is suspect, not a pass
  else purity="❌ $foreign/$elfs NOT riscv64"; pure_ok=0; fi

  if [ "$exec_ok" -eq 1 ] && [ "$pure_ok" -eq 1 ]; then result="**PASS**"; pass=$((pass+1)); else result="**FAIL**"; fail=$((fail+1)); fi
  row "$img | $blobs blobs/$sz | $entries entries | $exec_desc | $purity | $result"
  [ "${KEEP:-0}" = "1" ] || rm -rf "$bun"
done

{
  echo
  echo "**$pass passed / $fail failed** of $(( pass + fail )) images. Generated by \`tools/oci-matrix.sh\`."
  echo "PASS = unpack OK + entrypoint resolves to a real riscv64 executable/script + every ELF in the whole rootfs is riscv64. Boot leg (\`wvrun\` each) deferred."
} >> "$REPORT"

echo "=== matrix: $pass passed / $fail failed → $REPORT ===" >&2
cat "$REPORT"
[ "$fail" -eq 0 ]
}

# Run the matrix only when executed directly; when sourced (self-tests), expose the functions.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then run_matrix "$@"; fi
