// E5-T43i probe: would a Node startup snapshot built from an entry that loads https/tls/http and
// undici (one no-network fetch of a data: URL) make a first fetch cheaper, without changing what a
// user program sees? Native boot of the Replay desktop image with the slirp NIC, serial root shell.
import { bootNative } from "../../tools/replay-desktop/native-shell.mjs";
import { writeFile } from "node:fs/promises";
const [image, out] = process.argv.slice(2);
const g = await bootNative({ image, out, net: "--net-slirp" });
await g.waitFor((s) => /REPLAY_NODE_SNAPSHOT bytes=/.test(s), "node line");
await g.rootShell();
const N = "/opt/replay-node-26/bin/node";
const r = {};
await g.sh(`printf '%s\\n' "require('https'); require('http'); require('tls');" "fetch('data:,x').then((r) => r.text()).catch(() => {});" > /tmp/e.js`);
r.build = await g.sh(`cd /tmp && time ${N} --snapshot-blob /tmp/s2.blob --build-snapshot /tmp/e.js 2>&1 | tail -5; ls -l /tmp/s2.blob /run/replay-node/startup.blob`);
const t = (blob, code) => g.sh(`cd /tmp && time ${N} --snapshot-blob ${blob} -e '${code}' 2>&1 | tail -4`);
for (const [name, code] of Object.entries({
  zero: "0",
  fetchLocal: 'fetch("http://127.0.0.1:9").catch(()=>console.log(1))',
  httpsGet: 'require("https").get("https://example.com",r=>{console.log(r.statusCode);r.resume()})',
  fetchHttps: 'fetch("https://example.com").then(r=>console.log(r.status))',
  globals: "console.log(Object.getOwnPropertyNames(globalThis).length, Object.getOwnPropertySymbols(globalThis).map(String).join(), Object.keys(require.cache).length, process.argv.length)",
})) {
  for (const blob of ["/run/replay-node/startup.blob", "/tmp/s2.blob", "/tmp/s2.blob", "/run/replay-node/startup.blob"]) {
    r[`${name} ${blob} ${Math.random().toString(36).slice(2, 5)}`] = await t(blob, code);
  }
}
g.stop();
await writeFile(`${out}/probe.json`, JSON.stringify(r, null, 2));
for (const [k, v] of Object.entries(r)) console.log("==", k, "\n" + v.trim());
