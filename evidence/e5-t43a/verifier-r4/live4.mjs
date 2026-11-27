#!/usr/bin/env node
// E5-T43a round-4 verifier, LIVE. S2/S3 in predictions.md. 23 WebSockets in all, connect-only outbound
// (example.com:80, one HTTP GET), no sustained traffic. Writes live4.json (no token values).
import { writeFileSync } from "node:fs";
import tls from "node:tls";
import crypto from "node:crypto";
import { BASE, WS, PAGES, OP, WebSocket, frame, hostPort } from "../verifier/lib.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { startedAt: new Date().toISOString(), base: BASE };
const t00 = Date.now();
const stamp = () => Math.round((Date.now() - t00) / 100) / 10;
let limited = 0;
async function fetchToken() {
  for (;;) {
    const r = await fetch(`${BASE}/token`, { headers: { Origin: PAGES } });
    if (r.status === 200) return (await r.json()).token;
    if (r.status === 429) { limited++; await sleep(10000); continue; }
    throw new Error(`token ${r.status}`);
  }
}
const pool = [];
for (let i = 0; i < 9; i++) pool.push(await fetchToken());
out.tokens = { fetched: pool.length, throttled429: limited, atS: stamp() };
const tok = () => pool.shift();

const mask = (payload) => { const p = Buffer.from(payload); const m = crypto.randomBytes(4);
  const hdr = p.length < 126 ? Buffer.from([0x82, 0x80 | p.length]) : Buffer.from([0x82, 0x80 | 126, p.length >> 8, p.length & 255]);
  return Buffer.concat([hdr, m, Buffer.from(p.map((b, k) => b ^ m[k % 4]))]); };
// Raw TLS WebSocket that never answers Close and never ends its TCP side. Logs every frame (opcode, ws-proxy op) with time.
function raw(name) {
  return new Promise((resolve) => {
    const host = new URL(BASE).host; const t0 = Date.now();
    const s = tls.connect({ host, port: 443, servername: host });
    const r = { name, s, t0, frames: [], closeFrameAtMs: null, serverEndAtMs: null, upgraded: null, sent: [] };
    r.send = (label, payload) => { r.sent.push({ label, atMs: Date.now() - t0 }); try { s.write(mask(payload)); } catch {} };
    let buf = Buffer.alloc(0), up = false;
    s.on("secureConnect", () => s.write(`GET /ws HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\nOrigin: ${PAGES}\r\n\r\n`));
    s.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (!up) { const i = buf.indexOf("\r\n\r\n"); if (i < 0) return; up = / 101 /.test(buf.subarray(0, i).toString()); r.upgraded = up; buf = buf.subarray(i + 4); r.upgradedAtMs = Date.now() - t0; resolve(r); }
      while (buf.length >= 2) { let len = buf[1] & 127, off = 2; if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        if (buf.length < off + len) return; const op = buf[0] & 15; const body = buf.subarray(off, off + len);
        r.frames.push({ wsOp: op, proxyOp: op === 2 && body.length >= 5 ? body[4] : null, stream: op === 2 && body.length >= 4 ? body.readUInt32BE(0) : null, closeCode: op === 8 && body.length >= 2 ? body.readUInt16BE(0) : null, atMs: Date.now() - t0 });
        if (op === 8 && r.closeFrameAtMs === null) r.closeFrameAtMs = Date.now() - t0; buf = buf.subarray(off + len); }
    });
    const end = () => { r.serverEndAtMs ??= Date.now() - t0; };
    s.on("end", end); s.on("close", end); s.on("error", () => {});
    setTimeout(() => resolve(r), 20000);
  });
}
const st = (r) => ({ name: r.name, upgraded: r.upgraded, frames: r.frames, closeFrameAtMs: r.closeFrameAtMs, serverEndAtMs: r.serverEndAtMs, sent: r.sent, heldForS: Math.round((Date.now() - r.t0) / 1000) });
const helloBytes = (t) => frame(0, OP.HELLO, new Uint8Array([1, ...Buffer.from(t)]));

// S2a: no HELLO. Wait for the relay's Close (~10 s), then 5 s more (container side gone at +2 s), then a valid HELLO + OPEN.
const r1 = await raw("noHello_thenHelloAfterClose");
// S2b: valid HELLO, then an undecodable binary frame (protocol error): the relay ends the session at once.
const r2 = await raw("authed_thenProtocolError_thenOpenAfterClose");
r2.send("HELLO", helloBytes(tok()));
await sleep(1500);
r2.send("undecodable", new Uint8Array([1, 2, 3]));
// S3: sixteen more raw no-HELLO connections, all held.
const held = [];
for (let i = 0; i < 16; i++) held.push(await raw(`held${i}`));
out.afterOpenS = stamp();
// r2: 5 s after its Close, OPEN on stream 1.
await sleep(4000);
r2.send("OPEN example.com:80 after close", frame(1, OP.OPEN, hostPort("example.com", 80)));
// r1: wait for its Close + 5 s.
for (let i = 0; i < 40 && r1.closeFrameAtMs === null; i++) await sleep(500);
await sleep(5000);
const t1 = tok(); r1.send("HELLO after close", helloBytes(t1)); r1.send("OPEN example.com:80 after close", frame(1, OP.OPEN, hostPort("example.com", 80)));
await sleep(3000); // all 16 held ones are past 10 s + 2 s now
out.S2_at = stamp();

// S3: with 18 finished connections held at the edge, four sessions are served (one does an HTTP GET), a fifth refused.
function session(token, doGet = false) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS, { headers: { Origin: PAGES } }); ws.binaryType = "arraybuffer";
    let res = null, http = null;
    const done = () => { clearTimeout(timer); resolve({ ws, result: res, http }); };
    const timer = setTimeout(() => { res ??= "no answer"; done(); }, 15000);
    ws.on("open", () => { ws.send(helloBytes(token)); ws.send(frame(1, OP.OPEN, hostPort("example.com", 80))); });
    ws.on("message", (d) => { const b = new Uint8Array(d); const id = new DataView(b.buffer, b.byteOffset).getUint32(0); const op = b[4];
      if (id !== 1) return;
      if (res === null) { res = op === OP.OPEN_OK ? "served" : `fail ${b[5]}`; if (!doGet || res !== "served") return done();
        ws.send(frame(1, OP.WINDOW, new Uint8Array([0, 1, 0, 0])));
        ws.send(frame(1, OP.DATA, new TextEncoder().encode("GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n"))); return; }
      if (op === OP.DATA && http === null) { http = new TextDecoder().decode(b.subarray(5)).split("\r\n")[0]; done(); } });
    ws.on("unexpected-response", (_q, r) => { res = `http ${r.statusCode}`; done(); });
    ws.on("close", (code) => { res ??= `closed ${code}`; done(); }); ws.on("error", () => {});
  });
}
const five = [];
five.push(await session(tok(), true));
for (let i = 0; i < 4; i++) five.push(await session(tok()));
out.S3_withHeld = { results: five.map((x) => x.result), served: five.filter((x) => x.result === "served").length, http: five[0].http, atS: stamp() };
for (const x of five) try { x.ws.close(); } catch {}
await sleep(3000);
// Watch the raw sockets until ~60 s after start.
while (Date.now() - t00 < 60000) await sleep(2000);
out.S2_end = { r1: st(r1), r2: st(r2), atS: stamp() };
out.S3_held = { count: held.length, upgraded: held.filter((h) => h.upgraded).length,
  closeFrameAtMs: held.map((h) => h.closeFrameAtMs), serverEnded: held.filter((h) => h.serverEndAtMs !== null).length,
  framesAfterClose: held.map((h) => h.frames.filter((f) => f.wsOp !== 8 && h.closeFrameAtMs !== null && f.atMs > h.closeFrameAtMs).length) };
for (const h of [r1, r2, ...held]) h.s.destroy();
out.finishedAt = new Date().toISOString();
console.log(JSON.stringify(out, null, 2));
writeFileSync(new URL("./live4.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
process.exit(0);
