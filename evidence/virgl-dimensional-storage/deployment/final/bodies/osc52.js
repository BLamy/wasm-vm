// E3-T22a: OSC 52 clipboard-copy handler for the in-page terminal. Pure, dependency-free logic so
// it is node-unit-testable apart from the browser Clipboard API; `createOsc52Handler` adapts it to
// xterm.js's `registerOscHandler(52, …)`.
//
// A guest emits `ESC ] 52 ; <selection> ; <payload> (BEL|ST)`. xterm strips the `ESC]52;` framing and
// hands the callback the DATA string — i.e. `<selection>;<payload>` (e.g. `c;aGk=` or `c;?`). We:
//   - COPY when payload is base64 → decode and write the host clipboard,
//   - QUERY when payload is `?` → answer ONLY when clipboard-read is explicitly enabled (default off:
//     a guest read of the host clipboard is an exfiltration channel),
//   - classify anything malformed/oversize as INVALID and drop it (handled, never a throw/hang).

// Hostile-guest cap on the base64 payload length, enforced BEFORE any decode so a multi-megabyte
// sequence can never force a giant allocation. 100 KB of base64 ≈ 75 KB of clipboard text.
export const DEFAULT_MAX_ENCODED_BYTES = 100 * 1024;

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Classify an OSC 52 data string (everything after `ESC]52;`).
 * Returns one of:
 *   { kind: "copy",  selection, text }   — a valid, in-cap base64 payload, decoded to `text`
 *   { kind: "query", selection }         — the `?` read-request form
 *   { kind: "invalid", reason }          — malformed selection/base64, or over the cap
 * Never throws.
 */
export function parseOsc52(data, { maxEncodedBytes = DEFAULT_MAX_ENCODED_BYTES } = {}) {
  if (typeof data !== "string") return { kind: "invalid", reason: "non-string" };
  // Split into the selection field and the payload (the payload itself may be empty = clear).
  const semi = data.indexOf(";");
  if (semi < 0) return { kind: "invalid", reason: "no-selection-separator" };
  const selection = data.slice(0, semi);
  const payload = data.slice(semi + 1);
  // Selection is a set of clipboard names (c, p, s, 0-7, q, …). An empty field means the default
  // ("c" + "s") per the spec; anything with a separator or control char is malformed.
  if (/[;\s]/.test(selection)) return { kind: "invalid", reason: "bad-selection" };

  if (payload === "?") return { kind: "query", selection };

  // Enforce the cap on the ENCODED length first — before validating or decoding.
  if (payload.length > maxEncodedBytes) return { kind: "invalid", reason: "too-large" };
  if (!BASE64_RE.test(payload)) return { kind: "invalid", reason: "bad-base64" };
  const text = decodeBase64Utf8(payload);
  if (text === null) return { kind: "invalid", reason: "undecodable" };
  return { kind: "copy", selection, text };
}

/**
 * Build the `registerOscHandler(52, …)` callback. `writeClipboard(text) -> Promise` performs the host
 * write (e.g. `navigator.clipboard.writeText`); on rejection `onCopyBlocked(text)` surfaces the
 * "copied — click to confirm" affordance so a permission failure NEVER drops silently. The read-query
 * form is answered only when `allowRead` is true (default off).
 *
 * The returned handler is synchronous and always returns `true` (the sequence is "handled" — even an
 * invalid payload is consumed rather than echoed as raw bytes); async clipboard work runs in the
 * background so a slow/denied write can never block the terminal's OSC parser.
 *
 * `allowRead` may be a boolean OR a thunk `() => boolean`, evaluated PER INVOCATION so a live toggle
 * is honored (the guest read-query gate must reflect the current setting, not the construction-time one).
 */
export function createOsc52Handler({
  writeClipboard,
  readClipboard = null,
  allowRead = false,
  maxEncodedBytes = DEFAULT_MAX_ENCODED_BYTES,
  onCopyBlocked = null,
  onCopied = null,
  respond = null, // (payloadString) => void — how a query answer is written back to the guest
} = {}) {
  if (typeof writeClipboard !== "function") {
    throw new TypeError("createOsc52Handler requires writeClipboard(text) -> Promise");
  }
  const readAllowed = () => (typeof allowRead === "function" ? !!allowRead() : !!allowRead);
  return function handleOsc52(data) {
    const parsed = parseOsc52(data, { maxEncodedBytes });
    switch (parsed.kind) {
      case "copy": {
        Promise.resolve()
          .then(() => writeClipboard(parsed.text))
          .then(
            () => {
              if (onCopied) onCopied(parsed.text);
            },
            () => {
              // Denied / no transient activation / insecure context → hand off to the affordance.
              if (onCopyBlocked) onCopyBlocked(parsed.text);
            },
          );
        return true;
      }
      case "query": {
        // Default-off: a guest read of the host clipboard is refused silently (no answer written).
        if (!readAllowed() || typeof readClipboard !== "function" || typeof respond !== "function") {
          return true;
        }
        Promise.resolve()
          .then(() => readClipboard())
          .then(
            (text) => respond(`${parsed.selection};${encodeBase64Utf8(String(text ?? ""))}`),
            () => {
              /* read denied → answer nothing */
            },
          );
        return true;
      }
      default:
        // Invalid: consume the sequence (return true) so a hostile payload isn't re-emitted as text.
        return true;
    }
  };
}

// --- base64 <-> UTF-8, environment-agnostic (browser atob/btoa or Node Buffer) ---

function decodeBase64Utf8(b64) {
  try {
    if (typeof atob === "function") {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    }
    // Node fallback (unit tests).
    return globalThis.Buffer.from(b64, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

function encodeBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  if (typeof btoa === "function") {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  return globalThis.Buffer.from(bytes).toString("base64");
}
