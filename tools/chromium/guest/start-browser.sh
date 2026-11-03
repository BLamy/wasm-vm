#!/usr/bin/env bash
# Runs inside the existing unprivileged Weston desktop service.
set -euo pipefail
umask 077
test "$(id -u)" = 1000
test -d "$XDG_RUNTIME_DIR" -a -O "$XDG_RUNTIME_DIR"
control="$XDG_RUNTIME_DIR/replay-chromium"
mkdir "$control"
mkdir -p "$HOME/.local/state/replay-chromium"
mkfifo "$control/in" "$control/out"
# Holding both ends avoids FIFO-open ordering deadlocks. Chromium's private
# DevTools pipe reads fd 3 and writes NUL-terminated JSON on fd 4; no TCP listener.
exec 3<>"$control/in" 4<>"$control/out"
export RECORD_REPLAY_DONT_RECORD=1
/opt/replay-chromium/chrome \
  --ozone-platform=wayland --disable-gpu \
  --no-first-run --no-default-browser-check \
  --disable-background-networking --disable-component-update --disable-sync \
  --password-store=basic --lang=en-US --start-maximized \
  --num-raster-threads=1 --renderer-process-limit=1 \
  --user-data-dir="$HOME/.config/replay-chromium" --remote-debugging-pipe \
  file:///opt/replay-chromium/smoke.html \
  3<"$control/in" 4>"$control/out" \
  >"$HOME/.local/state/replay-chromium/browser.log" 2>&1 &
browser_pid=$!
ready=0
cleanup() {
  if [ "$ready" != 1 ]; then
    printf '%s\n' REPLAY_CHROMIUM_STARTUP_FAILED
  fi
  kill "$browser_pid" 2>/dev/null || true
  wait "$browser_pid" 2>/dev/null || true
  exec 3>&- 4>&-
  rm -f "$control/in" "$control/out" "$control/pid"
  rmdir "$control"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
printf '%s\n' "$browser_pid" > "$control/pid"

title_ready=0
for attempt in {1..120}; do
  kill -0 "$browser_pid"
  printf '{"id":%d,"method":"Target.getTargets"}\0' "$attempt" >&3
  message=
  if IFS= read -r -d '' -t 1 message <&4; then
    if [[ "$message" =~ \"title\"[[:space:]]*:[[:space:]]*\"Replay\ RISC-V\ PASS\ \#1\" ]]; then
      printf 'REPLAY_CHROMIUM_TARGETS %s\n' "$message"
      title_ready=1
      break
    fi
  fi
  sleep 0.1
done
if [ "$title_ready" != 1 ]; then
  exit 1
fi

renderers=0
for command in /proc/[0-9]*/cmdline; do
  renderer=0 profile=0
  while IFS= read -r -d '' argument; do
    # Zygote children can replace argv with one process-title string containing
    # all switches. Accept both that form and ordinary NUL-separated arguments.
    if [[ " $argument " == *" --type=renderer "* ]]; then renderer=1; fi
    if [[ " $argument " == *" --user-data-dir=$HOME/.config/replay-chromium "* ]]; then profile=1; fi
    if [ "$renderer" = 1 ] && [ "$profile" = 1 ]; then break; fi
  done 2>/dev/null < "$command" || true
  [ "$renderer" = 1 ] && [ "$profile" = 1 ] || continue
  status="${command%/cmdline}/status"
  no_new_privs= seccomp= namespace=
  while IFS=: read -r key value; do
    case "$key" in
      NoNewPrivs) no_new_privs="${value//[[:space:]]/}" ;;
      Seccomp) seccomp="${value//[[:space:]]/}" ;;
      NSpid) namespace="$value" ;;
    esac
  done < "$status"
  test "$no_new_privs" = 1 -a "$seccomp" = 2
  printf 'REPLAY_RENDERER_SANDBOX pid=%s NoNewPrivs=%s Seccomp=%s NSpid=%s\n' \
    "${command%/cmdline}" "$no_new_privs" "$seccomp" "$namespace"
  renderers=$((renderers + 1))
done
test "$renderers" -gt 0
sync
ready=1
printf 'REPLAY_CHROMIUM_READY renderers=%s\n' "$renderers"
wait "$browser_pid"
