# AQ: bounded Linux input retention proven; desktop trial still required

Frozen source head: `97743da727ee51eb7326b112c18653ff02941da1`.
Command: `make verify-E5_5-T03aq EVDEV_KERNEL_OUT=target/omarchy-input-kernel-r3 EVDEV_PROOF_OUT=evidence/omarchy-profile/evdev-buffer-r3/guest`
Environment: `DEVELOPER_DIR=/Library/Developer/CommandLineTools`,
`PYTHONPYCACHEPREFIX=/private/tmp/omarchy-proof-pycache`.

## Actual guest result

The same static RV64 init program opened two independent clients on the real
`wasm-vm virtio keyboard`, event0 major13/minor64, before the host injection
marker. The measured fd3 remained unread until fd4 observed the final B-down
state. Only fd4 used EVIOCGKEY, whose per-client queue-flush behavior therefore
did not alter the measured stream. Every final measured read drained to EAGAIN.
Host pending counts reached zero in every run. Raw24-byte events, full serial
logs and final guest architectural digests are retained under guest/.

| Kernel / input | Observed events | Result |
|---|---:|---|
| Original / one A press | 4 | Original make/sync/break/sync unchanged |
| Original /64 A presses +B sentinel | 10 | Exact predicted loss tail including SYN_DROPPED |
| Candidate / one A press | 4 | Same legacy behavior |
| Candidate /64 A presses +B sentinel | 258 | Every injected event, ordered, no SYN_DROPPED |
| Candidate /256 A presses +B sentinel | 4 | Explicit bounded overflow: DROP,sync,B-down,sync |

All five boots exited normally, each in11–15 host seconds. The guest output
reader's literal host oracle is independent of the kernel ring implementation;
no modeled queue was substituted for the Linux result. The opt-in CLI burst hook
raises only its own diagnostic host queue budget to the finite injected count,
so host loss cannot masquerade as evdev loss. Normal browser/core input is unchanged.

## Kernel and proof boundary

The isolated candidate was extracted from the pinned Linux6.6.63 tarball in a
fresh unique local Docker volume using image e8d02030be71b3eada014b615269d0a9e8eb93ace68fb2a8f9097c9467c109e1.
The original evdev source hash was checked before replacing exactly one line:
EVDEV_MIN_BUFFER_SIZE64U becomes1024U. The builder verifies the exact unified
patch, unchanged generated config and all original baseline artifact hashes.
The temporary build volume was removed successfully. No network was used.

Candidate Image:24208896 bytes, SHA256
`3cf8bed0d9a9941a6f2f81b7c8de86cefcba3e4e6bd5e5846bd395714a25642d`.
Original Image remains
`af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce`.
The minimum evdev allocation grows from1536 to24576 event bytes per client
(+23040), retaining the existing finite ring/overflow algorithm. System.map,
Image and config hashes are in kernel-build/build.json; artifacts remain under
target/omarchy-input-kernel-r3. AO WASM/core/web bytes are unchanged.

Format, configured native CLI clippy, three CLI argument tests and release build
pass. The first preflight failed to compile a nonexistent KEY_B import and also
surfaced the inherited non-gpu unused-variable warning. The corrected hook uses
Linux code48 and the repository's gpu-trace native configuration. The second
preflight reached kernel extraction but lacked the external patch utility in
the pinned image; the final builder uses its bundled Python and validates the
exact diff. Neither failed preflight launched a guest; their logs are retained.

This establishes input retention under delayed reading, not desktop latency.
AR must cold-boot this kernel into a fresh paired desktop state. AS must then
pass the original uninstrumented physical nonce and visible returned-prompt
trial before Q can publish responsiveness. Old AJ RAM still contains the old kernel.
