# Clipboard policy

The clipboard bridge is a text-only, bounded capability of the guest agent channel. It is
available only after `CAP_CLIPBOARD` is negotiated. The bridge carries UTF-8 bytes and accepts at
most 256 KiB per `CLIP_SET` value. A 257 KiB value, malformed UTF-8, or an unpaired UTF-16
surrogate is rejected locally and never reaches the guest, Wayland helper, or browser clipboard.

## Direction and privacy rules

- Guest → host writes use the browser's `navigator.clipboard.writeText` capability through the
  host service. The service does not poll the asynchronous read API.
- Host → guest reads happen only from a focused surface's capture-phase `paste` event and only
  inspect `clipboardData.getData("text/plain")` after focus has been proven. An unfocused surface
  does not read clipboard data and does not consume the paste event.
- The host frame is sent before the optional key-ready callback runs. This ordering prevents the
  first paste from becoming a stale key event.
- A denied guest → host write retains one newest bounded value. It changes the visible status to
  blocked/staged and retries only after a pointer or keyboard gesture. There is no background
  retry loop and no unbounded queue.
- The service keeps at most two short-lived byte-checked echo records. A matching host-originated
  frame is suppressed once, only in the same channel generation and within the echo window. Hashes
  are only an index; a byte comparison prevents hash collisions from suppressing real content.

## Permission matrix

| Environment | Guest → host | Host → guest | Operational policy |
| --- | --- | --- | --- |
| Chromium on the served demo | `clipboard-write` permission or a permitted user gesture | `paste` event on the focused guest surface | The automated proof grants the Chromium clipboard permissions and still verifies focus, ordering, bounds, and zero console errors. |
| Chromium with write permission denied | First write is staged and reported as blocked | Paste still sends only from a focused surface | A pointer/keyboard gesture retries the retained value once; failure remains visible. |
| Firefox | Use the focused paste event for host → guest; browser permission prompts may vary by profile | Guest → host may require the browser's explicit user gesture/prompt | The Chromium proof is the deterministic gate. Firefox is a manual follow-up check because permission-prompt behavior is profile-dependent. |
| WebKit/Safari or an embedded web view | Treat clipboard permission and event behavior as host-specific | Do not assume Chromium permission semantics | Not part of the current acceptance gate; verify manually when that target is supported. |

The proof uses the local Chromium permission context, not a system clipboard daemon or a second
machine. It records the browser version, exact git head, source/dist hashes, and every assertion in
`evidence/e5-t24d/`.

## Text and line endings

Clipboard values are `text/plain` only. UTF-8 bytes are preserved, including CRLF (`\r\n`), and
the exact 3-byte and exact-256-KiB boundaries are covered by the proof. Binary data is not a
clipboard type; malformed UTF-8 is rejected rather than repaired or silently replaced.

## Manual Firefox check

Serve the current `web/` directory over localhost, open the guest surface in Firefox, focus it,
and paste a short text, a CRLF sample, and a value near 256 KiB. Confirm that a denied write shows
the blocked status and succeeds after a user gesture. Then repeat with the surface unfocused and
confirm that the page's paste handler does not inspect the event's text. Record the Firefox
version/profile permission outcome separately; it must not be treated as Chromium evidence.
