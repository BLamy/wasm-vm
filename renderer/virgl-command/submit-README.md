# Proof-only ordered submission bridge

`createVirglSubmitBridge` connects an explicitly enabled Wasm proof machine to the asynchronous renderer. The ordinary `createVirglControlBridge` keeps its synchronous control-only behavior. Neither factory enables production guest VIRGL negotiation.

The callback `apply` copies and validates accepted commands and identity metadata, then starts one bounded renderer job without polling the GPU. The host calls `pump()` once per later browser task, outside `Machine.run`. The only transport capabilities are synchronous `gatherInput`, `scatterOutput`, and `complete`; all u64 identities and offsets use exactly 16 hexadecimal digits.

Successful backing attachment records both Rust and renderer generations immediately. Each DMA request must match that mapping and the admitted request snapshot. Input comes from a fresh owned Rust bus copy. Output contains only dense dirty rows; the bridge revalidates the pending renderer request immediately before Rust scatter, then acknowledges the same token in the same synchronous task. No Wasm-memory view is retained across a yield.

Completed GPU work posts one capacity-one mailbox response. The next bounded machine run publishes response bytes, used-ring ownership and interrupt state. Guest fence IDs are labels, never ordering keys. An epoch and internal request sequence identify the owned head. Later descriptors remain guest-owned until admitted.

Unexpected transport errors poison the bridge. A post-scatter exception cannot promise rollback: it posts an explicit uncertain failure (`bridge-poisoned`, `gpuComplete: false`) and cancels/drains renderer ownership. The Rust mailbox accepts the actual consumed exchange counter for this failure only. Cancellation from queue reconfiguration retains owners until draining; explicit reset revokes the old epoch and replaces them. Disposing never claims GPU completion.

`probes.owners()` is a trusted test capability, unavailable to guest packets. Browser evidence runs actual WebGL2 and guest queues; synthetic host-fault controls are separately labelled. The source-omission controls collect PBO data too early or post completion before the GPU fence retires and must fail independent sequencing assertions.


The browser suite imports the original eight captured command bodies without modification (210 packets), applies public initialization and cleanup in their recorded order, and checks 768 interior pixels against literal colors. The VirtIO envelopes are independently constructed proof packets, not a claim that a Linux Mesa process ran in this fixture. A second replay poisons saved output references and requires identical actual guest-RAM output hashes.

Additional fixtures queue 100 real indexed draws with duplicate, descending and full-width fence IDs followed immediately by context destruction; interleave two contexts; detach and reattach backing behind an owned head; mutate a later head before admission; reset or reconfigure pending ownership; and inject labelled trusted host failures after scatter and before acknowledgment. Eight literal portable cases compare exact native/Wasm request bytes, response bytes, rings, and canonical control/submission digests. GPU wait schedules may change diagnostic turn counts. Machine digests are captured at stable checkpoints rather than on every polling turn.

Run `make verify-E6-T11b2` for the submission gate. For an inner development loop, `node tools/verify-virgl-submit.mjs --output target/evidence/virgl-submit-development` records headed hardware execution. `--sabotage early-collect` must fail “async CPU collection requires a signaled fence”; `--sabotage early-completion` must fail “completion is posted only after all GPU fences retire”. These controls alter only served source bytes and record both source hashes.
