// E3.5-T05e: the fenced request/response protocol over the single ttyS0 console, extracted as a pure,
// node-testable module. The browser Docker tab drives `wvrun ps/logs/run/exec` over ONE serial console
// and must parse STRUCTURED results, not scrape free-form text — so each RPC is fenced with a unique
// request id and an END marker that embeds the guest-computed exit code. This file is the parser +
// command formatter that logic; `web/main.js`'s `guestExec` implements the same protocol inline (the
// wiring leaf adopts this module). Keeping it pure lets the adversarial cases — marker-spoof,
// stream-split, echo-strip — be proven deterministically without a browser boot.
//
// Protocol: to run `<cmd>` under request id `<rid>`, send
//   <cmd>; printf '\n__WVEND_<rid>_%s\n' "$?"\r
// The guest echoes the command line, prints the command's stdout, then the printf emits
//   __WVEND_<rid>_<exit>
// The parser accumulates the console byte stream (ANSI escapes + CR stripped), waits for the END
// marker bound to THIS rid followed by a DIGIT run (so the literal `%s` in the echoed printf can never
// false-match), then returns { stdout, exit } with the leading echoed-command line removed.

// Strip xterm/ANSI control sequences and carriage returns, matching what main.js does before parsing.
export function stripConsole(text) {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r/g, "");
}

// The END-marker matcher for a given request id. The trailing `(\d+)` is load-bearing: the command's
// own echoed `printf '…__WVEND_<rid>_%s\n'` ends in `%s`, NOT a digit, so it can never satisfy this.
export function endMarkerRegex(rid) {
  return new RegExp(`__WVEND_${escapeRegExp(rid)}_(\\d+)`);
}

// The exact bytes to send for one fenced RPC (command + fenced END printf + CR). `\r` (CR) is the
// Enter the tty maps to NL.
export function formatRpcCommand(cmd, rid) {
  return `${cmd}; printf '\\n__WVEND_${rid}_%s\\n' "$?"\r`;
}

// A stateful parser for ONE in-flight RPC. `feed(chunk)` accepts a string (already UTF-8 decoded) OR a
// Uint8Array; it accumulates, and returns { stdout, exit } once the fenced END marker for `rid` arrives,
// or null while still waiting. Byte-stream robust: the marker may arrive split across feeds.
export function createFencedRpc(rid, { decoder } = {}) {
  const re = endMarkerRegex(rid);
  const dec = decoder || (typeof TextDecoder !== "undefined" ? new TextDecoder() : null);
  let buf = "";
  let done = false;
  return {
    feed(chunk) {
      if (done) return null;
      const text = typeof chunk === "string" ? chunk : dec.decode(chunk, { stream: true });
      buf += stripConsole(text);
      const m = buf.match(re);
      if (!m) return null;
      done = true;
      const exit = parseInt(m[1], 10);
      let out = buf.slice(0, m.index);
      // Strip the echoed command line (everything up to and including the first newline).
      const nl = out.indexOf("\n");
      if (nl !== -1) out = out.slice(nl + 1);
      return { stdout: out, exit };
    },
    get settled() {
      return done;
    },
  };
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
