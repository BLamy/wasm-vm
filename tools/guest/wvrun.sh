#!/bin/sh
# wvrun — the tiny OCI runner (E3.5-T03). NOT Docker Engine: the ~20% of runc that runs a real
# unpacked image. Given a BUNDLE produced by `wasm-vm oci unpack` (`<bundle>/rootfs` + `run.json` +
# `config/{argv,env,cwd,user}`), it:
#   1. creates a per-container cgroup leaf (memory/pids limits when asked),
#   2. `unshare`s pid+mount+uts+ipc+net (fork so the child is PID 1),
#   3. overlay-mounts the image (rootfs = lower, tmpfs = upper) so container writes never mutate
#      the unpacked image,
#   4. mounts fresh proc/sys + a minimal /dev inside the new root,
#   5. `pivot_root`s into it, applies cwd/env, and `exec`s the image's argv,
#   6. propagates the container's exit code as wvrun's own.
#
# The container's stdio is wired straight to wvrun's — an interactive `sh` feels like a shell.
#
# v1 SCOPE / non-claims (honesty, not perfect confinement — the guest IS the sandbox):
#   * Runs as root-in-guest. USER_NS/uid_map (rootless) is a later pass; `config/user` is recorded
#     but NOT yet enforced.
#   * Containers share the guest net namespace v1 (loopback + eth0 visible); veth-per-container
#     graduates with E3.5-T05. `unshare -n` here gives an isolated (loopback-only) netns.
#   * seccomp filter install is E3.5-T03's remaining acceptance (relocated from T02); not yet here.
#   * An argv/env value containing a newline is not representable (one-per-line files) — real images
#     don't use them.
#
# POSIX sh (busybox ash). Requires util-linux (unshare/pivot_root) + the audited kernel (T02).
set -eu

usage() { echo "usage: wvrun [--interactive] [--memory BYTES] [--pids N] <bundle-dir>" >&2; exit 2; }

interactive=0
mem_limit=""
pids_limit=""
while [ $# -gt 0 ]; do
  case "$1" in
    --interactive|-i) interactive=1; shift ;;
    --memory) mem_limit="${2:?}"; shift 2 ;;
    --pids)   pids_limit="${2:?}"; shift 2 ;;
    --) shift; break ;;
    -*) echo "wvrun: unknown flag $1" >&2; usage ;;
    *) break ;;
  esac
done
bundle="${1:-}"; [ -n "$bundle" ] || usage
rootfs="$bundle/rootfs"
[ -d "$rootfs" ] || { echo "wvrun: no rootfs/ in bundle $bundle" >&2; exit 2; }

# ── Runtime config (flat files; no JSON parser needed in the guest) ─────────────────────────────
cwd=$(cat "$bundle/config/cwd" 2>/dev/null || true); [ -n "$cwd" ] || cwd=/

# argv: interactive overrides with a shell; else the image's Entrypoint++Cmd (must be non-empty).
if [ "$interactive" -eq 1 ]; then
  set -- /bin/sh
else
  # Read argv lines into positional params. IFS=newline so args with spaces survive.
  oldifs=$IFS; IFS='
'
  set --
  if [ -s "$bundle/config/argv" ]; then
    for a in $(cat "$bundle/config/argv"); do set -- "$@" "$a"; done
  fi
  IFS=$oldifs
  [ $# -gt 0 ] || { echo "wvrun: image has no entrypoint/cmd (use --interactive)" >&2; exit 2; }
fi

# ── Per-container cgroup leaf (best-effort; limits only when requested) ──────────────────────────
cg=""
if [ -f /sys/fs/cgroup/cgroup.controllers ]; then
  # Ensure controllers are delegated to children, then make a unique leaf.
  grep -q memory /sys/fs/cgroup/cgroup.controllers 2>/dev/null &&
    echo '+memory +pids' > /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || true
  cg="/sys/fs/cgroup/wvrun.$$"
  if mkdir -p "$cg" 2>/dev/null; then
    [ -n "$mem_limit" ]  && echo "$mem_limit"  > "$cg/memory.max" 2>/dev/null || true
    [ -n "$pids_limit" ] && echo "$pids_limit" > "$cg/pids.max"   2>/dev/null || true
  else
    cg=""
  fi
fi

# Clean up the cgroup leaf on exit (after the container process has left it).
cleanup() { [ -n "$cg" ] && rmdir "$cg" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# Export what the unshared child needs (a fresh `sh -c` does not inherit shell vars, only env).
export WVRUN_ROOTFS="$rootfs" WVRUN_CWD="$cwd" WVRUN_CG="$cg"
# The container's env comes from config/env; pass its path so the child sources it.
export WVRUN_ENVFILE="$bundle/config/env"

# The child script: runs INSIDE the new namespaces as (eventually) PID 1. It sets up the mounts,
# pivots, joins the cgroup, applies env/cwd, and execs the argv passed as "$@".
child='
  set -eu
  # Private propagation so our mounts do not leak back to the guest.
  mount --make-rprivate / 2>/dev/null || true
  work=$(mktemp -d /tmp/wvrun.XXXXXX)
  mkdir -p "$work/upper" "$work/work" "$work/merged"
  # Overlay: image rootfs is the read-only lower; a tmpfs upper captures all container writes so
  # the unpacked image is never mutated.
  mount -t tmpfs tmpfs "$work/upper" 2>/dev/null || true
  mkdir -p "$work/upper/u" "$work/upper/w"
  mount -t overlay overlay -o "lowerdir=$WVRUN_ROOTFS,upperdir=$work/upper/u,workdir=$work/upper/w" "$work/merged"
  # Essential virtual filesystems inside the new root.
  mkdir -p "$work/merged/proc" "$work/merged/sys" "$work/merged/dev" "$work/merged/.oldroot"
  mount -t proc  proc "$work/merged/proc"
  mount -t sysfs sys  "$work/merged/sys" 2>/dev/null || true
  # Bind the guest /dev (console/null/zero/tty) so the container has working stdio device nodes.
  mount --rbind /dev "$work/merged/dev" 2>/dev/null || mount -t tmpfs tmpfs "$work/merged/dev"
  # Join the cgroup leaf from HERE (this process becomes the container PID 1 after pivot).
  [ -n "${WVRUN_CG:-}" ] && echo $$ > "$WVRUN_CG/cgroup.procs" 2>/dev/null || true
  # Switch root into the merged tree, detach the old root.
  cd "$work/merged"
  pivot_root . .oldroot
  umount -l /.oldroot 2>/dev/null || true
  rmdir /.oldroot 2>/dev/null || true
  # Apply cwd (fall back to / if the image cwd does not exist), then env, then exec the argv.
  cd "$WVRUN_CWD" 2>/dev/null || cd /
  # Build a clean env from config/env (KEY=VAL per line) and exec argv via env -i.
  set -- "$@"
  if [ -s "$WVRUN_ENVFILE" ]; then
    exec env -i $(cat "$WVRUN_ENVFILE") "$@"
  else
    exec env -i "$@"
  fi
'

# unshare: mount+uts+ipc+pid+net, fork so the argv runs as PID 1 in the new pid ns, remount /proc.
unshare -m -u -i -p -n -f --mount-proc sh -c "$child" wvrun-init "$@"
rc=$?
exit "$rc"
