# E9-T05 independent critic predictions

Recorded before opening worker evidence on 2026-10-17. Runtime diff read first:
`34954a201d25f218663f682215a785319cd1b832..354f0a6036221bd2b858558dc04f125f22a3323b`.
Claim/status-only current head: `e0c7906172cd3b7847d7d02703f0b8af3dab73ec`.
No production code may be changed in this session.

- **P0 provenance.** The original report has SHA-256
  `d06225f249d7c1ce6b5d3b3826d92e7cdd713649a9fe3c7ea2367ea3f5e5ef92`, names
  the frozen runtime head, authenticates every recorded file and every claimed source;
  compact copies (including decompressed tuples) reproduce their original bytes.
- **P1 coherent boundary.** Independent decoding of before/restored envelopes finds the
  same five component bytes and exactly one of every native section 1..16; CPU, sparse
  RAM, clock phase/divider, devices, input/output, disk base and generation agree. The
  advanced frame differs in CPU/RAM/disk. Read-only filesystem inspection recovers
  `e9:before\n` from before/restored and `e9:after\n` from after.
- **P2 guest witness.** The actual built-browser reload starts paused without retiring
  instructions, retains held key 30 and queued `e9_queue=queued-before\n`, then the
  restored guest prints `memory-before/queued-before`. Native reference/restored
  continuations retire identical nonzero instructions and architectural digests.
- **P3 atomic failure/publication.** Invalid captures, corrupt saved objects and a failed
  publication do not change the revision-1 manifest or the advanced live guest; no
  rejected tuple replaces destination CPU, RAM, device or host queue bytes.
- **P4 original I/O and timeout.** Capture reaches an original pending disk read and a
  pending write, drains the existing work with no clock/instruction progress, and commits
  matching generation/map. Sixteen unavailable-chunk passes refuse without advancing
  time; supplying the genuine bytes makes the same machine capture and execute again.
- **P5 late-component admission.** Independently rehashed malformed native components
  (including late console/input/clock sections), missing/duplicate/unknown topology,
  wrong disk siblings and invalid clock policy refuse before any target mutation. A
  valid continuation after each refusal remains the uninterrupted reference.
- **P6 producer/owner transitions (bounded novel attack).** During an awaited immutable
  publication, mutation or detachment of caller-owned tuple/configuration cannot publish
  a different tuple under the pinned hash. Concurrent input/control/capture/stop calls
  respect the owner fence; failure leaves the old saved checkpoint and live machine usable.
- **P7 profile and compatibility.** Unsupported wall time, extra devices, host audio,
  microphone, active PCM and accelerated capture are refused in their relevant boundary.
  The immutable retained GPU runtime still physically draws after retiring instructions;
  this is compatibility evidence, not accelerated session-history qualification.
- **P8 coverage/mock hunt.** Every changed runtime hunk is exercised by authenticated
  native/Wasm/browser runs or has an explicit narrow configuration/type/logging waiver.
  Exact bytes and independently decoded guest-visible witnesses support the claim rather
  than screenshots, self-generated goldens or test-only semantic implementations.
- **P9 promoted oracle.** Independent varied-schedule/admission tests pass on the actual
  implementation, and a controlled local sabotage of the newly asserted invariant fails
  the promoted test. The production tree remains unchanged after the sabotage experiment.
- **P10 final proof pending.** The one pristine-clone acceptance must run after the final
  promoted-test commit with scrubbed Rust/Cargo environment; live Cloudflare bytes and
  public browser proof follow it. Neither can be asserted from the pre-cold audit.

Results will be recorded as HELD, FAILED or NEEDS EVIDENCE with concrete citations.

Before the ABA attack: **P6a** predicts that changing a COW leaf in the caller-owned
frame after `openSession`, then restoring that byte immediately before the final
machine-object `put`, either refuses publication or publishes a root whose complete
delta equals the authenticated machine frame. A reported successful commit followed by
`historical disk mismatch` on admission falsifies coherent publication.
