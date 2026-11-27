#!/usr/bin/env node
// E5-T43a: speak the ws-proxy protocol (docs/design/ws-proxy-protocol.md) to a relay and check
// that it fetches a page with a valid token and refuses what it must.
//
//   node smoke.mjs --base https://wasm-vm-relay.<account>.workers.dev [--origin https://wasm-vm.pages.dev]
//   node smoke.mjs --ws ws://127.0.0.1:18080 --secret S --origin https://wasm-vm.pages.dev   (local wvrelay)
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import WebSocket from "ws";
import { issueToken } from "./src/token.js";

const { values: opt } = parseArgs({ options: {
  base: { type: "string" }, ws: { type: "string" }, secret: { type: "string" },
  origin: { type: "string", default: "https://wasm-vm.pages.dev" }, out: { type: "string" },
} });
const OP = { HELLO: 0, OPEN: 1, OPEN_OK: 2, OPEN_FAIL: 3, DATA: 4, SHUTDOWN_WR: 5, CLOSE: 6, RST: 7, WINDOW: 8 };
const frame = (id, op, payload = new Uint8Array()) => {
  const b = new Uint8Array(5 + payload.length); new DataView(b.buffer).setUint32(0, id); b[4] = op; b.set(payload, 5); return b;
};
const openPayload = (host, port) => { const h = new TextEncoder().encode(host); const p = new Uint8Array(1 + h.length + 2); p[0] = h.length; p.set(h, 1); new DataView(p.buffer).setUint16(1 + h.length, port); return p; };
const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };

async function token(origin) {
  if (opt.secret) return { token: (await issueToken(opt.secret, origin, Math.floor(Date.now() / 1000), 600)).token, ws: opt.ws };
  const r = await fetch(`${opt.base}/token`, { headers: { Origin: origin } });
  if (r.status !== 200) return { status: r.status, cors: r.headers.get("access-control-allow-origin") };
  return { ...(await r.json()), status: 200, cors: r.headers.get("access-control-allow-origin") };
}

// One session: HELLO with `tok`, then each OPEN in `opens`; returns what happened.
function session(wsUrl, origin, tok, opens, { request } = {}) {
  return new Promise((resolve) => {
    const out = { opened: false, hello: null, streams: {}, closed: null, error: null };
    const ws = new WebSocket(wsUrl, { headers: { Origin: origin } });
    ws.binaryType = "arraybuffer";
    const timer = setTimeout(() => { ws.terminate(); resolve({ ...out, timeout: true }); }, 20000);
    const done = () => { clearTimeout(timer); try { ws.close(); } catch {} resolve(out); };
    ws.on("unexpected-response", (_req, res) => { out.error = `http ${res.statusCode}`; done(); });
    ws.on("error", (e) => { out.error = String(e.message); done(); });
    ws.on("close", (code) => { out.closed = code; clearTimeout(timer); resolve(out); });
    ws.on("open", () => {
      out.opened = true;
      ws.send(frame(0, OP.HELLO, new Uint8Array([1, ...new TextEncoder().encode(tok)])));
      opens.forEach(([host, port], i) => ws.send(frame(i + 1, OP.OPEN, openPayload(host, port))));
    });
    let pending = opens.length;
    ws.on("message", (data) => {
      const b = new Uint8Array(data); const id = new DataView(b.buffer, b.byteOffset).getUint32(0); const op = b[4]; const p = b.subarray(5);
      if (id === 0) { out.hello = op; return; }
      const s = out.streams[id] ??= { events: [], body: "" };
      s.events.push(op);
      if (op === OP.OPEN_OK) {
        ws.send(frame(id, OP.WINDOW, u32(1 << 20)));
        if (request) ws.send(frame(id, OP.DATA, new TextEncoder().encode(request(opens[id - 1][0]))));
      } else if (op === OP.DATA) s.body += new TextDecoder().decode(p);
      if (op === OP.OPEN_FAIL || op === OP.CLOSE || op === OP.RST || (op === OP.DATA && /<\/html>/i.test(s.body))) {
        if (op === OP.OPEN_FAIL) s.fail = p[0];
        if (--pending <= 0) done();
      }
    });
  });
}

const results = {};
const t = await token(opt.origin);
results.token = { status: t.status ?? 200, cors: t.cors ?? null, length: t.token?.length ?? 0 };
const wsUrl = opt.ws ?? t.ws;
// 1. A page through the relay.
const get = (host) => `GET / HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\nUser-Agent: wasm-vm-relay-smoke\r\n\r\n`;
const ok = await session(wsUrl, opt.origin, t.token, [["example.com", 80]], { request: get });
results.fetch = { status: /^HTTP\/1\.[01] (\d+)/.exec(ok.streams[1]?.body ?? "")?.[1] ?? null, title: /<title>([^<]*)/.exec(ok.streams[1]?.body ?? "")?.[1] ?? null, events: ok.streams[1]?.events, error: ok.error };
// 1b. DNS over the relay's UDP: an A query for example.com to 1.1.1.1:53 gets one answer.
results.udpDns = await new Promise((resolve) => {
  const ws = new WebSocket(wsUrl, { headers: { Origin: opt.origin } }); ws.binaryType = "arraybuffer";
  const id = 0x80000001; const timer = setTimeout(() => { ws.terminate(); resolve({ timeout: true }); }, 20000);
  const q = new Uint8Array([0x12, 0x34, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 7, ...new TextEncoder().encode("example"), 3, ...new TextEncoder().encode("com"), 0, 0, 1, 0, 1]);
  ws.on("open", () => { ws.send(frame(0, OP.HELLO, new Uint8Array([1, ...new TextEncoder().encode(t.token)]))); ws.send(frame(id, 9, openPayload("1.1.1.1", 53))); });
  ws.on("message", (data) => {
    const b = new Uint8Array(data); const sid = new DataView(b.buffer, b.byteOffset).getUint32(0); const op = b[4];
    if (sid === id && op === 10) ws.send(frame(id, 12, q));
    if (sid === id && op === 12) { clearTimeout(timer); const r = b.subarray(5); ws.close(); resolve({ bytes: r.length, id: (r[0] << 8) | r[1], answers: (r[6] << 8) | r[7] }); }
    if (sid === id && op === 11) { clearTimeout(timer); ws.close(); resolve({ udpOpenFail: b[5] }); }
  });
  ws.on("error", (e) => { clearTimeout(timer); resolve({ error: e.message }); });
});
// 2. Protected destinations.
const prot = await session(wsUrl, opt.origin, t.token, [["127.0.0.1", 80], ["10.0.0.1", 80], ["169.254.169.254", 80], ["localhost", 80]]);
results.protected = Object.fromEntries([1, 2, 3, 4].map((i) => [["127.0.0.1", "10.0.0.1", "169.254.169.254", "localhost"][i - 1], prot.streams[i]?.fail ?? prot.streams[i]?.events ?? null]));
// 3. Bad tokens and origins.
results.noToken = await session(wsUrl, opt.origin, "", [["example.com", 80]]);
results.forged = await session(wsUrl, opt.origin, t.token.slice(0, -4) + "AAAA", [["example.com", 80]]);
results.wrongOrigin = await session(wsUrl, "https://evil.example", t.token, [["example.com", 80]]);
if (!opt.secret) {
  const bad = await token("https://evil.example");
  results.tokenForOtherOrigin = { status: bad.status, cors: bad.cors };
}
const opened = (s) => Object.values(s.streams ?? {}).some((x) => x.events.includes(OP.OPEN_OK));
console.log(JSON.stringify(results, (k, v) => (k === "body" ? undefined : v), 2));
assert.equal(results.fetch.status, "200", "a page through the relay");
assert.equal(results.fetch.title, "Example Domain");
assert.ok(results.udpDns.id === 0x1234 && results.udpDns.answers >= 1, `DNS over UDP through the relay (${JSON.stringify(results.udpDns)})`);
for (const [host, v] of Object.entries(results.protected)) assert.ok(typeof v === "number", `${host} refused with OPEN_FAIL (${JSON.stringify(v)})`);
for (const k of ["noToken", "forged", "wrongOrigin"]) assert.ok(!opened(results[k]), `${k}: nothing opened`);
if (!opt.secret) assert.ok(results.tokenForOtherOrigin.status === 403 && !results.tokenForOtherOrigin.cors, "no token for another origin");
console.log("SMOKE PASS");
if (opt.out) (await import("node:fs")).writeFileSync(opt.out, JSON.stringify(results, (k, v) => (k === "body" ? undefined : v), 2) + "\n");
