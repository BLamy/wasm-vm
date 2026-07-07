// E2-T22: xterm.js ↔ 16550 UART bridge. Makes the in-page terminal byte-for-byte equivalent
// to the native CLI's pty: guest output written verbatim (xterm renders VT100/xterm sequences
// natively — we never filter or translate), keystrokes/paste encoded to UTF-8 and delivered to
// the guest's ttyS0 RX with backpressure, and an explicit resize story (fit addon + `stty` hint).
//
// UMD globals loaded via <script> in index.html (no bundler): `Terminal` (@xterm/xterm) and
// `FitAddon` (@xterm/addon-fit).

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

  term.onData((str) => feed(enc.encode(str)));

  return {
    term,
    fit,
    write: (u8) => term.write(u8),
    attachSink(fn) { sink = fn; if (queued && !draining) pump(); },
    detachSink() { sink = null; },
    fitNow() { try { fit.fit(); } catch { /* ignore */ } return { cols: term.cols, rows: term.rows }; },
    sttyHint() { return `stty rows ${term.rows} cols ${term.cols}`; },
    highWater: () => highWater,
    typeBytes: (u8) => feed(u8),
  };
}
