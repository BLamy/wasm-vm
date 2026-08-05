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
  npids=$(unshare -m -p -f --mount-proc sh -c 'ls /proc | grep -c "^[0-9][0-9]*$"' 2>/dev/null)
  # Lower bound (>=1) guards against an empty/failed /proc reading as "isolated" (critic LOW).
  if [ "${npids:-99}" -ge 1 ] && [ "${npids:-99}" -le 3 ]; then ok NS; else bad NS "PID ns did not isolate /proc (saw $npids pids)"; fi
else
  bad NS "unshare of pid/mount/net/uts/ipc failed"
fi

# 2. USER NAMESPACE (rootless shape) — assert a DISTINCT user ns is actually created. The guest runs
#    as root, so `id -u == 0` proves nothing (it's 0 with or without unshare — critic MAJOR). Compare
#    the /proc/self/ns/user inode: a real new userns has a different inode from the caller's.
outer_userns=$(readlink /proc/self/ns/user 2>/dev/null)
inner_userns=$(unshare -U -r sh -c 'readlink /proc/self/ns/user' 2>/dev/null)
if [ -n "$inner_userns" ] && [ "$inner_userns" != "$outer_userns" ]; then ok USERNS
else bad USERNS "no distinct user ns (outer=$outer_userns inner=$inner_userns)"; fi

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
#    overlayfs requires upperdir AND workdir on the SAME filesystem, so put both under one tmpfs
#    mount (the earlier version mounted tmpfs on upper only, leaving work on ext4 → EXDEV). lower may
#    live on a different fs (ext4), which is what a real container overlay does.
ov=/tmp/smoke-ov
rm -rf "$ov"; mkdir -p "$ov"/lower "$ov"/mnt "$ov"/merged
echo base > "$ov"/lower/keep; echo orig > "$ov"/lower/over; echo del > "$ov"/lower/gone
mount -t tmpfs tmpfs "$ov"/mnt 2>/dev/null || true
mkdir -p "$ov"/mnt/upper "$ov"/mnt/work
grep -qw overlay /proc/filesystems || echo "SMOKE OVERLAYFS NOTE: overlay absent from /proc/filesystems"
oerr=$(mount -t overlay overlay -o "lowerdir=$ov/lower,upperdir=$ov/mnt/upper,workdir=$ov/mnt/work" "$ov"/merged 2>&1)
if [ $? -eq 0 ]; then
  echo new > "$ov"/merged/over            # override a lower file
  rm -f "$ov"/merged/gone                 # whiteout a lower file
  if grep -q '^base$' "$ov"/merged/keep && grep -q '^new$' "$ov"/merged/over && [ ! -e "$ov"/merged/gone ]; then
    ok OVERLAYFS
  else bad OVERLAYFS "overlay read/override/whiteout wrong"; fi
  umount "$ov"/merged 2>/dev/null
else bad OVERLAYFS "overlay mount failed: ${oerr:-unknown}"; fi

# 6. PIVOT_ROOT — the runner's rootfs switch, inside a mount namespace. new_root MUST be a mount
#    point and its parent propagation MUST be private, so: make the ns's mounts private, mount a fresh
#    tmpfs as the new root, THEN populate it (the earlier version pre-created old/ then `mount --bind /`
#    shadowed it, so put_old vanished; and it never made / rprivate). Failures print their reason.
perr=$(unshare -m sh -c '
  mount --make-rprivate / 2>/dev/null || true
  nr=/tmp/smoke-root; rm -rf "$nr"; mkdir -p "$nr"
  mount -t tmpfs tmpfs "$nr" || { echo "newroot tmpfs mount failed:$?"; exit 1; }
  mkdir -p "$nr/old"
  echo here > "$nr/pivoted"        # a marker that exists ONLY in the new root
  cd "$nr" && pivot_root . old || { echo "pivot_root syscall failed:$?"; exit 1; }
  # Post-pivot the fresh root holds no binaries (and Alpine busybox is dynamically linked, so an
  # external exec would fail for lack of the musl loader) — prove the switch with shell BUILTINS only:
  # the marker is reachable at the new / iff the root really pivoted, and echo emits the check token.
  [ -f /pivoted ] || { echo "post-pivot root wrong (marker missing)"; exit 1; }
  echo PIVOT_$((6*7))
' 2>&1)
if printf '%s\n' "$perr" | grep -q '^PIVOT_42$'; then ok PIVOT_ROOT
else bad PIVOT_ROOT "pivot_root inside a mount ns failed: $(printf '%s' "$perr" | tr '\n' ' ')"; fi

# 7. CGROUP v2 memory limit → OOM kill (memcg accounting + the OOM killer must work).
#    Availability test keys on the controllers FILE (-f, not -d — it is a file; critic LOW false-FAIL),
#    and on Alpine /sys/fs/cgroup is usually already a cgroup2 mount so the mount may fail-busy.
if [ -f /sys/fs/cgroup/cgroup.controllers ] || mount -t cgroup2 none /sys/fs/cgroup 2>/dev/null; then
  grep -q memory /sys/fs/cgroup/cgroup.controllers 2>/dev/null && \
    echo +memory > /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null
  leaf=/sys/fs/cgroup/smoke; mkdir -p "$leaf" 2>/dev/null
  if echo $((16 * 1024 * 1024)) > "$leaf/memory.max" 2>/dev/null; then
    # Move the allocator into the leaf from INSIDE its own process, then exec the allocator: after the
    # `exec`, $$ is the allocator's own pid (in a POSIX subshell $$ is the PARENT script's pid, so the
    # old `echo $$ > cgroup.procs` moved the WRONG process and left the allocator unconfined — critic
    # CRITICAL). `tail /dev/zero` is the canonical unbounded allocator (O(1) forks, not the old O(n²)
    # shell-string loop that would blow the interpreter budget).
    sh -c 'echo $$ > "'"$leaf"'/cgroup.procs" 2>/dev/null; exec tail /dev/zero' >/dev/null 2>&1 &
    child=$!
    wait "$child" 2>/dev/null
    # PROOF is the kernel's own memcg OOM counter, NOT the exit code: a nonzero exit could come from a
    # global OOM, a signal, or an error while the memcg limit was never enforced (critic CRITICAL).
    # memory.events:oom_kill > 0 proves THIS cgroup's OOM killer fired.
    oom=$(awk '/^oom_kill /{print $2}' "$leaf/memory.events" 2>/dev/null)
    if [ "${oom:-0}" -gt 0 ]; then ok CGROUP_MEM
    else bad CGROUP_MEM "no memcg oom_kill event (limit unenforced; oom=${oom:-unset})"; fi
    rmdir "$leaf" 2>/dev/null
  else bad CGROUP_MEM "cannot set memory.max"; fi
else bad CGROUP_MEM "cgroup2 unavailable"; fi

# 8. VETH pair into a BRIDGE, with one peer moved into a separate NET NAMESPACE and pinged across.
#    Enslavement alone (all in the root netns) doesn't exercise the setns/cross-netns datapath the
#    runner needs — the peer must move into an `ip netns` and connectivity must actually work
#    (critic MAJOR: this is the emulator gap the task exists to surface).
if command -v ip >/dev/null 2>&1; then
  ip netns add smk-ns 2>/dev/null
  if ip link add smk-br type bridge 2>/dev/null \
     && ip link add smk-a type veth peer name smk-b 2>/dev/null \
     && ip link set smk-a master smk-br 2>/dev/null \
     && ip link set smk-b netns smk-ns 2>/dev/null \
     && ip addr add 10.99.0.1/24 dev smk-br 2>/dev/null \
     && ip link set smk-br up 2>/dev/null && ip link set smk-a up 2>/dev/null \
     && ip netns exec smk-ns ip addr add 10.99.0.2/24 dev smk-b 2>/dev/null \
     && ip netns exec smk-ns ip link set smk-b up 2>/dev/null \
     && ip netns exec smk-ns ip link set lo up 2>/dev/null; then
    # Ping the bridge (root netns) FROM inside the ns, across the veth — proves the datapath, not just plumbing.
    if ip netns exec smk-ns ping -c 1 -W 2 10.99.0.1 >/dev/null 2>&1; then ok VETH_BRIDGE
    else bad VETH_BRIDGE "no connectivity across veth/bridge/netns (ping failed)"; fi
  else bad VETH_BRIDGE "veth/bridge/netns setup failed"; fi
  ip link del smk-br 2>/dev/null; ip link del smk-a 2>/dev/null; ip netns del smk-ns 2>/dev/null
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
