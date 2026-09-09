# E5-T26h sound remediation — pre-evidence predictions

Role: fresh scoped critic of the sound-queue remediation. These predictions were recorded before
running any remediation test, sabotage, or worker-evidence review. No verdict or lifecycle change
is made here.

Orientation baseline: `71dae9509b2bb6ce0972c122597fa3aa6ba86db9`. The reviewed pre-freeze
worktree diff is limited to `crates/core/src/lib.rs` and
`crates/core/tests/desktop_machine_audio_resume.rs`: 140 insertions and 2 deletions, diff SHA-256
`6fad21adc5e27f5d5ad2bd6645d2334fa5de253704040e9f075fae148418a1cc`.
The runtime change writes sound cursor metadata as control/event/TX/RX, restores it into that same
queue-index order, and inserts section-local sound layout version 2 while leaving the outer resume
container at version 1.

## Falsifiable predictions

1. **Frozen identity and scope.** The eventual worker record will identify one frozen runtime head
   whose diff from `71dae950` contains only the scoped sound layout/order implementation and its
   regression/target wiring. The frozen `lib.rs` and test bytes will match the submitted evidence;
   unrelated upper-layer movement will not be treated as H runtime movement.

2. **Wire queue identity.** A newly saved sound section will encode its four five-byte service
   cursor records in transport queue-index order: control 0, event 1, TX 2, RX 3. A source with
   control/event/TX configured and RX absent will show the nonzero TX cursor in tuple 2 and an empty
   tuple 3. The following little-endian word will be exactly `2`, and the unchanged sound codec will
   begin after it.

3. **Absent RX is valid.** Whole-machine resume of a real playback source with no RX queue will no
   longer return `BadComponentState { tag: 16 }`. It will preserve DRIVER_OK and the saved
   control/event/TX used indices while leaving RX absent.

4. **Exact fresh PCM; no replay.** Restore itself will write zero bytes to the distinct fresh host
   sink. After posting ordinal-1 fresh seed-1701 PCM on queue 2 and advancing only the fresh host
   clock to its deadline, the fresh WAV payload will equal the new samples bit-for-bit, the old
   seed-73 period will not appear, TX used will advance from 1 to 2 exactly once, and its status
   will become `VIRTIO_SND_S_OK` with zero latency. The old sink will remain unchanged. This must
   hold for 480/2048-frame periods, zero/high source clocks, and stopped/released source states.

5. **Configured RX cannot steal TX.** Repeating prediction 4 with a configured but unused queue-3
   RX ring will produce identical fresh playback and TX completion. RX's zero cursor will remain
   associated with queue 3; it cannot rebuild or service the queue-2 TX path.

6. **Desktop envelope is neutral.** Predictions 3-5 will hold both after whole-machine load alone
   and after the subsequent fresh-HELLO-gated desktop-envelope restore. The envelope will neither
   replay old PCM nor replace the target's injected sink/clock.

7. **Legacy/unknown layout rejection is atomic.** An old unversioned control/event/RX/TX sound
   payload, version words `0`, `1`, `3`, and `u32::MAX`, and 0-3-byte truncated version words will
   all return typed `BadComponentState { tag: 16 }` during detached prevalidation. After each
   refusal, a byte-for-byte target resume snapshot, sound-state handle identity, zero-byte fresh
   sink, zero fresh clock, and absence of host-visible restore effects will match the pre-call
   baseline. No case may be accepted by accidentally reading codec bytes as a compatible layout.

8. **Valid-v2 malformed payload remains atomic.** A v2 marker followed by a corrupt/truncated sound
   codec or invalid queue metadata will still reject before live transport, queue shadows, sound
   state, sink, clock, RAM, or another desktop component changes. Existing every-section refusal
   coverage may satisfy this only if it reaches the new versioned parser boundary at the frozen
   bytes; otherwise one bounded mutation will be required.

9. **Headless compatibility.** A whole-machine snapshot with no sound section will retain outer
   container format version 1, load into a fresh headless target, restore CPU/RAM, and retire the
   next instruction. The section-local sound version check must not affect non-sound sections.

10. **Sabotage sensitivity.** In an exact temporary copy only, either restoring the old RX/TX
    ordering or bypassing the sound layout-version rejection will make the corresponding promoted
    regression fail. A test that remains green under its targeted sabotage is insufficient.

11. **Carried HELD scope.** Console old-session draining/fresh HELLO, serial/control continuity,
    malformed console reset, input release, GPU repair/resources, CPU/RAM continuation, topology,
    legacy atomicity/shared sparse parsing, RNG, headless behavior outside the new sound-version
    boundary, and clean-environment portability remain HELD where their runtime bytes and evidence
    digests are unchanged. Only the withdrawn sound queue/cursor/PCM boundary is re-litigated; no
    browser proof, WebKit, independent machine, or host-rr requirement is added.

## Planned bounded verification after freeze

- Verify the worker log digest and exact frozen source bytes.
- Run the focused native sound-resume target and the existing promoted H regressions selected by
  the changed boundary.
- Inspect exact v2 section bytes and typed refusal/unchanged-state assertions.
- Perform one temporary-copy queue-order or version-check sabotage, then discard the copy.
- Do not run browser or web builds; E5-T26f owns browser acceptance after H is reverified.
