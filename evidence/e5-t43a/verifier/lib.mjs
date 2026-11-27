// E5-T43a verifier: a minimal ws-proxy client (docs/design/ws-proxy-protocol.md), independent of
// deploy/cloudflare-relay/smoke.mjs except for the `ws` package it borrows from that directory.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../../../deploy/cloudflare-relay/package.json"));
export const WebSocket = require("ws");

export const BASE = process.env.RELAY_BASE || "https://wasm-vm-relay.brett-lamy.workers.dev";
export const WS = BASE.replace(/^http/, "ws") + "/ws";
export const PAGES = "https://wasm-vm.pages.dev";
export const OP = { HELLO: 0, OPEN: 1, OPEN_OK: 2, OPEN_FAIL: 3, DATA: 4, SHUTDOWN_WR: 5, CLOSE: 6, RST: 7, WINDOW: 8,
  UDP_OPEN: 9, UDP_OPEN_OK: 10, UDP_OPEN_FAIL: 11, UDP_DATA: 12, UDP_CLOSE: 13 };
export const frame = (id, op, payload = new Uint8Array()) => {
  const b = new Uint8Array(5 + payload.length); new DataView(b.buffer).setUint32(0, id); b[4] = op; b.set(payload, 5); return b;
};
export const hostPort = (host, port) => {
  const h = new TextEncoder().encode(host); const p = new Uint8Array(1 + h.length + 2);
  p[0] = h.length; p.set(h, 1); new DataView(p.buffer).setUint16(1 + h.length, port); return p;
};
export const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
export const hello = (tok) => frame(0, OP.HELLO, new Uint8Array([1, ...new TextEncoder().encode(tok)]));

export async function getToken(origin = PAGES) {
  const r = await fetch(`${BASE}/token`, { headers: origin ? { Origin: origin } : {} });
  const body = await r.text();
  let json = null; try { json = JSON.parse(body); } catch {}
  return { status: r.status, headers: Object.fromEntries(r.headers), body: json ?? body, token: json?.token, expiresAt: json?.expiresAt };
}

export function decodeToken(tok) {
  const text = Buffer.from(tok.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  return text.split("\n");
}
export function encodeToken(fields) {
  return Buffer.from(fields.join("\n"), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// A live connection with an event log; `wait(pred, ms)` resolves when a received frame matches.
export function connect(origin, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const c = { log: [], frames: [], closed: null, error: null, ws: null, t0 };
    const ws = new WebSocket(WS, origin ? { headers: { Origin: origin } } : {});
    c.ws = ws; ws.binaryType = "arraybuffer";
    const waiters = [];
    c.wait = (pred, ms = timeoutMs) => new Promise((res) => {
      const hit = c.frames.find(pred); if (hit) return res(hit);
      const w = { pred, res }; waiters.push(w);
      setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); res(null); } }, ms);
    });
    c.closedP = new Promise((res) => { c._closeRes = res; });
    ws.on("unexpected-response", (_q, res) => { c.error = `http ${res.statusCode}`; c.closed = -1; c._closeRes(); resolve(c); });
    ws.on("error", (e) => { c.error ??= String(e.message); });
    ws.on("close", (code) => { c.closed = code; c.closedAt = Date.now() - t0; c._closeRes(); for (const w of waiters.splice(0)) w.res(null); resolve(c); });
    ws.on("open", () => { c.opened = true; resolve(c); });
    ws.on("message", (data) => {
      const b = new Uint8Array(data); const id = new DataView(b.buffer, b.byteOffset).getUint32(0);
      const f = { id, op: b[4], payload: b.subarray(5), t: Date.now() - t0 };
      c.frames.push(f);
      for (const w of [...waiters]) if (w.pred(f)) { waiters.splice(waiters.indexOf(w), 1); w.res(f); }
    });
  });
}
export const send = (c, bytes) => { try { c.ws.send(bytes); } catch (e) { c.error ??= String(e); } };
export const close = (c) => { try { c.ws.close(); } catch {} };

// OPEN host:port on stream id; returns "OPEN_OK" | "OPEN_FAIL:<code>" | "none" (+ ms).
export async function tcpOpen(c, id, host, port, ms = 20000) {
  const t = Date.now();
  send(c, frame(id, OP.OPEN, hostPort(host, port)));
  const f = await c.wait((x) => x.id === id && (x.op === OP.OPEN_OK || x.op === OP.OPEN_FAIL), ms);
  const r = !f ? (c.closed !== null ? `closed:${c.closed}` : "none") : f.op === OP.OPEN_OK ? "OPEN_OK" : `OPEN_FAIL:${f.payload[0]}`;
  return { result: r, ms: Date.now() - t };
}
export async function udpOpen(c, id, host, port, ms = 20000) {
  const t = Date.now();
  send(c, frame(id, OP.UDP_OPEN, hostPort(host, port)));
  const f = await c.wait((x) => x.id === id && (x.op === OP.UDP_OPEN_OK || x.op === OP.UDP_OPEN_FAIL), ms);
  const r = !f ? (c.closed !== null ? `closed:${c.closed}` : "none") : f.op === OP.UDP_OPEN_OK ? "UDP_OPEN_OK" : `UDP_OPEN_FAIL:${f.payload[0]}`;
  return { result: r, ms: Date.now() - t };
}
// HTTP GET through an open TCP stream; returns the status line's code.
export async function httpGet(c, id, host) {
  send(c, frame(id, OP.WINDOW, u32(1 << 20)));
  send(c, frame(id, OP.DATA, new TextEncoder().encode(`GET / HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\nUser-Agent: wasm-vm-relay-verifier\r\n\r\n`)));
  const f = await c.wait((x) => x.id === id && x.op === OP.DATA, 15000);
  return f ? (/^HTTP\/1\.[01] (\d+)/.exec(new TextDecoder().decode(f.payload))?.[1] ?? "?") : null;
}
// After HELLO: did the relay answer HELLO and/or close?
export async function afterHello(c, ms = 8000) {
  const h = await c.wait((x) => x.id === 0, ms);
  return { helloReply: h ? h.op : null };
}
