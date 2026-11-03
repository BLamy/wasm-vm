#!/usr/bin/env bash
set -euo pipefail
export XKB_DEFAULT_LAYOUT=us
weston --backend=drm --renderer=pixman --socket=wayland-0 --config="$HOME/.config/weston.ini" &
weston_pid=$!
trap 'kill "$weston_pid" 2>/dev/null || true' EXIT INT TERM
ready=0
for attempt in $(seq 1 600); do
  if [ -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]; then ready=1; break; fi
  kill -0 "$weston_pid" 2>/dev/null || { wait "$weston_pid"; exit 1; }
  sleep 0.1
done
[ "$ready" = 1 ] || { printf '%s\n' REPLAY_GUI_STARTUP_TIMEOUT; exit 1; }
printf 'REPLAY_GUI_READY architecture=%s renderer=pixman\n' "$(uname -m)"
foot --title='Replay RISC-V Linux' /bin/bash -lc 'printf "Ubuntu RISC-V Linux — Weston / Pixman\n"; uname -a; printf "\n"; exec /bin/bash' &
wait "$weston_pid"
debugfs 1.47.0 (5-Feb-2023)
