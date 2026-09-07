# E5-T26c terminal verifier attack plan

Fresh-session predictions recorded at exact HEAD `0dcc764462348e96ef59d89deb325e14747b9704`
after reading the task, commit topology, and implementation diff, but before opening
`native-final.json` or any prior verifier report.

## Predictions

- **P1 — exact-head gate.** `make verify-E5-T26c` will exit 0 at `0dcc7644`, running 11
  snapshot tests, 6 keyboard/LED tests, and 2 `virtio_keyboard` integration tests with zero
  failed or ignored tests; format, both GPU-trace clippy modes, and the no-default-features
  wasm32 build will also pass.
- **P2 — evidence binding.** The committed `native-final.json` blob will hash to
  `3fa79264342ebc265dda07042b4b8836c55550780c50bf6c5b6ed6c5d2a96763`, identify runtime/test
  commit `30b7d6936a8cf06a1cd1157ccd45d6f35355c61f`, and describe the same commands and test counts
  observed in P1. That commit will be an ancestor of exact HEAD, with only verifier/task evidence
  above it.
- **P3 — cap-exact consumed-record refusal is atomic.** A payload containing exactly 65,536
  serialized events in a fully consumed frame (`next == len`, declared pending count zero),
  restored over a target with delivered `KEY_A` and `BTN_LEFT`, will fail before mutation with
  `TooManyEvents { found: 65539, maximum: 65536 }`. The target's snapshot bytes, delivered-key
  ledger, and suppressed-key ledger will remain exactly unchanged.
- **P4 — both cap boundaries hold.** The same 65,536-record payload will round-trip byte-exactly
  into a target requiring no release frame; adding record 65,537 will be rejected atomically on
  both encode and forged decode. A bounded novel attack with 65,533 consumed records plus the
  three-event two-key release frame will succeed at exactly 65,536 serialized records, prepend
  releases in deterministic reverse-code order, and clear the physical ledgers only after
  admission.
- **P5 — malformed input is atomic.** Zero frame length, `next > len`, pending-count mismatch,
  non-boolean flags, nonzero reserved bytes, trailing bytes, truncation, duplicate events, and an
  oversized combined staged/frame record count will all fail without changing queue bytes or the
  intentionally unserialized delivered/suppressed ledgers.
- **P6 — release ordering and protection.** With delivered `KEY_A` and `BTN_LEFT`, restore will
  emit `BTN_LEFT up`, `KEY_A up`, then `SYN_REPORT`; the release frame will precede saved work,
  survive budget pressure and key-up pruning, suppress a host re-down until drained, and leave no
  delivered/suppressed key behind.
- **P7 — fresh input and LEDs.** Restored empty keyboard, tablet, and mouse queues will each accept
  one fresh event and emit exactly `[event, SYN_REPORT]`. LED state `[num,caps,scroll]` will encode
  as canonical bytes `[1,0,1]`, reject a byte value of 2 without mutation, then accept a fresh
  `EV_LED/LED_CAPSL=1` status and encode `[1,1,1]`.
- **P8 — changed-hunk coverage.** Every semantic hunk from `4233b51^..0dcc7644` will map to an
  executed exact gate or promoted attack: snapshot API/codec/reader and malformed paths; release
  ledger/order/protection; serialized-count cap and preallocation; fresh-device behavior; LED
  codec/status; and the Make target. Type/export/documentation and verifier/task evidence hunks
  may be explicitly waived where runtime execution is inapplicable. No ignored tests, hidden
  network dependency, inherited `RUSTFLAGS`/`CARGO_*`/`RUST_LOG`, or self-computed evidence digest
  will substitute for direct assertions.

Independent-machine, WebKit, browser, and host-rr attacks are waived by repository policy and the
user's explicit scope for this terminal verification.
