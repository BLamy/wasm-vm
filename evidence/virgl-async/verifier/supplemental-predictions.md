# Supplemental predictions — resumed independent verifier

Recorded before this verifier observes worker or independent execution results.
The original predictions remain immutable (SHA-256
`677ada291f5788b987dfe01f2d2b34fa14c16fc50fe123ddc062158b8d72b111`).
This verifier previously read transport-related async API documentation during
read-only successor design; it has not implemented this task. The root disclosed
the empty-job cancellation and driver buffer-usage fixes before review.

- **P21 — empty-job cancellation owns its fence.** Cancel an admitted empty job
  before its first step and while its final fence is waiting. Each cancellation
  returns a structured terminal error, retains the slot until any issued fence
  actually signals, never creates a second outstanding completion fence, and
  releases every owned sync before a new empty job can complete successfully.
- **P22 — attachment identity is captured at attachment.** describeBacking returns
  current public resource/storage generation, backing generation and length.
  Reattaching backing changes its generation even with identical bytes and length;
  resource ID reuse changes resource generation. Old exchange identities cannot
  acknowledge an output into that replacement.
- **P23 — terminal tokens cannot retain charged ownership.** Repeated foreign,
  consumed and post-disposal token operations fail explicitly without changing
  active job/accounting or deleting a successor's GL objects. Historical diagnostic
  tokens do not keep GPU staging, leases or byte reservations alive.
- **P24 — partial texture output is literal GPU data.** Independently initialize a
  four-by-four RGBA texture with distinct literal texels using the fresh-input
  handshake. Read a two-by-two box at (1,1) to a nonzero offset and padded row stride
  across a simulated SG split, with forced timeout macrotasks. Only the four literal
  texels are produced; edits to unrelated destination bytes survive row scattering.
  Cancel a second output before acknowledgement, reattach backing, and reject the
  old output token without modifying replacement bytes.

These complement P01–P20. They do not expand this task into guest transport,
production negotiation, scanout, throughput or whole-submission rollback.
