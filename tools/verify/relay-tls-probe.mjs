// relay-tls-probe — isolate the wvrelay data path from the browser guest stack.
//
// Drives a REAL TLS 1.3 handshake to a public host THROUGH a running wvrelay, using a
// hand-built WS client that speaks the ws_proxy wire protocol (HELLO v1 / OPEN / WINDOW /
// DATA) — no browser, no VM, seconds not minutes. If this completes the handshake, the
// relay's bidirectional data path is proven good and any guest-HTTPS failure is upstream
// of the relay (the slirp TCP stack / WsConnector / browser transport), NOT the relay.
//
//   ./target/debug/wvrelay 127.0.0.1:18099        # dev mode (loopback = auth disabled)
//   node tools/verify/relay-tls-probe.mjs          # RELAY_URL/TARGET_HOST/TARGET_PORT env-overridable
//
// Proven 2026-08-04: full TLS1.3 + HTTP response to 1.1.1.1:443 through the relay (cert
// cloudflare-dns.com, IP SAN 1.1.1.1). Relay exonerated for E3-T19 guest-HTTPS.
import tls from "node:tls";
import { Duplex } from "node:stream";

const RELAY = process.env.RELAY_URL ?? "ws://127.0.0.1:18099";
const HOST = process.env.TARGET_HOST ?? "1.1.1.1";
const PORT = Number(process.env.TARGET_PORT ?? 443);
const STREAM = 1;

const be32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; };
const frame = (stream, opcode, payload = Buffer.alloc(0)) =>
  Buffer.concat([be32(stream), Buffer.from([opcode]), Buffer.from(payload)]);
const openPayload = (host, port) => {
  const h = Buffer.from(host);
  return Buffer.concat([Buffer.from([h.length]), h, (() => { const b = Buffer.alloc(2); b.writeUInt16BE(port, 0); return b; })()]);
};

const log = (...a) => console.log(`[probe ${Date.now() % 100000}]`, ...a);
const ws = new WebSocket(RELAY);
ws.binaryType = "arraybuffer";

let dataBytesFromBackend = 0;
let sawOpenOk = false, sawWindow = false;
const CREDIT = 256 * 1024;

// A Duplex that carries the TLS stream over relay frames on STREAM.
const chan = new Duplex({
  write(chunk, _enc, cb) { ws.send(frame(STREAM, 4, chunk)); cb(); },   // DATA out
  read() {},
});

ws.addEventListener("open", () => log("ws open"));
ws.addEventListener("error", (e) => { log("ws error", e.message ?? e); process.exit(3); });
ws.addEventListener("message", (ev) => {
  const b = Buffer.from(ev.data);
  log("RX frame len=", b.length, "hex=", b.subarray(0, 12).toString("hex"));
  if (b.length < 5) return;
  const stream = b.readUInt32BE(0), op = b[4], payload = b.subarray(5);
  if (op === 0) { // server HELLO -> reply [version=1][token]; dev mode: empty token ok
    ws.send(frame(0, 0, Buffer.from([1])));              // HELLO version=1, no token
    ws.send(frame(STREAM, 1, openPayload(HOST, PORT)));  // OPEN (opcode 1)
    return;
  }
  if (stream !== STREAM) return;
  if (op === 2) { sawOpenOk = true; log("OPEN_OK"); ws.send(frame(STREAM, 8, be32(CREDIT))); return; } // grant window
  if (op === 8) { sawWindow = true; log("WINDOW (relay->us send credit)=", payload.length ? payload.readUInt32BE(0) : "?"); return; }
  if (op === 4) { // DATA backend->us
    dataBytesFromBackend += payload.length;
    chan.push(payload);
    ws.send(frame(STREAM, 8, be32(payload.length)));  // re-grant consumed credit
    return;
  }
  if (op === 3) { log("OPEN_FAIL code=", payload[0]); chan.push(null); }
  if (op === 5 || op === 6 || op === 7) { log("half-close/close/rst op", op); chan.push(null); }
});

// Once OPEN_OK+WINDOW seen, run a real HTTPS GET over the channel.
const t0 = Date.now();
const iv = setInterval(() => {
  if (sawOpenOk && sawWindow) {
    clearInterval(iv);
    log("starting TLS over relay channel ->", `${HOST}:${PORT}`);
    const tlsSock = tls.connect({ socket: chan, servername: HOST, rejectUnauthorized: false }, () => {
      log("*** TLS HANDSHAKE COMPLETE ***", "authorized=", tlsSock.authorized, "proto=", tlsSock.getProtocol?.());
      const peer = tlsSock.getPeerCertificate?.();
      if (peer) log("peer cert CN/subjectAltName:", peer.subject?.CN, "|", (peer.subjectaltname||"").slice(0,80));
      tlsSock.write(`GET / HTTP/1.1\r\nHost: ${HOST}\r\nConnection: close\r\n\r\n`);
    });
    let httpResp = "";
    tlsSock.on("data", (d) => { httpResp += d.toString("latin1"); });
    tlsSock.on("error", (e) => { log("TLS ERROR:", e.message); finish(); });
    tlsSock.on("close", () => { log("HTTP status line:", httpResp.split("\r\n")[0] || "(none)"); finish(); });
  }
  if (Date.now() - t0 > 12000) { clearInterval(iv); log("TIMEOUT waiting for OPEN_OK/WINDOW", { sawOpenOk, sawWindow }); finish(); }
}, 50);

function finish() {
  log("SUMMARY: backendBytesReturned=", dataBytesFromBackend, "openOk=", sawOpenOk, "window=", sawWindow);
  try { ws.close(); } catch {}
  setTimeout(() => process.exit(0), 200);
}
