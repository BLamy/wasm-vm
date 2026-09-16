VERDICT: refuted

This refutes the positive **visible desktop response** claim. The submitted
negative measurement can be verified separately under AS's explicit failure
branch; it must not release Q or be described as solved responsiveness.

- **P1/P2/P3/P4/P6 — HELD.** Corrected frozen source
  `ab7bc0bce9783e551c004faef4377dc3d5e040ed`; report SHA256
  `97252137eed0cc5a4eae2e477e733a5d3f42dd0ad3e911358d8afd6b51afb174`.
  Independently checked all43 recorded helper digests against that commit,
  all96 served rows,67 distinct git-backed resources, exact AQ/AR/AO artifacts,
  read-only allowed serial commands,128 trusted keys and256 successful ordered
  key/sync acknowledgments. Actual notes identify AQ before the AR Foot property
  read. The independent27th read returns `3fb3e7477b1c8d55`, exit0, with no pending
  read. Raw wire completion is Enter+89.103s; recorder acknowledgment89.104s,
  both inside120s. Raw nonce: report.json:25936; physical receipt:27634 onward.
  Zero unexpected errors; normal owned exit, no watchdog; cleanup0.159s.
  Repeatable checks and exact read fences are in `r2-recording.json`.
- **R2 capture freshness — HELD, but not sufficient for visible response.**
  Capture starts at22:28:17.245Z after nonce confirmation. The baseline is
  sampled at22:28:17.246Z, frame4; frame5 is presented and the real screenshot
  finishes at22:28:32.916Z,15.671s into the original20s budget. Report.json:27011
  onward records these times and frame states. The new rectangle is
  `{x:10,y:36,width:1260,height:754}` within the1280x832 resource, covering Foot.
- **P5 actual visible response — FAILED again.** Personally viewed
  `../input-kernel-response-r2/desktop/desktop-keyboard.png`. It contains only
  the old empty prompt and no command or new returned prompt. Its10908 bytes
  have SHA256`431be977157bf77dcd21ca8bf3b640bce9e02dc8c54f09a30d58af78a8195b24`,
  exactly the same as the failed r1 image. A later terminal-region frame thus
  still carries no visible command response. Do not describe this as missing
  new frames; they arrived, but the application content did not change.
- **Bounded guard attack — HELD.** `capture-attacks-r2.json` rejects the original
  r1 proof, unchanged post-nonce frame, received-but-unpresented frame, early
  baseline and image1ms past capture deadline. The valid synthetic control
  continues to require manual image inspection. These are harness checks only.

## Measured next action

Record a bounded set of actual Worker `display` messages plus the real canvas
pixels in the same physical run. Copy the transferred ArrayBuffer synchronously,
retain sequence, scanout, format, resource dimensions, damage rectangle, timestamps
and full-buffer hashes; render the raw frame with its real pixel format for
personal inspection. Include before-input, post-nonce baseline and the later
Foot-region frame. Compare them with `__presentation.readPixels()` and PNG.
This separates stale incoming framebuffer content from browser presentation loss
without changing AO WASM or claiming another responsiveness success.

`web/linux-worker-protocol.js:728` already copies the full real resource at the
WASM→Worker boundary; messages have type`display`. Record `scanout` explicitly:
the core supplies null for an unbound resource yet still calls the sink at
`crates/core/src/dev/virtio/gpu/mod.rs:1260`, while current presentation snapshots
omit that field. This is an untested routing hypothesis, not an established bug.
If incoming pixels are already stale, further guest/compositor/GPU localization
is needed; damage rectangles alone cannot identify which stage is responsible.
