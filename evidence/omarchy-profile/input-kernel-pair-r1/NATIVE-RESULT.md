# AR native desktop capture

The native run at c2cbcfd0d0d8b18ccc0d109363eca370c2dbf847 completed
normally in 3660.416 seconds, within the original 7200-second boot budget.
It cold-booted the verified AQ kernel against the unchanged R3 base image.
The actual running `/sys/kernel/notes` digest matches the AQ Image's 84-byte
notes section. `native/run.json` records every input and output digest.

The complete serial recording is `native/boot.stdout.log`. Its final desktop
observation records mapped Foot PID473, address0x55558518d650, and the package-owned
quickshell PID484 with original1280x800 layers. Hyprland PID398 has the requested
llvmpipe environment, LP_NUM_THREADS=1, and one llvmpipe-0 thread. The renderer log
is empty: this is configuration/thread evidence, not a new GL-renderer proof.
The guest acknowledges `sync` and emits the actual capture trigger at line1318.

Output RAM snapshot: 201704786 compressed bytes,
SHA256413b49b0d9220d8b43fc258760f60430923a604e436d3aede44791076f2d6b2b.
Output disk delta: 1233174 compressed bytes,
SHA25696837e2d6fc893fb329ec698d985c7f190d3f95d268a903ef62ba20a2e8578eb.
Both remain in target/omarchy-input-kernel-native-pair-r1.

The wrapper's descendant-cleanup fix landed while this normal run was active.
The unchanged happy boot is carried forward; the original and corrected cleanup
branches have separate real-process critic evidence. After completion, an
independent process-table check found no members of owned group64485:
`native-owned-group-after.json`. No browser or physical-input acceptance is
inferred from this native capture.

Command (with DEVELOPER_DIR=/Library/Developer/CommandLineTools and Node24 on PATH):

```
python3 tools/verify/omarchy-input-kernel-native.py evidence/omarchy-profile/input-kernel-pair-r1/native target/omarchy-input-kernel-native-pair-r1
```
