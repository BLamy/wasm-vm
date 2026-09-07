# E5-T26c verifier predictions (fixed before evidence inspection)

Date: 2026-09-06
Range under review: `4233b51b3b4f03186561a91df7469300d376bdc9^..5cf56b74`

1. `make verify-E5-T26c` exits 0 at the submitted head and exercises the snapshot,
   keyboard/LED, integration, clippy, format, and wasm/no-default-features gates.
2. A snapshot with multiple pending frames and partially consumed frames restores the exact frame
   order, event bytes, `next` indices, staged work, queue-kick bits, and counters. Re-encoding the
   restored state is byte-identical when no release-all reconciliation is needed.
3. Keyboard LEDs encode as exactly three canonical bytes in num/caps/scroll order. A non-boolean
   byte is rejected and cannot partially mutate an existing LED state.
4. Zero/oversized frame lengths, `next > length`, forged pending counts, truncation, trailing data,
   invalid booleans/reserved bytes, and duplicate events are rejected before any target mutation;
   the target's complete pre-restore snapshot remains byte-identical.
5. Restoring over multiple delivered keys/buttons emits one protected release frame first, with
   key-up events in deterministic descending code order followed by one `SYN_REPORT`; the physical
   held/suppressed ledgers are cleared and reported discarded. Budget reduction and a subsequent
   host key-up cannot evict or rewrite this frame.
6. Restoring an empty queue permits fresh keyboard key/SYN, pointer/SYN, and LED status events
   immediately without reset or reboot.
7. The cited evidence digest matches the file, identifies the implementation head, contains no
   ignored/panicking test, and is not the sole oracle for any semantic assertion. Changed runtime
   hunks are either executed by deterministic tests/novel attacks or explicitly classified.

Waivers requested by the user/repository policy: independent machines, WebKit, and host rr.
