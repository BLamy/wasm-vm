import { readFileSync } from "node:fs";
const src = readFileSync(process.argv[2], "utf8");
const body = /export function clientKey\(request\) \{[\s\S]*?\n\}/.exec(src)[0].replace("export ", "");
const clientKey = new Function(`${body}; return clientKey;`)();
const req = (ip) => ({ headers: { get: (k) => (k === "CF-Connecting-IP" ? ip : null) } });
const cases = ["203.0.113.7", "2001:db8:abcd:12::1", "2001:db8:abcd:12:ffff:ffff:ffff:ffff", "2001:db8:abcd:13::1", "2001:DB8:ABCD:12::9",
  "2001:0db8:abcd:0012::1", "2001:db8::1", "::ffff:203.0.113.7", "::1", null];
const out = {}; for (const c of cases) out[String(c)] = clientKey(req(c));
console.log(JSON.stringify(out, null, 2));
// How many distinct /64 keys one routed /56 yields (2001:db8:abcd:1200::/56).
const keys = new Set(); for (let i = 0; i < 256; i++) keys.add(clientKey(req(`2001:db8:abcd:12${i.toString(16).padStart(2, "0")}::1`)));
console.log("distinct keys from one /56:", keys.size, "x 8 sessions =", keys.size * 8, "(total cap 256)");
