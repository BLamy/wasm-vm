set -euo pipefail
ulimit -c 0
cd "$HOME/chromium-smoke/replay-chromium"
export XDG_RUNTIME_DIR=/run/replay-desktop
export WAYLAND_DISPLAY=wayland-0
export GDK_BACKEND=wayland
export RECORD_REPLAY_DONT_RECORD=1
nohup ./chrome --ozone-platform=wayland --disable-gpu --no-first-run --no-default-browser-check --disable-background-networking --disable-component-update --disable-sync --password-store=basic --lang=en-US --start-maximized --user-data-dir="$HOME/.config/replay-gui-smoke" http://10.0.2.2:8530/smoke.html > ../gui-browser.log 2>&1 < /dev/null &
pid=$!
echo "$pid" > ../gui-browser.pid
printf 'CHROME_GUI_PID=%s\n' "$pid"
sleep 8
kill -0 "$pid"
ps -eo pid,ppid,args | grep -E '[c]hrome|[c]hromium'
for entry in /proc/[0-9]*/cmdline; do
  if tr '\0' ' ' < "$entry" 2>/dev/null | grep -q -- '--type=renderer'; then
    process="${entry%/cmdline}"
    echo "RENDERER_STATUS=$process"
    grep -E '^(Name|Pid|PPid|Uid|NSpid|NoNewPrivs|Seccomp|Seccomp_filters):' "$process/status" || true
  fi
done
printf 'REPLAY_GUI_BROWSER_STARTED\n'
