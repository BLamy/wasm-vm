#!/usr/bin/env node
// E5-T43a verifier round 2, long probe (~11.5 min, 3 connections): is a token's connect budget the
// same budget before and after its expiry, shared by its sessions (R1-R4 in predictions.md)?
// OPENs to 127.0.0.1 consume a connect (reserved before the policy runs) and dial nothing:
// OPEN_FAIL:1 = policy refusal (counted), OPEN_FAIL:2 = quota refusal.
import { writeFileSync } from "node:fs";
import { PAGES, connect, getToken, hello, tcpOpen, httpGet, close, send } from "../verifier/lib.mjs";

const now = () => Math.floor(Date.now() / 1000);
const sleepUntil = (unix) => new Promise((r) => setTimeout(r, Math.max(0, unix * 1000 - Date.now())));
const tally = (rs) => rs.reduce((m, r) => ((m[r.result] = (m[r.result] || 0) + 1), m), {});
const out = { startedAt: new Date().toISOString() };
const t = await getToken(PAGES);
const E = t.expiresAt;
out.token = { status: t.status, expiresAt: E, issuedAt: now() };
const A = await connect(PAGES), B = await connect(PAGES);
send(A, hello(t.token)); send(B, hello(t.token));
out.A_first = await tcpOpen(A, 900, "127.0.0.1", 80);   // proves A authenticated (FAIL:1, not closed)
out.B_first = await tcpOpen(B, 900, "127.0.0.1", 80);   // proves B authenticated; B then idles
console.error(`token expires ${E}; burning at ${E - 40}`);
await sleepUntil(E - 40);
const burn = [];
out.burnStart = now() - E;
for (let i = 1; i <= 100; i++) burn.push(await tcpOpen(A, i, "127.0.0.1", 80, 5000));
out.burnEnd = now() - E;
out.burn = tally(burn);                 // 100 connects in this 60 s window (the two first OPENs are ~9 min older)
await sleepUntil(E + 8);
out.afterExpiryAt = now() - E;
out.B_alive_at_expiry = B.closed === null;
const b = []; for (let i = 1; i <= 10; i++) b.push(await tcpOpen(B, i, "127.0.0.1", 80, 5000));
out.B_after = { tally: tally(b), seq: b.map((r) => r.result) };
const a = []; for (let i = 101; i <= 120; i++) a.push(await tcpOpen(A, i, "127.0.0.1", 80, 5000));
out.A_after = { tally: tally(a), seq: a.map((r) => r.result) };
out.afterExpiryEnd = now() - E;
const D = await connect(PAGES);
send(D, hello(t.token));
out.D_expired = await tcpOpen(D, 1, "127.0.0.1", 80, 10000);
out.D_closed = D.closed;
await sleepUntil(E + 75);
out.windowClearedAt = now() - E;
out.A_late = await tcpOpen(A, 200, "example.com", 80);
if (out.A_late.result === "OPEN_OK") out.A_late.http = await httpGet(A, 200, "example.com");
out.B_end = { alive: B.closed === null, closed: B.closed, closedAtMs: B.closedAt, aliveForS: Math.round((Date.now() - B.t0) / 1000) };
for (const c of [A, B, D]) close(c);
out.finishedAt = new Date().toISOString();
console.log(JSON.stringify(out, null, 2));
writeFileSync(new URL("./long2.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
process.exit(0);
