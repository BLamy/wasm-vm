// E2-T22: xterm.js ↔ 16550 UART bridge. Makes the in-page terminal byte-for-byte equivalent
// to the native CLI's pty: guest output written verbatim (xterm renders VT100/xterm sequences
// natively — we never filter or translate), keystrokes/paste encoded to UTF-8 and delivered to
// the guest's ttyS0 RX with backpressure, and an explicit resize story (fit addon + `stty` hint).
//
// UMD globals loaded via <script> in index.html (no bundler): `Terminal` (@xterm/xterm) and
// `FitAddon` (@xterm/addon-fit).

import { createOsc52Handler } from "./osc52.js";
import { BRACKET_END, BRACKET_START, framePaste } from "./paste.js";

// Bytes handed to the guest per drain tick. Bounds a single JS→wasm copy so a huge paste never
// becomes one giant allocation; the guest's RX FIFO paces the actual consumption underneath.
const INPUT_CHUNK = 4096;

/**
 * Build the terminal and its input bridge over an existing container element.
 * Returns a controller:
 *   term            the xterm.js Terminal (existing ELF-console code keeps using this)
 *   write(u8)       write guest output bytes to the screen
 *   attachSink(fn)  route keyboard/paste bytes to `fn(Uint8Array)` (e.g. linuxCtl.sendInput);
 *                   immediately drains anything typed before the guest existed
 *   detachSink()    stop routing (guest gone) — typed bytes queue until the next attach
 *   fitNow()        re-fit the rendered grid to the container; returns {cols, rows}
 *   sttyHint()      the `stty rows R cols C` line matching the current fit
 *   highWater()     max bytes ever queued in JS awaiting the guest (backpressure metric)
 *   typeBytes(u8)   inject raw bytes as if typed (used by tests)
 */
export function createLinuxTerminal(containerEl) {
  const term = new Terminal({
    convertEol: true, // bare \n from earlycon → column 0; the guest's onlcr \r\n passes through unchanged
    cursorBlink: true,
    scrollback: 5000,
    fontFamily: "ui-monospace, monospace",
    fontSize: 13,
    theme: { background: "#0b0e14", foreground: "#cdd6f4" },
    // E3-T22b: we OWN paste framing (framePaste: newline normalization + bracketed wrap + embedded
    // end-marker neutralization). Tell xterm not to also add 200~/201~, so paste is never double-framed
    // and the paste-injection defense is ours, not the library's.
    ignoreBracketedPasteMode: true,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(containerEl);
  try { fit.fit(); } catch { /* container not laid out yet — caller can fitNow() later */ }

  // Key policy: a BARE Ctrl+C must always reach the guest as ^C (SIGINT) — that reliability is
  // the whole point of a real console — so copy is bound to Ctrl+Shift+C (Cmd+C on mac), and
  // paste to Ctrl+Shift+V / Cmd+V. Those combos return false (browser handles them; xterm's DOM
  // paste path still re-emits pasted text through onData). Everything else goes to the guest.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true;
    if (e.metaKey && (e.key === "c" || e.key === "v")) return false; // mac copy/paste
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "C" || e.key === "V")) return false;
    return true;
  });

  // Input backpressure queue. The authoritative no-drop guarantee lives in the Rust pending→RX
  // path (it respects rx_free and never drops on a full FIFO — only genuine overrun sets OE).
  // This JS queue bounds per-call copy size for big pastes and exposes a high-water metric.
  const queue = []; // Uint8Array chunks, FIFO
  let pendingBracketedPaste = null; // Uint8Array chunks held until an explicit Enter or Ctrl-C
  let queued = 0;
  let highWater = 0;
  let draining = false;
  let sink = null;
  const enc = new TextEncoder();

  function pump() {
    if (!sink || queued === 0) { draining = false; return; }
    draining = true;
    const want = Math.min(INPUT_CHUNK, queued);
    const chunk = new Uint8Array(want);
    let off = 0;
    while (off < want && queue.length) {
      const head = queue[0];
      const take = Math.min(head.length, want - off);
      chunk.set(head.subarray(0, take), off);
      off += take;
      if (take === head.length) queue.shift();
      else queue[0] = head.subarray(take);
    }
    queued -= off;
    sink(chunk);
    if (queued > 0) setTimeout(pump, 0);
    else draining = false;
  }

  function feed(bytes) {
    if (bytes.length === 0) return;
    queue.push(bytes);
    queued += bytes.length;
    if (queued > highWater) highWater = queued;
    if (!draining) pump();
  }

  // Busybox ash (the fast guest used by the demo) does not consume DECSET-2004 markers itself. Hold a
  // bracketed paste in the host until the user supplies a terminating Enter, then release the sanitized
  // body as one ordered input sequence. Ctrl-C cancels the held paste. Guests with a bracket-aware line
  // editor get the same user-visible guarantee; the host hold is a compatibility fallback, not a second
  // framing layer. Ordinary typed bytes while a paste is held are buffered in order and released with it.
  function typeBytes(bytes) {
    if (!pendingBracketedPaste) {
      feed(bytes);
      return;
    }
    let boundary = -1;
    for (let index = 0; index < bytes.length; index += 1) {
      if (bytes[index] === 0x03 || bytes[index] === 0x0a || bytes[index] === 0x0d) {
        boundary = index;
        break;
      }
    }
    if (boundary < 0) {
      if (bytes.length > 0) pendingBracketedPaste.push(bytes.slice());
      return;
    }
    if (boundary > 0) pendingBracketedPaste.push(bytes.slice(0, boundary));
    const control = bytes[boundary];
    if (control === 0x03) {
      pendingBracketedPaste = null;
      feed(bytes.subarray(boundary));
      return;
    }
    const held = pendingBracketedPaste;
    pendingBracketedPaste = null;
    for (const chunk of held) feed(chunk);
    feed(bytes.subarray(boundary));
  }

  term.onData((str) => typeBytes(enc.encode(str)));

  // E3-T22a: OSC 52 clipboard copy. A guest `ESC]52;c;<base64>` sets the host clipboard; a rejected
  // write (denied permission / no transient activation / insecure context) surfaces a non-destructive
  // affordance instead of dropping silently. The clipboard-READ query (`52;c;?`) stays OFF by default
  // (a guest read of the host clipboard is an exfiltration channel); `setClipboardRead(true)` opts in.
  let allowClipboardRead = false;
  let onCopyBlocked = null; // set by the host UI to show a "copied — click to confirm" affordance
  let onCopied = null; // set by the host UI to show a "copied!" confirmation on a successful write
  const oscHandler = createOsc52Handler({
    writeClipboard: (text) =>
      navigator.clipboard?.writeText
        ? navigator.clipboard.writeText(text)
        : Promise.reject(new Error("clipboard unavailable")),
    readClipboard: () => navigator.clipboard.readText(),
    allowRead: () => allowClipboardRead, // thunk — the live toggle is honored per-invocation
    onCopied: (text) => { if (onCopied) onCopied(text); },
    onCopyBlocked: (text) => { if (onCopyBlocked) onCopyBlocked(text); },
    respond: (payload) => feed(enc.encode(`\x1b]52;${payload}\x07`)),
  });
  // xterm strips the `ESC]52;` framing and passes the handler the data string. In xterm.js 5.x the
  // parser owns this API (`term.parser.registerOscHandler`); retain the terminal-level fallback for
  // older builds. A silent no-op here would turn every guest OSC 52 copy into an unobservable drop.
  try {
    if (term.parser && typeof term.parser.registerOscHandler === "function") {
      term.parser.registerOscHandler(52, oscHandler);
    } else if (typeof term.registerOscHandler === "function") {
      term.registerOscHandler(52, oscHandler);
    }
  } catch { /* xterm without OSC hooks — deterministic handler tests still cover the pure path */ }

  // E3-T22b: frame + inject a paste. `bracketed` is snapshotted from the guest's live DECSET-2004
  // state ONCE per paste (no torn half-bracket if the guest toggles mid-paste). Unbracketed input feeds
  // the same backpressure queue immediately; bracketed input holds the sanitized body until Enter.
  function pasteText(text) {
    const bracketed = !!(term.modes && term.modes.bracketedPasteMode);
    const value = String(text ?? "");
    if (!bracketed) {
      feed(enc.encode(framePaste(value, { bracketed: false })));
      return;
    }
    const framed = framePaste(value, { bracketed: true });
    // Keep framePaste's newline normalization and end-marker neutralization, but remove the wrapper:
    // the host hold supplies the no-early-execute boundary for ash, which does not parse the markers.
    const body = enc.encode(framed.slice(BRACKET_START.length, -BRACKET_END.length));
    if (pendingBracketedPaste) pendingBracketedPaste.push(body);
    else pendingBracketedPaste = [body];
  }
  // Own the paste at the DOM level (capture phase → before xterm's textarea handler), so our framing
  // is the only framing and the injection defense is enforced. `ignoreBracketedPasteMode` above keeps
  // xterm from re-wrapping if this ever doesn't fire (degraded but never double-framed).
  try {
    containerEl.addEventListener(
      "paste",
      (e) => {
        const text = (e.clipboardData && e.clipboardData.getData("text")) || "";
        e.preventDefault();
        e.stopImmediatePropagation();
        pasteText(text);
      },
      true,
    );
  } catch { /* no DOM (unit env) — pasteText() is still callable directly */ }

  return {
    term,
    fit,
    write: (u8) => term.write(u8),
    attachSink(fn) { sink = fn; if (queued && !draining) pump(); },
    detachSink() { sink = null; },
    fitNow() { try { fit.fit(); } catch { /* ignore */ } return { cols: term.cols, rows: term.rows }; },
    sttyHint() { return `stty rows ${term.rows} cols ${term.cols}`; },
    highWater: () => highWater,
    typeBytes,
    // xterm only captures keystrokes while its hidden textarea is focused. Nothing focuses
    // it implicitly, so manual typing silently goes nowhere until this is called (after boot
    // and whenever the Terminal tab is (re)shown from a display:none panel).
    focus() { try { term.focus(); } catch { /* ignore */ } },
    // E3-T22a: opt in to answering guest clipboard-READ queries (`OSC 52 ; c ; ?`). Default off —
    // a guest reading the host clipboard is an exfiltration channel, so this must be explicit.
    setClipboardRead(enabled) { allowClipboardRead = !!enabled; },
    clipboardReadEnabled: () => allowClipboardRead,
    // E3-T22a: register a callback shown when a clipboard WRITE is blocked (denied permission / no
    // transient activation / insecure context) — the "copied — click to confirm" affordance. The
    // payload is preserved so the click can complete the write; nothing is ever dropped silently.
    onClipboardCopyBlocked(fn) { onCopyBlocked = fn; },
    // E3-T22a: register a callback fired when a clipboard WRITE succeeds (the "copied!" confirmation),
    // carrying the decoded text. Symmetric with onClipboardCopyBlocked.
    onClipboardCopied(fn) { onCopied = fn; },
    // E3-T22b: frame + inject pasted text (newline-normalized, bracketed per the guest's live mode
    // 2004, embedded end-markers neutralized). Used by the DOM paste interceptor and by E2E tests.
    pasteText,
    bracketedPasteEnabled: () => !!(term.modes && term.modes.bracketedPasteMode),
  };
}
