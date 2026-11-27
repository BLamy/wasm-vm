#!/usr/bin/env node
// E5-T43a verifier round 2, short probes (R5-R9 in predictions.md). About 6 WebSockets, a handful of
// outbound connects (example.com:80, smtp.gmail.com:587/465, connect-and-close), then /token requests
// until the first 429 (capped at 50) plus 8 more.
import { writeFileSync } from "node:fs";
import tls from "node:tls";
import crypto from "node:crypto";
import { BASE, PAGES, OP, connect, getToken, hello, tcpOpen, httpGet, close, send, frame } from "../verifier/lib.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { startedAt: new Date().toISOString() };

// R5: a valid HELLO at 9 s, and at 12 s.
for (const delay of [9000, 12000]) {
  const t = await getToken(PAGES);
  const c = await connect(PAGES);
  await sleep(delay);
  const r = { delayMs: delay, closedBeforeHello: c.closed, closedAtMs: c.closedAt };
  if (c.closed === null) {
    send(c, hello(t.token));
    r.open = await tcpOpen(c, 1, "example.com", 80);
    if (r.open.result === "OPEN_OK") { r.http = await httpGet(c, 1, "example.com"); }
    await sleep(3000); r.aliveAt = Math.round((Date.now() - c.t0) / 1000); r.alive = c.closed === null;
  }
  close(c);
  out[`hello_at_${delay / 1000}s`] = r;
}

// R6: a partial HELLO frame over a raw TLS WebSocket: header promises 300 bytes, one byte a second.
out.partialHello = await new Promise((resolve) => {
  const host = new URL(BASE).host;
  const s = tls.connect({ host, port: 443, servername: host });
  const key = crypto.randomBytes(16).toString("base64");
  let buf = Buffer.alloc(0), upgradedAt = null, timer = null, sent = 0; const t0 = Date.now();
  const done = (why) => { clearInterval(timer); s.destroy(); resolve({ why, status: buf.toString("latin1").split("\r\n")[0], bytesTrickled: sent, closedAfterUpgradeMs: upgradedAt ? Date.now() - upgradedAt : null }); };
  s.on("secureConnect", () => s.write(`GET /ws HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nOrigin: ${PAGES}\r\n\r\n`));
  s.on("data", (d) => {
    if (!upgradedAt) { buf = Buffer.concat([buf, d]); const i = buf.indexOf("\r\n\r\n"); if (i < 0) return;
      if (!/ 101 /.test(buf.toString("latin1").split("\r\n")[0])) return done("not upgraded");
      upgradedAt = Date.now(); const mask = crypto.randomBytes(4);
      s.write(Buffer.concat([Buffer.from([0x82, 0x80 | 126, 300 >> 8, 300 & 255]), mask]));
      timer = setInterval(() => { if (sent < 300) { s.write(Buffer.from([0 ^ mask[sent % 4]])); sent++; } }, 1000);
      const rest = buf.subarray(i + 4); if (rest.length && (rest[0] & 0x0f) === 8) return done("close frame");
      return; }
    if ((d[0] & 0x0f) === 8) return done("close frame"); // a server HELLO (binary) may come first
  });
  s.on("end", () => done("end")); s.on("close", () => done("socket closed"));
  setTimeout(() => done("still open at 40 s"), 40000);
});

// R7/R8: ports and IPv6 forms on one authenticated session.
{
  const t = await getToken(PAGES);
  const c = await connect(PAGES);
  send(c, hello(t.token));
  const r = {};
  let id = 1;
  for (const [h, p, ms] of [["::127.0.0.1", 80, 3000], ["aspmx.l.google.com", 25, 5000], ["smtp.gmail.com", 587, 8000], ["smtp.gmail.com", 465, 8000],
    ["::ffff:0:7f00:1", 80, 3000], ["fec0::1", 80, 3000], ["::ffff:0:a9fe:a9fe", 80, 3000]]) {
    const sid = id++;
    r[`${h}:${p}`] = await tcpOpen(c, sid, h, p, ms);
    send(c, frame(sid, OP.CLOSE));
  }
  out.portsAndV6 = r;
  close(c);
}

// R9: /token until the first 429 (cap 50), then spoofed client-IP headers, then plain again.
const tok = async (extra = {}) => (await fetch(`${BASE}/token`, { headers: { Origin: PAGES, ...extra } })).status;
const plain = [];
for (let i = 0; i < 50; i++) { const s = await tok(); plain.push(s); if (s === 429) break; }
const rnd = () => `203.0.113.${1 + Math.floor(Math.random() * 250)}`;
const rnd2 = () => `198.51.100.${1 + Math.floor(Math.random() * 250)}`;
const spoofed = {};
for (const [name, val] of [["CF-Connecting-IP", rnd2()], ["X-Forwarded-For", rnd2()], ["True-Client-IP", rnd2()], ["X-Real-IP", rnd2()],
  ["CF-Connecting-IPv6", "2001:db8::1"], ["Forwarded", `for=${rnd()}`]]) spoofed[name] = await tok({ [name]: val });
const plainAfter = [await tok(), await tok()];
out.tokenRate = { plain, firstLimitedAt: plain.indexOf(429) + 1 || null, spoofed, plainAfter };
out.finishedAt = new Date().toISOString();
console.log(JSON.stringify(out, null, 2));
writeFileSync(new URL("./short2.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
process.exit(0);
