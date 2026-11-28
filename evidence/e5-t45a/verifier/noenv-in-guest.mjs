// E5-T45a verifier: the image's root shell exports RECORD_REPLAY_DONT_RECORD=1, so a real no-env
// run must unset it. Runs the driver-slot paths for the new and the E5-T33 node.
import { bootNative } from "../../../tools/replay-desktop/native-shell.mjs";
import { writeFile } from "node:fs/promises";
const [image, drive, out] = process.argv.slice(2);
const g = await bootNative({ image, out, net: "--net", extraDrives: [drive], browserTopology: false, timeoutMin: 60, maxInstrs: "4000000000000" });
await g.waitFor((s) => /REPLAY_DESKTOP_MONITOR start/.test(s), "the monitor");
await g.rootShell();
const r = {};
const run = async (k, cmd) => { r[k] = await g.sh(cmd); console.log(`== ${k}\n${r[k]}`); };
await run("mount", "mkdir -p /tmp/v && mount -t ext4 -o ro /dev/vdb /tmp/v && sha256sum /tmp/v/node /tmp/v/oldnode; env | grep -c RECORD_REPLAY; env -u RECORD_REPLAY_DONT_RECORD env | grep -c RECORD_REPLAY");
for (const b of ["node", "oldnode"]) {
  const N = `/tmp/v/${b}`;
  await run(`${b}.noEnv`, `env -u RECORD_REPLAY_DONT_RECORD ${N} -e 'console.log("ran", process.version, process.arch, typeof process.recordreplay, process.config.variables.node_use_node_code_cache)' >/tmp/o 2>/tmp/e; echo "exit $?"; cat /tmp/o; echo '-- stderr:'; cat /tmp/e; ls /tmp/recordreplay.so-* 2>&1 | head -2`);
  await run(`${b}.badDriver`, `env -u RECORD_REPLAY_DONT_RECORD RECORD_REPLAY_DRIVER=/nonexistent/driver.so ${N} -e 'fetch("data:,x").then(r=>r.text()).then(t=>console.log("ran", t))' 2>&1; echo "exit $?"`);
  await run(`${b}.noEnvSmoke`, `cd /tmp && env -u RECORD_REPLAY_DONT_RECORD ${N} /tmp/v/smoke-node26.mjs 2>&1 | tail -2; echo "exit $?"`);
}
g.stop();
await writeFile(`${out}/result.json`, JSON.stringify(r, null, 2));
