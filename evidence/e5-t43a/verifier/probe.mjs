#!/usr/bin/env node
// E5-T43a verifier, short probes against the deployed relay (about 10 WebSocket connections).
// Never records a token value: only decoded non-secret fields (version, expiry, origin, id length).
import { writeFileSync } from "node:fs";
import { BASE, PAGES, connect, getToken, decodeToken, encodeToken, hello, tcpOpen, udpOpen, httpGet, send, close, frame, OP } from "./lib.mjs";

const out = {};
const hdr = (h) => ({ acao: h["access-control-allow-origin"] ?? null, vary: h.vary ?? null, cc: h["cache-control"] ?? null });

// P1/P2: the token endpoint and the token's shape.
const t1 = await getToken(PAGES), t2 = await getToken(PAGES);
const f1 = decodeToken(t1.token), f2 = decodeToken(t2.token);
const now = Math.floor(Date.now() / 1000);
out.P1 = { status: t1.status, ...hdr(t1.headers), keys: Object.keys(t1.body).sort(), ws: t1.body.ws };
out.P2 = { fields: f1.length, version: f1[0], ttl: Number(f1[1]) - now, expiresAtMatches: Number(f1[1]) === t1.expiresAt,
  origin: f1[2], idHex32: /^[0-9a-f]{32}$/.test(f1[3]), macHex64: /^[0-9a-f]{64}$/.test(f1[4]), idsDiffer: f1[3] !== f2[3] };

// P3: disallowed / variant origins.
out.P3 = {};
for (const o of ["https://evil.example", "HTTPS://WASM-VM.PAGES.DEV", "https://wasm-vm.pages.dev/", "https://wasm-vm.pages.dev:443", "null", "https://x.wasm-vm.pages.dev", ""]) {
  const r = await getToken(o);
  out.P3[o || "(none)"] = { status: r.status, acao: hdr(r.headers).acao, bodyHasToken: typeof r.body === "object" && !!r.body?.token };
}

// P4: the rest of the Worker surface.
const req = async (p, init = {}) => { const r = await fetch(BASE + p, init); return { status: r.status, ...hdr(Object.fromEntries(r.headers)), body: (await r.text()).slice(0, 80) }; };
out.P4 = {
  optionsAllowed: await req("/token", { method: "OPTIONS", headers: { Origin: PAGES, "Access-Control-Request-Method": "GET" } }),
  optionsEvil: await req("/token", { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "GET" } }),
  post: await req("/token", { method: "POST", headers: { Origin: PAGES } }),
  health: await req("/health"),
  wsNoUpgrade: await req("/ws", { headers: { Origin: PAGES } }),
  notFound: await req("/nope"),
  tokenQueryTtl: (() => null)(),
};
{ const r = await fetch(`${BASE}/token?ttl=86400`, { headers: { Origin: PAGES } }); const j = await r.json(); out.P4.tokenQueryTtl = { ttl: Number(decodeToken(j.token)[1]) - Math.floor(Date.now() / 1000) }; }

// P5: right token, a different allowed Origin (reaches wvrelay).
{ const c = await connect("http://localhost:8123"); send(c, hello(t1.token)); out.P5 = { upgraded: !!c.opened, open: await tcpOpen(c, 1, "example.com", 80, 8000), closed: c.closed }; close(c); }
// P6: origin field edited, signature kept.
{ const f = [...f1]; f[2] = "http://localhost:8123"; const forged = encodeToken(f);
  const c = await connect("http://localhost:8123"); send(c, hello(forged)); out.P6 = { upgraded: !!c.opened, open: await tcpOpen(c, 1, "example.com", 80, 8000), closed: c.closed }; close(c); }
// P6b: expiry field extended (signature kept) → InvalidSignature, not accepted.
{ const f = [...f1]; f[1] = String(Number(f[1]) + 100); const forged = encodeToken(f);
  const c = await connect(PAGES); send(c, hello(forged)); out.P6b = { open: await tcpOpen(c, 1, "example.com", 80, 8000), closed: c.closed }; close(c); }

// P7: one token, two concurrent connections.
{ const a = await connect(PAGES), b = await connect(PAGES); send(a, hello(t2.token)); send(b, hello(t2.token));
  const [ra, rb] = await Promise.all([tcpOpen(a, 1, "example.com", 80), tcpOpen(b, 1, "example.com", 80)]);
  out.P7 = { a: ra.result, b: rb.result, aHttp: ra.result === "OPEN_OK" ? await httpGet(a, 1, "example.com") : null, bHttp: rb.result === "OPEN_OK" ? await httpGet(b, 1, "example.com") : null };
  close(a); close(b); }

// P10–P14: destinations on one authenticated session (each OPEN costs a connect from the 120/min budget).
{ const c = await connect(PAGES); send(c, hello(t1.token));
  const tcp = ["::1", "[::1]", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "0.0.0.0", "127.1", "2130706433",
    "100.64.0.1", "172.16.0.1", "192.168.0.1", "169.254.169.254", "127.0.0.1.nip.io", "10.0.0.1.sslip.io", "169.254.169.254.nip.io",
    "::127.0.0.1", "64:ff9b::7f00:1"];
  out.P10_P12 = {}; let id = 1;
  for (const h of tcp) out.P10_P12[h] = await tcpOpen(c, id++, h, 80, 15000);
  out.P11 = {};
  let uid = 0x80000001;
  for (const h of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "127.0.0.1.nip.io"]) out.P11[h] = await udpOpen(c, uid++, h, 53, 15000);
  // Controls: a public IPv6 literal (does the container have IPv6 at all?), example.com:80, port 25.
  out.control = {
    ipv6Public: await tcpOpen(c, id++, "2606:4700:4700::1111", 80, 15000),
    example80: await tcpOpen(c, id, "example.com", 80, 15000),
  };
  if (out.control.example80.result === "OPEN_OK") out.control.example80.http = await httpGet(c, id, "example.com");
  id++;
  out.P13 = { mx25: await tcpOpen(c, id, "aspmx.l.google.com", 25, 15000) };
  if (out.P13.mx25.result === "OPEN_OK") send(c, frame(id, OP.RST));
  out.sessionClosed = c.closed;
  close(c); }

out.finishedAt = new Date().toISOString();
console.log(JSON.stringify(out, null, 2));
writeFileSync(new URL("./probe.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
process.exit(0);
