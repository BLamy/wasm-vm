#!/usr/bin/env node
// E5-T43a round-3 verifier, LOCAL (native wvrelay built at this head, loopback, throwaway secret):
// does the relay release a connection it has finished with (HELLO deadline, session refused at the
// per-client cap) when the client never answers the WebSocket Close frame?  Q5 / Q1-local in predictions.md.
// usage: node local-hold.mjs <path-to-wvrelay>
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
import crypto from "node:crypto";
import { writeFileSync } from "node:fs";
import { WebSocket, frame, OP, hostPort } from "../verifier/lib.mjs";

const BIN = process.argv[2];
const PORT = 18931, ORIGIN = "https://vm.example";
const SECRET = "verifier-local-throwaway-" + crypto.randomBytes(8).toString("hex");
const env = { ...process.env, WVRELAY_HMAC_SECRET: SECRET, WVRELAY_ALLOWED_ORIGINS: ORIGIN };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { startedAt: new Date().toISOString() };
const relay = spawn(BIN, [`127.0.0.1:${PORT}`], { env, stdio: ["ignore", "pipe", "pipe"] });
const relayLog = [];
relay.stderr.on("data", (d) => relayLog.push(...String(d).trim().split("\n")));
await new Promise((r) => relay.stdout.once("data", r));
let n = 0;
const token = () => execFileSync(BIN, ["issue-token", ORIGIN, `v${Date.now()}${n++}`, "300"], { env }).toString().trim();
// Server-side sockets on PORT that are ESTABLISHED (the relay's end, local port = PORT).
const serverSockets = () => {
  try { return execFileSync("lsof", ["-nP", "-a", "-p", String(relay.pid), `-iTCP:${PORT}`, "-sTCP:ESTABLISHED"]).toString().trim().split("\n").slice(1).length; }
  catch { return 0; }
};

// A raw WebSocket client that never answers a Close frame and never closes its TCP end.
function raw({ hello: tok = null, clientHeader = null } = {}) {
  return new Promise((resolve) => {
    const s = net.connect(PORT, "127.0.0.1"); const t0 = Date.now();
    const r = { s, frames: [], closeFrameAtMs: null, serverEndAtMs: null };
    let buf = Buffer.alloc(0), up = false;
    s.on("connect", () => s.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\nOrigin: ${ORIGIN}\r\n${clientHeader ? `x-wvrelay-client: ${clientHeader}\r\n` : ""}\r\n`));
    s.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (!up) { const i = buf.indexOf("\r\n\r\n"); if (i < 0) return; up = / 101 /.test(buf.subarray(0, i).toString()); buf = buf.subarray(i + 4); r.upgraded = up; resolve(r);
        if (up && tok) { const p = Buffer.from(frame(0, OP.HELLO, new Uint8Array([1, ...Buffer.from(tok)]))); const m = crypto.randomBytes(4);
          const hdr = p.length < 126 ? Buffer.from([0x82, 0x80 | p.length]) : Buffer.from([0x82, 0x80 | 126, p.length >> 8, p.length & 255]);
          s.write(Buffer.concat([hdr, m, Buffer.from(p.map((b, k) => b ^ m[k % 4]))])); } }
      while (buf.length >= 2) { let len = buf[1] & 127, off = 2; if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        if (buf.length < off + len) return; const op = buf[0] & 15; r.frames.push(op); if (op === 8 && r.closeFrameAtMs === null) r.closeFrameAtMs = Date.now() - t0; buf = buf.subarray(off + len); }
    });
    s.on("end", () => { r.serverEndAtMs ??= Date.now() - t0; }); s.on("close", () => { r.serverEndAtMs ??= Date.now() - t0; });
    s.on("error", () => {});
  });
}
function wsSession(tok, clientHeader = null) {
  return new Promise((resolve) => {
    const headers = { Origin: ORIGIN }; if (clientHeader) headers["x-wvrelay-client"] = clientHeader;
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`, { headers }); ws.binaryType = "arraybuffer";
    const done = (v) => { clearTimeout(timer); resolve({ ws, result: v }); };
    const timer = setTimeout(() => done("no answer"), 5000);
    ws.on("open", () => { ws.send(frame(0, OP.HELLO, new Uint8Array([1, ...Buffer.from(tok)]))); ws.send(frame(1, OP.OPEN, hostPort("127.0.0.1", 9))); });
    ws.on("message", (d) => { const b = new Uint8Array(d); if (new DataView(b.buffer, b.byteOffset).getUint32(0) === 1) done("served"); });
    ws.on("close", () => done("closed")); ws.on("error", () => {});
  });
}

// 1. One raw client that never sends HELLO.
out.baselineServerSockets = serverSockets();
const a = await raw();
await sleep(12000);
out.noHello = { closeFrameAtMs: a.closeFrameAtMs, serverEndAtMs: a.serverEndAtMs, serverSocketsAt12s: serverSockets() };
// 2. Eight sessions served (no header -> client = 127.0.0.1); a raw ninth with a valid HELLO.
const eight = [];
for (let i = 0; i < 8; i++) eight.push(await wsSession(token()));
out.eight = eight.map((x) => x.result);
const ninth = await raw({ hello: token() });
await sleep(2000);
out.ninthRaw = { closeFrameAtMs: ninth.closeFrameAtMs, serverEndAtMs: ninth.serverEndAtMs, frames: ninth.frames };
// 3. Twenty more raw clients that never send HELLO, never answer Close.
const many = []; for (let i = 0; i < 20; i++) many.push(await raw());
await sleep(50000);
out.at62s = { serverSockets: serverSockets(), noHello: { closeFrameAtMs: a.closeFrameAtMs, serverEndAtMs: a.serverEndAtMs },
  ninth: { closeFrameAtMs: ninth.closeFrameAtMs, serverEndAtMs: ninth.serverEndAtMs },
  many: { closeFramesSeen: many.filter((x) => x.closeFrameAtMs !== null).length, serverEnded: many.filter((x) => x.serverEndAtMs !== null).length } };
// 4. Header honoured when the relay is reached directly: ten sessions, each with its own x-wvrelay-client.
for (const x of eight) x.ws.terminate();
for (const x of [a, ninth, ...many]) x.s.destroy();
await sleep(1000);
out.afterTeardownServerSockets = serverSockets();
const spoof = [];
for (let i = 0; i < 10; i++) spoof.push(await wsSession(token(), `198.51.100.${i + 1}`));
out.directHeaderSpoof = spoof.map((x) => x.result);
for (const x of spoof) x.ws.terminate();
relay.kill();
out.relayEvents = relayLog.reduce((m, l) => { const e = /"event":"([a-z_]+)"(?:,"reason":"(\w+)")?/.exec(l); if (e) { const k = e[2] ? `${e[1]}:${e[2]}` : e[1]; m[k] = (m[k] || 0) + 1; } return m; }, {});
out.finishedAt = new Date().toISOString();
console.log(JSON.stringify(out, null, 2));
writeFileSync(new URL("./local-hold.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
process.exit(0);
