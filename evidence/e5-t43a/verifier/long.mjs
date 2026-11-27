#!/usr/bin/env node
// E5-T43a verifier, long probe (~11 min, 4 connections): token expiry against the deployed relay.
//   A: HELLO with token T at t0, one OPEN (stream 1) right away, kept alive with client pings; after
//      T's expiry, OPEN stream 3 + HTTP GET (does a session outlive its token? P9).
//   B: never sends HELLO, client pings every 30 s (slowloris: is there a HELLO deadline? P16).
//   C: never sends HELLO, no pings (edge idle timeout, P16).
//   D: a NEW connection after T's expiry presenting T in HELLO (P8).
import { writeFileSync } from "node:fs";
import { PAGES, connect, getToken, hello, tcpOpen, httpGet, send, close, frame, OP } from "./lib.mjs";

const out = { startedAt: new Date().toISOString() };
const t = await getToken(PAGES);
out.token = { status: t.status, expiresAt: t.expiresAt, issuedNow: Math.floor(Date.now() / 1000) };
const A = await connect(PAGES), B = await connect(PAGES), C = await connect(PAGES);
send(A, hello(t.token));
out.A_before = await tcpOpen(A, 1, "example.com", 80);
send(A, frame(1, OP.CLOSE));
const ping = setInterval(() => { for (const c of [A, B]) if (c.closed === null) try { c.ws.ping(); } catch {} }, 30000);
const waitMs = (t.expiresAt + 10) * 1000 - Date.now();
console.error(`waiting ${Math.round(waitMs / 1000)} s for expiry+10`);
await new Promise((r) => setTimeout(r, waitMs));
out.atCheck = { now: Math.floor(Date.now() / 1000), pastExpiryBy: Math.floor(Date.now() / 1000) - t.expiresAt };
out.A_alive = A.closed === null; out.A_closed = A.closed; out.A_closedAt = A.closedAt;
if (A.closed === null) {
  out.A_after = await tcpOpen(A, 3, "example.com", 80);
  if (out.A_after.result === "OPEN_OK") out.A_after.http = await httpGet(A, 3, "example.com");
}
out.B = { alive: B.closed === null, closed: B.closed, closedAtMs: B.closedAt };
out.C = { alive: C.closed === null, closed: C.closed, closedAtMs: C.closedAt };
const D = await connect(PAGES);
send(D, hello(t.token));
out.D_expired = await tcpOpen(D, 1, "example.com", 80, 10000);
out.D_closed = D.closed;
clearInterval(ping);
for (const c of [A, B, C, D]) close(c);
out.finishedAt = new Date().toISOString();
console.log(JSON.stringify(out, null, 2));
writeFileSync(new URL("./long.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
process.exit(0);
