# E5.5-T03al independent verifier predictions

Recorded before inspecting any final candidate run. Baseline source is
`d52e8eaac48be3f67ef5967b409b47f8727041b0`; its allocation failure is already known
and is the problem statement, not a prediction. Only root implements. This
verifier changes no runtime code or worker tests.

## Predictions to falsify

1. **P1 — bounded allocation:** at the first save immediately after restoring
   the pinned R3 1 GiB guest, candidate release WASM returns a complete resume
   blob without an allocation trap. No retired guest instruction is needed.
   Memory sizes and the actual blob length are recorded. Restoring the exact
   same input using the original release WASM still fails in the unchanged
   `SnapshotWriter::section` allocation path.
2. **P2 — bytes and state:** with no guest instructions between observations,
   all serialized bytes of the save/load/save round trip are equal, not just
   the fixed header or a prefix, and the exposed RAM state digest remains equal.
   Source review confirms `WasmLinux.stateDigest` hashes RAM, not registers or
   devices; the complete bytes establish preservation of those other sections.
   Core/base/overlay identities retain their intended values. Evidence must
   distinguish the original R3 blob from a newly saved blob if loading performs
   documented normalization; no normalization may be silently discarded.
3. **P3 — persistent path:** the built browser's real persistence API saves the
   full restored machine, reads/export it back, and produces the same complete
   bytes as the direct writer from that same paused state. Stored metadata and
   byte count must agree. A mock IndexedDB or a tiny substitute guest does not
   establish the 1 GiB claim.
4. **P4 — refusals:** changing either the base-image identity or the overlay
   generation still yields its corresponding refusal. It must not resume a
   mismatched pair or mutate machine state before the refusal. Existing core
   identity refusal and malformed framing tests remain passing.
5. **P5 — section framing and allocation attack:** varied known-tag sequences,
   including empty/tiny sections before and after a large section, preserve the
   exact independently assembled little-endian WVMRESU1 bytes and order. A
   suffix cannot provoke approximately double unused container capacity. The
   reader must consume the exact section boundaries and return the original
   payloads. Seeds and lengths will be independent of worker fixtures.
6. **P6 — sabotage:** removing only the new reservation from an isolated copy
   causes the new allocation regression to fail, while the identical candidate
   copy passes. The regular working tree will not be mutated for this test.
7. **P7 — coverage:** every runtime changed hunk executes during the actual
   direct save and persistent save. Header, tags, payload encoding, restore
   guards, and quiescence semantics do not change. Overflow-only panic defense
   may be waived if its unreachability is justified by the supported memory and
   payload bounds; success paths may not be waived.
8. **P8 — submission and environment:** frozen head, runtime hashes, affected
   native/WASM checks, the actual 127-test browser suite with no new console
   errors, and one final scrubbed pristine-clone acceptance are bound to the
   implementation. Inherited gauntlet failures must be identified by unchanged
   source/error evidence; a new allocation regression is not inherited.
9. **P9 — honest scope:** the demo/export claim is limited to successful
   snapshots. No task, report, or UI states that physical keyboard responsiveness
   was solved. T03aj and T03ak remain gated on their own fresh-frame and physical
   keyboard evidence.

## Planned method

Read the final diff first, recompute evidence digests, and inspect each report
and log against its producing code. Run one small independent native source
module attack with a manually assembled byte oracle. Run the worker regression
against candidate and reservation-removed copies. Coordinate before any
browser, guest, or heavy build. Cite exact files and lines for the final verdict.

No final result has been inspected and no prediction is marked HELD yet.

## P2 clarification before the final run: existing console restore transition

The worker's preflight reported two differing original-R3 bytes. This verifier
then independently read the unchanged restore and codec source; the final run
has not been inspected. Exact equality to the original input is intentionally
not the restore contract for the host agent lifecycle. This is a narrowly
defined transition, not a blanket allowance for changed bytes:

- `mmio.rs::snapshot_transport` writes 45 fixed bytes followed by eight
  29-byte queue records: transport length 277.
- `lib.rs::save_resume` then writes six five-byte queue shadows in the order
  port0 RX, port0 TX, control RX, control TX, agent RX, agent TX. Agent TX's
  presence byte is therefore payload offset `277 + 5*5 = 302`.
- `ConsoleState::snapshot_resume` writes five lifecycle booleans followed by
  the eight-byte generation: generation starts at `277 + 6*5 + 5 = 312`, and
  the full console payload is 320 bytes.
- `ConsoleState::restore_resume` increments the restored generation with
  `wrapping_add(1)`. `Machine::load_resume` calls `discard_resume_agent_tx`
  after committing sections; its `prepare_queue` constructs a missing valid
  ready agent TX shadow. For this fixed input the predicted empty ring keeps
  both cursors zero and changes only that presence bit from 0 to 1.

**P2a prediction:** locate exactly one tag-11 TLV through the actual container
framing, require its 320-byte payload, and derive expected output from the
independently pinned original bytes using only presence=1 and generation+1
modulo 2^64. The first saved blob must equal that entire expected byte sequence.
The next load/save must apply only another generation increment (presence stays
1). An ordinary persistence save/read of the same state has no additional
restore transition and must be byte-identical. Restoring stored state applies
one further increment. Every other byte and the RAM digest must remain equal.
Unexpected payload length, framing, identity, queue cursors, or byte changes
fail this prediction; no observed final differences will be added to this
allowlist. The task and claim should state this transition explicitly.
