#!/bin/sh
# T05b lifecycle test harness — runs as root on a Linux box with cgroup v2 + overlayfs + static busybox.
# Builds a tiny bundle and exercises wvrun run -d / ps / logs / stop / rm. Prints PASS/FAIL markers.
set -u
WVRUN=/tmp/wvrun.sh
BB=/bin/busybox
ROOT=/tmp/wvt
rm -rf "$ROOT"; mkdir -p "$ROOT"
export WV_RUN_DIR=/tmp/wvt/run WV_LOG_DIR=/tmp/wvt/log
# wvrun.sh hard-codes /run and /var/log; override by editing? No — it uses the constants. So we run it
# with those dirs writable. Instead, symlink: just let it use /run/wvcontainers + /var/log/wvcontainers.
unset WV_RUN_DIR WV_LOG_DIR
# Clean any prior state.
rm -rf /run/wvcontainers /var/log/wvcontainers 2>/dev/null
# Remove any leftover cgroup leaves from prior runs.
for d in /sys/fs/cgroup/wvrun.*; do [ -d "$d" ] && { echo $$ > /sys/fs/cgroup/cgroup.procs 2>/dev/null; rmdir "$d" 2>/dev/null; }; done

mkbundle() { # <dir> <argv-lines-file-content via stdin>
  bdir=$1
  mkdir -p "$bdir/rootfs/bin" "$bdir/config"
  cp "$BB" "$bdir/rootfs/bin/busybox"
  for a in sh echo sleep cat ls hostname env id sh true false head; do
    ln -sf busybox "$bdir/rootfs/bin/$a"
  done
  printf '/\n' > "$bdir/config/cwd"
  printf 'PATH=/bin\n' > "$bdir/config/env"
}

pass=0; fail=0
ok()   { echo "PASS $1"; pass=$((pass+1)); }
bad()  { echo "FAIL $1"; fail=$((fail+1)); }

# ── AC1: run -d one-shot-ish container, ps shows running, logs shows computed marker ──
B1=$ROOT/b1; mkbundle "$B1"
printf '/bin/sh\n-c\necho CONTAINED_$((6*7)); sleep 3\n' > "$B1/config/argv"
id1=$(sh "$WVRUN" run -d --name c1 "$B1")
echo "id1=$id1"
[ -n "$id1" ] && ok "AC1-run-returns-id" || bad "AC1-run-returns-id"
sleep 1
ps1=$(sh "$WVRUN" ps)
echo "PS1: $ps1"
echo "$ps1" | grep -q '"name":"c1"' && echo "$ps1" | grep -q '"status":"running"' && ok "AC1-ps-running" || bad "AC1-ps-running"
sleep 3
log1=$(sh "$WVRUN" logs c1)
echo "LOG1: $log1"
echo "$log1" | grep -q "CONTAINED_42" && ok "AC1-logs-marker" || bad "AC1-logs-marker"

# ── AC2: long-runner ps running, logs -f streams TICK, stop → exited ──
B2=$ROOT/b2; mkbundle "$B2"
printf '/bin/sh\n-c\ni=0; while :; do echo TICK_$i; i=$((i+1)); sleep 1; done\n' > "$B2/config/argv"
id2=$(sh "$WVRUN" run -d --name longrun "$B2")
echo "id2=$id2"
sleep 2
sh "$WVRUN" ps | grep -q '"name":"longrun".*"status":"running"' && ok "AC2-running" || bad "AC2-running"
# logs -f for ~3s then check TICK progression
( sh "$WVRUN" logs -f longrun > "$ROOT/tick.out" 2>&1 & echo $! > "$ROOT/tickpid" )
sleep 3
kill "$(cat "$ROOT/tickpid")" 2>/dev/null
tick_n=$(grep -c "TICK_" "$ROOT/tick.out" 2>/dev/null || echo 0)
echo "tick lines: $tick_n"
[ "$tick_n" -ge 2 ] && ok "AC2-logs-follow" || bad "AC2-logs-follow"
sh "$WVRUN" stop longrun >/dev/null
sleep 1
st2=$(sh "$WVRUN" ps -a | grep '"name":"longrun"')
echo "after stop: $st2"
echo "$st2" | grep -q '"status":"exited"' && ok "AC2-stopped" || bad "AC2-stopped"

# ── AC3: rm running refused w/o -f; after stop rm cleans up ──
B3=$ROOT/b3; mkbundle "$B3"
printf '/bin/sh\n-c\nsleep 30\n' > "$B3/config/argv"
id3=$(sh "$WVRUN" run -d --name rmtest "$B3")
sleep 1
if sh "$WVRUN" rm rmtest 2>/tmp/wvt/rmerr; then bad "AC3-rm-running-refused"; else grep -qi "running\|use -f" /tmp/wvt/rmerr && ok "AC3-rm-running-refused" || bad "AC3-rm-running-refused"; fi
sh "$WVRUN" stop rmtest >/dev/null
sh "$WVRUN" rm rmtest >/dev/null
[ ! -d "/run/wvcontainers/$id3" ] && [ ! -f "/var/log/wvcontainers/$id3.log" ] && ok "AC3-rm-cleans" || bad "AC3-rm-cleans"
[ ! -d "/sys/fs/cgroup/wvrun.$id3" ] && ok "AC3-cgroup-gone" || bad "AC3-cgroup-gone"

# ── AC4: two concurrent detached, distinct ids/logs, independent stop ──
B4=$ROOT/b4; mkbundle "$B4"
printf '/bin/sh\n-c\nwhile :; do echo AAA_$((6*7)); sleep 1; done\n' > "$B4/config/argv"
B5=$ROOT/b5; mkbundle "$B5"
printf '/bin/sh\n-c\nwhile :; do echo BBB_$((7*7)); sleep 1; done\n' > "$B5/config/argv"
ida=$(sh "$WVRUN" run -d --name ca "$B4")
idb=$(sh "$WVRUN" run -d --name cb "$B5")
echo "ida=$ida idb=$idb"
[ -n "$ida" ] && [ -n "$idb" ] && [ "$ida" != "$idb" ] && ok "AC4-distinct-ids" || bad "AC4-distinct-ids"
sleep 3
la=$(sh "$WVRUN" logs ca); lb=$(sh "$WVRUN" logs cb)
echo "$la" | grep -q "AAA_42" && ! echo "$la" | grep -q "BBB_" && echo "$lb" | grep -q "BBB_49" && ! echo "$lb" | grep -q "AAA_" && ok "AC4-no-crosstalk" || bad "AC4-no-crosstalk"
sh "$WVRUN" stop ca >/dev/null
sleep 1
# ca exited, cb still running
sh "$WVRUN" ps | grep -q '"name":"cb".*"status":"running"' && sh "$WVRUN" ps -a | grep '"name":"ca"' | grep -q exited && ok "AC4-independent-stop" || bad "AC4-independent-stop"
sh "$WVRUN" stop cb >/dev/null

# ── AC5: ps JSON parseable; a name with a space is not corrupt ──
B6=$ROOT/b6; mkbundle "$B6"
printf '/bin/sh\n-c\nsleep 20\n' > "$B6/config/argv"
sh "$WVRUN" run -d --name "my container" "$B6" >/dev/null
sleep 1
psj=$(sh "$WVRUN" ps | grep 'my container')
echo "PSJ: $psj"
# valid JSON per line? use busybox awk-free check: python if present, else grep the escaped field
if command -v python3 >/dev/null; then
  echo "$psj" | python3 -c 'import sys,json; [json.loads(l) for l in sys.stdin if l.strip()]' && ok "AC5-json-parseable" || bad "AC5-json-parseable"
else
  echo "$psj" | grep -q '"name":"my container"' && ok "AC5-json-parseable" || bad "AC5-json-parseable"
fi

# cleanup
for n in longrun rmtest ca cb "my container"; do sh "$WVRUN" rm -f "$n" >/dev/null 2>&1; done
sh "$WVRUN" rm -f c1 >/dev/null 2>&1

echo "==== RESULT pass=$pass fail=$fail ===="
[ "$fail" -eq 0 ] && echo "T05B_ALL_PASS" || echo "T05B_HAS_FAILURES"
