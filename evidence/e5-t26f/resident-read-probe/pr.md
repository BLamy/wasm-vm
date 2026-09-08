## Scope

Retains one native aarch64 BusyBox1.36.1 read-primitive experiment and its
fail-closed trace parser. No helper, guest image, emulator or browser runtime is
changed. Continues PR365 while F remains in progress and timing-failed.

## Result and review

- Actual ash reads:444 one-byte data reads +2 EOF reads over three real proc files.
- Actual cat reads:3 data reads +3 EOF reads over its own real proc files.
- Every trace's returned bytes reconstruct that operation's output exactly.
- Four bounded parser checks and an independent unknown-C-escape attack pass.
- Fresh Daybreak Blue holds the native claim only. No RISC-V/browser timing,
  full prepared-player, F-acceptance or speedup claim is made.

The two setup failures are retained before successful tracing. Tool byte hashes
bind the probe executed while repository/runtime base was2ace1353; that base
commit is not claimed to contain the then-uncommitted new probe.

Evidence: `evidence/e5-t26f/resident-read-probe/README.md` and
`evidence/e5-t26f/resident-read-verifier/report.md`.
No Actions, merge, auto-merge or deployment. No previous browser proof is rerun.
