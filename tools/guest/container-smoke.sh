#!/bin/sh
# E3.5-T02: in-guest container-capability smoke test. Shipped into the Alpine rootfs at
# /usr/local/bin/container-smoke. Every "=y" kernel symbol is a LIE until exercised in the guest —
# this drives each container primitive on our emulator and prints PASS/FAIL per capability, then a
# final SMOKE_ALL_"PASS" (split so a tty echo of the invocation can't fake it — the E3-T13 F1
# lesson). Requires util-linux (unshare/nsenter/setpriv) + the kernel config audited in
# docs/containers.md. POSIX sh (busybox ash).
#
# Exit 0 iff every capability passed.

fails=0
ok()   { echo "SMOKE $1 PASS"; }
bad()  { echo "SMOKE $1 FAIL: $2"; fails=$((fails + 1)); }

# 1. NAMESPACES — the exact shape E3.5-T03's runner uses (pid+mount+net+uts+ipc+fork, /proc remounted).
#    The child computes its marker so the outer tty echo can't satisfy the check.
if unshare -m -n -u -i -p -f --mount-proc sh -c 'echo NS_$((6*7))' 2>/dev/null | grep -q '^NS_42$'; then
  # In a fresh PID ns the entered shell is PID 1 and sees a fresh /proc.
  npids=$(unshare -m -p -f --mount-proc sh -c 'ls /proc | grep -c "^[0-9]*$"' 2>/dev/null)
  if [ "${npids:-99}" -le 3 ]; then ok NS; else bad NS "PID ns did not isolate /proc (saw $npids pids)"; fi
else
  bad NS "unshare of pid/mount/net/uts/ipc failed"
fi

# 2. USER NAMESPACE (rootless shape) — unshare -U with a uid map; root inside maps to the caller.
if unshare -U -r sh -c 'id -u' 2>/dev/null | grep -q '^0$'; then ok USERNS; else bad USERNS "unshare -U -r failed"; fi

# 3. UTS isolation — a hostname change inside the ns must not leak out.
outer=$(hostname)
if unshare -u sh -c 'hostname smoke-uts; hostname' 2>/dev/null | grep -q '^smoke-uts$' \
   && [ "$(hostname)" = "$outer" ]; then ok UTS; else bad UTS "hostname isolation failed"; fi

# 4. TMPFS — mount, write, read back.
mkdir -p /tmp/smoke-tmpfs
if mount -t tmpfs tmpfs /tmp/smoke-tmpfs 2>/dev/null \
   && echo TMP_$((6*7)) > /tmp/smoke-tmpfs/f && grep -q '^TMP_42$' /tmp/smoke-tmpfs/f; then
  umount /tmp/smoke-tmpfs 2>/dev/null; ok TMPFS
else bad TMPFS "tmpfs mount/read failed"; fi

# 5. OVERLAYFS — lower (ext4) + upper/work (tmpfs): a whiteout and an override across layers.
ov=/tmp/smoke-ov
rm -rf "$ov"; mkdir -p "$ov"/lower "$ov"/upper "$ov"/work "$ov"/merged
echo base > "$ov"/lower/keep; echo orig > "$ov"/lower/over; echo del > "$ov"/lower/gone
mount -t tmpfs tmpfs "$ov"/upper 2>/dev/null || true
if mount -t overlay overlay -o "lowerdir=$ov/lower,upperdir=$ov/upper,workdir=$ov/work" "$ov"/merged 2>/dev/null; then
  echo new > "$ov"/merged/over            # override a lower file
  rm -f "$ov"/merged/gone                 # whiteout a lower file
  if grep -q '^base$' "$ov"/merged/keep && grep -q '^new$' "$ov"/merged/over && [ ! -e "$ov"/merged/gone ]; then
    ok OVERLAYFS
  else bad OVERLAYFS "overlay read/override/whiteout wrong"; fi
  umount "$ov"/merged 2>/dev/null
else bad OVERLAYFS "overlay mount failed"; fi

# 6. PIVOT_ROOT — the runner's rootfs switch, inside a mount namespace.
if unshare -m sh -c '
  newroot=/tmp/smoke-root; rm -rf "$newroot"; mkdir -p "$newroot/old" "$newroot/bin" "$newroot/proc"
  # A minimal root: bind busybox in so /bin/sh exists after the pivot.
  mount --bind / "$newroot" 2>/dev/null || { cp -a /bin/busybox "$newroot/bin/" 2>/dev/null; ln -sf busybox "$newroot/bin/sh"; }
  cd "$newroot" && pivot_root . old 2>/dev/null || exit 1
  /bin/busybox echo PIVOT_$((6*7))
' 2>/dev/null | grep -q '^PIVOT_42$'; then ok PIVOT_ROOT; else bad PIVOT_ROOT "pivot_root inside a mount ns failed"; fi

# 7. CGROUP v2 memory limit → OOM kill (memcg accounting + the OOM killer must work).
if mount -t cgroup2 none /sys/fs/cgroup 2>/dev/null || [ -d /sys/fs/cgroup/cgroup.controllers ]; then
  grep -q memory /sys/fs/cgroup/cgroup.controllers 2>/dev/null && \
    echo +memory > /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null
  leaf=/sys/fs/cgroup/smoke; mkdir -p "$leaf" 2>/dev/null
  if echo $((16 * 1024 * 1024)) > "$leaf/memory.max" 2>/dev/null; then
    # Move an over-allocator into the group; it must be OOM-killed, and the guest survives.
    ( echo $$ > "$leaf/cgroup.procs" 2>/dev/null
      # busybox 'yes' piped into a growing buffer allocates; use dd to a tmpfs sized past the limit.
      exec sh -c 'a=""; i=0; while [ $i -lt 100000 ]; do a="$a$(head -c 1024 /dev/zero | tr "\0" x)"; i=$((i+1)); done' ) &
    child=$!
    wait "$child" 2>/dev/null; rc=$?
    # Killed by SIGKILL (OOM) → exit code 137, or non-zero. A clean 0 means the limit was NOT enforced.
    if [ "$rc" -ne 0 ]; then ok CGROUP_MEM; else bad CGROUP_MEM "over-allocator was NOT OOM-killed (limit unenforced)"; fi
    rmdir "$leaf" 2>/dev/null
  else bad CGROUP_MEM "cannot set memory.max"; fi
else bad CGROUP_MEM "cgroup2 unavailable"; fi

# 8. VETH pair into a BRIDGE (the container networking primitive, inside a net ns).
if command -v ip >/dev/null 2>&1; then
  if ip link add smk-br type bridge 2>/dev/null \
     && ip link add smk-a type veth peer name smk-b 2>/dev/null \
     && ip link set smk-a master smk-br 2>/dev/null \
     && ip link set smk-br up 2>/dev/null && ip link set smk-a up 2>/dev/null; then
    ip link show smk-a 2>/dev/null | grep -q 'master smk-br' && ok VETH_BRIDGE || bad VETH_BRIDGE "veth not enslaved"
    ip link del smk-br 2>/dev/null; ip link del smk-a 2>/dev/null
  else bad VETH_BRIDGE "veth/bridge creation failed"; fi
else bad VETH_BRIDGE "iproute2 'ip' missing"; fi

# 9. LOOP device — loop-mount a filesystem image (some layer/volume flows use it).
img=/tmp/smoke.img
if dd if=/dev/zero of="$img" bs=1M count=4 2>/dev/null && mkfs.ext4 -q -F "$img" 2>/dev/null; then
  mkdir -p /tmp/smoke-loop
  if mount -o loop "$img" /tmp/smoke-loop 2>/dev/null; then
    echo LOOP_$((6*7)) > /tmp/smoke-loop/f && grep -q '^LOOP_42$' /tmp/smoke-loop/f && ok LOOP || bad LOOP "loop rw failed"
    umount /tmp/smoke-loop 2>/dev/null
  else bad LOOP "loop mount failed"; fi
  rm -f "$img"
else bad LOOP "cannot create the loop image (mkfs.ext4 missing?)"; fi

echo "SMOKE_SUMMARY fails=$fails"
if [ "$fails" -eq 0 ]; then echo "SMOKE_ALL_""PASS"; exit 0; else exit 1; fi
