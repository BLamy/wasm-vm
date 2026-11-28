// E5-T45a: the new Node (snapshot + code cache, from a second drive) against the shipped one, in a
// native wasm-vm boot with the slirp network. Guest seconds (instruction-counted while busy).
import { bootNative } from "../../tools/replay-desktop/native-shell.mjs";
import { writeFile } from "node:fs/promises";
const [image, drive, out] = process.argv.slice(2);
const g = await bootNative({ image, out, net: "--net-slirp", extraDrives: [drive], browserTopology: false, timeoutMin: 120, maxInstrs: "4000000000000" });
await g.waitFor((s) => /REPLAY_NETWORK bound/.test(s), "the lease");
await g.rootShell();
await g.sh("mkdir -p /tmp/nn && mount -t ext4 -o ro /dev/vdb /tmp/nn");
const NEW = "/tmp/nn/node", OLD = "/opt/replay-node-26/bin/node";
const r = { config: {} };
for (const [k, bin] of [["new", NEW], ["old", OLD]]) {
  r.config[k] = (await g.sh(`RECORD_REPLAY_DONT_RECORD=1 ${bin} -p 'JSON.stringify([process.version, process.config.variables.node_use_node_snapshot, process.config.variables.node_use_node_code_cache])'`)).trim();
}
const cmds = {
  zero: "0",
  fetchLocal: 'fetch("http://127.0.0.1:9").catch(()=>console.log(1))',
  httpsGet: 'require("https").get("https://example.com",r=>{console.log(r.statusCode);r.resume()})',
  fetchHttps: 'fetch("https://example.com").then(r=>console.log(r.status))',
  requireMany: 'for (const m of ["child_process","crypto","zlib","http","worker_threads","readline","stream/web","util"]) require(m); console.log(1)',
};
const time = async (bin, code) => {
  const t = await g.sh(`a=$(cut -d' ' -f1 /proc/uptime); RECORD_REPLAY_DONT_RECORD=1 ${bin} -e '${code}' >/tmp/o 2>&1; b=$(cut -d' ' -f1 /proc/uptime); echo "T $a $b $(head -c 80 /tmp/o | tr '\\n' ' ')"`);
  const m = /T (\S+) (\S+) (.*)/.exec(t); return { s: +(m[2] - m[1]).toFixed(2), out: m[3].trim() };
};
r.times = {};
for (const [name, code] of Object.entries(cmds)) {
  r.times[name] = {};
  for (const k of ["new", "old", "new", "old"]) { (r.times[name][k] ??= []).push(await time(k === "new" ? NEW : OLD, code)); }
}
// The shipped wrapper's user-land startup snapshot built from the new binary, on top of its built-in one.
r.userSnapshot = await g.sh(`cd /tmp && RECORD_REPLAY_DONT_RECORD=1 ${NEW} --snapshot-blob /tmp/u.blob --build-snapshot /dev/null >/tmp/ub.log 2>&1; echo "build $?"; ls -la /tmp/u.blob; tail -2 /tmp/ub.log`);
r.times.zeroUserBlob = []; r.times.fetchLocalUserBlob = [];
for (let i = 0; i < 2; i++) {
  r.times.zeroUserBlob.push(await time(`${NEW} --snapshot-blob /tmp/u.blob`, "0"));
  r.times.fetchLocalUserBlob.push(await time(`${NEW} --snapshot-blob /tmp/u.blob`, 'fetch("http://127.0.0.1:9").catch(()=>console.log(1))'));
}
r.smoke = await g.sh(`RECORD_REPLAY_DONT_RECORD=1 ${NEW} --version; RECORD_REPLAY_DONT_RECORD=1 ${NEW} -e 'const {Worker}=require("worker_threads"); new Worker("require(\\"worker_threads\\").parentPort.postMessage(7)",{eval:true}).on("message",m=>console.log("worker",m))'`);
g.stop();
await writeFile(`${out}/result.json`, JSON.stringify(r, null, 2));
console.log(JSON.stringify(r, null, 1));
