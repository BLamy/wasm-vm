// E5-T43i probe 2: which entry contents can the guest's Node build a startup snapshot from?
import { bootNative } from "../../tools/replay-desktop/native-shell.mjs";
import { writeFile } from "node:fs/promises";
const [image, out] = process.argv.slice(2);
const g = await bootNative({ image, out, net: "--net" });
await g.waitFor((s) => /REPLAY_NODE_SNAPSHOT bytes=/.test(s), "node line");
await g.rootShell();
const N = "/opt/replay-node-26/bin/node";
const entries = {
  https: "require('https');",
  tls: "require('tls');",
  http: "require('http');",
  fetchData: "fetch('data:,x').then((r) => r.text()).catch(() => {});",
  fetchGetter: "void globalThis.fetch;",
};
const r = {};
for (const [name, code] of Object.entries(entries)) {
  await g.sh(`printf '%s\\n' "${code}" > /tmp/${name}.js`);
  r[name] = await g.sh(`cd /tmp && ${N} --snapshot-blob /tmp/${name}.blob --build-snapshot /tmp/${name}.js 2>&1 | grep -v '^ *[0-9]*: 0x' | head -12; echo "exit $?"; ls -l /tmp/${name}.blob 2>&1`);
}
g.stop();
await writeFile(`${out}/probe.json`, JSON.stringify(r, null, 2));
for (const [k, v] of Object.entries(r)) console.log("==", k, "\n" + v.trim());
