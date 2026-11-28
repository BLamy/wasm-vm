#!/usr/bin/env node
// E5-T43a round 2: the abuse bounds the first verifier found missing, against a deployed relay.
//   node hardening.mjs --base https://wasm-vm-relay.<account>.workers.dev [--out file]
import { parseArgs } from "node:util";
import WebSocket from "ws";
const { values: opt } = parseArgs({ options: { base: { type: "string" }, origin: { type: "string", default: "https://wasm-vm.pages.dev" }, out: { type: "string" } } });
const OP = { HELLO: 0, OPEN: 1, OPEN_OK: 2, OPEN_FAIL: 3 };
const frame = (id, op, payload = new Uint8Array()) => { const b = new Uint8Array(5 + payload.length); new DataView(b.buffer).setUint32(0, id); b[4] = op; b.set(payload, 5); return b; };
const openPayload = (host, port) => { const h = new TextEncoder().encode(host); const p = new Uint8Array(1 + h.length + 2); p[0] = h.length; p.set(h, 1); new DataView(p.buffer).setUint16(1 + h.length, port); return p; };
const token = async () => (await (await fetch(`${opt.base}/token`, { headers: { Origin: opt.origin } })).json());
const results = {};
// 1. OPENs that must fail fast (not hang): port 25, IPv4-compatible and NAT64 loopback.
{
  const t = await token();
  const targets = [["aspmx.l.google.com", 25], ["::127.0.0.1", 80], ["64:ff9b::7f00:1", 80], ["2002:7f00:1::1", 80], ["example.com", 80]];
  results.opens = await new Promise((resolve) => {
    const ws = new WebSocket(t.ws, { headers: { Origin: opt.origin } }); ws.binaryType = "arraybuffer";
    const out = {}; const t0 = Date.now();
    const timer = setTimeout(() => { ws.terminate(); resolve(out); }, 20000);
    ws.on("open", () => { ws.send(frame(0, OP.HELLO, new Uint8Array([1, ...new TextEncoder().encode(t.token)]))); targets.forEach(([h, p], i) => ws.send(frame(i + 1, OP.OPEN, openPayload(h, p)))); });
    ws.on("message", (d) => { const b = new Uint8Array(d); const id = new DataView(b.buffer, b.byteOffset).getUint32(0); const op = b[4];
      if (id && (op === OP.OPEN_OK || op === OP.OPEN_FAIL)) { out[`${targets[id - 1][0]}:${targets[id - 1][1]}`] = { result: op === OP.OPEN_OK ? "open" : `fail ${b[5]}`, ms: Date.now() - t0 };
        if (Object.keys(out).length === targets.length) { clearTimeout(timer); ws.close(); resolve(out); } } });
  });
}
// 2. A connection that never sends HELLO is closed (deadline 10 s).
results.noHello = await new Promise((resolve) => {
  (async () => { const t = await token(); const ws = new WebSocket(t.ws, { headers: { Origin: opt.origin } }); const t0 = Date.now();
    const timer = setTimeout(() => { ws.terminate(); resolve({ closed: false, afterMs: Date.now() - t0 }); }, 30000);
    ws.on("close", (code) => { clearTimeout(timer); resolve({ closed: true, code, afterMs: Date.now() - t0 }); }); })();
});
// 2a. A client that never answers Close cannot hold a finished connection: raw TLS clients that
// upgrade and then only read. One never authenticates; one is refused at the session cap (the
// other places held by four authenticated sessions).
import tls from "node:tls";
function rawUntilDropped(wsUrl, helloToken, limitMs) {
  return new Promise((resolve) => {
    const u = new URL(wsUrl);
    const sock = tls.connect({ host: u.hostname, port: 443, servername: u.hostname });
    let head = ""; let upgraded = false; let t0 = 0;
    const timer = setTimeout(() => { sock.destroy(); resolve({ dropped: false, afterMs: Date.now() - t0 }); }, limitMs);
    sock.on("secureConnect", () => sock.write(`GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nOrigin: ${opt.origin}\r\n\r\n`));
    sock.on("data", (d) => {
      if (upgraded) return;
      head += d.toString("latin1");
      if (!head.includes("\r\n\r\n")) return;
      upgraded = true; t0 = Date.now();
      if (!head.startsWith("HTTP/1.1 101")) { clearTimeout(timer); sock.destroy(); resolve({ status: head.split("\r\n")[0] }); return; }
      if (helloToken) {
        const p = frame(0, OP.HELLO, new Uint8Array([1, ...new TextEncoder().encode(helloToken)]));
        const hdr = p.length < 126 ? [0x82, 0x80 | p.length] : [0x82, 0x80 | 126, p.length >> 8, p.length & 255];
        sock.write(Buffer.from([...hdr, 0, 0, 0, 0, ...p]));
      }
    });
    sock.on("close", () => { clearTimeout(timer); resolve({ dropped: true, afterMs: Date.now() - t0 }); });
    sock.on("error", () => {});
  });
}
{
  const t = await token();
  results.rawNoHello = await rawUntilDropped(t.ws, null, 30000);
  const holders = [];
  for (let i = 0; i < 4; i++) {
    const h = await token();
    holders.push(await new Promise((resolve) => { const ws = new WebSocket(h.ws, { headers: { Origin: opt.origin } }); ws.on("open", () => { ws.send(frame(0, OP.HELLO, new Uint8Array([1, ...new TextEncoder().encode(h.token)]))); setTimeout(() => resolve(ws), 800); }); }));
  }
  const extra = await token();
  results.rawRefusedAtCap = await rawUntilDropped(extra.ws, extra.token, 20000);
  for (const ws of holders) ws.terminate();
  await new Promise((r) => setTimeout(r, 2000));
}
// 2b. One client holds at most 4 authenticated sessions at once: open six, each served or not.
{
  const sockets = [];
  const served = [];
  for (let i = 0; i < 6; i++) {
    const t = await token();
    const r = await new Promise((resolve) => {
      const ws = new WebSocket(t.ws, { headers: { Origin: opt.origin } }); ws.binaryType = "arraybuffer";
      const timer = setTimeout(() => resolve("no answer"), 15000);
      ws.on("open", () => { ws.send(frame(0, OP.HELLO, new Uint8Array([1, ...new TextEncoder().encode(t.token)]))); ws.send(frame(1, OP.OPEN, openPayload("example.com", 80))); });
      ws.on("message", (d) => { const b = new Uint8Array(d); if (new DataView(b.buffer, b.byteOffset).getUint32(0) === 1) { clearTimeout(timer); resolve(b[4] === OP.OPEN_OK ? "served" : `fail ${b[5]}`); } });
      ws.on("close", () => { clearTimeout(timer); resolve("closed"); });
      sockets.push(ws);
    });
    served.push(r);
  }
  results.sessionsPerClient = { served, count: served.filter((x) => x === "served").length };
  for (const ws of sockets) ws.terminate();
  await new Promise((r) => setTimeout(r, 2000));
  // With those gone, a new session is served again.
  const t = await token();
  results.sessionsPerClient.afterClose = await new Promise((resolve) => {
    const ws = new WebSocket(t.ws, { headers: { Origin: opt.origin } }); ws.binaryType = "arraybuffer";
    const timer = setTimeout(() => resolve("no answer"), 15000);
    ws.on("open", () => { ws.send(frame(0, OP.HELLO, new Uint8Array([1, ...new TextEncoder().encode(t.token)]))); ws.send(frame(1, OP.OPEN, openPayload("example.com", 80))); });
    ws.on("message", (d) => { const b = new Uint8Array(d); if (new DataView(b.buffer, b.byteOffset).getUint32(0) === 1) { clearTimeout(timer); ws.close(); resolve(b[4] === OP.OPEN_OK ? "served" : `fail ${b[5]}`); } });
    ws.on("close", () => { clearTimeout(timer); resolve("closed"); });
  });
}
// 3. /token is rate-limited per client IP (20 a minute).
const statuses = [];
for (let i = 0; i < 26; i++) statuses.push((await fetch(`${opt.base}/token`, { headers: { Origin: opt.origin } })).status);
results.tokenRate = { statuses, ok: statuses.filter((s) => s === 200).length, limited: statuses.filter((s) => s === 429).length };
console.log(JSON.stringify(results, null, 2));
if (opt.out) (await import("node:fs")).writeFileSync(opt.out, JSON.stringify(results, null, 2) + "\n");
