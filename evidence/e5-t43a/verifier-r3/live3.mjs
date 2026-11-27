#!/usr/bin/env node
// E5-T43a round-3 verifier, LIVE against the deployed relay. About 34 WebSockets in all, connect-only
// outbound (example.com:80), no sustained traffic. Q1-Q5 in predictions.md.
import { writeFileSync } from "node:fs";
import tls from "node:tls";
import crypto from "node:crypto";
import { BASE, WS, PAGES, OP, WebSocket, frame, hostPort } from "../verifier/lib.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { startedAt: new Date().toISOString(), base: BASE };
const t00 = Date.now();
const stamp = () => Math.round((Date.now() - t00) / 1000);

// Tokens, paced under the /token limiter (retry on 429).
const pool = []; let limited = 0;
async function fetchToken() {
  for (;;) {
    const r = await fetch(`${BASE}/token`, { headers: { Origin: PAGES } });
    if (r.status === 200) return (await r.json()).token;
    if (r.status === 429) { limited++; await sleep(10000); continue; }
    throw new Error(`token ${r.status}`);
  }
}
for (let i = 0; i < 34; i++) pool.push(await fetchToken());
out.tokens = { fetched: pool.length, throttled429: limited, tookS: stamp() };
const tok = () => pool.shift();
const randIp = () => `198.51.100.${1 + Math.floor(Math.random() * 250)}`;

// One session: HELLO then OPEN example.com:80 on stream 1; "served" | "fail N" | "closed" | "no answer".
function session(token, headers = {}, version = 1) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS, { headers: { Origin: PAGES, ...headers } }); ws.binaryType = "arraybuffer";
    const done = (v) => { clearTimeout(timer); resolve({ ws, result: v }); };
    const timer = setTimeout(() => done("no answer"), 15000);
    ws.on("open", () => { ws.send(frame(0, OP.HELLO, new Uint8Array([version, ...new TextEncoder().encode(token)]))); ws.send(frame(1, OP.OPEN, hostPort("example.com", 80))); });
    ws.on("message", (d) => { const b = new Uint8Array(d); if (new DataView(b.buffer, b.byteOffset).getUint32(0) === 1) done(b[4] === OP.OPEN_OK ? "served" : `fail ${b[5]}`); });
    ws.on("unexpected-response", (_q, res) => done(`http ${res.statusCode}`));
    ws.on("close", (code) => done(`closed ${code}`)); ws.on("error", () => {});
  });
}
// A raw TLS WebSocket that never answers the Close frame and never ends its TCP side.
function raw(token = null, extraHeader = "") {
  return new Promise((resolve) => {
    const host = new URL(BASE).host; const t0 = Date.now();
    const s = tls.connect({ host, port: 443, servername: host });
    const r = { s, t0, frames: [], closeFrameAtMs: null, serverEndAtMs: null, upgraded: null };
    let buf = Buffer.alloc(0), up = false;
    s.on("secureConnect", () => s.write(`GET /ws HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\nOrigin: ${PAGES}\r\n${extraHeader}\r\n`));
    s.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (!up) { const i = buf.indexOf("\r\n\r\n"); if (i < 0) return; up = / 101 /.test(buf.subarray(0, i).toString()); r.upgraded = up; buf = buf.subarray(i + 4); resolve(r);
        if (up && token) { const p = Buffer.from(frame(0, OP.HELLO, new Uint8Array([1, ...Buffer.from(token)]))); const m = crypto.randomBytes(4);
          const hdr = p.length < 126 ? Buffer.from([0x82, 0x80 | p.length]) : Buffer.from([0x82, 0x80 | 126, p.length >> 8, p.length & 255]);
          s.write(Buffer.concat([hdr, m, Buffer.from(p.map((b, k) => b ^ m[k % 4]))])); } }
      while (buf.length >= 2) { let len = buf[1] & 127, off = 2; if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        if (buf.length < off + len) return; const op = buf[0] & 15; r.frames.push(op); if (op === 8 && r.closeFrameAtMs === null) r.closeFrameAtMs = Date.now() - t0; buf = buf.subarray(off + len); }
    });
    const end = () => { r.serverEndAtMs ??= Date.now() - t0; };
    s.on("end", end); s.on("close", end); s.on("error", () => {});
    setTimeout(() => resolve(r), 20000);
  });
}
const rawState = (r) => ({ upgraded: r.upgraded, frames: r.frames, closeFrameAtMs: r.closeFrameAtMs, serverEndAtMs: r.serverEndAtMs, heldForS: Math.round((Date.now() - r.t0) / 1000) });
const closeAll = async (xs) => { for (const x of xs) try { x.ws.close(); } catch {} await sleep(3000); };

// Q1: ten sessions, each claiming its own client header (and X-Forwarded-For / True-Client-IP).
const ten = [];
for (let i = 0; i < 10; i++) { const ip = randIp(); ten.push(await session(tok(), { "x-wvrelay-client": ip, "X-Forwarded-For": ip, "True-Client-IP": ip })); }
out.Q1_spoofedHeaders = { results: ten.map((x) => x.result), served: ten.filter((x) => x.result === "served").length, at: stamp() };
// Q5 live: with eight held, a raw eleventh with a valid HELLO (refused at the cap) and a raw no-HELLO; neither answers Close.
const refusedRaw = await raw(tok(), `x-wvrelay-client: ${randIp()}\r\n`);
const noHelloRaw = await raw();
await sleep(12000);
out.Q5_at12s = { refused: rawState(refusedRaw), noHello: rawState(noHelloRaw), at: stamp() };
await closeAll(ten);
// Q3: a HELLO with the wrong protocol version (open_session runs before the version check).
const mismatch = await session(tok(), {}, 2);
out.Q3_versionMismatch = mismatch.result; try { mismatch.ws.close(); } catch {}
await sleep(2000);
// Q2: eight served again after the ten (two refused) and the mismatch closed; the ninth refused.
const nine = [];
for (let i = 0; i < 9; i++) nine.push(await session(tok()));
out.Q2_recount = { results: nine.map((x) => x.result), served: nine.filter((x) => x.result === "served").length, at: stamp() };
await closeAll(nine);
// Q4: twelve at once.
const twelve = await Promise.all(Array.from({ length: 12 }, () => session(tok())));
out.Q4_race = { results: twelve.map((x) => x.result), served: twelve.filter((x) => x.result === "served").length, at: stamp() };
await closeAll(twelve);
// Q5 live, continued: watch the two raw sockets up to ~100 s after their close frames.
for (let i = 0; i < 9 && (refusedRaw.serverEndAtMs === null || noHelloRaw.serverEndAtMs === null); i++) await sleep(10000);
out.Q5_end = { refused: rawState(refusedRaw), noHello: rawState(noHelloRaw), at: stamp() };
refusedRaw.s.destroy(); noHelloRaw.s.destroy();
out.finishedAt = new Date().toISOString();
console.log(JSON.stringify(out, null, 2));
writeFileSync(new URL("./live3.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
process.exit(0);
