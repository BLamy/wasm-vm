#!/bin/sh
# wvrun — the tiny OCI runner + minimal container LIFECYCLE (E3.5-T03 core, E3.5-T05b lifecycle).
# NOT Docker Engine: the ~20% of runc+a-daemon that runs real unpacked images and tracks them.
#
# Subcommands (E3.5-T05b):
#   wvrun run [-d|--detach] [--name N] [--memory B] [--pids N] <bundle>   run (foreground / detached)
#   wvrun ps [-a]                                                         list containers (JSON lines)
#   wvrun logs [-f] <id|name>                                            replay/follow a container log
#   wvrun stop <id|name>                                                 SIGTERM→cgroup.kill
#   wvrun rm [-f] <id|name>                                              remove a (stopped) container
#   wvrun exec [-it] <id|name> <cmd…>                                    enter a running container (E3.5-T05c)
# Legacy (E3.5-T03, still supported): `wvrun [--interactive] [--memory B] [--pids N] <bundle>`.
#
# For a BUNDLE produced by `wasm-vm oci unpack` (`<bundle>/rootfs` + `config/{argv,env,cwd,user}`),
# a container is: a per-container cgroup leaf → `unshare` pid+mount+uts+ipc(+not net) → overlay-mount
# the image (ro rootfs lower + tmpfs upper) → fresh proc/sys + minimal /dev → pivot_root → seccomp
# filter → exec the image argv; the container's exit code is propagated.
#
# v1 SCOPE / non-claims (honesty, not perfect confinement — the guest IS the sandbox):
#   * Runs as root-in-guest. USER_NS/uid_map (rootless) is a later pass.
#   * Containers SHARE the guest net namespace v1 (loopback + eth0 visible).
#   * argv/env values containing a newline are not representable (one-per-line files).
#
# POSIX sh (busybox ash). Requires util-linux (unshare/nsenter/pivot_root/setsid) + the audited kernel.
set -eu

WV_RUN_DIR=/run/wvcontainers      # per-container state (tmpfs)
WV_LOG_DIR=/var/log/wvcontainers  # captured stdout+stderr

ensure_dirs() { mkdir -p "$WV_RUN_DIR" "$WV_LOG_DIR" 2>/dev/null || true; }
now_epoch()   { date +%s 2>/dev/null || echo 0; }
# Short random container id (12 hex). NOT sequential — avoids collisions across reloads.
new_id() {
  if [ -r /proc/sys/kernel/random/uuid ]; then
    tr -d - < /proc/sys/kernel/random/uuid | cut -c1-12
  else
    od -An -tx1 -N6 /dev/urandom 2>/dev/null | tr -d ' \n' || echo "c$$$(now_epoch)"
  fi
}
# JSON-quote a string (escape backslash + double-quote; control chars are not expected in names).
json() { printf '"%s"' "$(printf '%s' "${1:-}" | sed 's/\\/\\\\/g; s/"/\\"/g')"; }

usage() {
  echo "usage: wvrun run [-d] [--name N] [--memory B] [--pids N] <bundle> [-- <cmd...>]" >&2
  echo "       wvrun ps [-a] | logs [-f] <ref> | stop <ref> | rm [-f] <ref> | exec [-it] <ref> <cmd…>" >&2
  echo "       wvrun [--interactive] [--memory B] [--pids N] <bundle>   (legacy run-to-exit)" >&2
  exit 2
}

# ── The container child: runs INSIDE the new namespaces as PID 1. Sets up mounts, pivots, installs the
# seccomp filter, applies env/cwd, and execs the argv passed as "$@". (Unchanged from E3.5-T03.) ──────
child='
  set -eu
  mount --make-rprivate / 2>/dev/null || true
  work=$(mktemp -d /tmp/wvrun.XXXXXX)
  mkdir -p "$work/upper" "$work/work" "$work/merged"
  mount -t tmpfs tmpfs "$work/upper" 2>/dev/null || true
  mkdir -p "$work/upper/u" "$work/upper/w"
  mount -t overlay overlay -o "lowerdir=$WVRUN_ROOTFS,upperdir=$work/upper/u,workdir=$work/upper/w" "$work/merged"
  mkdir -p "$work/merged/proc" "$work/merged/sys" "$work/merged/dev" "$work/merged/.oldroot"
  mount -t proc  proc "$work/merged/proc"
  mount -t sysfs sys  "$work/merged/sys" 2>/dev/null || true
  mount -t tmpfs tmpfs "$work/merged/dev" 2>/dev/null || true
  for d in null zero full random urandom tty console; do
    if [ -e "/dev/$d" ]; then
      : > "$work/merged/dev/$d" 2>/dev/null || true
      mount --bind "/dev/$d" "$work/merged/dev/$d" 2>/dev/null || true
    fi
  done
  mkdir -p "$work/merged/dev/pts" 2>/dev/null || true
  mount -t devpts devpts "$work/merged/dev/pts" 2>/dev/null || true
  have_seccomp=0
  if [ -x /usr/local/bin/wvseccomp ]; then
    if cp /usr/local/bin/wvseccomp "$work/merged/.wvseccomp" 2>/dev/null; then
      chmod 0755 "$work/merged/.wvseccomp" 2>/dev/null || true
      have_seccomp=1
    fi
  fi
  cd "$work/merged"
  pivot_root . .oldroot
  umount -l /.oldroot 2>/dev/null || true
  rmdir /.oldroot 2>/dev/null || true
  cd "$WVRUN_CWD" 2>/dev/null || cd /
  argc=$#
  if [ -s "$WVRUN_ENVFILE" ]; then
    while IFS= read -r kv || [ -n "$kv" ]; do
      if [ -n "$kv" ]; then set -- "$@" "$kv"; fi
    done < "$WVRUN_ENVFILE"
  fi
  i=0
  while [ "$i" -lt "$argc" ]; do a=$1; shift; set -- "$@" "$a"; i=$((i + 1)); done
  if [ "${have_seccomp:-0}" = 1 ]; then
    exec /.wvseccomp -- env -i "$@"
  fi
  exec env -i "$@"
'

# Create + join a per-container cgroup leaf. Tracked containers ALWAYS get one (even with no limits) so
# `cgroup.kill` gives a reliable stop — a pid-ns init ignores SIGTERM unless it installed a handler.
# Echoes the cgroup path (empty if cgroups are unavailable). Joins THIS process (parent) before unshare
# so `unshare --fork` inherits it.
setup_cgroup() {
  _cgname=$1 _mem=$2 _pids=$3
  [ -f /sys/fs/cgroup/cgroup.controllers ] || { echo ""; return 0; }
  grep -q memory /sys/fs/cgroup/cgroup.controllers 2>/dev/null &&
    echo '+memory +pids' > /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || true
  _cg="/sys/fs/cgroup/$_cgname"
  mkdir -p "$_cg" 2>/dev/null || { echo ""; return 0; }
  [ -n "$_mem" ]  && echo "$_mem"  > "$_cg/memory.max" 2>/dev/null || true
  [ -n "$_pids" ] && echo "$_pids" > "$_cg/pids.max"   2>/dev/null || true
  # Join must succeed for the leaf to bind the container (and for cgroup.kill to work). If it fails
  # (e.g. a systemd-delegated host that forbids root-level cgroup joins), DON'T leave an orphan dir —
  # rmdir it and report no-cgroup so `stop` falls back to signalling the pid directly.
  if echo $$ > "$_cg/cgroup.procs" 2>/dev/null; then
    echo "$_cg"
  else
    rmdir "$_cg" 2>/dev/null || true
    echo ""
  fi
}

# Read the container's PID-1 host pid: the child forked by `unshare --fork` is a child of the unshare
# process ($1) in the host ns. Uses the shell builtin `read` (NOT a `cat|awk` subprocess per spin — on
# the interpreted riscv guest each fork+exec is glacially slow, so a subprocess spin here hung past the
# AC4 timeout). Bounded builtin poll + a single 1s yield fallback for the fork-not-visible-yet race.
container_pid1() {
  _up=$1 _n=0 _c=""
  # `$(cat …)` capture (NOT `read`, which returns non-zero on the momentarily-empty children file and
  # trips `set -e` inside the loop) + shell `${_c%% *}` for the first pid (no awk subprocess). A real 1s
  # yield between tries lets the forked child get scheduled; returns as soon as it appears (usually ≤1s),
  # bounded at ~30s — NOT a tight 500-iteration subprocess spin (that hung the interpreted riscv guest).
  while [ "$_n" -lt 30 ]; do
    _c=$(cat "/proc/$_up/task/$_up/children" 2>/dev/null || true)
    _c=${_c%% *}
    [ -n "$_c" ] && { echo "$_c"; return 0; }
    sleep 1 2>/dev/null || true
    _n=$((_n + 1))
  done
  echo ""
}

# The shared runner. Sets up the cgroup, unshares, execs the container.
#   container_core <interactive> <mem> <pids> <cgname> <statedir|""> <bundle>
# statedir="" → legacy/foreground (interactive keeps the tty). statedir set → tracked (records
# pid/upid/cg/status/exit into the dir, backgrounds the container so the host pid-1 can be captured).
container_core() {
  _int=$1 _mem=$2 _pids=$3 _cgname=$4 _sd=$5 bundle=$6; shift 6
  # Anything left in "$@" is an explicit command override (docker-style `run <img> <cmd…>`).
  rootfs="$bundle/rootfs"
  [ -d "$rootfs" ] || { echo "wvrun: no rootfs/ in bundle $bundle" >&2; return 2; }
  cwd=$(cat "$bundle/config/cwd" 2>/dev/null || true); [ -n "$cwd" ] || cwd=/

  # argv precedence: --interactive → /bin/sh; else an explicit command override (already in "$@")
  # is used as-is; else the bundle's baked config/argv (the image entrypoint).
  if [ "$_int" -eq 1 ]; then
    set -- /bin/sh
  elif [ $# -gt 0 ]; then
    :  # command override already in "$@"
  else
    if [ -s "$bundle/config/argv" ]; then
      while IFS= read -r a || [ -n "$a" ]; do set -- "$@" "$a"; done < "$bundle/config/argv"
    fi
    [ $# -gt 0 ] || { echo "wvrun: image has no entrypoint/cmd (use --interactive)" >&2; return 2; }
  fi

  # A tracked container always gets a cgroup leaf; a legacy run only when a limit is asked.
  cg=""
  if [ -n "$_sd" ] || [ -n "$_mem" ] || [ -n "$_pids" ]; then
    cg=$(setup_cgroup "$_cgname" "$_mem" "$_pids")
  fi
  export WVRUN_ROOTFS="$rootfs" WVRUN_CWD="$cwd" WVRUN_ENVFILE="$bundle/config/env"

  # Non-tracked (legacy run-to-exit + interactive): FOREGROUND exec-style unshare — exactly the path
  # E3.5-T03 proved (direct exit-code propagation + a controlling tty for interactive). Only TRACKED
  # detached containers need the background+wait+capture below; routing the legacy --memory OOM path
  # through background+wait misbehaved under the memcg OOM-killer on the interpreted guest.
  if [ -z "$_sd" ]; then
    rc=0
    unshare -m -u -i -p -f --mount-proc sh -c "$child" wvrun-init "$@" || rc=$?
    _leave_cgroup "$cg"
    return "$rc"
  fi

  # Background the container so we can capture its host PID-1 (needed for stop/exec). The pid capture
  # only matters for a TRACKED container — skip it for the legacy/foreground path (where the captured
  # value is discarded), so a plain `wvrun --memory <bundle>` never pays the capture cost.
  unshare -m -u -i -p -f --mount-proc sh -c "$child" wvrun-init "$@" &
  upid=$!
  if [ -n "$_sd" ]; then
    # Publish running state IMMEDIATELY (before the pid capture, which yields ~1s for the fork to be
    # scheduled) so `ps` sees `running` without delay. The pid is filled in a moment later.
    printf '%s\n' "$upid" > "$_sd/upid"
    printf '%s\n' "$cg"   > "$_sd/cg"
    printf 'running\n'    > "$_sd/status"
    cpid=$(container_pid1 "$upid")
    printf '%s\n' "$cpid" > "$_sd/pid"
    # The supervisor now LEAVES the container's cgroup (the unshare child already inherited it at fork).
    # Two reasons: `wvrun stop` uses `cgroup.kill`, which would otherwise kill this supervisor before it
    # can record the exit; and the supervisor's own memory must not count against the container's limit.
    [ -n "$cg" ] && echo $$ > /sys/fs/cgroup/cgroup.procs 2>/dev/null || true
  fi
  rc=0
  wait "$upid" || rc=$?
  if [ -n "$_sd" ]; then
    printf '%s\n' "$rc"  > "$_sd/exit"
    printf 'exited\n'    > "$_sd/status"
  fi
  _leave_cgroup "$cg"
  return "$rc"
}

# Move back to the root cgroup so a leaf can be rmdir'd (the container has already gone).
_leave_cgroup() {
  [ -n "${1:-}" ] || return 0
  echo $$ > /sys/fs/cgroup/cgroup.procs 2>/dev/null || true
  rmdir "$1" 2>/dev/null || true
}

# Resolve a ref (id or name) → its state dir path. Echoes the path, returns 1 if not found.
resolve() {
  _ref=$1
  for d in "$WV_RUN_DIR"/*; do
    [ -d "$d" ] || continue
    [ "$(cat "$d/id" 2>/dev/null || true)" = "$_ref" ]   && { printf '%s' "$d"; return 0; }
    [ "$(cat "$d/name" 2>/dev/null || true)" = "$_ref" ] && { printf '%s' "$d"; return 0; }
  done
  return 1
}
name_taken() { _n=$1; resolve "$_n" >/dev/null 2>&1; }

# Reconcile a container marked running whose supervisor pid is gone → exited(dead). A pid that is gone
# OR a ZOMBIE (killed, not yet reaped — /proc still exists) both mean the container is no longer alive;
# checking only /proc existence would keep a cgroup.kill'd-but-unreaped upid stuck at `running`.
reconcile() {
  _d=$1
  [ "$(cat "$_d/status" 2>/dev/null || true)" = running ] || return 0
  _up=$(cat "$_d/upid" 2>/dev/null || true)
  [ -n "$_up" ] || return 0
  _dead=0
  if [ ! -e "/proc/$_up" ]; then
    _dead=1
  else
    _stt=$(awk '/^State:/{print $2; exit}' "/proc/$_up/status" 2>/dev/null || echo Z)
    case "$_stt" in Z | X | "") _dead=1 ;; esac
  fi
  if [ "$_dead" = 1 ]; then
    printf 'exited\n' > "$_d/status"
    [ -s "$_d/exit" ] || printf 'dead\n' > "$_d/exit"
  fi
}

# ── run ───────────────────────────────────────────────────────────────────────────────────────────
wv_run() {
  _int=0 _mem="" _pids="" _name="" _detach=0
  while [ $# -gt 0 ]; do
    case "$1" in
      -d|--detach)      _detach=1; shift ;;
      -i|--interactive) _int=1; shift ;;
      --name)           _name="${2:?--name needs a value}"; shift 2 ;;
      --memory)         _mem="${2:?--memory needs a value}"; shift 2 ;;
      --pids)           _pids="${2:?--pids needs a value}"; shift 2 ;;
      --)               shift; break ;;
      -*)               echo "wvrun run: unknown flag $1" >&2; return 2 ;;
      *)                break ;;
    esac
  done
  bundle="${1:-}"; [ -n "$bundle" ] || usage; shift  # remaining "$@" = optional command override
  [ -d "$bundle/rootfs" ] || { echo "wvrun run: no rootfs/ in bundle $bundle" >&2; return 2; }
  ensure_dirs

  if [ "$_detach" -eq 0 ]; then
    container_core "$_int" "$_mem" "$_pids" "wvrun.fg.$$" "" "$bundle" "$@"
    return $?
  fi

  # Detached: allocate id + state, check name uniqueness, launch a supervisor subshell.
  [ -n "$_name" ] && { name_taken "$_name" && { echo "wvrun run: name '$_name' already in use" >&2; return 2; }; }
  id=$(new_id)
  [ -n "$_name" ] || _name="$id"
  sd="$WV_RUN_DIR/$id"; mkdir -p "$sd"
  log="$WV_LOG_DIR/$id.log"; : > "$log"
  printf '%s\n' "$id"                 > "$sd/id"
  printf '%s\n' "$_name"              > "$sd/name"
  printf '%s\n' "$(basename "$bundle")" > "$sd/image"
  printf '%s\n' "$bundle"             > "$sd/bundle"
  printf '%s\n' "$(now_epoch)"        > "$sd/started"
  printf 'created\n'                  > "$sd/status"
  # Supervisor: a detached subshell (ignores SIGHUP so it survives this wvrun exiting). It inherits the
  # functions + $child. stdout/stderr → the container log. It records state and reaps the exit code.
  (
    trap '' HUP
    exec >>"$log" 2>&1 </dev/null
    container_core "$_int" "$_mem" "$_pids" "wvrun.$id" "$sd" "$bundle" "$@" || true
  ) &
  printf '%s\n' "$!" > "$sd/spid"
  printf '%s\n' "$id"
}

# ── ps ────────────────────────────────────────────────────────────────────────────────────────────
wv_ps() {
  _all=0; [ "${1:-}" = "-a" ] && _all=1
  ensure_dirs
  for d in "$WV_RUN_DIR"/*; do
    [ -d "$d" ] || continue
    id=$(cat "$d/id" 2>/dev/null || true); [ -n "$id" ] || continue
    reconcile "$d"
    st=$(cat "$d/status" 2>/dev/null || echo unknown)
    if [ "$_all" -eq 0 ]; then
      [ "$st" = running ] || [ "$st" = created ] || continue
    fi
    name=$(cat "$d/name" 2>/dev/null || true)
    image=$(cat "$d/image" 2>/dev/null || true)
    started=$(cat "$d/started" 2>/dev/null || echo 0)
    exitc=$(cat "$d/exit" 2>/dev/null || true)
    printf '{"id":"%s","name":%s,"image":%s,"status":"%s","started":"%s","exit":"%s"}\n' \
      "$id" "$(json "$name")" "$(json "$image")" "$st" "$started" "$exitc"
  done
}

# ── logs ──────────────────────────────────────────────────────────────────────────────────────────
wv_logs() {
  _f=0; [ "${1:-}" = "-f" ] && { _f=1; shift; }
  ref="${1:-}"; [ -n "$ref" ] || { echo "usage: wvrun logs [-f] <id|name>" >&2; return 2; }
  d=$(resolve "$ref") || { echo "wvrun logs: no such container: $ref" >&2; return 1; }
  id=$(cat "$d/id" 2>/dev/null || true); log="$WV_LOG_DIR/$id.log"
  [ -f "$log" ] || { echo "wvrun logs: no log for $ref" >&2; return 1; }
  if [ "$_f" -eq 0 ]; then cat "$log"; return 0; fi
  # Follow: stream new lines until the container leaves the running/created states.
  tail -n +1 -f "$log" & tp=$!
  while :; do
    reconcile "$d"
    st=$(cat "$d/status" 2>/dev/null || echo exited)
    { [ "$st" = running ] || [ "$st" = created ]; } || break
    sleep 1
  done
  sleep 1
  kill "$tp" 2>/dev/null || true
  wait "$tp" 2>/dev/null || true
}

# ── stop ──────────────────────────────────────────────────────────────────────────────────────────
wv_stop() {
  ref="${1:-}"; [ -n "$ref" ] || { echo "usage: wvrun stop <id|name>" >&2; return 2; }
  d=$(resolve "$ref") || { echo "wvrun stop: no such container: $ref" >&2; return 1; }
  reconcile "$d"
  st=$(cat "$d/status" 2>/dev/null || true)
  [ "$st" = running ] || { echo "$(cat "$d/id")"; return 0; }
  cg=$(cat "$d/cg" 2>/dev/null || true)
  pid=$(cat "$d/pid" 2>/dev/null || true)
  up=$(cat "$d/upid" 2>/dev/null || true)
  # Best-effort graceful: SIGTERM the container init (honored only if it installed a handler).
  [ -n "$pid" ] && kill -TERM "$pid" 2>/dev/null || true
  _n=0; while [ "$_n" -lt 10 ]; do
    reconcile "$d"; [ "$(cat "$d/status" 2>/dev/null)" = running ] || break; sleep 1; _n=$((_n + 1))
  done
  if [ "$(cat "$d/status" 2>/dev/null)" = running ]; then
    if [ -n "$cg" ] && [ -f "$cg/cgroup.kill" ]; then
      echo 1 > "$cg/cgroup.kill" 2>/dev/null || true
    else
      [ -n "$up" ]  && kill -KILL "$up"  2>/dev/null || true
      [ -n "$pid" ] && kill -KILL "$pid" 2>/dev/null || true
    fi
  fi
  _n=0; while [ "$_n" -lt 10 ]; do
    reconcile "$d"; [ "$(cat "$d/status" 2>/dev/null)" = running ] || break; sleep 1; _n=$((_n + 1))
  done
  echo "$(cat "$d/id")"
}

# ── rm ────────────────────────────────────────────────────────────────────────────────────────────
wv_rm() {
  _force=0; [ "${1:-}" = "-f" ] && { _force=1; shift; }
  ref="${1:-}"; [ -n "$ref" ] || { echo "usage: wvrun rm [-f] <id|name>" >&2; return 2; }
  d=$(resolve "$ref") || { echo "wvrun rm: no such container: $ref" >&2; return 1; }
  reconcile "$d"
  st=$(cat "$d/status" 2>/dev/null || true)
  if [ "$st" = running ] || [ "$st" = created ]; then
    [ "$_force" -eq 1 ] || { echo "wvrun rm: container $ref is $st (use -f to force)" >&2; return 1; }
    wv_stop "$ref" >/dev/null 2>&1 || true
  fi
  id=$(cat "$d/id" 2>/dev/null || true)
  cg=$(cat "$d/cg" 2>/dev/null || true)
  _leave_cgroup "$cg"
  # Defensive: also remove the id-derived leaf if a partially-created one lingers.
  [ -n "$id" ] && [ -d "/sys/fs/cgroup/wvrun.$id" ] && rmdir "/sys/fs/cgroup/wvrun.$id" 2>/dev/null || true
  rm -rf "$d"
  [ -n "$id" ] && rm -f "$WV_LOG_DIR/$id.log"
  echo "$id"
}

# ── exec (E3.5-T05c): enter a running container's namespaces via nsenter/setns ──────────────────────
# Runs a NEW process inside an already-running container's pid+mount+uts+ipc namespaces, its root
# filesystem (the overlay merged tree), and its cwd/env. This is the real "docker exec" primitive.
#
# CONFINEMENT INHERITANCE (honest, v1): exec inherits the container's NAMESPACES (pid/mount/uts/ipc)
# and therefore its root fs + hostname + process view. It does NOT re-apply the container's seccomp
# filter to the exec'd process (nsenter doesn't, and setns doesn't carry the filter) — a follow-up if
# per-exec seccomp parity is wanted. cgroup: the exec'd process stays in the CALLER's cgroup (guest),
# not the container's leaf, in v1. These are stated, not implied.
wv_exec() {
  _it=0
  while [ $# -gt 0 ]; do
    case "$1" in
      -it|-ti|-i|-t) _it=1; shift ;;
      --) shift; break ;;
      -*) echo "wvrun exec: unknown flag $1" >&2; return 2 ;;
      *) break ;;
    esac
  done
  ref="${1:-}"; [ -n "$ref" ] || { echo "usage: wvrun exec [-it] <id|name> <cmd…>" >&2; return 2; }
  shift
  d=$(resolve "$ref") || { echo "wvrun exec: no such container: $ref" >&2; return 1; }
  reconcile "$d"
  st=$(cat "$d/status" 2>/dev/null || true)
  [ "$st" = running ] || { echo "wvrun exec: container $ref is not running ($st)" >&2; return 1; }
  pid=$(cat "$d/pid" 2>/dev/null || true)
  { [ -n "$pid" ] && [ -d "/proc/$pid" ]; } || { echo "wvrun exec: container $ref has no live process" >&2; return 1; }
  # Guard against host PID reuse: the recorded pid must still be a pid-namespace INIT (nested) — its
  # /proc/<pid>/status NSpid line must carry 2+ fields (host pid + in-ns pid). A recycled guest pid
  # would show a single NSpid field → refuse rather than exec into an unrelated process.
  _nsp=$(awk '/^NSpid:/{print NF-1; exit}' "/proc/$pid/status" 2>/dev/null || echo 1)
  [ "${_nsp:-1}" -ge 2 ] || { echo "wvrun exec: container $ref pid is no longer a container init (pid reuse guard)" >&2; return 1; }

  [ $# -gt 0 ] || set -- /bin/sh
  bundle=$(cat "$d/bundle" 2>/dev/null || true)
  # Enter the container namespaces + root + cwd; apply the container env (env -i KEY=VAL…). nsenter's
  # --root/--wd (no value) default to the target's root and cwd, landing in the overlay merged tree.
  argc=$#
  if [ -n "$bundle" ] && [ -s "$bundle/config/env" ]; then
    while IFS= read -r kv || [ -n "$kv" ]; do [ -n "$kv" ] && set -- "$@" "$kv"; done < "$bundle/config/env"
  fi
  # Rotate: move the original argv (argc entries) to the end so order is <env pairs…> <argv…>.
  i=0
  while [ "$i" -lt "$argc" ]; do a=$1; shift; set -- "$@" "$a"; i=$((i + 1)); done
  exec nsenter --target "$pid" --pid --mount --uts --ipc --root --wd -- env -i "$@"
}

# ── legacy run-to-exit (E3.5-T03): `wvrun [--interactive] [--memory B] [--pids N] <bundle>` ──────────
wv_legacy() {
  _int=0 _mem="" _pids=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --interactive|-i) _int=1; shift ;;
      --memory) _mem="${2:?}"; shift 2 ;;
      --pids)   _pids="${2:?}"; shift 2 ;;
      --) shift; break ;;
      -*) echo "wvrun: unknown flag $1" >&2; usage ;;
      *) break ;;
    esac
  done
  bundle="${1:-}"; [ -n "$bundle" ] || usage
  ensure_dirs
  container_core "$_int" "$_mem" "$_pids" "wvrun.$$" "" "$bundle"
}

# ── dispatch ────────────────────────────────────────────────────────────────────────────────────────
case "${1:-}" in
  run)  shift; wv_run  "$@" ;;
  ps)   shift; wv_ps   "$@" ;;
  logs) shift; wv_logs "$@" ;;
  stop) shift; wv_stop "$@" ;;
  rm)   shift; wv_rm   "$@" ;;
  exec) shift; wv_exec "$@" ;;
  "")   usage ;;
  *)    wv_legacy "$@" ;;
esac
