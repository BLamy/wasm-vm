#!/bin/sh
# T05c exec test harness — runs as root on a Linux box with cgroup v2 + overlayfs + a static
# busybox. Starts a detached container (T05b) and exercises `wvrun exec [-it]`: namespace entry,
# container PID-1 visibility, mount-namespace secret isolation, interactive command, and typed
# errors for absent/exited containers. Prints PASS/FAIL markers + T05C_ALL_PASS / T05C_HAS_FAILURES.
set -u
WVRUN=/tmp/wvrun.sh
BB=/bin/busybox
ROOT=/tmp/wvt-exec
rm -rf "$ROOT"; mkdir -p "$ROOT"
rm -rf /run/wvcontainers /var/log/wvcontainers 2>/dev/null
for d in /sys/fs/cgroup/wvrun.*; do [ -d "$d" ] && { echo $$ > /sys/fs/cgroup/cgroup.procs 2>/dev/null; rmdir "$d" 2>/dev/null; }; done

mkbundle() {
  bdir=$1; mkdir -p "$bdir/rootfs/bin" "$bdir/config"
  cp "$BB" "$bdir/rootfs/bin/busybox"
  for a in sh echo sleep cat ls hostname env id true false head grep; do ln -sf busybox "$bdir/rootfs/bin/$a"; done
  printf '/\n' > "$bdir/config/cwd"
  printf 'PATH=/bin\nENV_exectest=marker\n' > "$bdir/config/env"
}
pass=0; fail=0
ok()  { echo "PASS $1"; pass=$((pass+1)); }
bad() { echo "FAIL $1 :: ${2:-}"; fail=$((fail+1)); }

B=$ROOT/c; mkbundle "$B"
printf '/bin/sh\n-c\nhostname wvctr; echo UP_$((6*7)); while :; do sleep 1; done\n' > "$B/config/argv"
id=$(sh "$WVRUN" run -d --name ex "$B"); sleep 2
echo "id=$id"

# AC1: exec computes a marker inside the container AND sees the container's hostname (uts ns).
out=$(sh "$WVRUN" exec "$id" sh -c 'echo INEXEC_$((6*7)); hostname' 2>&1)
echo "$out" | grep -q "INEXEC_42" && ok "AC1-inexec-marker" || bad "AC1-inexec-marker" "$out"
echo "$out" | grep -q "wvctr"      && ok "AC1-container-uts"   || bad "AC1-container-uts" "$out"

# AC2: /proc/1/comm inside exec is the CONTAINER's PID 1 (the entrypoint sh), not the host init.
c1=$(sh "$WVRUN" exec "$id" sh -c 'cat /proc/1/comm' 2>&1)
echo "$c1" | grep -qE '^(sh|busybox)$' && ok "AC2-container-pid1" || bad "AC2-container-pid1" "$c1"

# AC2b: container env is applied (env -i with the bundle's env).
e=$(sh "$WVRUN" exec "$id" sh -c 'echo E=$ENV_exectest' 2>&1)
echo "$e" | grep -q "E=marker" && ok "AC2b-container-env" || bad "AC2b-container-env" "$e"

# AC3: a host file OUTSIDE the bundle is NOT readable from inside (mount-namespace isolation).
echo TOPSECRET > /root/wv-guest-secret
sec=$(sh "$WVRUN" exec "$id" sh -c 'cat /root/wv-guest-secret 2>&1' 2>&1)
echo "$sec" | grep -q "TOPSECRET" && bad "AC3-secret-isolated" "LEAKED: $sec" || ok "AC3-secret-isolated"
rm -f /root/wv-guest-secret

# AC4: `exec -it` runs a command fed on stdin inside the container (interactive path).
it=$(printf 'echo ITWORKS_$((6*7))\nexit\n' | timeout 30 sh "$WVRUN" exec -it "$id" sh 2>&1)
echo "$it" | grep -q "ITWORKS_42" && ok "AC4-interactive" || bad "AC4-interactive" "$it"

# AC5: exec into an ABSENT container is a typed error (non-zero), not a silent success.
if sh "$WVRUN" exec no-such-ctr sh -c 'echo X' >/dev/null 2>&1; then bad "AC5-absent-typed-error" "exit 0"; else ok "AC5-absent-typed-error"; fi
# AC5b: after stop, exec into the EXITED container is a typed error.
sh "$WVRUN" stop "$id" >/dev/null 2>&1; sleep 1
if sh "$WVRUN" exec "$id" sh -c 'echo X' >/dev/null 2>&1; then bad "AC5b-exited-typed-error" "exit 0"; else ok "AC5b-exited-typed-error"; fi
sh "$WVRUN" rm "$id" >/dev/null 2>&1

echo "==== RESULT pass=$pass fail=$fail ===="
[ "$fail" -eq 0 ] && echo "T05C_ALL_PASS" || echo "T05C_HAS_FAILURES"
