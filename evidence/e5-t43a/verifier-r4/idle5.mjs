#!/usr/bin/env node
// E5-T43a round-4 verifier, LIVE idle limit, second run (after idle4 showed idle sessions' places freed but no Close
// at the client). 6 WebSockets, connect-only. Q: raw TLS client, HELLO then silent, logs every frame and TCP end.
// 29 min: N1..N3 served + N4 refused => Q still holds its place at 29 min idle.
// 31 min: N5 served => Q's place freed between 29 and 31 min; then Q sends OPEN example.com:80 => logged.
import { writeFileSync } from "node:fs";
import tls from "node:tls";
import crypto from "node:crypto";
import { BASE, WS, PAGES, OP, WebSocket, frame, hostPort } from "../verifier/lib.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t00 = Date.now(); const stamp = () => Math.round((Date.now() - t00) / 100) / 10;
const out = { startedAt: new Date().toISOString(), base: BASE };
const save = () => writeFileSync(new URL("./idle5.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
async function fetchToken() { for (;;) { const r = await fetch(`${BASE}/token`, { headers: { Origin: PAGES } });
  if (r.status === 200) return (await r.json()).token; if (r.status === 429) { await sleep(10000); continue; } throw new Error(`token ${r.status}`); } }
const helloBytes = (t) => frame(0, OP.HELLO, new Uint8Array([1, ...Buffer.from(t)]));
const mask = (payload) => { const p = Buffer.from(payload); const m = crypto.randomBytes(4);
  const hdr = p.length < 126 ? Buffer.from([0x82, 0x80 | p.length]) : Buffer.from([0x82, 0x80 | 126, p.length >> 8, p.length & 255]);
  return Buffer.concat([hdr, m, Buffer.from(p.map((b, k) => b ^ m[k % 4]))]); };
const Q = { frames: [], sent: [], tcpEndAtS: null, closeFrameAtS: null };
await new Promise((resolve) => {
  const host = new URL(BASE).host; const s = tls.connect({ host, port: 443, servername: host }); Q.s = s;
  Q.send = (label, p) => { Q.sent.push({ label, atS: stamp() }); try { s.write(mask(p)); } catch (e) { Q.sent.at(-1).err = String(e); } };
  let buf = Buffer.alloc(0), up = false;
  s.on("secureConnect", () => s.write(`GET /ws HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\nOrigin: ${PAGES}\r\n\r\n`));
  s.on("data", (d) => { buf = Buffer.concat([buf, d]);
    if (!up) { const i = buf.indexOf("\r\n\r\n"); if (i < 0) return; up = / 101 /.test(buf.subarray(0, i).toString()); Q.upgraded = up; buf = buf.subarray(i + 4); resolve(); }
    while (buf.length >= 2) { let len = buf[1] & 127, off = 2; if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      if (buf.length < off + len) return; const op = buf[0] & 15; const body = buf.subarray(off, off + len);
      Q.frames.push({ wsOp: op, proxyOp: op === 2 && body.length >= 5 ? body[4] : null, stream: op === 2 ? body.readUInt32BE(0) : null, closeCode: op === 8 && body.length >= 2 ? body.readUInt16BE(0) : null, atS: stamp() });
      if (op === 8) Q.closeFrameAtS ??= stamp(); buf = buf.subarray(off + len); } });
  const end = () => { Q.tcpEndAtS ??= stamp(); }; s.on("end", end); s.on("close", end); s.on("error", () => {});
});
Q.send("HELLO", helloBytes(await fetchToken()));
await sleep(2000);
Q.send("OPEN stream 1 example.com:80 (proves auth)", frame(1, OP.OPEN, hostPort("example.com", 80)));
out.Q_lastActivityAtS = stamp(); save();
function session(name, token) {
  return new Promise((resolve) => {
    const s = { name, frames: [], closed: null, closedAtS: null };
    const ws = new WebSocket(WS, { headers: { Origin: PAGES } }); ws.binaryType = "arraybuffer"; s.ws = ws;
    const timer = setTimeout(() => { s.result ??= "no answer"; resolve(s); }, 15000);
    ws.on("open", () => { ws.send(helloBytes(token)); ws.send(frame(1, OP.OPEN, hostPort("example.com", 80))); });
    ws.on("message", (d) => { const b = new Uint8Array(d); const id = new DataView(b.buffer, b.byteOffset).getUint32(0); s.frames.push({ id, op: b[4], atS: stamp() });
      if (id === 1 && s.result === undefined) { s.result = b[4] === OP.OPEN_OK ? "served" : `fail ${b[5]}`; clearTimeout(timer); resolve(s); } });
    ws.on("close", (code) => { s.closed = code; s.closedAtS = stamp(); s.result ??= `closed ${code}`; clearTimeout(timer); resolve(s); });
    ws.on("error", () => {});
  });
}
const view = (s) => ({ name: s.name, result: s.result, closed: s.closed, closedAtS: s.closedAtS, frames: s.frames });
const qView = () => ({ upgraded: Q.upgraded, frames: Q.frames, sent: Q.sent, closeFrameAtS: Q.closeFrameAtS, tcpEndAtS: Q.tcpEndAtS, atS: stamp() });
const toks = [];
while (Date.now() - t00 < 28 * 60 * 1000) { await sleep(60000); out.Q_progress = qView(); save(); }
for (let i = 0; i < 5; i++) toks.push(await fetchToken());
while (Date.now() - t00 < 29 * 60 * 1000) await sleep(1000);
const N = [];
for (let i = 1; i <= 4; i++) N.push(await session(`N${i}`, toks.shift()));
out.at29 = { Q: qView(), sessions: N.map(view) }; save();
for (let i = 0; i < 3; i++) { await sleep(30000); for (const s of N.slice(0, 3)) try { s.ws.send(frame(1, OP.WINDOW, new Uint8Array([0, 0, 0, 1]))); } catch {} }
while (Date.now() - t00 < 31 * 60 * 1000) await sleep(1000);
const N5 = await session("N5", toks.shift());
out.at31 = { Q: qView(), N5: view(N5), N1to3: N.slice(0, 3).map(view) }; save();
Q.send("OPEN stream 3 example.com:80 after idle", frame(3, OP.OPEN, hostPort("example.com", 80)));
await sleep(30000);
out.end = { Q: qView(), sessions: [...N, N5].map(view) };
for (const s of [...N, N5]) try { s.ws.close(); } catch {}
Q.s.destroy(); out.finishedAt = new Date().toISOString(); save();
await sleep(1500); process.exit(0);
