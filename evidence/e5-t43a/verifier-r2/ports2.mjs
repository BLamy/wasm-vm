#!/usr/bin/env node
// E5-T43a verifier round 2, R7/R8: destination ports and IPv6 forms on one authenticated session.
// (short2.mjs's version sent CLOSE after an OPEN_FAIL, a protocol error that closed the session;
// this one sends CLOSE only after OPEN_OK.) 1 WebSocket; outbound: connect-and-close to Google SMTP.
import { writeFileSync } from "node:fs";
import { PAGES, OP, connect, getToken, hello, tcpOpen, close, send, frame } from "../verifier/lib.mjs";
const t = await getToken(PAGES);
const out = { tokenStatus: t.status, startedAt: new Date().toISOString() };
const c = await connect(PAGES);
send(c, hello(t.token));
let id = 1;
for (const [h, p, ms] of [["::127.0.0.1", 80, 3000], ["aspmx.l.google.com", 25, 5000], ["smtp.gmail.com", 587, 8000],
  ["smtp.gmail.com", 465, 8000], ["::ffff:0:7f00:1", 80, 3000], ["fec0::1", 80, 3000], ["::ffff:0:a9fe:a9fe", 80, 3000], ["example.com", 80, 8000]]) {
  const sid = id++;
  out[`${h}:${p}`] = await tcpOpen(c, sid, h, p, ms);
  if (out[`${h}:${p}`].result === "OPEN_OK") send(c, frame(sid, OP.CLOSE));
}
out.sessionClosed = c.closed;
close(c);
console.log(JSON.stringify(out, null, 2));
writeFileSync(new URL("./ports2.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
process.exit(0);
