# Native capture review (interim; no task verdict)

Reviewed frozen native source at `c2cbcfd0` and subsequent cleanup-only diff.
Actual native and browser evidence is still pending. This file does not mark AR
verified and makes no desktop responsiveness claim.

- **P1 independent Image identity — HELD.** The supplied AQ Image is 24208896
  bytes, SHA-256 `3cf8bed0d9a9941a6f2f81b7c8de86cefcba3e4e6bd5e5846bd395714a25642d`.
  Independent System.map extraction locates its 84-byte notes at Image offset
  19537624 and confirms `7117bfaf56cad575a6473084a94e6e2976cc08b598b5fbbe7d9d3142d238d55f`.
  See `kernel-notes-identity.json`. Actual running-guest readings remain pending.
- **P2 notes mismatch guard — HELD.** `kernel-identity-attack-r1.json` accepts
  valid candidate output and rejects 11 independent changes: the old executing
  kernel behind candidate Image metadata, ambiguous/duplicate lines, wrong
  sysfs path, nonzero/missing status, absent/truncated/altered digest, and suffix
  payload. The helper reads execution identity independently from metadata.
- **P7a process cleanup — initially FAILED, fix HELD.** Native wrapper at
  `c2cbcfd0`, lines 60–69, sent SIGTERM to the owned group but waited only for its
  leader. `owned-cleanup-original-r2/attack.json` and `...-r3/attack.json` both show
  the leader exited `-15` while its same-group descendant's heartbeat advanced
  after the wrapper returned. Verifier cleanup killed those fixture groups.
  The cleanup-only change (`omarchy-input-kernel-native.py` SHA-256
  `7710c792dd84353fcda6d9cccc995586f2e1c92bf7e22e14fba40455cf7317b4`)
  drains the group independently. The preserved actual-process attack now records
  TERM then KILL, `groupGone: true`, no descendant PID, and no heartbeat progress
  after wrapper return (`owned-cleanup-fixed-r1/attack.json`). Two additional
  actual-process checks cover an already exited group and cooperative leader +
  descendant, both with no unnecessary KILL (`owned-cleanup-cases-r1/cases.json`).

The first cleanup attack attempt (`owned-cleanup-original-r1`) encountered the
sandbox's denial of `ps`; its `finally` had already killed the owned group. The
repeated tests use only their own PID/heartbeat evidence and need no system-wide
process inspection. No actual emulator process was touched.

## Incremental coverage

Carry kernel identity/parser results and cleanup fixture results when their
function code is unchanged at the final freeze. The in-flight native happy run
can carry across the cleanup-only change: guest behavior, kernel notes reading,
snapshot trigger, serializer and native build commands are unchanged. The final
audit still needs native return/digests, browser loaded-kernel identity, actual
new pair, explicit final guest sync, geometry/properties and real screenshot.

## Actual native run — inspected after completion

**P1, native P3/P4/P6/P7 — HELD.** Independently read the full 1318-line raw
native boot log (a normalized copy preserves raw line numbers) and recomputed
every recorded input/output digest. `native-artifact-audit.json` records the
checks; native `run.json` SHA-256 is
`6b21acf1b7398e9655ee8f9f3bc90f2eb7bc3c238cd30cd372b9263d8cee5629`.

- Raw `boot.stdout.log` SHA-256
  `25ff25f23106ec415ce3ed71b76ecf6fdb16be5153ac2ca459dbdd0e487afa4c`,
  lines 421–427: actual fenced `sha256sum /sys/kernel/notes`, candidate digest at
  line 425, status zero at line 427. Linux cold boot, exact command line and
  1 GiB memory appear at lines 1, 24, 37; no inherited RAM is supplied by the
  frozen `build-omarchy-snapshot.sh` invocation.
- Lines 1156–1279: real mapped/visible/input-accepting Foot PID 473 at (12,38),
  1256×750; quickshell PID 484 runs `/usr/share/omarchy/shell`, with visible
  1280×800 background and 1280×26 bar. Earlier Hyprland IPC startup timeouts
  remain in the log and are not omitted or treated as responsiveness success.
- Lines 1284–1304: `LIBGL_ALWAYS_SOFTWARE=1`, `GALLIUM_DRIVER=llvmpipe`,
  `LP_NUM_THREADS=1`, and one `llvmpipe-0` thread. The separate renderer-log query
  returns no GL renderer string; this establishes the carried LP1 configuration,
  not a new positive GL renderer-string observation.
- Lines 1315–1318: `sync &&` split trigger command, followed by the genuine
  concatenated readiness marker. `pipeline.stderr.log` records an 888671256-byte
  snapshot and normal exit. Native wrapper return code is zero after 3660.416
  seconds, no watchdog, and independent `killpg(64485, 0)` finds no group.
- RAM gzip is 201704786 bytes / SHA-256
  `413b49b0d9220d8b43fc258760f60430923a604e436d3aede44791076f2d6b2b`;
  delta gzip is 1233174 bytes /
  `96837e2d6fc893fb329ec698d985c7f190d3f95d268a903ef62ba20a2e8578eb`.
  Both headers bind canonical R3 base `5f6a0809…f23d44` and generation zero;
  delta contains exactly 2712 ordered, unique, in-range 4 KiB blocks. Original
  R3 image SHA-256 `2b4143df…4cf83c` also matches historical R3 receipts.

Browser restored identity, final fresh image, direct properties and synchronized
export remain pending; AR cannot yet be verified.
