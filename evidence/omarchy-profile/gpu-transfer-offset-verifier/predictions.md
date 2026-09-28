# E5.5-T03at — independent predictions

Prepared on 2026-09-16 by the fresh verifier before final worker evidence or
the implementation diff. Orientation head: af253faa. Scope is the existing
TRANSFER_TO_HOST_2D source address boundary. AQ, AR and AS held claims remain
unchanged; AS explicitly proves physical execution and a failed visible image.

## Independent contract

The pinned local Linux 6.6.63 archive's
drivers/gpu/drm/virtio/virtgpu_plane.c:122–130 computes the byte source offset
from x, y and framebuffer pitch before sending the transfer request. In QEMU
9.2.0 hw/display/virtio-gpu.c:430–443, source addressing is offset plus the row
advance; rectangle x/y select the host destination. These independent producer
and consumer implementations agree. Reference URL:
https://raw.githubusercontent.com/qemu/qemu/v9.2.0/hw/display/virtio-gpu.c

## Predictions, not findings

- P1 — Linux-style literal regression. For a 5×4 resource with source words
  A5000000 through A5000013, rectangle (1,1,3,2), offset 24, destination indices
  6,7,8,11,12,13 become A5000006, A5000007, A5000008, A500000B, A500000C,
  A500000D. Every other word remains its prior value. The old implementation
  starts at source byte 48 and therefore either yields wrong words or rejects
  a source range that should be valid. A recorded old-code failure is required.
- P2 — Independent byte-offset / SG attack. For a 4×3 resource, rectangle
  (1,1,2,2), a 27-byte logical source containing 01 through 1B, and source
  offset 3, host indices 5,6,9,10 become 07060504, 0B0A0908, 17161514,
  1B1A1918. Use discontiguous SG entries, a pixel spanning an entry boundary,
  and physical RAM page boundaries. The final source byte is exactly byte 26.
  Destination origin must never be reapplied to this independent source offset.
- P3 — Rejection atomicity. Offset 4 on P2's 27-byte source, u64::MAX,
  u64::MAX-3, a destination rectangle outside the resource, a detached resource,
  or an invalid later backing range return InvalidParameter before any host
  shadow or damage mutation. Offset equal to length with a nonempty rectangle
  rejects. Preserve the existing checked empty-rectangle behavior.
- P4 — Full transfer and repeat behavior. Full-resource offset-zero transfers
  remain byte-identical. The partial transfer changes only destination rectangle
  words; changed-pixel damage covers those destination locations. Repeating an
  identical transfer cannot invent new changed pixels. Guest RAM remains read-only.
- P5 — Real queue boundary. Actual descriptor-backed create/attach/transfer/flush
  commands complete through the production decoder and device service path. Their
  responses and sink pixels satisfy P1/P2; command trace binds requests to returned
  responses. Direct ResourceMap calls alone do not establish this criterion.
- P6 — Sabotage sensitivity. Restoring the old extra-origin arithmetic in an
  isolated copy causes at least one literal regression to fail, with no verifier
  changes to the expected words. The clean candidate passes the same test.
- P7 — Frozen provenance and coverage. Each changed semantic hunk is reached by
  the recorded deterministic device tests or the real browser path; nonsemantic
  hunks receive explicit waivers. A pristine clone builds and runs the defined
  final-head proof with RUSTFLAGS, CARGO_* and RUST_LOG scrubbed. Source hashes,
  build identity and evidence digests agree with the claimed frozen head.
- P8 — Physical trial. The verified AR pair and AQ kernel bytes are restored with
  the newly frozen runtime and no guest observer/profiler. Trusted physical
  keyboard events execute the trial's unique command. An independent raw-wire
  file read returns its exact nonce strictly after Enter and within 120 seconds.
  Startup remains 300 seconds, typing 60 seconds, capture 20 seconds, cleanup
  30 seconds. No widened deadline or alternate pair can substitute.
- P9 — Visible result. The real final screenshot, personally read independently,
  shows the actual typed command and returned terminal prompt at the original
  readable desktop geometry. It is captured within the 20-second post-nonce
  window after a newer presented frame than the post-nonce baseline. A nonce,
  counter increase, changed PNG digest, or stale prompt alone cannot establish
  visible responsiveness. Preserve a negative result and gate Q if it fails.

These predictions are pending until the final worker submission. A possibly
unbound scanout is outside this change and is not assumed to explain any result.
