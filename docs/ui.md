# Browser host chrome

The focused [`console-capture.html`](../web/console-capture.html) surface keeps the guest's
Canvas2D display and xterm.js serial console alive together. Display and Serial are visibility
tabs, not alternate machine instances: FrameSink callbacks are still presented and serial bytes
are still written while either panel is hidden.

The reserved view switch is `Ctrl+Alt+Backquote`. The keyboard policy handles that chord in the
capture phase, consumes the modifier prefixes, and never forwards the chord to the guest. The
view-toggle lifecycle also releases host-held guest keys before focus moves to the other panel.

Screenshot uses `canvas.toBlob("image/png")` while the guest controller is paused at the current
flush generation. The route decodes the PNG into a temporary canvas and compares every RGBA byte
with the same-generation `getImageData()` readback before offering the download.

Recording uses `canvas.captureStream(30)` and `MediaRecorder` with the first supported WebM type
(VP9, VP8, then generic WebM). A recording is capped at 10 seconds, stops every captured track,
and reports the blob size and a playback decode check. Canvas2D is the production default and its
readback is top-to-bottom. A future WebGL2 surface must keep screenshot comparison against the
composited canvas (not a stale back buffer); raw `readPixels()` data is bottom-to-top and must be
oriented before comparing it with a PNG. The stream itself captures the composited canvas, so a
WebGL implementation must not rely on `preserveDrawingBuffer` for the host recording contract.
