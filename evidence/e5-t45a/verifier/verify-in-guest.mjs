// E5-T45a verifier: native wasm-vm boot (loopback NIC), the new node and the E5-T33 node from a
// second drive, attacks P3-P5 and P7.   node evidence/e5-t45a/verifier/verify-in-guest.mjs IMAGE DRIVE OUT
import { bootNative } from "../../../tools/replay-desktop/native-shell.mjs";
import { writeFile } from "node:fs/promises";
const [image, drive, out] = process.argv.slice(2);
const g = await bootNative({ image, out, net: "--net", extraDrives: [drive], browserTopology: false, timeoutMin: 120, maxInstrs: "4000000000000" });
await g.waitFor((s) => /REPLAY_DESKTOP_MONITOR start/.test(s), "the monitor");
await g.rootShell();
const r = {};
const run = async (k, cmd) => { r[k] = await g.sh(cmd); console.log(`== ${k}\n${r[k]}`); };
await run("mount", "mkdir -p /tmp/v && mount -t ext4 -o ro /dev/vdb /tmp/v && sha256sum /tmp/v/node /tmp/v/oldnode /opt/replay-node-26/bin/node; env | grep -i -E 'record|replay|node' ; echo env-done; cat /proc/cpuinfo | grep -m3 -E 'isa|mmu'");
for (const b of ["node", "oldnode"]) {
  const N = `/tmp/v/${b}`;
  await run(`${b}.config`, `RECORD_REPLAY_DONT_RECORD=1 ${N} -p 'JSON.stringify([process.version, process.config.variables.node_use_node_snapshot, process.config.variables.node_use_node_code_cache])'`);
  await run(`${b}.noEnv`, `ls /tmp/recordreplay.so-* 2>&1 | head -2; ${N} -e 'console.log("ran", typeof process.recordreplay)' >/tmp/o 2>/tmp/e; echo "exit $?"; cat /tmp/o; echo '-- stderr:'; cat /tmp/e; ls /tmp/recordreplay.so-* 2>&1 | head -2`);
  await run(`${b}.badDriver`, `RECORD_REPLAY_DRIVER=/nonexistent/driver.so ${N} -e 'console.log("ran")' 2>&1; echo "exit $?"`);
  await run(`${b}.codeCache`, `RECORD_REPLAY_DONT_RECORD=1 NODE_DEBUG_NATIVE=CODE_CACHE ${N} -e 'require("https"); require("child_process"); new (require("worker_threads").Worker)("1",{eval:true}).on("exit",()=>console.log("w-exit"))' >/tmp/cc 2>&1; echo "exit $?"; echo "accepted $(grep -c 'is accepted' /tmp/cc) rejected $(grep -c 'is rejected' /tmp/cc) with $(grep -c 'with code cache' /tmp/cc) without $(grep -c 'without code cache' /tmp/cc) embedderRejected $(grep -c 'EmbedderBuiltinCodeCache rejected' /tmp/cc)"; grep -m3 'snapshot contains' /tmp/cc; grep -m2 'is rejected' /tmp/cc; grep -m2 'without code cache' /tmp/cc; grep -m3 -E 'https|_tls_wrap|undici' /tmp/cc; grep w-exit /tmp/cc`);
  await run(`${b}.smoke`, `cd /tmp && RECORD_REPLAY_DONT_RECORD=1 ${N} /tmp/v/smoke-node26.mjs | tail -1; echo "exit $?"`);
  await run(`${b}.esm`, `cd /tmp/v && RECORD_REPLAY_DONT_RECORD=1 ${N} --no-warnings ./esm.mjs a b; echo "exit $?"; cd /tmp`);
  await run(`${b}.repl`, `RECORD_REPLAY_DONT_RECORD=1 ${N} -i < /tmp/v/repl.txt 2>&1 | tr -d '\\033' | tail -3; echo "exit $?"`);
  await run(`${b}.userSnapshot`, `cd /tmp && rm -f /tmp/${b}.blob && RECORD_REPLAY_DONT_RECORD=1 ${N} --snapshot-blob /tmp/${b}.blob --build-snapshot /tmp/v/snap-entry.js > /tmp/sb 2>&1; echo "build $?"; tail -2 /tmp/sb; ls -la /tmp/${b}.blob | awk '{print $5}'; RECORD_REPLAY_DONT_RECORD=1 ${N} --snapshot-blob /tmp/${b}.blob x y; echo "run $?"`);
  await run(`${b}.noSnapshotFlag`, `RECORD_REPLAY_DONT_RECORD=1 ${N} --no-node-snapshot -e 'console.log("nosnap", require("https").request.name)'; echo "exit $?"`);
  await run(`${b}.mem`, `RECORD_REPLAY_DONT_RECORD=1 ${N} -e 'const m=process.memoryUsage(); console.log("rss", m.rss, "heapUsed", m.heapUsed, "heapTotal", m.heapTotal)'`);
  await run(`${b}.time`, `for i in 1 2; do a=$(cut -d' ' -f1 /proc/uptime); RECORD_REPLAY_DONT_RECORD=1 ${N} -e 'require("https")'; b2=$(cut -d' ' -f1 /proc/uptime); echo "T $a $b2"; done; for i in 1; do a=$(cut -d' ' -f1 /proc/uptime); RECORD_REPLAY_DONT_RECORD=1 ${N} --no-node-snapshot -e 'require("https")'; b2=$(cut -d' ' -f1 /proc/uptime); echo "NOSNAP $a $b2"; done`);
}
r.hostSeconds = g.hostSeconds();
g.stop();
await writeFile(`${out}/result.json`, JSON.stringify(r, null, 2));
