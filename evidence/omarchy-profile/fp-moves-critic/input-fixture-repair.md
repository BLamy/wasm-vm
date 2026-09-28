# Pre-existing wasm input queue fixture repair

This is a test-only repair found during the T03t workspace gauntlet. It changes
neither FP runtime semantics nor the physical desktop input recorder.

## Source diagnosis, before the repaired run

The pre-existing test constructs `InputDeviceSpec::default()`, whose event
capability bitmaps are empty (`crates/core/src/dev/virtio/input/mod.rs:632`).
`VirtioInput::new_with_state` retains that spec in `InputState` (:729), so
`inject_event(EV_KEY, 30, value)` rejects the unadvertised key (:204, :290).
Both rejected return values were ignored by the fixture. A rejected-only `sync`
emits no frame (:223). Consequently queue service has no event work (:1087).
The already-observed baseline failure is the all-zero buffer in
`evidence/omarchy-profile/fp-moves-r1/ci.log:343`; it is not evidence about FP
execution because this fixture creates no Hart, FRegs, or JIT executor.

`prepare_queue` checks `queue.ready` (:887); transport `DRIVER_OK` negotiation
is not this fixture's failure boundary. No transport status change is proposed.

## Prediction before repaired execution

Declare exactly the fixture's `EV_KEY/30` and `EV_SYN/SYN_REPORT` capabilities
before constructing the device. Assert that both host injections are accepted.
Then the existing service call must write, in order, key-down, key-up, and one
SYN_REPORT; each used descriptor must have length 8 and the used index must be 3.
Keep the existing byte-level assertions intact. The narrow command is:

```sh
wasm-pack test --node crates/wasm --test input_queues -- --nocapture
```

This repair cannot establish desktop responsiveness; the production physical
trial remains failed at the unchanged 120-second deadline.

## Recorded result

**HELD.** The focused command completed with exit 0 and 2 passed, 0 failed.
`input-fixture-repair.log:21`–`:24` records the corrected stream test and final
summary. Both newly asserted injections were accepted; the existing exact
event bytes, used lengths, and used index assertions all ran. `cargo fmt --all
--check` also passed. Log SHA-256:
`dc0ab5d7d77c6856578d43c90e838233e4b48534e38a19b9e7b7a486e4761617`.
Test source SHA-256:
`def66484b756f1771156f8648001f8fe3779ef9fec6da016e022d0170665b768`.
No runtime or transport status code changed.
