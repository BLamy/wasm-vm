# E5.5-T03aq — fresh critic predictions

Prepared on 2026-09-16 after reading AGENTS.md, the task, planning commit
`1f3b74a74640305096d0eec0578d6810b54a0afd`, and the unchanged native
keyboard-proof hook. No AQ worker run or artifact result has been inspected.

## Falsifiable predictions

- **P1 isolated kernel change.** The candidate input source differs from pinned
  Linux 6.6.63 only at `EVDEV_MIN_BUFFER_SIZE` (`64U` to `1024U`). The source
  tarball, baseline evdev source, full config and build-toolchain identities are
  recorded. The checked-in baseline kernel still hashes to
  `af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce`.
  No other guest kernel source/config, emulator queue, WASM, deadline, service,
  renderer or snapshot-format change is hidden in the product diff.
- **P2 actual shared reader.** Both kernel boots execute the identical hashed
  static RV64 `/init` binary. It opens two distinct evdev clients on the actual
  virtio keyboard before printing the host injection marker. The measured
  client performs no read, flush ioctl or clock-changing ioctl until all input
  reaches the kernel. Only the separate state client uses `EVIOCGKEY` to detect
  a final B-down sentinel. The recording identifies real character device,
  device name, capabilities and loaded kernel artifact, and includes raw bytes.
- **P3 candidate command-sized burst.** For 64 A make/break pairs, the delayed
  measured read returns exactly 258 24-byte events, ordered as 64 repetitions
  of `(EV_KEY,KEY_A,1),(EV_SYN,SYN_REPORT,0),(EV_KEY,KEY_A,0),
  (EV_SYN,SYN_REPORT,0)`, followed by `(EV_KEY,KEY_B,1),
  (EV_SYN,SYN_REPORT,0)`. It contains no `SYN_DROPPED` and then returns EAGAIN.
- **P4 baseline bounded loss.** For the same 64-pair input, the 64-entry ring
  discards 62 retained events each time head catches tail. Four overflows leave
  exactly 10 events: `SYN_DROPPED,SYN_REPORT,A-up,SYN_REPORT,A-down,SYN_REPORT,
  A-up,SYN_REPORT,B-down,SYN_REPORT`. Independently extracted pinned source
  `linux-6.6.63-evdev.c:214-241` shows overflow on one-based insertion numbers
  64, 126, 188 and 250; the last overwrite replaces input index248 with the
  marker and retains indices249 through257. This prediction was refined from
  the source before viewing any worker output. Actual guest evidence, not the
  index calculation, must satisfy it.
- **P5 overflow remains bounded.** Candidate 256 A pairs plus the sentinel
  enqueue 1026 events. One 1024-entry-ring overflow leaves four events:
  `(EV_SYN,SYN_DROPPED,0),(EV_SYN,SYN_REPORT,0),(EV_KEY,KEY_B,1),
  `(EV_SYN,SYN_REPORT,0)`. No hang, unbounded allocation or silent loss replaces
  the synchronization marker.
- **P6 legacy unchanged.** Without the new optional burst argument, the native
  proof hook still injects exactly A-down/SYN_REPORT/A-up/SYN_REPORT and no B
  sentinel, no capacity change and no CLI-default behavior change. The existing
  four-event proof still passes. The new argument is rejected unless the proof
  hook is explicitly enabled and is bounded against huge allocations.
- **P7 coverage and provenance.** The frozen head, candidate and baseline
  identities, reader, all exact argv, exit status and output digests agree.
  Affected CLI/harness checks pass; carried AO runtime proofs are unchanged.
  No result is advertised as desktop responsiveness or browser acceptance.

## Bounded novel attack, chosen before any worker result

Run the frozen candidate with **255 A make/break pairs**, followed by the same
B-down/SYN_REPORT sentinel. Its 1022 events sit just below the first overflow
boundary and must all survive in exact order, with no SYN_DROPPED. Compare with
the worker's 256-pair / 1026-event overflow proof. This distinguishes an actual
1024-entry capacity from an implementation or audit that merely special-cases
the 64-pair happy case, and exposes an off-by-one or packet-boundary assumption.

## Scope limitations

This proves fixed guest evdev burst retention only. It does not prove that the
AP SYN_DROPPED marker had a uniquely determined cause, that existing RAM snapshots
contain the candidate kernel, or that Hyprland/Foot respond within 120 seconds.
Those desktop-pair and uninstrumented physical/visible gates remain separate.
