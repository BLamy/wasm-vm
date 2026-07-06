# Container support: the guest kernel audit (E3.5-T02)

Running OCI containers in the guest (the E3.5 goal → `wvrun postgres`) needs a set of kernel
capabilities. This is the audited matrix for the pinned `releases/kernel/6.6.63/config`, the
decisions on the two off-by-default symbols, and how each capability is *proven* (a `=y` in the
config is a lie until it's exercised in the guest — an emulator missing a syscall makes the
config claim false).

## Config matrix (verified against the shipped kernel)

| Capability | Symbol(s) | State | Why |
|---|---|---|---|
| Namespaces | `NAMESPACES`, `PID_NS`, `NET_NS`, `USER_NS`, `IPC_NS`, `UTS_NS` | **on** | container isolation; `USER_NS` enables rootless |
| cgroup v2 | `CGROUPS`, `MEMCG`, `CGROUP_PIDS`, `CPUSETS` | **on** | resource limits (memory/pids/cpu) |
| seccomp | `SECCOMP`, `SECCOMP_FILTER` | **on** | syscall filtering (runc-style profiles) |
| overlayfs | `OVERLAY_FS` | **on** | union rootfs from image layers |
| container net | `VETH`, `BRIDGE`, `BRIDGE_NETFILTER`, `NF_NAT`, `IP_NF_NAT` | **on** | veth-into-bridge + NAT |
| tmpfs | `TMPFS` | **on** | `/tmp`, overlay upper, in-memory volumes |
| loop | `BLK_DEV_LOOP` | **on** | loop-mounting filesystem images |

Most of these arrived via the riscv `defconfig` pulled in by the E3-T13 networking rebuild —
they were already present; this task's value is the **in-guest proof**, not the grep.

## The two off-by-default symbols — decisions

- **`TUN` (`CONFIG_TUN`) — DEFERRED to E3-T14 (slirp).** TUN/TAP is only needed for user-mode /
  slirp-style networking and a few container CNI plugins. v1 container networking uses
  `veth`-into-`bridge` (all `=y`), and the first `wvrun postgres` milestone connects over
  loopback — no TUN. Enable it when E3-T14 (the smoltcp slirp core) lands and needs a tap device.
- **`SQUASHFS` (`CONFIG_SQUASHFS`) — DEFERRED (no consumer yet).** Only needed if we ship
  *squashed* OCI layers or a squashed base rootfs. The E3.5-T01 importer unpacks layers to a
  plain tree over the ext4 overlay, so nothing reads squashfs today. Enable it only if a specific
  image or a size-optimization pass requires it; recorded here so the decision is explicit.

Neither blocks the container milestone; both are one-line config additions + a kernel rebuild if
a later task needs them.

## Proof: the in-guest smoke test

`tools/guest/container-smoke.sh` (shipped into the rootfs at `/usr/local/bin/container-smoke`)
drives each capability on the emulator and prints `SMOKE <CAP> PASS|FAIL`, then a final
`SMOKE_ALL_PASS` iff every one passed. It exercises, in order:

1. **Namespaces** — `unshare -m -n -u -i -p -f --mount-proc` (E3.5-T03's exact shape) + a PID-ns
   `/proc` isolation check (1 ≤ pid count ≤ 3).
2. **User namespace** — a real new userns must exist: `/proc/self/ns/user` inode inside
   `unshare -U -r` differs from the caller's. (Asserting `id -u == 0` would be vacuous — the guest
   is already root — so the ns-inode comparison is the actual proof.)
3. **UTS** — a hostname change inside the ns must not leak out (two-sided).
4. **tmpfs** — mount + read-back.
5. **overlayfs** — lower(ext4)+upper(tmpfs)+work: override a lower file and whiteout another.
6. **pivot_root** — the runner's rootfs switch, inside a mount namespace.
7. **cgroup v2 memory** — a leaf `memory.max`, an over-allocator (`tail /dev/zero`) moved into the
   leaf **from inside its own process** (a POSIX subshell's `$$` is the parent's pid, so the pid
   must be written after `exec`), proven OOM-killed by reading the kernel's own
   `memory.events:oom_kill > 0` counter — NOT the exit code (a nonzero exit could be a global OOM
   or a signal while the memcg limit was never enforced).
8. **veth + bridge across a net ns** — a veth pair enslaved to a bridge with one peer moved into a
   separate `ip netns`, then **pinged across** (proves the setns/cross-netns datapath, not just the
   plumbing).
9. **loop** — `mkfs.ext4` an image + `mount -o loop`.

Markers are echo-proof (computed in-guest, e.g. `NS_$((6*7))` → `NS_42`) per the E3-T13 F1 lesson,
so a tty echo of the command can't fake a PASS. Each step is written to prove the capability is
*actually working*, not merely that a command exited 0 — a smoke test that PASSes on a broken
capability is worse than none.

**Seccomp is not smoke-tested here.** Alpine base ships no seccomp CLI and the rootfs build has no
compiler for a probe helper, so a pure-shell filter test isn't available. `SECCOMP`/`SECCOMP_FILTER`
are config-verified `=y`; the *runtime* proof (install a filter, a denied syscall returns EPERM)
is relocated to **E3.5-T03**, whose runner installs a runc-style profile and asserts it.

### Userland requirement

The smoke test (and the runner) need **util-linux** (`unshare`, `nsenter`, `setpriv`,
`pivot_root`) and **iproute2** (`ip`) — both added to the rootfs package set
(`tools/build-rootfs.sh` `PKGS`). busybox's applets are too limited for the full namespace flags.

## Acceptance

`crates/cli/tests/boot_container_smoke.rs` (`#[ignore]`, nightly) boots Alpine, runs
`/usr/local/bin/container-smoke`, and asserts `SMOKE_ALL_PASS` — every capability exercised on the
real emulator. Any step that FAILS in-guest but works on real riscv64 Linux is an **emulator bug**
(a missing/wrong syscall: `clone3` namespace flags, `setns`, `pivot_root`, `umount2(MNT_DETACH)`,
`seccomp` filtering) to file and fix — the whole point of this task is to surface those before the
runner (E3.5-T03) depends on them.

## The runner: `wvrun` (E3.5-T03)

`tools/guest/wvrun.sh` (→ `/usr/local/bin/wvrun`) consumes a BUNDLE produced by
`wasm-vm oci unpack <layout> --out <bundle>` — `<bundle>/rootfs/` + `run.json` +
`config/{argv,env,cwd,user}` (flat files so the POSIX-sh runner needs no JSON parser). It overlays
the image (rootfs = read-only lower, tmpfs upper), `unshare`s pid+mount+uts+ipc+net, mounts fresh
proc/sys + `/dev`, `pivot_root`s in, applies cwd/env, and `exec`s the image's argv with exit-code
passthrough. `wvrun --interactive <bundle>` drops to a shell. `crates/cli/tests/boot_wvrun.rs`
(`#[ignore]`) is its booted acceptance: runs a bundle, proves overlay-upper write isolation (the
bundle rootfs is unmutated), and exit-code fidelity. **Seccomp filtering** (relocated here from the
audit) is proven by the runner installing a runc-style filter and asserting a denied syscall returns
EPERM — the one container primitive not smoke-tested in the audit above.
