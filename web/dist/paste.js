// E3-T22b: paste framing for the in-page terminal. Pure, dependency-free so it is node-unit-testable
// apart from the browser paste plumbing. Turns raw pasted text into the exact byte stream to inject
// into the guest tty:
//   - newline normalization: CRLF / lone LF / lone CR all become a single CR (`\r`) — what a real
//     terminal delivers for Enter, so multi-line pastes behave like typed input;
//   - bracketed paste (DECSET 2004): when the guest enabled it, wrap in `ESC[200~ … ESC[201~` so the
//     guest shell treats the whole blob as literal data (no line executes until the user hits Enter);
//   - PASTE-INJECTION defense (the classic CVE class): any embedded end-marker `ESC[201~` in hostile
//     pasted content is neutralized, so the remainder can never escape the bracket and execute.

const BRACKET_START = "\x1b[200~";
const BRACKET_END = "\x1b[201~";

/**
 * Frame pasted `text` for injection. `bracketed` is the guest's live DECSET-2004 state (a snapshot —
 * the caller passes ONE consistent value so a mode toggle mid-paste can't produce a torn half-bracket).
 * Returns the string to inject (the caller encodes it to UTF-8 and feeds it through the tty backpressure
 * queue, which does the chunking).
 */
export function framePaste(text, { bracketed = false } = {}) {
  const normalized = normalizeNewlines(String(text));
  if (!bracketed) return normalized; // documented fallback: no markers when mode 2004 is unset
  // Neutralize any embedded end-marker BEFORE wrapping so the paste cannot terminate its own bracket.
  return BRACKET_START + stripEndMarkers(normalized) + BRACKET_END;
}

/** CRLF, lone LF, and lone CR all collapse to a single CR — the byte Enter delivers on a real tty. */
export function normalizeNewlines(text) {
  return text.replace(/\r\n?|\n/g, "\r");
}

/**
 * Remove every `ESC[201~` occurrence from `text`. Only the END marker is dangerous (it closes the
 * bracket early); a stray START marker inside the body is harmless data. Removing (not escaping) the
 * end marker is the conservative choice — the pasted bytes minus the injected control sequence.
 */
export function stripEndMarkers(text) {
  return text.split(BRACKET_END).join("");
}

export { BRACKET_START, BRACKET_END };
