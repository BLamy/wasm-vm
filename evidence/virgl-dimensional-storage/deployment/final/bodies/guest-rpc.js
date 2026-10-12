// E3.5-T05e: the fenced request/response protocol over the single ttyS0 console, extracted as a pure,
// node-testable module. The browser Docker tab drives `wvrun ps/logs/run/exec` over ONE serial console
// and must parse STRUCTURED results, not scrape free-form text — so each RPC is fenced with a unique
// request id and an END marker that embeds the guest-computed exit code. This file is the parser +
// command formatter that logic; `web/main.js`'s `guestExec` consumes this module for the live bridge.
// Keeping it pure lets the adversarial cases — marker-spoof, stream-split, echo-strip — be proven
// deterministically without a browser boot.
//
// Protocol: to run `<cmd>` under request id `<rid>`, send
//   printf '\n__WVBEGIN_<rid>\n'; <cmd>; printf '\n__WVEND_<rid>_%s\n' "$?"\r
// The guest echoes the command line, then emits a full-line BEGIN, the command's stdout, and a
// full-line END containing the guest-computed exit code. The parser ignores everything before BEGIN
// (including the shell prompt and echoed command) and returns only the bytes between the two nonce
// lines. It never heuristically strips a prompt or output line.

// Strip xterm/ANSI control sequences and carriage returns, matching what main.js does before parsing.
export function stripConsole(text) {
  return text
    // systemd/Bash OSC 3008 metadata and terminal DCS replies are not command stdout. Hide a
    // partial control through the current end; the RPC retains raw bytes for the next feed.
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\|$)/g, "")
    .replace(/\x1bP[\s\S]*?(?:\x1b\\|$)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*$/g, "")
    .replace(/\r/g, "");
}

// The END-marker matcher for a given request id. Both line boundaries are load-bearing: the command's
// own echoed `printf '…__WVEND_<rid>_%s\n'` ends in `%s`, NOT a digit, and a marker-looking substring
// inside ordinary output cannot satisfy this fence.
export function endMarkerRegex(rid) {
  return new RegExp(`(?:^|\\n)__WVEND_${escapeRegExp(rid)}_(\\d+)\\n`);
}

// The exact bytes to send for one fenced RPC. `\r` (CR) is the Enter the tty maps to NL; the leading
// newline in the END printf makes its marker a complete line even when command output lacks a newline.
export function formatRpcCommand(cmd, rid) {
  return `printf '\\n__WVBEGIN_${rid}\\n'; ${cmd}; printf '\\n__WVEND_${rid}_%s\\n' "$?"\r`;
}

// A stateful parser for ONE in-flight RPC. `feed(chunk)` accepts a string (already UTF-8 decoded) OR a
// Uint8Array; it accumulates, and returns { stdout, exit } once both nonce fences for `rid` arrive, or
// null while still waiting. Byte-stream robust: markers and OSC metadata may split across feeds.
export function createFencedRpc(rid, { decoder } = {}) {
  const re = endMarkerRegex(rid);
  const beginRe = new RegExp(`(?:^|\\n)__WVBEGIN_${escapeRegExp(rid)}\\n`);
  const dec = decoder || (typeof TextDecoder !== "undefined" ? new TextDecoder() : null);
  let buf = "";
  let done = false;
  return {
    feed(chunk) {
      if (done) return null;
      const text = typeof chunk === "string" ? chunk : dec.decode(chunk, { stream: true });
      buf += text;
      const plain = stripConsole(buf);
      const begin = plain.match(beginRe);
      if (!begin) return null;
      const bodyStart = begin.index + begin[0].length;
      const m = plain.slice(bodyStart).match(re);
      if (!m) return null;
      done = true;
      const exit = parseInt(m[1], 10);
      // The END regex includes its line-start newline when it is not at body start. Keep the
      // complete payload between marker lines, including any command-output newline before END.
      const endStart = bodyStart + m.index + (m[0].startsWith("\n") ? 1 : 0);
      return { stdout: plain.slice(bodyStart, endStart), exit };
    },
    get settled() {
      return done;
    },
  };
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
