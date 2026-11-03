set -euo pipefail
cd "$HOME/chromium-smoke/replay-chromium"
printf 'REFERENCE_IDENTITY_BEGIN\n'
uname -a
sha256sum chrome sandbox_linux_unittests
RECORD_REPLAY_DONT_RECORD=1 ./chrome --version
ps -eo pid,ppid,args | grep -E '[c]hrome|[c]hromium'
for entry in /proc/[0-9]*/cmdline; do
  if tr '\0' ' ' < "$entry" 2>/dev/null | grep -q -- '--type=renderer'; then
    process="${entry%/cmdline}"
    printf 'RENDERER_STATUS=%s\n' "$process"
    grep -E '^(Name|Pid|PPid|Uid|NSpid|NoNewPrivs|Seccomp|Seccomp_filters):' "$process/status"
  fi
done
printf 'REFERENCE_IDENTITY_END\nSANDBOX_FULL_LOG_BEGIN\n'
cat ../sandbox-tests-build20.log
printf '\nSANDBOX_FULL_LOG_END\nGUI_FULL_LOG_BEGIN\n'
cat ../gui-browser.log
printf '\nGUI_FULL_LOG_END\n'
