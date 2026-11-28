#!/usr/bin/env node
// E5-T43a round-4 verifier, LIVE idle limit (B4 in predictions.md). ~33 min, 7 WebSockets, connect-only.
// A: HELLO + OPEN example.com:80, then silent.  D: HELLO only, then silent.
// B, C: HELLO + OPEN example.com:80, then only WINDOW(stream 1, credit 1) every 240 s (no bytes).
// At ~31.5 min: E, F, G new sessions -> predicted E, F served (A's and D's places freed), G refused.
import { writeFileSync } from "node:fs";
import { BASE, WS, PAGES, OP, WebSocket, frame, hostPort } from "../verifier/lib.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t00 = Date.now(); const stamp = () => Math.round((Date.now() - t00) / 1000);
const out = { startedAt: new Date().toISOString(), base: BASE };
const save = () => writeFileSync(new URL("./idle4.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
async function fetchToken() { for (;;) { const r = await fetch(`${BASE}/token`, { headers: { Origin: PAGES } });
  if (r.status === 200) return (await r.json()).token; if (r.status === 429) { await sleep(10000); continue; } throw new Error(`token ${r.status}`); } }
const hello = (t) => frame(0, OP.HELLO, new Uint8Array([1, ...Buffer.from(t)]));
function sess(name, token, open) {
  return new Promise((resolve) => {
    const s = { name, frames: [], closed: null, closedAtS: null, lastSentAtS: null, sent: 0 };
    const ws = new WebSocket(WS, { headers: { Origin: PAGES } }); ws.binaryType = "arraybuffer"; s.ws = ws;
    s.send = (b) => { try { ws.send(b); s.sent++; s.lastSentAtS = stamp(); } catch {} };
    const timer = setTimeout(() => { s.result ??= "no answer"; resolve(s); }, 15000);
    ws.on("open", () => { s.send(hello(token)); if (open) s.send(frame(1, OP.OPEN, hostPort("example.com", 80))); else setTimeout(() => { s.result ??= "hello sent"; clearTimeout(timer); resolve(s); }, 1500); });
    ws.on("message", (d) => { const b = new Uint8Array(d); const id = new DataView(b.buffer, b.byteOffset).getUint32(0);
      s.frames.push({ id, op: b[4], atS: stamp() });
      if (open && id === 1 && s.result === undefined) { s.result = b[4] === OP.OPEN_OK ? "served" : `fail ${b[5]}`; clearTimeout(timer); resolve(s); } });
    ws.on("close", (code) => { s.closed = code; s.closedAtS = stamp(); s.result ??= `closed ${code}`; clearTimeout(timer); resolve(s); });
    ws.on("error", () => {});
  });
}
const view = (s) => ({ name: s.name, result: s.result, closed: s.closed, closedAtS: s.closedAtS, lastSentAtS: s.lastSentAtS, sent: s.sent,
  idleBeforeCloseS: s.closedAtS !== null && s.lastSentAtS !== null ? s.closedAtS - s.lastSentAtS : null, frames: s.frames });
const A = await sess("A_idle_with_stream", await fetchToken(), true);
const D = await sess("D_idle_no_stream", await fetchToken(), false);
const B = await sess("B_window_only", await fetchToken(), true);
const C = await sess("C_window_only", await fetchToken(), true);
out.opened = [A, D, B, C].map(view); save();
const keep = [B, C];
while (Date.now() - t00 < 31.5 * 60 * 1000) {
  await sleep(240000);
  for (const s of keep) if (s.closed === null) s.send(frame(1, OP.WINDOW, new Uint8Array([0, 0, 0, 1])));
  out.progress = { atS: stamp(), sessions: [A, D, B, C].map((s) => ({ name: s.name, closed: s.closed, closedAtS: s.closedAtS, sent: s.sent })) }; save();
}
out.at31 = [A, D, B, C].map(view);
const E = await sess("E_new", await fetchToken(), true);
const F = await sess("F_new", await fetchToken(), true);
const G = await sess("G_new", await fetchToken(), true);
out.afterIdle = [E, F, G].map(view);
await sleep(2000);
out.final = [A, D, B, C, E, F, G].map(view);
for (const s of [A, D, B, C, E, F, G]) try { s.ws.close(); } catch {}
out.finishedAt = new Date().toISOString(); save();
await sleep(1500); process.exit(0);
