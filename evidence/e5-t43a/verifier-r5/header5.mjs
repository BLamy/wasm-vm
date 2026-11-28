#!/usr/bin/env node
// E5-T43a round-5 verifier, LIVE: the deployed Worker (with src/client.js) overwrites a caller's x-wvrelay-client.
// 8 WebSockets from this one address, each sending its own x-wvrelay-client (plus X-Forwarded-For / True-Client-IP).
// Expect: S1..S4 served (OPEN_OK example.com:80), S5..S7 closed at HELLO (cap 4 per client), after closing all, S8 served.
import { writeFileSync } from "node:fs";
import crypto from "node:crypto";
import { BASE, WS, PAGES, OP, WebSocket, frame, hostPort, hello } from "../verifier/lib.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now(); const stamp = () => Math.round((Date.now() - t0) / 100) / 10;
const out = { startedAt: new Date().toISOString(), base: BASE };
const save = () => writeFileSync(new URL("./header5.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
async function token() { for (;;) { const r = await fetch(`${BASE}/token`, { headers: { Origin: PAGES } });
  if (r.status === 200) return (await r.json()).token; if (r.status === 429) { await sleep(10000); continue; } throw new Error(`token ${r.status}`); } }
function session(name, client) {
  return new Promise(async (resolve) => {
    const tok = await token();
    const s = { name, clientHeader: client.length > 40 ? `${client.slice(0, 8)}…(${client.length} chars)` : client, frames: [], closed: null };
    const headers = { Origin: PAGES, "x-wvrelay-client": client, "X-Forwarded-For": `198.51.100.${1 + Math.floor(Math.random() * 250)}`, "True-Client-IP": `203.0.113.${1 + Math.floor(Math.random() * 250)}` };
    const ws = new WebSocket(WS, { headers }); ws.binaryType = "arraybuffer"; s.ws = ws;
    const timer = setTimeout(() => { s.result ??= "no answer in 15 s"; resolve(s); }, 15000);
    ws.on("open", () => { ws.send(hello(tok)); ws.send(frame(1, OP.OPEN, hostPort("example.com", 80))); });
    ws.on("message", (d) => { const b = new Uint8Array(d); const id = new DataView(b.buffer, b.byteOffset).getUint32(0); s.frames.push({ id, op: b[4], atS: stamp() });
      if (id === 1 && s.result === undefined) { s.result = b[4] === OP.OPEN_OK ? "served" : `open_fail ${b[5]}`; clearTimeout(timer); resolve(s); } });
    ws.on("close", (code) => { s.closed = code; s.closedAtS = stamp(); s.result ??= `closed ${code}`; clearTimeout(timer); resolve(s); });
    ws.on("unexpected-response", (_q, res) => { s.result = `http ${res.statusCode}`; clearTimeout(timer); resolve(s); });
    ws.on("error", () => {});
  });
}
const view = (s) => ({ name: s.name, clientHeader: s.clientHeader, result: s.result, closed: s.closed, closedAtS: s.closedAtS, frames: s.frames });
const rnd = () => crypto.randomBytes(6).toString("hex");
const held = [];
for (let i = 1; i <= 4; i++) held.push(await session(`S${i}`, `spoof-${rnd()}`));
out.first4 = held.map(view); save();
const over = [await session("S5_random", `spoof-${rnd()}`), await session("S6_200chars", "y".repeat(200)), await session("S7_other_ipv4", "203.0.113.9")];
out.over = over.map(view); save();
for (const s of [...held, ...over]) try { s.ws.close(); } catch {}
await sleep(4000);
const s8 = await session("S8_after_close", `spoof-${rnd()}`);
out.after = view(s8); try { s8.ws.close(); } catch {}
out.verdict = { first4Served: held.filter((s) => s.result === "served").length, overRefused: over.filter((s) => s.result !== "served").length, afterServed: s8.result === "served" };
out.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify(out.verdict));
await sleep(1000); process.exit(0);
