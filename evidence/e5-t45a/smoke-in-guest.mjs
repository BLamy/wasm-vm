// E5-T45a: the E5-T33 smoke for the packaged node, run on the target (a native wasm-vm boot of the
// Replay desktop image, loopback NIC only: nothing outside the guest is reachable).
import { bootNative } from "../../tools/replay-desktop/native-shell.mjs";
import { writeFile } from "node:fs/promises";
const [image, drive, out] = process.argv.slice(2);
const g = await bootNative({ image, out, net: "--net", extraDrives: [drive], browserTopology: false, timeoutMin: 120, maxInstrs: "4000000000000" });
await g.waitFor((s) => /REPLAY_DESKTOP_MONITOR start/.test(s), "the monitor");
await g.rootShell();
const r = {};
r.mount = await g.sh("mkdir -p /tmp/s && mount -t ext4 -o ro /dev/vdb /tmp/s && sha256sum /tmp/s/node");
r.version = await g.sh("RECORD_REPLAY_DONT_RECORD=1 /tmp/s/node --version");
r.smoke = await g.sh("cd /tmp && RECORD_REPLAY_DONT_RECORD=1 /tmp/s/node /tmp/s/smoke-node26.mjs; echo \"exit $?\"");
r.noEnv = await g.sh("/tmp/s/node -e 'console.log(process.version, process.arch, process.config.variables.node_use_node_code_cache)' 2>/tmp/err; grep -c 'file too short' /tmp/err");
g.stop();
await writeFile(`${out}/result.json`, JSON.stringify(r, null, 2));
console.log(JSON.stringify(r, null, 1));
