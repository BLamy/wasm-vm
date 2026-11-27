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
// 3. /token is rate-limited per client IP (20 a minute).
const statuses = [];
for (let i = 0; i < 26; i++) statuses.push((await fetch(`${opt.base}/token`, { headers: { Origin: opt.origin } })).status);
results.tokenRate = { statuses, ok: statuses.filter((s) => s === 200).length, limited: statuses.filter((s) => s === 429).length };
console.log(JSON.stringify(results, null, 2));
if (opt.out) (await import("node:fs")).writeFileSync(opt.out, JSON.stringify(results, null, 2) + "\n");
