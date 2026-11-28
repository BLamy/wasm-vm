# E5-T43c verifier predictions (written before opening the worker's result files or booting)

Image under test: target/e5-t43c/image/replay-desktop.ext4, sha256 2a6e727e346b... (build.json head 32c5e4072,
no image-source change 32c5e4072..HEAD).

P1 READY not delayed. slirp/loopback/none result.json `readyUptime` each within 0.3 s of the same mode's
   gen-2 `baseline-gen2-*/result.json` readyUptime; the baselines themselves are measured (not typed in)
   and are the values the claim quotes (5.29 / 5.29 / 5.30).
P2 Lease. slirp console.log has `REPLAY_NETWORK bound ip=10.0.2.15 router=10.0.2.2 dns=10.0.2.3` before
   `REPLAY_DESKTOP_READY`-or-shortly-after; result.json checks.addresses == ["10.0.2.15/24"], routes has
   `default via 10.0.2.2 dev eth0`, resolvConf == ["nameserver 10.0.2.3"], fetchHttp/fetchHttps contain
   "STATUS 200".
P3 No DHCP answer (--net loopback): checks.addresses [], defaultRoute [], resolvConfExists "no",
   udhcpc a pid, networkLines []; READY within 0.3 s.
P4 No NIC: eth0 absent, udhcpc "none".
P5 Regression: evidence/e5-t43c/e5-t41a and e5-t36b result.json pass:true and imageSha256 == 2a6e727e....
P6 In my own boot, the hook and rcS inside the image are byte-identical (sha256) to the repo files at HEAD.
P7 (renewal, natural T1, novel) With `--net-slirp-lease-secs 30`, udhcpc renews on its own at ~T1 (15 s)
   without USR1; every renewal emits `REPLAY_NETWORK renew ip=10.0.2.15`; an `ip` wrapper placed first on
   the hook's PATH logs, across >= 2 natural renewals, NO `addr del 10.0.2.15/24` and NO `addr flush`
   (only `addr show`, `addr replace`, `route replace`). This is a deterministic check of "the hook never
   removes the lease's own address", independent of sampling luck.
P8 (mock hunt: discrimination of the script's renewal sampler) Against a sabotage hook that does
   `ip addr flush` + `ip addr add` on renew, the worker's sampler loop (same command text) will MISS the
   gap in a majority of renewals, because the gap is two back-to-back `ip` execs (~ms) while each sample is
   an ip|awk|tr pipeline. Prediction: of 5 sabotaged USR1 renewals, the sampler shows a missing-address
   sample in <= 2. If so the `renewSampleSet` assertion does not discriminate and is a weak proof; P7 then
   carries the claim.
P9 Snapshot timing: E5-T43c cannot capture the warm snapshot (no snapshot in its boundary); the attack
   belongs to E5-T43d. Prediction: E5-T43d's task file does not yet carry the stale-lease attack.
P10 Coverage: every changed hunk executes in some recorded run, except the hook's `deconfig` branch
   (executes at udhcpc start in every NIC run - udhcpc calls deconfig first) and `search $domain` (slirp
   sends no domain -> waived/unexercised). The second `ip link set lo up` in rcS duplicates rcS line 15
   (dead).
P11 Flag judgement: the CLI's `--net` is loopback-echo with no DHCP (crates/cli/src/boot.rs:402-405), so
   acceptance's "with --net" can only be met by `--net-slirp`; the worker's mapping is right.
